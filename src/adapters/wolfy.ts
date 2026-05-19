// PLUMB — Wolfy Adapter
// Wraps `pi --print --mode json` with Wolfy's agent directory.
// Uses oneshot mode (one process per task) because --mode rpc is broken for model calls.
// Wolfy HAS persistent identity: memory palace, knowledge graph, 11 minds, Pact.
// Memory (mempalace) persists independently across all sessions.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface PiJsonEvent {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
    text?: string;
    [key: string]: unknown;
  };
  command?: string;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export class WolfyAdapter implements AgentAdapter {
  readonly id = 'wolfy';
  readonly binary = 'wolfy';
  readonly tier = 1 as const;
  readonly displayName = 'Wolfy 🐺';
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

  buildArgs(_task: AgentTask, _config: PlumbConfig): string[] {
    return ['--mode', 'json', '--print', '--no-session'];
  }

  formatInput(task: AgentTask): string {
    const contextMetadata = task.context?.metadata ?? {};
    const project = contextMetadata.project ?? 'general';
    const source = contextMetadata.source ?? 'plumb-mesh';
    return `[${source}][${project}] ${task.message}\n`;
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: PiJsonEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // Filter noise
    if (event.type === 'extension_ui_request') return [];
    if (event.type === 'session') return [];

    // message_update with text_delta — streaming assistant text
    if (event.type === 'message_update' && event.assistantMessageEvent) {
      const ame = event.assistantMessageEvent;
      if (ame.type === 'text_delta' && typeof ame.delta === 'string' && ame.delta) {
        return [{ type: 'text-delta', text: ame.delta }];
      }
      // Skip thinking deltas — don't surface internal reasoning
      if (ame.type === 'thinking_delta' || ame.type === 'thinking_start' || ame.type === 'thinking_end') {
        return [];
      }
      // Skip text_start/text_end
      if (ame.type === 'text_start' || ame.type === 'text_end') {
        return [];
      }
      return [];
    }

    // message_end with assistant role — extract final text
    if (event.type === 'message_end') {
      const msg = event.message;
      if (msg && msg.role === 'assistant') {
        // message_end for assistant = the response is complete
        return [];
      }
      return [];
    }

    // Turn/agent end — task complete
    if (event.type === 'turn_end' || event.type === 'agent_end') {
      // Extract final text from messages array if present
      const events: AdapterEvent[] = [];
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
      events.push({ type: 'status', state: 'completed' });
      return events;
    }

    // Error
    if (event.type === 'error') {
      return [{ type: 'error', message: event.error ?? 'Unknown error' }];
    }

    // Skip everything else (agent_start, turn_start, message_start, etc.)
    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['wolfy'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('wolfy', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch { /* continue */ }
      return {
        binary: 'wolfy',
        version: `🐺 Wolfy (Pi ${version})`,
        path: stdout.trim(),
        tier: 1,
        protocol: 'jsonl',
      };
    } catch {
      return null;
    }
  }
}
