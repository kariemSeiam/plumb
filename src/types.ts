// PLUMB — Core Types
// The bridge contract. stdin/stdout to A2A. Nothing else.

export interface TaskMetadata {
  /** Correlation ID for multi-hop tracing across the mesh. */
  correlationId?: string;
  /**
   * Current A2A hop depth across the mesh.
   * Counts agent-to-agent (Plumb-to-Plumb) hops only — NOT local adapter dispatches.
   * Rejected if >= maxDepth (default 4) at admission.
   * Auto-incremented at each Plumb hop.
   */
  depth?: number;
  /**
   * Remaining wall-clock budget in milliseconds.
   * Decreases by real elapsed time per hop (not a fixed constant).
   * Budget is admission-time only — no wall-clock enforcement until Day 3.
   */
  budgetMs?: number;
  /**
   * Admission deadline as Unix MS timestamp.
   * Rejects if already past at task arrival.
   * This is admission control ONLY — wall-clock enforcement during execution
   * requires Day 3 (deadline + cancellation propagation).
   */
  deadlineUnixMs?: number;
  /** Sender's wall-clock at message origination (Unix MS). Used for clock skew detection across the mesh. */
  senderUnixMs?: number;
  /** Task priority. Critical tasks jump the queue. */
  priority?: 'critical' | 'normal' | 'background';
  /** Idempotency key for deduplication. Bounded LRU in executor. */
  idempotencyKey?: string;
  /** W3C traceparent for OpenTelemetry span correlation. */
  traceparent?: string;
  /** W3C tracestate for OpenTelemetry vendor-specific data. */
  tracestate?: string;
}

export interface AgentTask {
  id: string;
  message: string;
  context?: {
    workdir?: string;
    labels?: string[];
    metadata?: Record<string, unknown>;
    /** Structured INK metadata for mesh-aware task routing. */
    ink?: TaskMetadata;
  };
}

export type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'thinking'; text: string }
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
  /** Max A2A hop depth. Tasks exceeding this at admission are rejected. Default 4. */
  maxDepth?: number;
  /** Max request body size in bytes. Default 10MB (10485760). */
  maxRequestBytes?: number;
  /** If true and no apiKey is set, reject all A2A requests. */
  denyWithoutKey?: boolean;
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
  | { type: 'task_submitted'; taskId: string; cli: string; message: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'task_running'; taskId: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'thinking'; taskId: string; text: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'progress'; taskId: string; text: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'log'; taskId: string; level: string; text: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'task_completed'; taskId: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'task_failed'; taskId: string; error: string; timestamp: string; ink?: TaskMetadata }
  | { type: 'task_cancelled'; taskId: string; timestamp: string; ink?: TaskMetadata };

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
