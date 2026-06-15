// PLUMB — Ledger Read
// Read-only queries over the append-only JSONL ledger. No mutation.
// Pure functions: file discovery, parsing, aggregation. Rendering lives in cli.ts.

import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { LedgerEvent } from '../types.ts';

const DEFAULT_LEDGER_DIR = '.plumb/ledger';

/** Resolve the ledger directory. Mirrors the writer's default; --dir / env override. */
export function resolveLedgerDir(custom?: string): string {
  return custom ?? process.env.PLUMB_LEDGER_DIR ?? DEFAULT_LEDGER_DIR;
}

/** Today's ledger date stamp (YYYY-MM-DD), matching the writer. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ledgerFileForDate(dir: string, date: string): string {
  return join(dir, `${date}.jsonl`);
}

/** All ledger files in dir, sorted ascending by name (= chronological). */
export function listLedgerFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => join(dir, f));
}

/** Parse JSONL text into events. Malformed lines are skipped, not thrown. */
export function parseLedgerLines(raw: string): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as LedgerEvent); } catch { /* skip malformed */ }
  }
  return out;
}

/** Read and parse all events from the given files (in order). Unreadable files are skipped. */
export function readEvents(files: string[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const f of files) {
    try { events.push(...parseLedgerLines(readFileSync(f, 'utf8'))); } catch { /* skip */ }
  }
  return events;
}

/** Nearest-rank percentile. Returns null for an empty set. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))]!;
}

export interface AgentStats {
  agent: string;
  submitted: number;
  completed: number;
  failed: number;
  cancelled: number;
  failureRate: number;
  durationP50Ms: number | null;
  durationP95Ms: number | null;
  tools: Record<string, number>;
  outputBytes: number;
}

export interface LedgerStats {
  agents: AgentStats[];
  totalEvents: number;
}

/** Aggregate per-agent stats from a stream of ledger events. */
export function aggregateStats(events: LedgerEvent[], agentFilter?: string): LedgerStats {
  type Acc = {
    submitted: number; completed: number; failed: number; cancelled: number;
    durations: number[]; tools: Record<string, number>; outputBytes: number;
  };
  const byAgent = new Map<string, Acc>();
  const ensure = (agent: string): Acc => {
    let a = byAgent.get(agent);
    if (!a) { a = { submitted: 0, completed: 0, failed: 0, cancelled: 0, durations: [], tools: {}, outputBytes: 0 }; byAgent.set(agent, a); }
    return a;
  };

  for (const ev of events) {
    const agent = (ev as { agent?: string }).agent;
    if (!agent) continue; // high-volume events (progress/thinking/log) join by taskId, not counted here
    if (agentFilter && agent !== agentFilter) continue;
    const a = ensure(agent);
    switch (ev.type) {
      case 'task_submitted': a.submitted++; break;
      case 'task_completed':
        a.completed++;
        if (typeof ev.durationMs === 'number') a.durations.push(ev.durationMs);
        if (typeof ev.outputBytes === 'number') a.outputBytes += ev.outputBytes;
        break;
      case 'task_failed':
        a.failed++;
        if (typeof ev.durationMs === 'number') a.durations.push(ev.durationMs);
        break;
      case 'task_cancelled': a.cancelled++; break;
      case 'tool_call': a.tools[ev.tool] = (a.tools[ev.tool] ?? 0) + 1; break;
    }
  }

  const agents: AgentStats[] = [...byAgent.entries()]
    .map(([agent, a]) => {
      const terminal = a.completed + a.failed;
      return {
        agent,
        submitted: a.submitted,
        completed: a.completed,
        failed: a.failed,
        cancelled: a.cancelled,
        failureRate: terminal > 0 ? a.failed / terminal : 0,
        durationP50Ms: percentile(a.durations, 50),
        durationP95Ms: percentile(a.durations, 95),
        tools: a.tools,
        outputBytes: a.outputBytes,
      };
    })
    .sort((x, y) => y.submitted - x.submitted);

  return { agents, totalEvents: events.length };
}

/** All events for one task, in ledger order. */
export function taskTimeline(events: LedgerEvent[], taskId: string): LedgerEvent[] {
  return events.filter(e => (e as { taskId?: string }).taskId === taskId);
}

/**
 * Read only the bytes appended since `offset`. Efficient for `tail --follow`
 * (does not re-read the whole file). Returns new text and the updated offset.
 */
export function readFrom(file: string, offset: number): { text: string; newOffset: number } {
  if (!existsSync(file)) return { text: '', newOffset: offset };
  const size = statSync(file).size;
  if (size <= offset) return { text: '', newOffset: size };
  const len = size - offset;
  const buf = Buffer.alloc(len);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, len, offset); } finally { closeSync(fd); }
  return { text: buf.toString('utf8'), newOffset: size };
}
