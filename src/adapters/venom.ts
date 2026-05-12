// PLUMB — VENOM Adapter
// Wraps `venom -p --output-format stream-json --permission-mode danger-full-access`.
// Stream-json protocol, same shape as Cursor. Tier 3 (custom, no official updates).
//
// VENOM is the in-house Rust CLI agent. It speaks the same stream-json dialect
// as cursor-agent. The `-p` flag is --print. `--permission-mode danger-full-access`
// auto-approves all tool calls (required for headless operation).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface VenomStreamEvent {
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

export class VenomAdapter implements AgentAdapter {
  readonly id = 'venom';
  readonly binary = 'venom';
  readonly tier = 3 as const;
  readonly displayName = 'VENOM';
  readonly mode = 'oneshot' as const;

  /** Stream-json dedup: skip consolidated assistant events when streaming. */
  streamPartial = true;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
    { id: 'rust', name: 'Rust development', tags: ['rust', 'cargo'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['-p', '--output-format', 'stream-json', '--permission-mode', 'danger-full-access'];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: VenomStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    if (event.type === 'system') return [];
    if (event.type === 'user') return [];

    if (event.type === 'assistant' && event.message?.content) {
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

    if (event.type === 'result') {
      if (event.subtype === 'error' || event.is_error) {
        return [{ type: 'error', message: event.error ?? 'VENOM execution failed' }];
      }
      return [{ type: 'status', state: 'completed' }];
    }

    if (event.type === 'error') {
      return [{ type: 'error', message: String(event.error ?? event.message ?? 'Unknown error') }];
    }

    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['venom'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('venom', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch {
        // Version check failed
      }
      return {
        binary: 'venom',
        version,
        path: stdout.trim(),
        tier: 3,
        protocol: 'stream-json',
      };
    } catch {
      return null;
    }
  }
}
