// PLUMB — Cursor Adapter
// Wraps `cursor-agent --print --output-format stream-json`. Stream-json protocol.
// Tier 1. Uses shared stream-json parser for dedup with VENOM/Claude.
//
// CRITICAL: With --print (default), cursor-agent emits ONLY consolidated assistant
// events (no streaming deltas). streamPartial MUST be false.
// With --stream-partial-output, deltas have timestamp_ms and consolidated events
// don't — in that mode, streamPartial=true correctly deduplicates.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, extractContentText, isConsolidatedAssistant, textDelta, statusEvent, errorEvent } from './stream-json.ts';

const execFileAsync = promisify(execFile);

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  readonly binary = 'cursor-agent';
  readonly tier = 1 as const;
  readonly displayName = 'Cursor';
  readonly mode = 'oneshot' as const;

  /** Enable streaming partial output dedup. Default false — cursor-agent
   *  with --print emits only consolidated events (no streaming deltas).
   *  Only enable when --stream-partial-output is added to buildArgs. */
  streamPartial = false;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write', 'composer'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
    { id: 'plan', name: 'Plan mode', tags: ['plan', 'architecture'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    const args = ['--print', '--output-format', 'stream-json', '--trust'];
    const apiKey = process.env.CURSOR_API_KEY;
    if (apiKey) args.push('--api-key', apiKey);
    return args;
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

    // Thinking events — streaming thought content
    if (json.type === 'thinking' && typeof (json as Record<string, unknown>).text === 'string') {
      return [textDelta((json as Record<string, unknown>).text as string)];
    }

    // Assistant content blocks
    if (json.type === 'assistant') {
      const contentEvent = json as unknown as Parameters<typeof extractContentText>[0];
      // Streaming dedup: skip consolidated events when streamPartial is on
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
        return [errorEvent(json.error ?? 'Cursor execution failed')];
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
      const { stdout } = await execFileAsync('which', ['cursor-agent'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('cursor-agent', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch { /* version check failed */ }
      return { binary: 'cursor-agent', version, path: stdout.trim(), tier: 1, protocol: 'stream-json' };
    } catch { return null; }
  }
}