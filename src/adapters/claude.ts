// PLUMB — Claude Adapter
// Wraps `claude --print --output-format stream-json --verbose`. Streaming JSONL.
// Filters system/rate-limit events. Captures assistant messages and results.
// Uses shared stream-json parser for content extraction.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, extractContentText, textDelta, statusEvent, errorEvent } from './stream-json.ts';
import type { ContentBlockEvent } from './stream-json.ts';

const execFileAsync = promisify(execFile);

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
      const contentEvent = json as unknown as ContentBlockEvent;
      const extracted = extractContentText(contentEvent);
      return extracted ? [textDelta(extracted)] : [];
    }

    // Result event — final output
    if (json.type === 'result') {
      if (json.is_error || json.error) {
        return [errorEvent(json.error ?? 'Unknown error')];
      }
      // Result text is already captured from assistant message, signal completion
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
      const { stdout } = await execFileAsync('which', ['claude'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('claude', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch { /* version check failed */ }
      return { binary: 'claude', version, path: stdout.trim(), tier: 1, protocol: 'stream-json' };
    } catch { return null; }
  }
}