// PLUMB — Crash Resume
// On every start, scans the ledger for tasks that were running/submitted
// when the server died. Marks them as interrupted. Before accepting new tasks.
//
// The missing task_completed event IS the signal.
// The ledger is the source of truth.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './log.ts';

export interface CrashResumeResult {
  interruptedCount: number;
  taskIds: string[];
}

/**
 * Scan a ledger file for tasks that were running or submitted
 * but never reached a terminal state (completed, failed, cancelled, interrupted).
 */
export function scanForInterrupted(ledgerDir: string): CrashResumeResult {
  const today = new Date().toISOString().slice(0, 10);
  const ledgerPath = join(ledgerDir, `${today}.jsonl`);

  if (!existsSync(ledgerPath)) {
    return { interruptedCount: 0, taskIds: [] };
  }

  const raw = readFileSync(ledgerPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    return { interruptedCount: 0, taskIds: [] };
  }

  const terminalTypes = new Set([
    'task_completed',
    'task_failed',
    'task_cancelled',
    'task_interrupted',
  ]);

  // Track the latest non-terminal state per taskId.
  // A terminal event removes the task from tracking (null).
  // A running/submitted event marks it as active.
  const openTasks = new Map<string, string>(); // taskId → last event type

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as { type: string; taskId?: string };
      const taskId = event.taskId;
      if (!taskId) continue;

      if (terminalTypes.has(event.type)) {
        openTasks.delete(taskId);
      } else if (event.type === 'task_running' || event.type === 'task_submitted') {
        openTasks.set(taskId, event.type);
      }
    } catch {
      // Malformed line — skip
    }
  }

  const taskIds = [...openTasks.keys()];

  return {
    interruptedCount: taskIds.length,
    taskIds,
  };
}

/**
 * Write task_interrupted events for each interrupted task found in the scan.
 * Must be called before accepting new tasks.
 */
export function writeInterruptedEvents(
  append: (event: Record<string, unknown>) => void,
  result: CrashResumeResult,
): void {
  const now = new Date().toISOString();
  for (const taskId of result.taskIds) {
    append({
      type: 'task_interrupted',
      taskId,
      previousStatus: 'running',
      timestamp: now,
    });
    log('warn', 'task_interrupted', {
      taskId,
      reason: 'server crash detected on restart',
      timestamp: now,
    });
  }
}
