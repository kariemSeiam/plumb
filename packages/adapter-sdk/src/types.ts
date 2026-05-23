// @plumb/adapter-sdk — Core Types
// The adapter contract. Implement AgentAdapter to teach Plumb a new CLI agent.

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
   */
  budgetMs?: number;
  /**
   * Admission deadline as Unix MS timestamp.
   * Rejects if already past at task arrival.
   */
  deadlineUnixMs?: number;
  /** Sender's wall-clock at message origination (Unix MS). Used for clock skew detection. */
  senderUnixMs?: number;
  /** Task priority. Critical tasks jump the queue. */
  priority?: 'critical' | 'normal' | 'background';
  /** Idempotency key for deduplication. */
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
    ink?: TaskMetadata;
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
  maxDepth?: number;
  maxRequestBytes?: number;
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
