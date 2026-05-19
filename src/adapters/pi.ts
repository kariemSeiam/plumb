// PLUMB — Pi Adapter
// Wraps `pi --mode rpc --print`. JSONL protocol. Highest value adapter.
// Extension UI requests are filtered. Text deltas and responses are captured.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface PiRpcEvent {
  type: string;
  text?: string;
  content?: string;
  success?: boolean;
  error?: string;
  delta?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  [key: string]: unknown;
}

export class PiAdapter implements AgentAdapter {
  readonly id = 'pi';
  readonly binary = 'pi';
  readonly tier = 1 as const;
  readonly displayName = 'Pi';
  readonly mode = 'persistent' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write'] },
    { id: 'bash', name: 'Execute shell commands', tags: ['bash', 'shell', 'terminal'] },
    { id: 'read', name: 'Read files', tags: ['read', 'file'] },
  ];

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['--mode', 'rpc', '--print', '--no-session'];
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

    let event: PiRpcEvent;
    try {
      event = JSON.parse(line);
    } catch {
      // Non-JSON line — treat as raw text
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // Filter extension UI requests — these are status updates, not task output
    if (event.type === 'extension_ui_request') {
      return [];
    }

    // Text delta events — streaming output
    if (event.type === 'text-delta' || event.type === 'delta') {
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Pi message_update — streaming text from assistant
    // Format: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'text' } }
    if (event.type === 'message_update') {
      const ame = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ame?.type === 'text_delta' && typeof ame.delta === 'string') {
        return [{ type: 'text-delta', text: ame.delta }];
      }
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Content block — full text
    if (event.type === 'content' || event.type === 'text') {
      const text = event.text ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Response event — task result
    if (event.type === 'response') {
      if (event.success === false && event.error) {
        return [{ type: 'error', message: event.error }];
      }
      // Successful response — emit text if present, always complete
      const text = event.text ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }, { type: 'status', state: 'completed' }];
      return [{ type: 'status', state: 'completed' }];
    }

    // Error event
    if (event.type === 'error') {
      return [{ type: 'error', message: event.error ?? 'Unknown error' }];
    }

    // Done/complete signals (Pi uses agent_end and turn_end)
    if (event.type === 'done' || event.type === 'complete' || event.type === 'finished' ||
        event.type === 'agent_end' || event.type === 'turn_end') {
      const events: AdapterEvent[] = [];
      // Extract final assistant text from agent_end/turn_end messages array
      if (event.type === 'agent_end' || event.type === 'turn_end') {
        const messages = (event as Record<string, unknown>).messages as Array<Record<string, unknown>> | undefined;
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

    // Unknown event type — log but don't emit
    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['pi'], { timeout: 5000 });
      // Get version
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('pi', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch {
        // Version check failed, continue with unknown
      }
      return {
        binary: 'pi',
        version,
        path: stdout.trim(),
        tier: 1,
        protocol: 'jsonl-rpc',
      };
    } catch {
      return null;
    }
  }
}
