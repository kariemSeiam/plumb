// PLUMB — Echo Adapter
// Wraps `cat`. Proves the bridge works. Emits a real A2A task lifecycle.
// Every line cat echoes becomes a progress event. Exit 0 → completed.
// Stolen from fangai's Echo First pattern, implemented as a real CLI wrapper.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

export class EchoAdapter implements AgentAdapter {
  readonly id = 'echo';
  readonly binary = 'cat';
  readonly tier = 1 as const;
  readonly displayName = 'Echo';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'echo', name: 'Echo task input', tags: ['echo', 'test', 'conformance'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return [];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    return [{ type: 'text-delta', text: line + '\n' }];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['cat'], { timeout: 5000 });
      return {
        binary: 'cat',
        version: '1.0.0',
        path: stdout.trim(),
        tier: 1,
        protocol: 'text',
      };
    } catch {
      return null;
    }
  }
}
