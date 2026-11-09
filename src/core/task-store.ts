// PLUMB — Task Store
// LRU-bounded + TTL-cleanup task store. Replaces SDK InMemoryTaskStore.
// Prevents unbounded memory growth: evicts terminal tasks after retention
// window, enforces max task cap. Based on FangTaskStore (fangai, tested).

import type { Task } from '@a2a-js/sdk';
import type { TaskStore, ServerCallContext } from '@a2a-js/sdk/server';

const TERMINAL_STATES = new Set<string>([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

interface StoredEntry {
  task: Task;
  /** Timestamp when this task entered a terminal state (ms). null = active. */
  terminalSinceMs: number | null;
}

function shallowClone(task: Task): Task {
  const t: Task = { ...task };
  if (t.history !== undefined) {
    t.history = [...t.history];
  }
  if (t.artifacts !== undefined) {
    t.artifacts = t.artifacts.map(a => ({ ...a }));
  }
  return t;
}

export interface PlumbTaskStoreOptions {
  /** Maximum tasks retained (LRU eviction). Default 100. */
  maxTasks?: number;
  /** Drop terminal tasks older than this many minutes. Default 60. */
  completedRetentionMinutes?: number;
}

export class PlumbTaskStore implements TaskStore {
  private readonly maxTasks: number;
  private readonly retentionMs: number;
  /** Map iteration order = LRU. Touch = delete + re-set. */
  private readonly entries = new Map<string, StoredEntry>();

  constructor(options?: PlumbTaskStoreOptions) {
    const mt = options?.maxTasks ?? 100;
    this.maxTasks = mt < 1 ? 1 : mt;
    const mins = options?.completedRetentionMinutes ?? 60;
    this.retentionMs = Math.max(1, mins) * 60 * 1000;
  }

  async save(task: Task, _context?: ServerCallContext): Promise<void> {
    const cloned = shallowClone(task);
    const now = Date.now();
    const terminal = TERMINAL_STATES.has(cloned.status.state);

    let terminalSinceMs: number | null = null;
    if (terminal) {
      const prev = this.entries.get(cloned.id);
      if (prev && prev.terminalSinceMs !== null && TERMINAL_STATES.has(prev.task.status.state)) {
        terminalSinceMs = prev.terminalSinceMs;
      } else {
        terminalSinceMs = now;
      }
    }

    // Touch: delete then re-set to maintain LRU order
    if (this.entries.has(cloned.id)) {
      this.entries.delete(cloned.id);
    }
    this.entries.set(cloned.id, { task: cloned, terminalSinceMs });

    this.evictIfNeeded();
    return Promise.resolve();
  }

  async load(taskId: string, _context?: ServerCallContext): Promise<Task | undefined> {
    const entry = this.entries.get(taskId);
    if (!entry) return Promise.resolve(undefined);

    // Touch for LRU
    this.entries.delete(taskId);
    const touched: StoredEntry = {
      task: entry.task,
      terminalSinceMs: entry.terminalSinceMs,
    };
    this.entries.set(taskId, touched);

    return Promise.resolve(shallowClone(entry.task));
  }

  /** Remove a single task by ID. */
  delete(taskId: string, _context?: ServerCallContext): Promise<void> {
    this.entries.delete(taskId);
    return Promise.resolve();
  }

  /** Drop terminal tasks past retention window. */
  cleanupStaleCompleted(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (
        TERMINAL_STATES.has(entry.task.status.state) &&
        entry.terminalSinceMs !== null &&
        now - entry.terminalSinceMs > this.retentionMs
      ) {
        this.entries.delete(id);
      }
    }
  }

  /** Number of tasks currently stored. */
  get size(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxTasks) {
      let victim: string | undefined;
      // Evict terminal tasks first
      for (const id of this.entries.keys()) {
        const entry = this.entries.get(id);
        if (entry && TERMINAL_STATES.has(entry.task.status.state)) {
          victim = id;
          break;
        }
      }
      // If no terminal tasks, evict oldest
      if (victim === undefined) {
        victim = this.entries.keys().next().value as string | undefined;
      }
      if (victim === undefined) break;
      this.entries.delete(victim);
    }
  }
}
