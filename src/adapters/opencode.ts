// PLUMB — OpenCode Adapter
// Wraps `opencode run --format json`.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { detectBinary } from './detect.ts';

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

  buildArgs(): string[] {
    return ['run', '--format', 'json'];
  }

  formatInput(task: AgentTask): string {
    return JSON.stringify({ prompt: task.message }) + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    if (event.type === 'text' || event.type === 'content' || event.type === 'text-delta') {
      const fromPart = typeof (event.part as Record<string, unknown>)?.text === 'string' ? (event.part as Record<string, unknown>).text as string : '';
      const text = fromPart || (event.text ?? event.content ?? event.delta ?? '');
      if (text) return [{ type: 'text-delta', text: text as string }];
      return [];
    }

    if (event.type === 'message.part.updated') {
      const text = event.content ?? event.text ?? '';
      if (text) return [{ type: 'text-delta', text: text as string }];
      return [];
    }

    if (event.type === 'step_finish' && (event.part as Record<string, unknown>)?.reason === 'stop') {
      return [{ type: 'status', state: 'completed' }];
    }

    if (event.type === 'session.completed' || event.type === 'done' || event.type === 'complete') {
      return [{ type: 'status', state: 'completed' }];
    }

    if (event.type === 'error') {
      return [{ type: 'error', message: (event.error ?? event.message ?? 'Unknown error') as string }];
    }

    return [];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('opencode', 2, 'json-stream');
  }
}
