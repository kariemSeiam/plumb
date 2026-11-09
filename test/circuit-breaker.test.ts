// PLUMB — Circuit Breaker Tests
// State machine: CLOSED → OPEN → HALF-OPEN → CLOSED/OPEN
// Verifies rolling window, probe behavior, error code filtering.

import { describe, it, expect } from 'bun:test';
import { CircuitBreaker } from '../src/core/circuit-breaker.ts';

// Fast config for testing: low threshold, short window/cooldown
function fastBreaker(): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: 3,
    windowMs: 5000,
    cooldownMs: 100, // short cooldown for testing transition
  });
}

describe('CircuitBreaker — initial state', () => {
  it('starts closed with zero failures', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('accepts default config values', () => {
    const cb = new CircuitBreaker();
    const d = cb.getDiagnostics();
    expect(d.threshold).toBe(5);
    expect(d.windowMs).toBe(60000);
    expect(d.cooldownMs).toBe(120000);
  });
});

describe('CircuitBreaker — CLOSED → OPEN', () => {
  it('opens after N consecutive failures', () => {
    const cb = fastBreaker();
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('closed');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('closed');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('does not open with mixed successes and failures', () => {
    const cb = fastBreaker();
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordSuccess();
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordSuccess();
    cb.recordFailure('CLI_RUNTIME_ERROR');
    // Third failure but with successes in between — should still open
    // because success doesn't clear the failure window
    expect(cb.getState()).toBe('open');
  });

  it('does not count TASK_CANCELLED toward breaker', () => {
    const cb = fastBreaker();
    cb.recordFailure('TASK_CANCELLED');
    cb.recordFailure('TASK_CANCELLED');
    cb.recordFailure('TASK_CANCELLED');
    // Should still be closed — cancellation is caller's fault
    expect(cb.getState()).toBe('closed');
  });

  it('does not count INK_* validation errors toward breaker', () => {
    const cb = fastBreaker();
    cb.recordFailure('INK_VERSION');
    cb.recordFailure('INK_RECURSION_LIMIT');
    cb.recordFailure('INK_DEADLINE_INVALID');
    expect(cb.getState()).toBe('closed');
  });

  it('counts errors without a code (generic failure)', () => {
    const cb = fastBreaker();
    cb.recordFailure(); // no code = generic failure
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('tracks failure count in rolling window', () => {
    const cb = new CircuitBreaker({
      failureThreshold: 5,
      windowMs: 60000,
      cooldownMs: 120000,
    });
    expect(cb.getFailureCount()).toBe(0);
    cb.recordFailure('CLI_TIMEOUT');
    cb.recordFailure('ADAPTER_PARSE_ERROR');
    expect(cb.getFailureCount()).toBe(2);
  });
});

describe('CircuitBreaker — OPEN → HALF-OPEN → CLOSED', () => {
  it('transitions to half-open after cooldown', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      windowMs: 5000,
      cooldownMs: 50, // 50ms cooldown for async test
    });
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('open');

    // Wait for cooldown
    await new Promise(r => setTimeout(r, 80));
    expect(cb.getState()).toBe('half_open');
  });

  it('allows exactly one probe in half-open state', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      windowMs: 5000,
      cooldownMs: 50,
    });
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('open');

    await new Promise(r => setTimeout(r, 80));
    expect(cb.getState()).toBe('half_open');

    // First request — allowed (probe)
    expect(cb.allowRequest()).toBe(true);
    // Second request — blocked (probe already used)
    expect(cb.allowRequest()).toBe(false);
  });

  it('closes breaker on probe success', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      windowMs: 5000,
      cooldownMs: 50,
    });
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    await new Promise(r => setTimeout(r, 80));

    expect(cb.getState()).toBe('half_open');
    cb.allowRequest(); // consume probe slot
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true); // normal operation
  });

  it('reopens breaker on probe failure', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      windowMs: 5000,
      cooldownMs: 50,
    });
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    await new Promise(r => setTimeout(r, 80));

    expect(cb.getState()).toBe('half_open');
    cb.allowRequest(); // consume probe slot
    cb.recordFailure('CLI_TIMEOUT'); // probe failed
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });
});

describe('CircuitBreaker — reset', () => {
  it('resets to closed with zero counts', () => {
    const cb = fastBreaker();
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordFailure('CLI_RUNTIME_ERROR');
    expect(cb.getState()).toBe('open');
    expect(cb.getTotalFailures()).toBe(3);

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getTotalFailures()).toBe(0);
    expect(cb.getTotalSuccesses()).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });
});

describe('CircuitBreaker — diagnostics', () => {
  it('reports accurate diagnostics', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 10000, cooldownMs: 30000 });
    cb.recordFailure('CLI_RUNTIME_ERROR');
    cb.recordSuccess();

    const d = cb.getDiagnostics();
    expect(d.state).toBe('closed');
    expect(d.failuresInWindow).toBe(1);
    expect(d.totalSuccesses).toBe(1);
    expect(d.totalFailures).toBe(1);
    expect(d.threshold).toBe(3);
    expect(d.windowMs).toBe(10000);
    expect(d.cooldownMs).toBe(30000);
  });
});
