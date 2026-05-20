// PLUMB — Wolfy Adapter
// Wraps `wolfy --mode json --print --no-session`.

import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';
import { detectBinary } from './detect.ts';

export class WolfyAdapter implements AgentAdapter {
  readonly id = 'wolfy';
  readonly binary = 'wolfy';
  readonly tier = 1 as const;
  readonly displayName = 'Wolfy';
  readonly mode = 'oneshot' as const;

  skills = [
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write', 'build'] },
    { id: 'bash', name: 'Shell command execution', tags: ['bash', 'shell', 'terminal', 'deploy'] },
    { id: 'read', name: 'File reading and analysis', tags: ['read', 'file', 'audit'] },
    { id: 'memory', name: 'Persistent memory with semantic search', tags: ['memory', 'search', 'context'] },
    { id: 'knowledge', name: 'Knowledge graph with temporal facts', tags: ['knowledge', 'facts', 'timeline'] },
    { id: 'subagents', name: 'Parallel and chained subagent delegation', tags: ['subagents', 'parallel', 'chain'] },
    { id: 'architecture', name: 'System architecture and API design', tags: ['architecture', 'api', 'schema'] },
    { id: 'deepseek', name: 'DeepSeek V4 Pro — deep reasoning, 200K context', tags: ['deepseek', 'reasoning'] },
    { id: 'kimi', name: 'Kimi K2.6 — long context analysis, 262K context', tags: ['kimi', 'analysis'] },
  ];

  buildArgs(): string[] {
    return ['--mode', 'json', '--print', '--no-session'];
  }

  formatInput(task: AgentTask): string {
    const meta = task.context?.metadata ?? {};
    return `[${meta.source ?? 'plumb-mesh'}][${meta.project ?? 'general'}] ${task.message}\n`;
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    if (event.type === 'extension_ui_request' || event.type === 'session') return [];

    if (event.type === 'message_update' && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent as Record<string, unknown>;
      if (ame.type === 'text_delta' && typeof ame.delta === 'string' && ame.delta) {
        return [{ type: 'text-delta', text: ame.delta }];
      }
      if (ame.type === 'thinking_delta' || ame.type === 'thinking_start' || ame.type === 'thinking_end') return [];
      if (ame.type === 'text_start' || ame.type === 'text_end') return [];
      return [];
    }

    if (event.type === 'message_end') return [];

    if (event.type === 'turn_end' || event.type === 'agent_end') {
      const events: AdapterEvent[] = [];
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
      events.push({ type: 'status', state: 'completed' });
      return events;
    }

    if (event.type === 'error') {
      return [{ type: 'error', message: (event.error ?? 'Unknown error') as string }];
    }

    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    const result = await detectBinary('wolfy', 1, 'jsonl');
    if (result) {
      result.version = `Wolfy (Pi ${result.version})`;
    }
    return result;
  }
}