// PLUMB — Echo Adapter
// Wraps `cat`. Proves the bridge works. Every line becomes a progress event.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { detectBinary } from './detect.ts';

export class EchoAdapter implements AgentAdapter {
  readonly id = 'echo';
  readonly binary = 'cat';
  readonly tier = 1 as const;
  readonly displayName = 'Echo';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'echo', name: 'Echo task input', tags: ['echo', 'test', 'conformance'] },
  ];

  buildArgs(): string[] { return []; }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    return [{ type: 'text-delta', text: line + '\n' }];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('cat', 1, 'text');
  }
}
