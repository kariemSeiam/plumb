// PLUMB — Ledger Read Tests
// Pure read/aggregate functions: percentile, parse, stats, timeline.

import { describe, it, expect } from 'bun:test';
import { aggregateStats, percentile, parseLedgerLines, taskTimeline } from '../src/core/ledger-read.ts';
import type { LedgerEvent } from '../src/types.ts';

const ts = '2026-06-15T10:00:00.000Z';

describe('percentile', () => {
  it('returns null for empty input', () => {
    expect(percentile([], 50)).toBeNull();
  });
  it('computes nearest-rank percentiles', () => {
    const v = [10, 20, 30, 40, 50];
    expect(percentile(v, 50)).toBe(30);
    expect(percentile(v, 95)).toBe(50);
    expect(percentile(v, 1)).toBe(10);
  });
});

describe('parseLedgerLines', () => {
  it('parses valid lines and skips malformed/blank', () => {
    const raw = [
      JSON.stringify({ type: 'progress', taskId: 't', text: 'x', timestamp: ts }),
      'not json {{{',
      '',
      JSON.stringify({ type: 'task_completed', taskId: 't', agent: 'pi', timestamp: ts }),
    ].join('\n');
    const evs = parseLedgerLines(raw);
    expect(evs.length).toBe(2);
    expect(evs[0]!.type).toBe('progress');
    expect(evs[1]!.type).toBe('task_completed');
  });
});

describe('aggregateStats', () => {
  const events: LedgerEvent[] = [
    { type: 'task_submitted', taskId: 't1', agent: 'pi', cli: 'pi', message: 'a', timestamp: ts },
    { type: 'tool_call', taskId: 't1', agent: 'pi', tool: 'read', timestamp: ts },
    { type: 'tool_call', taskId: 't1', agent: 'pi', tool: 'read', timestamp: ts },
    { type: 'tool_call', taskId: 't1', agent: 'pi', tool: 'edit', timestamp: ts },
    { type: 'task_completed', taskId: 't1', agent: 'pi', durationMs: 100, outputBytes: 50, timestamp: ts },
    { type: 'task_submitted', taskId: 't2', agent: 'pi', cli: 'pi', message: 'b', timestamp: ts },
    { type: 'task_failed', taskId: 't2', agent: 'pi', error: 'boom', durationMs: 300, timestamp: ts },
    { type: 'task_submitted', taskId: 't3', agent: 'claude', cli: 'claude', message: 'c', timestamp: ts },
    { type: 'task_completed', taskId: 't3', agent: 'claude', durationMs: 20, outputBytes: 10, timestamp: ts },
    // progress has no agent → must be ignored by per-agent aggregation
    { type: 'progress', taskId: 't3', text: 'no agent here', timestamp: ts },
  ];

  it('aggregates counts, durations, tools, output per agent', () => {
    const stats = aggregateStats(events);
    expect(stats.totalEvents).toBe(events.length);

    const pi = stats.agents.find(a => a.agent === 'pi')!;
    expect(pi.submitted).toBe(2);
    expect(pi.completed).toBe(1);
    expect(pi.failed).toBe(1);
    expect(pi.failureRate).toBeCloseTo(0.5);
    expect(pi.durationP50Ms).toBe(100);
    expect(pi.durationP95Ms).toBe(300);
    expect(pi.tools).toEqual({ read: 2, edit: 1 });
    expect(pi.outputBytes).toBe(50);

    const claude = stats.agents.find(a => a.agent === 'claude')!;
    expect(claude.completed).toBe(1);
    expect(claude.failed).toBe(0);
    expect(claude.failureRate).toBe(0);
  });

  it('sorts agents by tasks submitted, descending', () => {
    const stats = aggregateStats(events);
    expect(stats.agents[0]!.agent).toBe('pi');
  });

  it('respects the agent filter', () => {
    const stats = aggregateStats(events, 'claude');
    expect(stats.agents.length).toBe(1);
    expect(stats.agents[0]!.agent).toBe('claude');
  });
});

describe('taskTimeline', () => {
  it('returns one task\'s events in ledger order', () => {
    const events: LedgerEvent[] = [
      { type: 'task_submitted', taskId: 't1', agent: 'pi', cli: 'pi', message: 'a', timestamp: ts },
      { type: 'task_submitted', taskId: 't2', agent: 'pi', cli: 'pi', message: 'b', timestamp: ts },
      { type: 'task_completed', taskId: 't1', agent: 'pi', timestamp: ts },
    ];
    const tl = taskTimeline(events, 't1');
    expect(tl.length).toBe(2);
    expect(tl[0]!.type).toBe('task_submitted');
    expect(tl[1]!.type).toBe('task_completed');
  });
});
