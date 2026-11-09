// PLUMB — Task Store Unit Tests
// Validates LRU eviction, TTL cleanup, terminal state tracking.

import { describe, test, expect, beforeEach } from 'bun:test';
import { PlumbTaskStore } from '../src/core/task-store.ts';
import type { Task } from '@a2a-js/sdk';

function makeTask(id: string, state: string): Task {
  return {
    id,
    contextId: id,
    kind: 'task' as const,
    status: { state, timestamp: new Date().toISOString() },
    history: [],
    artifacts: [],
  } as Task;
}

describe('PlumbTaskStore', () => {
  let store: PlumbTaskStore;

  beforeEach(() => {
    store = new PlumbTaskStore({ maxTasks: 5, completedRetentionMinutes: 0 });
  });

  test('save and load', async () => {
    const task = makeTask('t1', 'working');
    await store.save(task);
    const loaded = await store.load('t1');
    expect(loaded).not.toBeUndefined();
    expect(loaded!.id).toBe('t1');
    expect(loaded!.status.state).toBe('working');
  });

  test('load missing returns undefined', async () => {
    const result = await store.load('nonexistent');
    expect(result).toBeUndefined();
  });

  test('delete removes task', async () => {
    const task = makeTask('t1', 'working');
    await store.save(task);
    await store.delete('t1');
    const loaded = await store.load('t1');
    expect(loaded).toBeUndefined();
  });

  test('LRU evicts terminal tasks first', async () => {
    const small = new PlumbTaskStore({ maxTasks: 3 });
    // Fill with terminal tasks
    for (let i = 0; i < 4; i++) {
      await small.save(makeTask(`t${i}`, 'completed'));
    }
    // Oldest terminal should be evicted
    const t0 = await small.load('t0');
    expect(t0).toBeUndefined();
    // Newer tasks still present
    const t3 = await small.load('t3');
    expect(t3).not.toBeUndefined();
  });

  test('LRU prefers evicting terminal over active tasks', async () => {
    const small = new PlumbTaskStore({ maxTasks: 3 });
    await small.save(makeTask('a', 'completed'));
    await small.save(makeTask('b', 'completed'));
    await small.save(makeTask('c', 'working')); // active
    // Force eviction by adding a 4th
    await small.save(makeTask('d', 'completed'));
    // 'a' (terminal) should be evicted, not 'c' (active)
    expect(await small.load('a')).toBeUndefined();
    expect(await small.load('c')).not.toBeUndefined();
  });

  test('cleanupStaleCompleted removes old terminal tasks', () => {
    const storeWithRetention = new PlumbTaskStore({ maxTasks: 5, completedRetentionMinutes: 1 });
    const task = makeTask('old', 'completed');
    storeWithRetention.save(task);
    // Force entry to have old terminal timestamp by manipulating internals
    // @ts-expect-error — accessing private for test
    const entry = storeWithRetention.entries.get('old');
    if (entry) entry.terminalSinceMs = Date.now() - 120_000; // 2 min ago
    storeWithRetention.cleanupStaleCompleted();
    expect(storeWithRetention.size).toBe(0);
  });

  test('size reflects stored count', async () => {
    expect(store.size).toBe(0);
    await store.save(makeTask('a', 'working'));
    expect(store.size).toBe(1);
    await store.save(makeTask('b', 'completed'));
    expect(store.size).toBe(2);
    await store.delete('a');
    expect(store.size).toBe(1);
  });
});
