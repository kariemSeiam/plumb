// PLUMB — Claude Adapter
// Wraps `claude --print --output-format stream-json --verbose`. Streaming JSONL.
// Filters system/rate-limit events. Captures assistant messages and results.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
  result?: string;
  is_error?: boolean;
  error?: string;
  [key: string]: unknown;
}

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
    if (!line.trim()) return [];

    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON line — treat as raw text
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // Filter non-content events
    if (event.type === 'rate_limit_event') return [];
    if (event.type === 'system') return [];

    // Assistant message — extract text content
    if (event.type === 'assistant' && event.message?.content) {
      const texts = event.message.content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!);
      if (texts.length > 0) {
        return [{ type: 'text-delta', text: texts.join('\n') }];
      }
      return [];
    }

    // Result event — final output
    if (event.type === 'result') {
      if (event.is_error || event.error) {
        return [{ type: 'error', message: event.error ?? 'Unknown error' }];
      }
      // Result text is already captured from assistant message, signal completion
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
      const { stdout } = await execFileAsync('which', ['claude'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('claude', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch {
        // Version check failed
      }
      return {
        binary: 'claude',
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
