// PLUMB — VENOM Adapter
// Wraps `venom --output-format stream-json --permission-mode danger-full-access`.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, extractContentText, isConsolidatedAssistant, textDelta, statusEvent, errorEvent } from './stream-json.ts';
import type { ContentBlockEvent } from './stream-json.ts';
import { detectBinary } from './detect.ts';

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

  buildArgs(): string[] {
    return ['--output-format', 'stream-json', '--permission-mode', 'danger-full-access'];
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

    if (json.type === 'assistant') {
      const extracted = extractContentText(json as ContentBlockEvent);
      if (isConsolidatedAssistant(json as ContentBlockEvent, this.streamPartial)) return [];
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

  detect(): Promise<DetectionResult | null> {
    return detectBinary('venom', 3, 'stream-json');
  }
}