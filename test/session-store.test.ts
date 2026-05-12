import { describe, it, expect, beforeEach } from 'bun:test';
import { CursorSessionStore } from '../src/core/session-store.ts';

describe('CursorSessionStore', () => {
  it('registers a new session and sets lastSession', () => {
    const store = new CursorSessionStore();
    store.register('s1', '/workspace', 'model-a');
    expect(store.lastSession).toBe('s1');
    const s = store.get('s1');
    expect(s).toBeDefined();
    expect(s!.id).toBe('s1');
    expect(s!.workspace).toBe('/workspace');
    expect(s!.model).toBe('model-a');
    expect(s!.turnCount).toBe(1);
    expect(s!.turns).toHaveLength(0);
  });

  it('increments turnCount on re-register', () => {
    const store = new CursorSessionStore();
    store.register('s1', '/w', 'm');
    store.register('s1', '/w', 'm');
    expect(store.get('s1')!.turnCount).toBe(2);
    expect(store.lastSession).toBe('s1');
  });

  it('records completed turns with truncation', () => {
    const store = new CursorSessionStore({ recapMaxTurns: 2, recapMaxCharsPerLeg: 20 });
    store.register('s1', '/w', 'm');
    store.recordCompletedTurn('s1', 'hello', 'world');
    store.recordCompletedTurn('s1', 'msg2', 'resp2');
    store.recordCompletedTurn('s1', 'msg3', 'resp3'); // should evict msg1
    const s = store.get('s1')!;
    expect(s.turns).toHaveLength(2);
    expect(s.turns[0]!.user).toBe('msg2');
    expect(s.turns[1]!.user).toBe('msg3');
  });

  it('expireLastSessionIfStale drops session and queues recap when turns exist', () => {
    const store = new CursorSessionStore({ sessionTtlMs: 60_000 });
    store.register('s1', '/w', 'm');
    store.recordCompletedTurn('s1', 'user says', 'assistant says');
    // Backdate lastUsedAt to 2 minutes ago
    const s = store.get('s1')!;
    s.lastUsedAt = new Date(Date.now() - 120_000);
    store.expireLastSessionIfStale();
    expect(store.lastSession).toBeNull();
    expect(store.get('s1')).toBeUndefined();
    const recap = store.consumeColdRecap();
    expect(recap).toContain('user says');
    expect(recap).toContain('assistant says');
  });

  it('expireLastSessionIfStale clears stale session without recap when no turns', () => {
    const store = new CursorSessionStore({ sessionTtlMs: 1000 });
    store.register('s1', '/w', 'm');
    const s = store.get('s1')!;
    s.lastUsedAt = new Date(Date.now() - 5000);
    store.expireLastSessionIfStale();
    expect(store.lastSession).toBeNull();
    expect(store.consumeColdRecap()).toBeNull();
  });

  it('consumeColdRecap returns null on second call', () => {
    const store = new CursorSessionStore({ sessionTtlMs: 1000 });
    store.register('s1', '/w', 'm');
    store.recordCompletedTurn('s1', 'q', 'a');
    const s = store.get('s1')!;
    s.lastUsedAt = new Date(Date.now() - 5000);
    store.expireLastSessionIfStale();
    expect(store.consumeColdRecap()).not.toBeNull();
    expect(store.consumeColdRecap()).toBeNull();
  });

  it('does not expire when within TTL', () => {
    const store = new CursorSessionStore({ sessionTtlMs: 300_000 });
    store.register('s1', '/w', 'm');
    store.expireLastSessionIfStale();
    expect(store.lastSession).toBe('s1');
  });

  it('does not expire when TTL is null', () => {
    const store = new CursorSessionStore({ sessionTtlMs: null });
    store.register('s1', '/w', 'm');
    const s = store.get('s1')!;
    s.lastUsedAt = new Date(Date.now() - 1_000_000);
    store.expireLastSessionIfStale();
    expect(store.lastSession).toBe('s1');
  });

  it('clear resets everything', () => {
    const store = new CursorSessionStore({ sessionTtlMs: 1000 });
    store.register('s1', '/w', 'm');
    store.recordCompletedTurn('s1', 'q', 'a');
    const s = store.get('s1')!;
    s.lastUsedAt = new Date(Date.now() - 5000);
    store.expireLastSessionIfStale();
    store.clear();
    expect(store.lastSession).toBeNull();
    expect(store.list()).toHaveLength(0);
    expect(store.consumeColdRecap()).toBeNull();
  });

  it('list returns sessions sorted by lastUsedAt desc', () => {
    const store = new CursorSessionStore();
    store.register('s1', '/w', 'm');
    // Advance time by ensuring a real delay or manual backdate
    const s1 = store.get('s1')!;
    s1.lastUsedAt = new Date(Date.now() - 1000);
    store.register('s2', '/w2', 'm2');
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('s2'); // most recent first
    expect(list[1]!.id).toBe('s1');
  });

  it('recordCompletedTurn ignores null sessionId', () => {
    const store = new CursorSessionStore();
    store.register('s1', '/w', 'm');
    // Should not throw
    store.recordCompletedTurn(null, 'q', 'a');
    expect(store.get('s1')!.turns).toHaveLength(0);
  });

  it('recordCompletedTurn ignores unknown sessionId', () => {
    const store = new CursorSessionStore();
    store.recordCompletedTurn('nonexistent', 'q', 'a');
    expect(store.list()).toHaveLength(0);
  });
});
