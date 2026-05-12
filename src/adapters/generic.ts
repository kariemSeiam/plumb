// PLUMB — Generic Adapter
// Text passthrough. Wraps any CLI that reads stdin and writes to stdout.
// Every non-empty line becomes a progress event. Exit 0 = complete.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

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

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] { return []; }

  formatInput(task: AgentTask): string { return task.message + '\n'; }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];
    return [{ type: 'text-delta', text: line.trim() + '\n' }];
  }

  async detect(): Promise<DetectionResult | null> {
    if (!this.cliCommand) return null;
    try {
      const [cmd] = this.cliCommand.trim().split(/\s+/);
      if (!cmd) return null;
      const { stdout } = await execFileAsync('which', [cmd], { timeout: 5000 });
      return { binary: cmd, version: 'unknown', path: stdout.trim(), tier: 3, protocol: 'text' };
    } catch {
      return null;
    }
  }
}
