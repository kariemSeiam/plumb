// PLUMB — Codex Adapter
// Wraps `codex exec --json`. Non-interactive; the prompt is read from stdin ('-'),
// events stream out as JSONL (thread/turn/item lifecycle).

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { tryParseLine, textDelta, thinkingEvent, statusEvent, errorEvent } from './stream-json.ts';
import { detectBinary } from './detect.ts';

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly binary = 'codex';
  readonly tier = 1 as const;
  readonly displayName = 'Codex';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['exec', '--json', '--skip-git-repo-check', '-'];
  }

  formatInput(task: AgentTask): string {
    return task.message + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    const { json, raw } = tryParseLine(line);
    if (!json) return raw ? [textDelta(raw + '\n')] : [];

    const item = (json.item ?? {}) as Record<string, unknown>;

    switch (json.type) {
      case 'item.completed': {
        if (item.type === 'agent_message' && typeof item.text === 'string' && item.text) {
          return [textDelta(item.text + '\n')];
        }
        if (item.type === 'reasoning' && typeof item.text === 'string' && item.text) {
          return [thinkingEvent(item.text)];
        }
        if (item.type === 'command_execution') {
          const failed = typeof item.exit_code === 'number' && item.exit_code !== 0;
          return [
            { type: 'tool-call', tool: 'bash', input: { command: String(item.command ?? '') } },
            { type: 'tool-result', tool: 'bash', output: String(item.aggregated_output ?? '').trim() || '(no output)', isError: failed },
          ];
        }
        return [];
      }
      case 'turn.completed':
        return [statusEvent('completed')];
      case 'turn.failed': {
        const err = json.error as { message?: unknown } | undefined;
        return [errorEvent(String(err?.message ?? 'Codex turn failed'))];
      }
      case 'error':
        return [errorEvent(String(json.message ?? 'Unknown error'))];
      default:
        return [];
    }
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('codex', 1, 'jsonl');
  }
}
