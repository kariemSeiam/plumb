// PLUMB — Circuit Breaker
// Per-adapter state machine. Protects the fleet from flapping agents.
// CLOSED → [N failures in W window] → OPEN → [cooldown elapsed] → HALF-OPEN
// HALF-OPEN → [probe success] → CLOSED
// HALF-OPEN → [probe failure] → OPEN (full cooldown)

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerConfig {
  failureThreshold?: number;  // default 5
  windowMs?: number;          // default 60000
  cooldownMs?: number;        // default 120000
}

/** Error codes that count toward the breaker (adapter/CLI faults). */
const COUNTED_ERROR_CODES = new Set([
  'CLI_RUNTIME_ERROR',
  'CLI_TIMEOUT',
  'CLI_KILLED',
  'ADAPTER_PARSE_ERROR',
]);

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failureTimestamps: number[] = [];
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private probeUsed = false;
  private totalSuccesses = 0;
  private totalFailures = 0;

  private readonly threshold: number;
  private readonly window: number;
  private readonly cooldown: number;

  constructor(config: BreakerConfig = {}) {
    this.threshold = config.failureThreshold ?? 5;
    this.window = config.windowMs ?? 60_000;
    this.cooldown = config.cooldownMs ?? 120_000;
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Current breaker state. */
  getState(): BreakerState {
    return this.state;
  }

  /** Failure count within the rolling window. */
  getFailureCount(): number {
    this.prune();
    return this.failureTimestamps.length;
  }

  /** Lifetime success count (since boot or last reset). */
  getTotalSuccesses(): number {
    return this.totalSuccesses;
  }

  /** Lifetime failure count (since boot or last reset). */
  getTotalFailures(): number {
    return this.totalFailures;
  }

  /**
   * Whether the breaker allows a new request.
   * - CLOSED: always yes
   * - HALF_OPEN: yes for exactly one probe, then no until result
   * - OPEN: no
   */
  allowRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half_open' && !this.probeUsed) {
      this.probeUsed = true;
      return true;
    }
    return false;
  }

  /** Record a successful task completion. */
  recordSuccess(): void {
    this.totalSuccesses++;
    this.prune();

    if (this.state === 'half_open') {
      // Probe succeeded — close the breaker
      this.state = 'closed';
      this.probeUsed = false;
      this.failureTimestamps = [];
    }
  }

  /**
   * Record a task failure.
   * Only CLI/ADAPTER errors count (CLI_RUNTIME_ERROR, CLI_TIMEOUT, etc.).
   * Validation errors (INK_*, TASK_CANCELLED) do NOT count — caller's fault.
   */
  recordFailure(errorCode?: string): void {
    // Skip non-counted errors
    if (errorCode && !COUNTED_ERROR_CODES.has(errorCode)) return;

    this.totalFailures++;
    this.prune();
    this.failureTimestamps.push(Date.now());

    if (this.state === 'half_open') {
      // Probe failed — reopen with full cooldown
      this.trip();
    } else if (this.state === 'closed' && this.failureTimestamps.length >= this.threshold) {
      this.trip();
    }
  }

  /** Manual operator override: reset to closed. */
  reset(): void {
    this.state = 'closed';
    this.failureTimestamps = [];
    this.probeUsed = false;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  /** Get breaker diagnostics for observability. */
  getDiagnostics(): {
    state: BreakerState;
    failuresInWindow: number;
    totalSuccesses: number;
    totalFailures: number;
    threshold: number;
    windowMs: number;
    cooldownMs: number;
  } {
    this.prune();
    return {
      state: this.state,
      failuresInWindow: this.failureTimestamps.length,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      threshold: this.threshold,
      windowMs: this.window,
      cooldownMs: this.cooldown,
    };
  }

  // ── Private ──────────────────────────────────────────────────────

  private trip(): void {
    this.state = 'open';
    this.probeUsed = false;
    this.failureTimestamps = [];

    this.cooldownTimer = setTimeout(() => {
      this.state = 'half_open';
      this.cooldownTimer = null;
    }, this.cooldown);

    // Don't hold the process open
    if (this.cooldownTimer && typeof (this.cooldownTimer as NodeJS.Timeout).unref === 'function') {
      (this.cooldownTimer as NodeJS.Timeout).unref();
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.window;
    this.failureTimestamps = this.failureTimestamps.filter(t => t > cutoff);
  }
}
