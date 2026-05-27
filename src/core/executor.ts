// PLUMB — Executor
// Bridges A2A tasks to CLI processes. Writes every lifecycle event to the ledger.
// Supports oneshot (process-per-task) and persistent (single long-running process) modes.

import { randomUUID } from 'node:crypto';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import type { AgentAdapter, AgentTask, AdapterEvent, PlumbConfig, TaskMetadata } from '../types.ts';
import { ProcessManager, PersistentProcess } from './process.ts';
import { Ledger } from './ledger.ts';

/** Fang Post-Parse hook: transforms events after parseLine, before executor processes them. */
export type FangPostParse = (events: AdapterEvent[], ctx: { taskId: string; adapterId: string }) => AdapterEvent[];

export class PlumbExecutor implements AgentExecutor {
  private pm = new ProcessManager();
  private persistent: PersistentProcess | null = null;
  private adapter: AgentAdapter;
  private config: PlumbConfig;
  private ledger: Ledger;
  private contextByTaskId = new Map<string, string>();
  /** Active INK metadata per taskId. Bounded: entries deleted on task completion/failure/cancellation. */
  private inkByTaskId = new Map<string, TaskMetadata>();

  private fangHook?: FangPostParse;

  constructor(adapter: AgentAdapter, config: PlumbConfig, ledger: Ledger, fangHook?: FangPostParse) {
    this.adapter = adapter;
    this.config = config;
    this.ledger = ledger;
    this.fangHook = fangHook;
  }

  async execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = ctx;

    // Normalize A2A part boundary: accept both `type` (A2A standard) and `kind` (Plumb internal)
    type PartEntry = { kind?: string; type?: string; text?: string };
    const parts = (ctx.userMessage.parts ?? []) as PartEntry[];
    const text = parts
      .filter(p => (p.kind === 'text' || p.type === 'text') && typeof p.text === 'string')
      .map(p => p.text!)
      .join('\n').trim();

    if (!text) {
      this.fail(bus, taskId, contextId, 'No message text provided.', 'rejected');
      bus.finished();
      return;
    }

    // ─── INK metadata extraction ────────────────────────────────────────────
    const ink = this.extractInk(ctx);
    // Preserve caller's senderUnixMs for elapsed budget calculation;
    // overwrite with our arrival time for downstream clock skew detection.
    const inboundUnixMs = Date.now();
    this.inkByTaskId.set(taskId, ink);

