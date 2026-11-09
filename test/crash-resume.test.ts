// PLUMB — Crash Resume Tests
// Scans ledger for interrupted tasks, writes task_interrupted events.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForInterrupted, writeInterruptedEvents } from '../src/core/crash-resume.ts';

function tmpLedgerDir(): string {
  const dir = join(tmpdir(), `plumb-crash-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function writeLedger(dir: string, lines: string[]): void {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(dir, `${today}.jsonl`), lines.join('\n') + '\n');
}

describe('scanForInterrupted — empty ledger', () => {
  it('returns zero for non-existent ledger', () => {
    const result = scanForInterrupted('/nonexistent/path');
    expect(result.interruptedCount).toBe(0);
    expect(result.taskIds).toEqual([]);
  });

  it('returns zero for empty ledger', () => {
    const dir = tmpLedgerDir();
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(join(dir, `${today}.jsonl`), '');
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(0);
    rmSync(dir, { recursive: true });
  });
});

describe('scanForInterrupted — normal lifecycle', () => {
  it('returns zero when all tasks completed normally', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"a1","cli":"cat","message":"hello","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"a1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"progress","taskId":"a1","text":"hello","timestamp":"2026-05-31T00:00:02Z"}',
      '{"type":"task_completed","taskId":"a1","timestamp":"2026-05-31T00:00:03Z"}',
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(0);
    rmSync(dir, { recursive: true });
  });

  it('returns zero when all tasks failed normally', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"b1","cli":"cat","message":"fail","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"b1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"task_failed","taskId":"b1","error":"CLI crash","timestamp":"2026-05-31T00:00:02Z"}',
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(0);
    rmSync(dir, { recursive: true });
  });

  it('returns zero when all tasks were cancelled', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"c1","cli":"cat","message":"cancel","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"c1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"task_cancelled","taskId":"c1","timestamp":"2026-05-31T00:00:02Z"}',
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(0);
    rmSync(dir, { recursive: true });
  });
});

describe('scanForInterrupted — crash detection', () => {
  it('detects running task with no terminal event', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"d1","cli":"cat","message":"crash","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"d1","timestamp":"2026-05-31T00:00:01Z"}',
      // No task_completed/failed/cancelled — server crashed
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(1);
    expect(result.taskIds).toEqual(['d1']);
    rmSync(dir, { recursive: true });
  });

  it('detects submitted task that never started running', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"e1","cli":"cat","message":"never ran","timestamp":"2026-05-31T00:00:00Z"}',
      // No task_running — server crashed after submission
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(1);
    expect(result.taskIds).toEqual(['e1']);
    rmSync(dir, { recursive: true });
  });

  it('detects multiple interrupted tasks', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"f1","cli":"cat","message":"a","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"f1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"task_submitted","taskId":"f2","cli":"cat","message":"b","timestamp":"2026-05-31T00:00:02Z"}',
      '{"type":"task_running","taskId":"f2","timestamp":"2026-05-31T00:00:03Z"}',
      // Both f1 and f2 are still running — no terminal events
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(2);
    expect(result.taskIds.sort()).toEqual(['f1', 'f2']);
    rmSync(dir, { recursive: true });
  });

  it('skips tasks with terminal events mixed with interrupted ones', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"g1","cli":"cat","message":"done","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"g1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"task_completed","taskId":"g1","timestamp":"2026-05-31T00:00:02Z"}',
      '{"type":"task_submitted","taskId":"g2","cli":"cat","message":"interrupted","timestamp":"2026-05-31T00:00:03Z"}',
      '{"type":"task_running","taskId":"g2","timestamp":"2026-05-31T00:00:04Z"}',
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(1);
    expect(result.taskIds).toEqual(['g2']);
    rmSync(dir, { recursive: true });
  });

  it('handles previously interrupted tasks (should not flag again)', () => {
    const dir = tmpLedgerDir();
    writeLedger(dir, [
      '{"type":"task_submitted","taskId":"h1","cli":"cat","message":"x","timestamp":"2026-05-31T00:00:00Z"}',
      '{"type":"task_running","taskId":"h1","timestamp":"2026-05-31T00:00:01Z"}',
      '{"type":"task_interrupted","taskId":"h1","previousStatus":"running","timestamp":"2026-05-31T00:00:02Z"}',
    ]);
    const result = scanForInterrupted(dir);
    expect(result.interruptedCount).toBe(0);
    rmSync(dir, { recursive: true });
  });
});

describe('writeInterruptedEvents', () => {
  it('appends task_interrupted events for each interrupted task', () => {
    const events: Record<string, unknown>[] = [];
    const append = (e: Record<string, unknown>) => { events.push(e); };

    writeInterruptedEvents(append, {
      interruptedCount: 2,
      taskIds: ['i1', 'i2'],
    });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('task_interrupted');
    expect(events[0].taskId).toBe('i1');
    expect(events[0].previousStatus).toBe('running');
    expect(typeof events[0].timestamp).toBe('string');
    expect(events[1].taskId).toBe('i2');
  });

  it('handles empty result gracefully', () => {
    const events: Record<string, unknown>[] = [];
    const append = (e: Record<string, unknown>) => { events.push(e); };

    writeInterruptedEvents(append, {
      interruptedCount: 0,
      taskIds: [],
    });

    expect(events).toHaveLength(0);
  });
});
