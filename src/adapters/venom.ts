// PLUMB — VENOM Adapter
// Wraps `venom -p --output-format stream-json --permission-mode danger-full-access`.
// Stream-json protocol, same shape as Cursor. Tier 3 (custom, no official updates).
// Uses shared stream-json parser.
//
// VENOM is the in-house Rust CLI agent. It speaks the same stream-json dialect
// as cursor-agent. The `-p` flag is --print. `--permission-mode danger-full-access`
// auto-approves all tool calls (required for headless operation).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, extractContentText, isConsolidatedAssistant, textDelta, statusEvent, errorEvent } from './stream-json.ts';

const execFileAsync = promisify(execFile);

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
    return ['--output-format', 'json', '--permission-mode', 'danger-full-access'];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    const { json, raw } = tryParseLine(line);
    if (!json) {
      if (!raw) return [];
      return [textDelta(raw + '\n')];
    }

    // System/user events — metadata only
    if (json.type === 'system' || json.type === 'user') return [];

    // Assistant content blocks
    if (json.type === 'assistant') {
      const contentEvent = json as unknown as Parameters<typeof extractContentText>[0];
      if (isConsolidatedAssistant(contentEvent, this.streamPartial)) return [];
      const extracted = extractContentText(contentEvent);
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
        return [errorEvent(json.error ?? 'VENOM execution failed')];
      }
      return [statusEvent('completed')];
    }

    // Error event
    if (json.type === 'error') {
      return [errorEvent(String(json.error ?? json.message ?? 'Unknown error'))];
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
      } catch { /* version check failed */ }
      return { binary: 'venom', version, path: stdout.trim(), tier: 3, protocol: 'stream-json' };
    } catch { return null; }
  }
}