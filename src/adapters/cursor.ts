// PLUMB — Cursor Adapter
// Wraps `cursor-agent --print --output-format stream-json`. Stream-json protocol.
// Tier 1. Uses shared stream-json parser for dedup with VENOM/Claude.
//
// CRITICAL: With --print (default), cursor-agent emits ONLY consolidated assistant
// events (no streaming deltas). streamPartial MUST be false.
// With --stream-partial-output, deltas have timestamp_ms and consolidated events
// don't — in that mode, streamPartial=true correctly deduplicates.
//
// Multi-turn: adapter tracks session_ids and injects --continue/--resume for
// follow-up tasks. When sessionTtlMs is set on the store, stale sessions are
// abandoned and a cold recap is injected instead.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { CursorSessionStore } from '../core/session-store.ts';
import { tryParseLine, extractContentText, isConsolidatedAssistant, textDelta, statusEvent, errorEvent } from './stream-json.ts';

const execFileAsync = promisify(execFile);

export interface CursorAdapterOptions {
  /** Default model (default: 'composer-2-fast') */
  defaultModel?: string;
  /** Enable streaming partial output dedup. Default false. */
  streamPartial?: boolean;
  /** Auto-approve all tool calls (default: true for headless) */
  yolo?: boolean;
  /** Trust workspace without prompting (default: true for headless) */
  trust?: boolean;
  /** Max session turns before auto-reset (default: 50) */
  maxSessionTurns?: number;
  /** Session store (shared across adapter instances for multi-chat) */
  sessionStore?: CursorSessionStore;
  /** When set (and no custom sessionStore), builds a store with TTL + recap. */
  sessionTtlMs?: number | null;
  recapMaxTurns?: number;
  recapMaxCharsPerLeg?: number;
}

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  readonly binary = 'cursor-agent';
  readonly tier = 1 as const;
  readonly displayName = 'Cursor';
  readonly mode = 'oneshot' as const;

  streamPartial: boolean;
  readonly yolo: boolean;
  readonly trust: boolean;
  readonly maxSessionTurns: number;
  readonly defaultModel: string;
  readonly sessionStore: CursorSessionStore;

  /** Accumulated assistant text for current task (recap storage). */
  private taskAssistantForRecap = '';
  /** Last user message for turn recording. */
  private lastUserMessage = '';

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write', 'composer'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
    { id: 'plan', name: 'Plan mode', tags: ['plan', 'architecture'] },
  ];

  constructor(opts: CursorAdapterOptions = {}) {
    this.streamPartial = opts.streamPartial ?? false;
    this.yolo = opts.yolo ?? true;
    this.trust = opts.trust ?? true;
    this.maxSessionTurns = opts.maxSessionTurns ?? 50;
    this.defaultModel = opts.defaultModel ?? 'composer-2-fast';
    this.sessionStore = opts.sessionStore ?? new CursorSessionStore({
      sessionTtlMs: opts.sessionTtlMs,
      recapMaxTurns: opts.recapMaxTurns,
      recapMaxCharsPerLeg: opts.recapMaxCharsPerLeg,
    });
  }

  buildArgs(task: AgentTask, config: PlumbConfig): string[] {
    const args: string[] = ['--print', '--output-format', 'stream-json'];

    if (this.streamPartial) args.push('--stream-partial-output');
    if (this.yolo) args.push('--yolo');
    if (this.trust) args.push('--trust');

    // Model: task metadata > default
    const model = (task.context?.metadata?.model as string) ?? this.defaultModel;
    args.push('--model', model);

    // Workspace: task context > config
    const workspace = task.context?.workdir ?? config.workdir;
    if (workspace) args.push('--workspace', workspace);

    // API key from env
    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) args.push('--api-key', apiKey);

    // Expire stale sessions before deciding on --continue
    this.sessionStore.expireLastSessionIfStale();

    // Session continuity
    const resumeSession = task.context?.metadata?.resumeSession as string | undefined;
    const continueLast = task.context?.metadata?.continueLast as boolean | undefined;
    const newChat = task.context?.metadata?.newChat as boolean | undefined;

    if (resumeSession) {
      args.push('--resume', resumeSession);
    } else if (continueLast && this.sessionStore.lastSession) {
      args.push('--continue');
    } else if (!newChat && this.sessionStore.lastSession) {
      // Default: continue if session exists and under max turns
      const session = this.sessionStore.get(this.sessionStore.lastSession);
      if (session && session.turnCount < this.maxSessionTurns) {
        args.push('--continue');
      }
    }

    // Plan mode
    if (task.context?.metadata?.planMode) {
      args.push('--plan');
    }

    return args;
  }

  formatInput(task: AgentTask): string {
    this.taskAssistantForRecap = '';
    const newChat = task.context?.metadata?.newChat === true;
    let recap: string | null = null;
    if (newChat) {
      this.sessionStore.consumeColdRecap(); // discard
    } else {
      recap = this.sessionStore.consumeColdRecap();
    }
    const body = `${task.message}\n`;
    return recap ? `${recap}${body}` : body;
  }

  parseLine(line: string): AdapterEvent[] {
    const { json, raw } = tryParseLine(line);
    if (!json) {
      if (!raw) return [];
      return [textDelta(raw + '\n')];
    }

    // System init — register session
    if (json.type === 'system') {
      if (typeof json.session_id === 'string') {
        this.sessionStore.register(
          json.session_id,
          typeof json.cwd === 'string' ? json.cwd : '',
          typeof json.model === 'string' ? json.model : '',
        );
      }
      return [];
    }

    // User echo — skip
    if (json.type === 'user') return [];

    // Thinking events
    if (json.type === 'thinking' && typeof (json as Record<string, unknown>).text === 'string') {
      return [textDelta((json as Record<string, unknown>).text as string)];
    }

    // Assistant content blocks
    if (json.type === 'assistant') {
      const contentEvent = json as unknown as Parameters<typeof extractContentText>[0];
      if (isConsolidatedAssistant(contentEvent, this.streamPartial)) return [];
      const extracted = extractContentText(contentEvent);
      if (extracted) this.taskAssistantForRecap += extracted;
      return extracted ? [textDelta(extracted)] : [];
    }

    // Tool call
    if (json.type === 'tool_call') {
      const tc = (json as Record<string, unknown>).tool_call as { shellToolCall?: { args?: Record<string, unknown>; result?: string } } | undefined;
      if (tc?.shellToolCall) {
        return [{ type: 'tool-call', tool: 'shell', input: tc.shellToolCall.args ?? {} }];
      }
      return [];
    }

    // Result — completion or error
    if (json.type === 'result') {
      if (json.subtype === 'error' || json.is_error) {
        this.resetRecapTaskState();
        return [errorEvent(String(json.error ?? 'Cursor execution failed'))];
      }

      // Record completed turn for cold recap
      this.sessionStore.recordCompletedTurn(
        this.sessionStore.lastSession,
        this.lastUserMessage,
        this.taskAssistantForRecap,
      );
      this.resetRecapTaskState();
      return [statusEvent('completed')];
    }

    // Error event
    if (json.type === 'error') {
      this.resetRecapTaskState();
      return [errorEvent(String(json.error ?? json.message ?? 'Unknown error'))];
    }

    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['cursor-agent'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('cursor-agent', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch { /* version check failed */ }
      return { binary: 'cursor-agent', version, path: stdout.trim(), tier: 1, protocol: 'stream-json' };
    } catch { return null; }
  }

  /** Set the user message for turn recording. Call before execute(). */
  setUserMessage(msg: string): void {
    this.lastUserMessage = msg;
  }

  private resetRecapTaskState(): void {
    this.taskAssistantForRecap = '';
  }
}
