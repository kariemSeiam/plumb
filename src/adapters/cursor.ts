// PLUMB — Cursor Adapter
// Wraps `cursor-agent --print --output-format stream-json`.
// Multi-turn session tracking with --continue / cold recap.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { CursorSessionStore } from '../core/session-store.ts';
import { tryParseLine, extractContentText, isConsolidatedAssistant, textDelta, statusEvent, errorEvent } from './stream-json.ts';
import type { ContentBlockEvent } from './stream-json.ts';
import { detectBinary } from './detect.ts';

export interface CursorAdapterOptions {
  defaultModel?: string;
  streamPartial?: boolean;
  yolo?: boolean;
  trust?: boolean;
  maxSessionTurns?: number;
  sessionStore?: CursorSessionStore;
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

  private taskAssistantForRecap = '';
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

    const model = (task.context?.metadata?.model as string) ?? this.defaultModel;
    args.push('--model', model);

    const workspace = task.context?.workdir ?? config.workdir;
    if (workspace) args.push('--workspace', workspace);

    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) args.push('--api-key', apiKey);

    this.sessionStore.expireLastSessionIfStale();

    const resumeSession = task.context?.metadata?.resumeSession as string | undefined;
    const continueLast = task.context?.metadata?.continueLast as boolean | undefined;
    const newChat = task.context?.metadata?.newChat as boolean | undefined;

    if (resumeSession) {
      args.push('--resume', resumeSession);
    } else if (continueLast && this.sessionStore.lastSession) {
      args.push('--continue');
    } else if (!newChat && this.sessionStore.lastSession) {
      const session = this.sessionStore.get(this.sessionStore.lastSession);
      if (session && session.turnCount < this.maxSessionTurns) {
        args.push('--continue');
      }
    }

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
      this.sessionStore.consumeColdRecap();
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

    if (json.type === 'user') return [];

    if (json.type === 'thinking' && typeof (json as Record<string, unknown>).text === 'string') {
      return [textDelta((json as Record<string, unknown>).text as string)];
    }

    if (json.type === 'assistant') {
      const contentEvent = json as ContentBlockEvent;
      if (isConsolidatedAssistant(contentEvent, this.streamPartial)) return [];
      const extracted = extractContentText(contentEvent);
      if (extracted) this.taskAssistantForRecap += extracted;
      return extracted ? [textDelta(extracted)] : [];
    }

    if (json.type === 'tool_call') {
      const tc = (json as Record<string, unknown>).tool_call as { shellToolCall?: { args?: Record<string, unknown>; result?: string } } | undefined;
      if (tc?.shellToolCall) {
        return [{ type: 'tool-call', tool: 'shell', input: tc.shellToolCall.args ?? {} }];
      }
      return [];
    }

    if (json.type === 'result') {
      if (json.subtype === 'error' || json.is_error) {
        this.resetRecapTaskState();
        return [errorEvent(String(json.error ?? 'Cursor execution failed'))];
      }

      this.sessionStore.recordCompletedTurn(
        this.sessionStore.lastSession,
        this.lastUserMessage,
        this.taskAssistantForRecap,
      );
      this.resetRecapTaskState();
      return [statusEvent('completed')];
    }

    if (json.type === 'error') {
      this.resetRecapTaskState();
      return [errorEvent(String(json.error ?? json.message ?? 'Unknown error'))];
    }

    return [];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('cursor-agent', 1, 'stream-json');
  }

  setUserMessage(msg: string): void {
    this.lastUserMessage = msg;
  }

  private resetRecapTaskState(): void {
    this.taskAssistantForRecap = '';
  }
}
