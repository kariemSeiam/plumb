// PLUMB — Wolfy Mesh Port
// Wolfy is not an adapter. It is a port. A living mind accessible through the mesh.
// Wraps `pi --mode rpc --print --agent-dir /opt/wolfy-data/agent` with Wolfy's full identity.
//
// Unlike claude/cursor/opencode (stateless CLI tools wrapped as adapters),
// Wolfy HAS persistent identity: memory palace, knowledge graph, 11 minds, Pact.
// The --no-session flag is OMITTED so Wolfy maintains session continuity.
// Memory (mempalace) persists independently across all sessions.
//
// Protocol: Pi JSONL-RPC. Tier 1 (first-class mesh citizen).
// Port name: "wolfy" — discoverable as a mesh port, not wrapped as a CLI.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentAdapter, AgentTask, AdapterEvent, DetectionResult, PlumbConfig } from '../types.ts';

const execFileAsync = promisify(execFile);

interface WolfyRpcEvent {
  type: string;
  text?: string;
  content?: string;
  success?: boolean;
  error?: string;
  delta?: string;
  assistantMessageEvent?: { type?: string; delta?: string; text_delta?: { text?: string } };
  [key: string]: unknown;
}

export class WolfyAdapter implements AgentAdapter {
  readonly id = 'wolfy';
  readonly binary = 'wolfy';
  readonly tier = 1 as const;
  readonly displayName = 'Wolfy 🐺';
  readonly mode = 'persistent' as const;

  // Wolfy's full capability catalog — surfaced in A2A Agent Card
  skills = [
    // Core agent capabilities
    { id: 'code', name: 'Code generation and editing', tags: ['code', 'edit', 'write', 'build'] },
    { id: 'bash', name: 'Shell command execution', tags: ['bash', 'shell', 'terminal', 'deploy'] },
    { id: 'read', name: 'File reading and analysis', tags: ['read', 'file', 'audit'] },

    // Memory & Knowledge (unique to Wolfy — no other Plumb citizen has this)
    { id: 'memory', name: 'Persistent memory with semantic search', tags: ['memory', 'search', 'context'] },
    { id: 'knowledge', name: 'Knowledge graph with temporal facts', tags: ['knowledge', 'facts', 'timeline'] },

    // Multi-agent orchestration
    { id: 'subagents', name: 'Parallel and chained subagent delegation', tags: ['subagents', 'parallel', 'chain'] },

    // Specialized builder skills
    { id: 'architecture', name: 'System architecture and API design', tags: ['architecture', 'api', 'schema', 'deployment'] },
    { id: 'arabic', name: 'Arabic/RTL localization and typography', tags: ['arabic', 'rtl', 'localization', 'mena'] },
    { id: 'production', name: 'Production deployment and infrastructure', tags: ['production', 'docker', 'wsgi', 'linux'] },

    // Model intelligence
    { id: 'deepseek', name: 'DeepSeek V4 Pro — deep reasoning, 200K context', tags: ['deepseek', 'reasoning', 'architecture'] },
    { id: 'kimi', name: 'Kimi K2.6 — long context analysis, 262K context', tags: ['kimi', 'analysis', 'review'] },
  ];

  buildArgs(_task: AgentTask, config: PlumbConfig): string[] {
    // Agent directory set via PI_CODING_AGENT_DIR env var in Plumb config
    // NOT via --agent-dir flag (Pi reads env, not CLI flag)
    return [
      '--mode', 'rpc',
      '--print',
      // NO --no-session — Wolfy maintains continuity
    ];
  }

  formatInput(task: AgentTask): string {
    // Inject Wolfy's context envelope into every task
    // This tells Wolfy WHO is asking and WHAT context to use
    const contextMetadata = task.context?.metadata ?? {};
    const project = contextMetadata.project ?? 'general';
    const source = contextMetadata.source ?? 'plumb-mesh';
    const priority = contextMetadata.priority ?? 'normal';

    const preamble = [
      `[PLUMB MESH — ${source}]`,
      `Project: ${project} | Priority: ${priority}`,
      ``,
    ].join('\n');

    const cmd = {
      type: 'prompt',
      message: preamble + task.message,
    };
    return JSON.stringify(cmd) + '\n';
  }

  parseLine(line: string): AdapterEvent[] {
    if (!line.trim()) return [];

    let event: WolfyRpcEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return [{ type: 'text-delta', text: line + '\n' }];
    }

    // Filter extension UI — status updates, not task output
    if (event.type === 'extension_ui_request') return [];

    // Text delta — streaming output
    if (event.type === 'text-delta' || event.type === 'delta') {
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Pi message_update — streaming assistant text
    if (event.type === 'message_update') {
      const ame = event.assistantMessageEvent as Record<string, unknown> | undefined;
      const delta = ame?.delta ?? ame?.text_delta?.text ?? ame?.text ?? '';
      if (typeof delta === 'string' && delta) {
        return [{ type: 'text-delta', text: delta }];
      }
      const text = event.text ?? event.delta ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Tool calls — surface to mesh
    if (event.type === 'tool_call' || event.type === 'tool_use') {
      const toolName = (event as Record<string, unknown>).tool ?? (event as Record<string, unknown>).name ?? 'unknown';
      const toolInput = (event as Record<string, unknown>).input ?? (event as Record<string, unknown>).arguments ?? {};
      return [{
        type: 'tool-call',
        tool: String(toolName),
        input: toolInput as Record<string, unknown>,
      }];
    }

    // Content block
    if (event.type === 'content' || event.type === 'text') {
      const text = event.text ?? event.content ?? '';
      if (text) return [{ type: 'text-delta', text }];
      return [];
    }

    // Response — task result
    if (event.type === 'response') {
      if (event.success === false && event.error) {
        return [{ type: 'error', message: String(event.error) }];
      }
      const text = event.text ?? event.content ?? '';
      const events: AdapterEvent[] = [];
      if (text) events.push({ type: 'text-delta', text });
      events.push({ type: 'status', state: 'completed' });
      return events;
    }

    // Error
    if (event.type === 'error') {
      return [{ type: 'error', message: event.error ?? 'Unknown error' }];
    }

    // Done signals — extract final message content before completing
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

    return [];
  }

  async detect(): Promise<DetectionResult | null> {
    try {
      const { stdout } = await execFileAsync('which', ['pi'], { timeout: 5000 });
      let version = 'unknown';
      try {
        const { stdout: vOut } = await execFileAsync('pi', ['--version'], { timeout: 5000 });
        version = vOut.trim().split('\n')[0] ?? 'unknown';
      } catch { /* continue */ }

      // Verify Wolfy's agent directory exists
      const agentDir = process.env.PI_CODING_AGENT_DIR ?? '/opt/wolfy-data/agent';
      const fs = await import('node:fs');
      const hasAgent = fs.existsSync(agentDir + '/AGENTS.md');

      return {
        binary: 'pi',
        version: hasAgent ? `🐺 Wolfy (Pi ${version})` : version,
        path: stdout.trim(),
        tier: 1,
        protocol: 'jsonl-rpc',
      };
    } catch {
      return null;
    }
  }
}
