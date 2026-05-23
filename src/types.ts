// PLUMB — Core Types
// Public adapter contract lives in @plumb/adapter-sdk.
// This file re-exports those + adds Plumb-internal types (ledger, RPC).

export type {
  TaskMetadata,
  AgentTask,
  AdapterEvent,
  PlumbConfig,
  DetectionResult,
  AgentAdapter,
} from '@plumb/adapter-sdk';

export type LedgerEvent =
  | { type: 'task_submitted'; taskId: string; cli: string; message: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'task_running'; taskId: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'progress'; taskId: string; text: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'log'; taskId: string; level: string; text: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'task_completed'; taskId: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'task_failed'; taskId: string; error: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata }
  | { type: 'task_cancelled'; taskId: string; timestamp: string; ink?: import('@plumb/adapter-sdk').TaskMetadata };

// ─── Persistent RPC Types ────────────────────────────────────────────────────

export type RpcHostToolResultContent = ReadonlyArray<Record<string, unknown>>;

export interface RpcParsedResponse {
  command?: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export type RpcHostToolExecutor = (
  ctx: {
    requestId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    abortSignal: AbortSignal;
  },
) => Promise<{ content: RpcHostToolResultContent; isError?: boolean }>;
