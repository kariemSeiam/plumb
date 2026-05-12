// PLUMB — OpenCode Adapter
// Wraps `opencode run --format json`. JSON event stream.
// Filters log/status events. Captures text content and results.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface OpenCodePart {
  type?: string;
  text?: string;
  reason?: string;
  [key: string]: unknown;
}

interface OpenCodeEvent {
  type: string;
  content?: string;
  text?: string;
  part?: OpenCodePart;
  delta?: string;
  error?: string;
  message?: string;
  result?: string;
  [key: string]: unknown;
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode';
  readonly binary = 'opencode';
  readonly tier = 2 as const;
  readonly displayName = 'OpenCode';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['run', '--format', 'json'];
  }

  formatInput(task: AgentTask): string {
    // OpenCode reads one JSON line per stdin message with `prompt` (see fangai OpenCodeAdapter).
    return JSON.stringify({ prompt: task.message }) + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: OpenCodeEvent;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON line — treat as raw text
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // Text content — OpenCode JSON uses part.text for assistant output
    if (event.type === 'text' || event.type === 'content' || event.type === 'text-delta') {
      const fromPart = typeof event.part?.text === 'string' ? event.part.text : '';
      const text = fromPart || (event.text ?? event.content ?? event.delta ?? '');
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Message part updated — streaming content
    if (event.type === 'message.part.updated') {
      const text = event.content ?? event.text ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // End of agent step — primary completion signal for `opencode run --format json`
    if (event.type === 'step_finish' && event.part?.reason === 'stop') {
      return [{ type: 'status', state: 'completed' }];
    }

    // Session / run completed (alternate event names)
    if (event.type === 'session.completed' || event.type === 'done' || event.type === 'complete') {
      return [{ type: 'status', state: 'completed' }];
    }

    // Error events
    if (event.type === 'error') {
      return [{ type: 'error', message: event.error ?? event.message ?? 'Unknown error' }];
    }

    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['opencode'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('opencode', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch {
        // Version check failed
      }
      return {
        binary: 'opencode',
        version,
        path: stdout.trim(),
        tier: 2,
        protocol: 'json-stream',
      };
    } catch {
      return null;
    }
  }
}
