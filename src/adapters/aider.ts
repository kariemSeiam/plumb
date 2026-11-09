// PLUMB — Aider Adapter
// Wraps `aider --message <prompt> --yes-always`. Aider takes the prompt as an
// argument (not stdin), prints plain text, and exits when done.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { detectBinary } from './detect.ts';

export class AiderAdapter implements AgentAdapter {
  readonly id = 'aider';
  readonly binary = 'aider';
  readonly tier = 2 as const;
  readonly displayName = 'Aider';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
  ];

  buildArgs(task: AgentTask, _config: PlumbConfig): string[] {
    return ['--message', task.message, '--yes-always', '--no-pretty', '--no-fancy-input'];
  }

  // The prompt travels in argv; stdin is closed empty so aider never waits on it.
  formatInput(_task: AgentTask): string { return ''; }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    return [{ type: 'text-delta', text: line + '\n' }];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('aider', 2, 'text');
  }
}