    // Validate: reject negative or non-numeric depth
    if (ink.depth !== undefined && (!Number.isFinite(ink.depth) || ink.depth < 0)) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, `Invalid depth: ${ink.depth}`, 'rejected');
      bus.finished();
      return;
    }

    // Validate: reject negative budget
    if (ink.budgetMs !== undefined && (!Number.isFinite(ink.budgetMs) || ink.budgetMs < 0)) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, `Invalid budgetMs: ${ink.budgetMs}`, 'rejected');
      bus.finished();
      return;
    }

    // Validate: field length limits
    if (ink.correlationId !== undefined && ink.correlationId.length > 128) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, 'correlationId exceeds 128 chars', 'rejected');
      bus.finished();
      return;
    }
    if (ink.idempotencyKey !== undefined && ink.idempotencyKey.length > 256) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, 'idempotencyKey exceeds 256 chars', 'rejected');
      bus.finished();
      return;
    }
    if (ink.tracestate !== undefined && ink.tracestate.length > 512) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, 'tracestate exceeds 512 chars', 'rejected');
      bus.finished();
      return;
    }

    // Validate: traceparent format (W3C: 2-32-16-2 hex segments)
    if (ink.traceparent !== undefined
      && !/^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i.test(ink.traceparent)) {
      // Malformed traceparent: strip it rather than reject (non-fatal)
      delete ink.traceparent;
    }

    // Validate: senderUnixMs must be present at depth > 0
    // (inter-Plumb traffic without it means budget arithmetic is broken)
    if (ink.depth !== undefined && ink.depth > 0 && ink.senderUnixMs === undefined) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, 'senderUnixMs required for inter-Plumb traffic (depth > 0)', 'rejected');
      bus.finished();
      return;
    }

    // Precedence: deadlineUnixMs is canonical. If budgetMs disagrees, deadline wins.
    if (ink.budgetMs !== undefined && ink.deadlineUnixMs !== undefined) {
      const budgetImpliedDeadline = (ink.senderUnixMs ?? inboundUnixMs) + ink.budgetMs;
      if (Math.abs(budgetImpliedDeadline - ink.deadlineUnixMs) > 1000) {
        // Significant disagreement (>1s). deadlineUnixMs wins, log warning.
        this.ledger.append({
          type: 'log', taskId, level: 'warn',
          text: `budgetMs/deadlineUnixMs disagree (budget implies ${budgetImpliedDeadline}, deadline ${ink.deadlineUnixMs}). deadlineUnixMs wins.`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Enforce admission deadline: if absolute deadline is past, reject immediately
    // NOTE: This is admission control only. Real wall-clock enforcement comes in Day 3.
    if (ink.deadlineUnixMs !== undefined && Date.now() > ink.deadlineUnixMs) {
      this.inkByTaskId.delete(taskId);
      this.fail(bus, taskId, contextId, 'Task deadline exceeded before execution', 'rejected');
      bus.finished();
      return;
    }

    // Enforce hop depth: maxDepth (default 4), A2A hops across mesh only
    const maxDepth = this.config.maxDepth ?? 4;
    if (ink.depth !== undefined) {
      if (ink.depth >= maxDepth) {
        this.inkByTaskId.delete(taskId);
        this.fail(bus, taskId, contextId, `Max hop depth (${maxDepth}) exceeded (current: ${ink.depth})`, 'rejected');
        bus.finished();
        return;
      }
      ink.depth++; // increment for this A2A hop
    }

    // Enforce budget: subtract real elapsed time since original sender
    if (ink.budgetMs !== undefined) {
      const originTime = ink.senderUnixMs ?? inboundUnixMs;
      const elapsed = inboundUnixMs - originTime;
      const remaining = ink.budgetMs - elapsed;
      if (remaining <= 0) {
        this.inkByTaskId.delete(taskId);
        this.fail(bus, taskId, contextId, 'Task budget exhausted before execution', 'rejected');
        bus.finished();
        return;
      }
      ink.budgetMs = remaining;
    }

    // If deadlineUnixMs is set, derive budgetMs for downstream if not already present
    // (budgetMs is a derived hint on egress; deadlineUnixMs is canonical)
    if (ink.deadlineUnixMs !== undefined && ink.budgetMs === undefined) {
      ink.budgetMs = ink.deadlineUnixMs - inboundUnixMs;
    }

    // Stamp senderUnixMs for downstream hop clock skew detection
    // (done AFTER budget calc so budget uses the original origin time)
    ink.senderUnixMs = inboundUnixMs;

    this.ledger.append({
      type: 'task_submitted',
      taskId,
      cli: this.config.cli,
      message: text,
      timestamp: new Date().toISOString(),
      ink: this.hasInk(ink) ? ink : undefined,
    });

    this.contextByTaskId.set(taskId, contextId);
    const task: AgentTask = { id: taskId, message: text, context: { workdir: this.config.workdir, ink: this.hasInk(ink) ? ink : undefined } };

    if (this.adapter.mode === 'persistent') {
      await this.executePersistent(ctx, bus, task);
    } else {
      await this.executeOneshot(ctx, bus, task);
    }
  }

  /** Unified event processor — shared by both oneshot and persistent loops.
   *  Applies Fang post-parse hook first, then handles each event type. */
  private handleEvents(
    rawEvents: AdapterEvent[],
    accumulated: { text: string },
    settled: { value: boolean },
    taskId: string,
    contextId: string,
    ledger: Ledger,
    bus: ExecutionEventBus,
    timer: ReturnType<typeof setTimeout>,
    resolve: () => void,
    cleanup: () => void,
  ): void {
    // Fang Post-Parse: transform events before processing
    const events = this.fangHook
      ? this.fangHook(rawEvents, { taskId, adapterId: this.adapter.id })
      : rawEvents;

    for (const ev of events) {
      if (ev.type === 'text-delta' && ev.text) {
        accumulated.text += ev.text;
        ledger.append({ type: 'progress', taskId, text: ev.text, timestamp: new Date().toISOString() });
        bus.publish({
          kind: 'artifact-update', taskId, contextId,
          artifact: { artifactId: 'stdout', name: 'output', parts: [{ kind: 'text', text: ev.text }] },
          append: true, lastChunk: false,
        });
      }
      if (ev.type === 'tool-call' && ev.tool) {
        const label = `[${ev.tool}]${ev.input ? ' ' + JSON.stringify(ev.input) : ''}\n`;
        accumulated.text += label;
        ledger.append({ type: 'progress', taskId, text: label, timestamp: new Date().toISOString() });
        bus.publish({ kind: 'artifact-update', taskId, contextId, artifact: { artifactId: 'stdout', name: 'output', parts: [{ kind: 'text', text: label }] }, append: true, lastChunk: false });
      }
      if (ev.type === 'tool-result' && ev.output) {
        const label = `→ ${ev.isError ? '✗' : '✓'} ${ev.output}\n`;
        accumulated.text += label;
        ledger.append({ type: 'progress', taskId, text: label, timestamp: new Date().toISOString() });
        bus.publish({ kind: 'artifact-update', taskId, contextId, artifact: { artifactId: 'stdout', name: 'output', parts: [{ kind: 'text', text: label }] }, append: true, lastChunk: false });
      }
      if (ev.type === 'status' && ev.state === 'completed') {
        settled.value = true;
        clearTimeout(timer);
        cleanup();
        ledger.append({ type: 'task_completed', taskId, timestamp: new Date().toISOString() });
        bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated.text || 'Done' }] });
        bus.finished();
        resolve();
      }
      if (ev.type === 'error') {
        settled.value = true;
        clearTimeout(timer);
        cleanup();
        ledger.append({ type: 'task_failed', taskId, error: ev.message, timestamp: new Date().toISOString() });
        this.fail(bus, taskId, contextId, ev.message);
        bus.finished();
        resolve();
      }
    }
  }

  private async executeOneshot(
    ctx: RequestContext,
    bus: ExecutionEventBus,
    task: AgentTask,
  ): Promise<void> {
    const { taskId, contextId } = ctx;
    const { adapter, config, ledger } = this;
    const timeout = config.taskTimeout ?? 300;

    bus.publish({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      history: [],
    });

    const ink = this.inkByTaskId.get(taskId);
    ledger.append({ type: 'task_running', taskId, timestamp: new Date().toISOString(), ink });

    const [cmd, ...cliArgs] = this.splitCli(config.cli);
    const extraArgs = adapter.buildArgs(task, config);
    const accumulated = { text: '' };
    const settled = { value: false };

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (settled.value) return;
        settled.value = true;
        this.pm.kill(taskId);
        this.inkByTaskId.delete(taskId);
        ledger.append({ type: 'task_failed', taskId, error: `timed out after ${timeout}s`, timestamp: new Date().toISOString(), ink });
        this.fail(bus, taskId, contextId, `Task timed out after ${timeout}s`);
        bus.finished();
        resolve();
      }, timeout * 1000);

      this.pm.spawn(
        taskId, cmd!, [...cliArgs, ...extraArgs],
        { cwd: config.workdir, env: config.env },
        {
          onLine: (line) => {
            if (settled.value) return;
            const events = adapter.parseLine(line);
            this.handleEvents(events, accumulated, settled, taskId, contextId, ledger, bus, timer, resolve, () => {
              this.contextByTaskId.delete(taskId);
            });
          },
          onError: (text) => {
            ledger.append({ type: 'log', taskId, level: 'error', text, timestamp: new Date().toISOString() });
            bus.publish({
              kind: 'artifact-update', taskId, contextId,
              artifact: { artifactId: 'stderr', name: 'errors', parts: [{ kind: 'text', text }] },
            });
          },
          onExit: (code) => {
            clearTimeout(timer);
            if (settled.value) { resolve(); return; }
            settled.value = true;
            this.contextByTaskId.delete(taskId);
            this.inkByTaskId.delete(taskId);
            if (code === 0) {
              ledger.append({ type: 'task_completed', taskId, timestamp: new Date().toISOString(), ink });
              bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated.text || '(no output)' }] });
            } else {
              const errMsg = `Process exited with code ${code}`;
              ledger.append({ type: 'task_failed', taskId, error: errMsg, timestamp: new Date().toISOString(), ink });
              bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: errMsg }] });
            }
            bus.finished();
            resolve();
          },
        },
      );

      // Notify adapter of user message (Cursor session tracking)
      const adapterAny = adapter as unknown as Record<string, unknown>;
      if (typeof adapterAny.setUserMessage === 'function') {
        (adapterAny as { setUserMessage(msg: string): void }).setUserMessage(task.message);
      }
      this.pm.stdin(taskId, adapter.formatInput(task), true);
    });
  }

  private async executePersistent(
    ctx: RequestContext,
    bus: ExecutionEventBus,
    task: AgentTask,
  ): Promise<void> {
    const { taskId, contextId } = ctx;
    const { adapter, config, ledger } = this;
    const timeout = config.taskTimeout ?? 300;

    // Ensure persistent process is running
    if (!this.persistent) {
      const [cmd, ...cliArgs] = this.splitCli(config.cli);
      const extraArgs = adapter.buildArgs(task, config);
      this.persistent = new PersistentProcess(cmd!, [...cliArgs, ...extraArgs], {
        cwd: config.workdir,
        env: config.env,
      });
      // Forward persistent stderr to ledger
      this.persistent.onStderr = (text: string) => {
        this.ledger.append({
          type: 'log',
          taskId: '(persistent)',
          level: 'stderr',
          text,
          timestamp: new Date().toISOString(),
        });
      };
    }
    await this.persistent.ensure();
    // Short ready-wait (30s). If agent never emits ready frame but is alive, proceed.
    await this.persistent.waitUntilReady(30_000);

    bus.publish({
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'working', timestamp: new Date().toISOString() },
      history: [],
    });

    const ink = this.inkByTaskId.get(taskId);
    ledger.append({ type: 'task_running', taskId, timestamp: new Date().toISOString(), ink });

    const accumulated = { text: '' };
    const settled = { value: false };

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (settled.value) return;
        settled.value = true;
        this.persistent?.removeLineHandler(taskId);
        this.inkByTaskId.delete(taskId);
        ledger.append({ type: 'task_failed', taskId, error: `timed out after ${timeout}s`, timestamp: new Date().toISOString(), ink });
        this.fail(bus, taskId, contextId, `Task timed out after ${timeout}s`);
        bus.finished();
        resolve();
      }, timeout * 1000);

      this.persistent!.setLineHandler(taskId, (line) => {
        if (settled.value) return;
        const events = adapter.parseLine(line);
        this.handleEvents(events, accumulated, settled, taskId, contextId, ledger, bus, timer, resolve, () => {
          this.contextByTaskId.delete(taskId);
          this.persistent?.removeLineHandler(taskId);
        });

      });

      // Notify adapter of user message (Cursor session tracking)
      const adapterAny = adapter as unknown as Record<string, unknown>;
      if (typeof adapterAny.setUserMessage === 'function') {
        (adapterAny as { setUserMessage(msg: string): void }).setUserMessage(task.message);
      }
      // Send task input to the persistent process
      this.persistent!.writeWhenActive(taskId, adapter.formatInput(task));
    });
  }

  async cancelTask(taskId: string, bus: ExecutionEventBus): Promise<void> {
    const contextId = this.contextByTaskId.get(taskId) ?? taskId;

    if (this.adapter.mode === 'persistent' && this.persistent) {
      this.persistent.removeLineHandler(taskId);
    } else {
      this.pm.kill(taskId, this.config.killTimeout ?? 5000);
    }

    this.contextByTaskId.delete(taskId);
    const ink = this.inkByTaskId.get(taskId);
    this.inkByTaskId.delete(taskId);
    this.ledger.append({ type: 'task_cancelled', taskId, timestamp: new Date().toISOString(), ink });
    bus.publish({
      kind: 'status-update', taskId, contextId, final: true,
      status: {
        state: 'canceled',
        message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text: 'Task cancelled.' }] },
        timestamp: new Date().toISOString(),
      },
    });
    bus.finished();
  }

  async shutdown(): Promise<void> {
    this.contextByTaskId.clear();
    this.inkByTaskId.clear();
    await this.pm.killAll();
    if (this.persistent) {
      await this.persistent.kill();
      this.persistent = null;
    }
  }

  /** Persistent agent liveness. null for oneshot, true/false for persistent. */
  isPersistentAlive(): boolean | null {
    if (this.adapter.mode !== 'persistent') return null;
    return this.persistent?.isAlive ?? false;
  }

  private fail(
    bus: ExecutionEventBus,
    taskId: string,
    contextId: string,
    text: string,
    state: 'failed' | 'rejected' = 'failed',
  ): void {
    this.contextByTaskId.delete(taskId);
    bus.publish({
      kind: 'status-update', taskId, contextId, final: true,
      status: {
        state,
        message: { kind: 'message', role: 'agent', messageId: randomUUID(), parts: [{ kind: 'text', text }] },
        timestamp: new Date().toISOString(),
      },
    });
  }

  /** Extract INK metadata from the A2A message metadata field. */
  private extractInk(ctx: RequestContext): TaskMetadata {
    const meta = (ctx.userMessage.metadata ?? {}) as Record<string, unknown>;
    return {
      correlationId: meta.correlationId as string | undefined,
      depth: meta.depth as number | undefined,
      budgetMs: meta.budgetMs as number | undefined,
      deadlineUnixMs: meta.deadlineUnixMs as number | undefined,
      senderUnixMs: meta.senderUnixMs as number | undefined,
      priority: meta.priority as 'critical' | 'normal' | 'background' | undefined,
      idempotencyKey: meta.idempotencyKey as string | undefined,
      traceparent: meta.traceparent as string | undefined,
      tracestate: meta.tracestate as string | undefined,
    };
  }

  /** Returns true if at least one INK field is set by the caller (excludes system-set senderUnixMs). */
  private hasInk(ink: TaskMetadata): boolean {
    return ink.correlationId !== undefined
      || ink.depth !== undefined
      || ink.budgetMs !== undefined
      || ink.deadlineUnixMs !== undefined
      || ink.priority !== undefined
      || ink.idempotencyKey !== undefined
      || ink.traceparent !== undefined
      || ink.tracestate !== undefined;
  }

  private splitCli(cli: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let inQ: string | null = null;
    for (const ch of cli) {
      if (inQ) { if (ch === inQ) inQ = null; else cur += ch; }
      else if (ch === '"' || ch === "'") inQ = ch;
      else if (ch === ' ' || ch === '\t') { if (cur) { parts.push(cur); cur = ''; } }
      else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  }
}
