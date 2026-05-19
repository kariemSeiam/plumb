// PLUMB — Executor
// Bridges A2A tasks to CLI processes. Writes every lifecycle event to the ledger.
// Supports oneshot (process-per-task) and persistent (single long-running process) modes.

import { randomUUID } from 'node:crypto';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import type { AgentAdapter, AgentTask, AdapterEvent, PlumbConfig } from '../types.ts';
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

    this.ledger.append({
      type: 'task_submitted',
      taskId,
      cli: this.config.cli,
      message: text,
      timestamp: new Date().toISOString(),
    });

    this.contextByTaskId.set(taskId, contextId);
    const task: AgentTask = { id: taskId, message: text, context: { workdir: this.config.workdir } };

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

    ledger.append({ type: 'task_running', taskId, timestamp: new Date().toISOString() });

    const [cmd, ...cliArgs] = this.splitCli(config.cli);
    const extraArgs = adapter.buildArgs(task, config);
    const accumulated = { text: '' };
    const settled = { value: false };

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (settled.value) return;
        settled.value = true;
        this.pm.kill(taskId);
        ledger.append({ type: 'task_failed', taskId, error: `timed out after ${timeout}s`, timestamp: new Date().toISOString() });
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
            if (code === 0) {
              ledger.append({ type: 'task_completed', taskId, timestamp: new Date().toISOString() });
              bus.publish({ kind: 'message', messageId: randomUUID(), role: 'agent', parts: [{ kind: 'text', text: accumulated.text || '(no output)' }] });
            } else {
              const errMsg = `Process exited with code ${code}`;
              ledger.append({ type: 'task_failed', taskId, error: errMsg, timestamp: new Date().toISOString() });
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

    ledger.append({ type: 'task_running', taskId, timestamp: new Date().toISOString() });

    const accumulated = { text: '' };
    const settled = { value: false };

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (settled.value) return;
        settled.value = true;
        this.persistent?.removeLineHandler(taskId);
        ledger.append({ type: 'task_failed', taskId, error: `timed out after ${timeout}s`, timestamp: new Date().toISOString() });
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
    this.ledger.append({ type: 'task_cancelled', taskId, timestamp: new Date().toISOString() });
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
