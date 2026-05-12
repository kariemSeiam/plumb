// PLUMB — Cursor Adapter
// Wraps `cursor-agent --print --output-format stream-json`. Stream-json protocol.
// Tier 1. Handles streaming partial dedup (consolidated assistant events skipped
// when streamPartial=true, which is the default for --print).
//
// Event types from cursor-agent stream-json:
//   system, user, assistant, tool_call, result
//
// CRITICAL: With --stream-partial-output (default), cursor-agent emits streaming
// deltas (each with timestamp_ms) followed by a consolidated assistant event
// (NO timestamp_ms). The adapter skips consolidated events to avoid duplicate
// output. If streamPartial=false, ALL assistant events are emitted.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface CursorStreamEvent {
  type: string;
  subtype?: string;
  timestamp_ms?: number;
  message?: {
    role?: string;
    content?: Array<{ type: string; text?: string }>;
  };
  tool_call?: {
    shellToolCall?: { args?: Record<string, unknown>; result?: string };
  };
  call_id?: string;
  result?: string;
  is_error?: boolean;
  error?: string;
  session_id?: string;
  model?: string;
  duration_ms?: number;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  readonly binary = 'cursor-agent';
  readonly tier = 1 as const;
  readonly displayName = 'Cursor';
  readonly mode = 'oneshot' as const;

  /** Enable streaming partial output dedup. Default true — matches cursor-agent --print default. */
  streamPartial = true;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write', 'composer'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
    { id: 'plan', name: 'Plan mode', tags: ['plan', 'architecture'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['--print', '--output-format', 'stream-json'];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: CursorStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON — treat as raw text (cursor-agent rarely emits non-JSON)
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // System events — metadata only, no content
    if (event.type === 'system') return [];
    if (event.type === 'user') return [];

    // Assistant message — extract text content blocks
    if (event.type === 'assistant' && event.message?.content) {
      // Streaming dedup: if streamPartial is enabled and this event has NO
      // timestamp_ms, it's a consolidated event (duplicates streaming deltas).
      // Skip it to avoid duplicate output.
      if (this.streamPartial && !event.timestamp_ms) {
        return [];
      }
      const texts = event.message.content
        .filter((c): c is { type: string; text: string } =>
          c.type === 'text' && typeof c.text === 'string'
        )
        .map(c => c.text);
      if (texts.length > 0) {
        return [{ type: 'text-delta', text: texts.join('\n') }];
      }
      return [];
    }

    // Tool call — emit tool-call event
    if (event.type === 'tool_call') {
      const tc = event.tool_call?.shellToolCall;
      if (tc) {
        return [{
          type: 'tool-call',
          tool: 'shell',
          input: tc.args ?? {},
        }];
      }
      return [];
    }

    // Result event — signals completion or error
    if (event.type === 'result') {
      if (event.subtype === 'error' || event.is_error) {
        return [{ type: 'error', message: event.error ?? 'Cursor execution failed' }];
      }
      // Success result — task is complete
      return [{ type: 'status', state: 'completed' }];
    }

    // Error event
    if (event.type === 'error') {
      return [{ type: 'error', message: String(event.error ?? event.message ?? 'Unknown error') }];
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
      } catch {
        // Version check failed
      }
      return {
        binary: 'cursor-agent',
        version,
        path: stdout.trim(),
        tier: 1,
        protocol: 'stream-json',
      };
    } catch {
      return null;
    }
  }
}
