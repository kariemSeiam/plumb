// PLUMB — Generic Adapter
// Text passthrough. Wraps any CLI that reads stdin and writes to stdout.

import { detectBinary } from './detect.ts';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

export class GenericAdapter implements AgentAdapter {
  readonly id = 'generic';
  readonly binary = '';
  readonly tier = 3 as const;
  readonly displayName = 'Generic CLI';
  readonly mode = 'oneshot' as const;
  private cliCommand: string;

  skills = [{ id: 'generic', name: 'CLI task', tags: ['code'] }];

  constructor(cliCommand = '') {
    this.cliCommand = cliCommand;
  }

  buildArgs(): string[] { return []; }

  formatInput(task: AgentTask): string { return task.message + '\n'; }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    return [{ type: 'text-delta', text: line.trim() + '\n' }];
  }

  async detect(): Promise<DetectionResult | null> {
    if (!this.cliCommand) return null;
    const [cmd] = this.cliCommand.trim().split(/\s+/);
    if (!cmd) return null;
    return detectBinary(cmd, 3, 'text');
  }
}
