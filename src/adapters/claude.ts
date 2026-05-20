// PLUMB — Claude Adapter
// Wraps `claude --print --output-format stream-json --verbose`. Streaming JSONL.
// Filters system/rate-limit events. Captures assistant messages and results.
// Uses shared stream-json parser for content extraction.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, extractContentText, textDelta, statusEvent, errorEvent } from './stream-json.ts';
import type { ContentBlockEvent } from './stream-json.ts';
import { detectBinary } from './detect.ts';

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly binary = 'claude';
  readonly tier = 1 as const;
  readonly displayName = 'Claude';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
    { id: 'web', name: 'Web search and fetch', tags: ['web', 'search', 'fetch'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['--print', '--output-format', 'stream-json', '--verbose'];
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

    // Filter non-content events
    if (json.type === 'rate_limit_event' || json.type === 'system') return [];

    // Assistant message — extract text content
    if (json.type === 'assistant') {
      const extracted = extractContentText(json as ContentBlockEvent);
      return extracted ? [textDelta(extracted)] : [];
    }

    if (json.type === 'result') {
      if (json.is_error || json.error) {
        return [errorEvent(json.error ?? 'Unknown error')];
      }
      return [statusEvent('completed')];
    }

    if (json.type === 'error') {
      return [errorEvent(String(json.error ?? json.message ?? 'Unknown error'))];
    }

    return [];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('claude', 1, 'stream-json');
  }
}