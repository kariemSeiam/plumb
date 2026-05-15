// PLUMB — Core Types
// The bridge contract. stdin/stdout to A2A. Nothing else.

export interface AgentTask {
  id: string;
  message: string;
  context?: {
    workdir?: string;
    metadata?: Record<string, unknown>;
  };
}

export type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'status'; state: 'working' | 'completed' | 'failed' }
  | { type: 'error'; message: string; code?: string };

export interface PlumbConfig {
  cli: string;
  port: number;
  name?: string;
  workdir?: string;
  env?: Record<string, string>;
  taskTimeout?: number;
  killTimeout?: number;
  apiKey?: string;
}

export interface DetectionResult {
  binary: string;
  version: string;
  path: string;
  tier: 1 | 2 | 3;
  protocol: string;
}

export interface AgentAdapter {
  readonly id: string;
  readonly binary: string;
  readonly tier: 1 | 2 | 3;
  readonly displayName: string;
  readonly mode: 'oneshot' | 'persistent';
  skills: Array<{ id: string; name: string; tags: string[] }>;

  buildArgs(task: AgentTask, config: PlumbConfig): string[];
  formatInput(task: AgentTask): string;
  parseLine(line: string): AdapterEvent[];
  detect(): Promise<DetectionResult | null>;
}

export type LedgerEvent =
  | { type: 'task_submitted'; taskId: string; cli: string; message: string; timestamp: string }
  | { type: 'task_running'; taskId: string; timestamp: string }
  | { type: 'progress'; taskId: string; text: string; timestamp: string }
  | { type: 'log'; taskId: string; level: string; text: string; timestamp: string }
  | { type: 'task_completed'; taskId: string; timestamp: string }
  | { type: 'task_failed'; taskId: string; error: string; timestamp: string }
  | { type: 'task_cancelled'; taskId: string; timestamp: string };

// ─── Persistent RPC Types ────────────────────────────────────────────────────
// Correlated request/response over stdin/stdout for persistent agents (e.g. Pi).

/** Content shape for host_tool_result (subset of AgentToolResult). */
export type RpcHostToolResultContent = ReadonlyArray<Record<string, unknown>>;

/** Parsed RPC response from stdout { type: "response" }. */
export interface RpcParsedResponse {
  command?: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Executes a host_tool_call from the persistent agent.
 * Must return fragments suitable for { result: { content } }.
 * abortSignal cooperatively cancels when agent emits host_tool_cancel.
 */
export type RpcHostToolExecutor = (
  ctx: {
    requestId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    abortSignal: AbortSignal;
  },
) => Promise<{ content: RpcHostToolResultContent; isError?: boolean }>;
