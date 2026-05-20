// PLUMB — Pi Adapter
// Wraps `pi --mode json --print --no-session`.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { detectBinary } from './detect.ts';

export class PiAdapter implements AgentAdapter {
  readonly id = 'pi';
  readonly binary = 'pi';
  readonly tier = 1 as const;
  readonly displayName = 'Pi';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['--mode', 'json', '--print', '--no-session'];
  }

  formatInput(task: AgentTask): string {
    // Pi RPC mode expects JSONL input. Send prompt command.
    const cmd = {
      type: 'prompt',
      message: task.message,
    };
    return JSON.stringify(cmd) + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    if (event.type === 'extension_ui_request') return [];

    if (event.type === 'text-delta' || event.type === 'delta') {
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text: text as string }];
      return [];
    }

    if (event.type === 'message_update' && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent as Record<string, unknown>;
      if (ame.type === 'text_delta' && typeof ame.delta === 'string' && ame.delta) {
        return [{ type: 'text-delta', text: ame.delta }];
      }
      if (ame.type && String(ame.type).startsWith('thinking_')) return [];
      if (ame.type === 'text_start' || ame.type === 'text_end') return [];
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text: text as string }];
      return [];
    }

    if (event.type === 'content' || event.type === 'text') {
      const text = event.text ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text: text as string }];
      return [];
    }

    if (event.type === 'response') {
      if (event.success === false && event.error) {
        return [{ type: 'error', message: event.error as string }];
      }
      const text = event.text ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text: text as string }, { type: 'status', state: 'completed' }];
      return [{ type: 'status', state: 'completed' }];
    }

    if (event.type === 'error') {
      return [{ type: 'error', message: (event.error ?? 'Unknown error') as string }];
    }

    if (event.type === 'done' || event.type === 'complete' || event.type === 'finished' ||
        event.type === 'agent_end' || event.type === 'turn_end') {
      const events: AdapterEvent[] = [];
      if (event.type === 'agent_end' || event.type === 'turn_end') {
        const messages = event.messages as Array<Record<string, unknown>> | undefined;
        if (messages) {
          for (const msg of messages) {
            if (msg.role === 'assistant') {
              const content = msg.content as Array<Record<string, unknown>> | undefined;
              if (content) {
                for (const block of content) {
                  if (block.type === 'text' && typeof block.text === 'string') {
                    events.push({ type: 'text-delta', text: block.text });
                  }
                }
              }
            }
          }
        }
      }
      events.push({ type: 'status', state: 'completed' });
      return events;
    }

    return [];
  }

  detect(): Promise<DetectionResult | null> {
    return detectBinary('pi', 1, 'jsonl-rpc');
  }
}
