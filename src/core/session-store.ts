// PLUMB — Cursor Session Store
// In-memory session tracking for multi-turn Cursor conversations.
// Ported from fangai cursor-adapter.ts. Tracks session_ids from
// cursor-agent's --continue/--resume lifecycle.
//
// When sessionTtlMs is set, stale server sessions are abandoned (no --continue)
// and a cold recap of the last N turns is injected into the next prompt so cold
// starts maintain continuity without relying on Cursor holding the session.

export interface SessionTurn {
  user: string;
  assistant: string;
}

export interface CursorSession {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  workspace: string;
  model: string;
  turnCount: number;
  /** Last N completed turns for recap after --continue is unsafe. */
  turns: SessionTurn[];
}

export interface CursorSessionStoreOptions {
  /** Max age since lastUsedAt before dropping session and injecting recap. null = no TTL. */
  sessionTtlMs?: number | null;
  /** Max completed turns to retain per session and include in recap. Default 8. */
  recapMaxTurns?: number;
  /** Max chars per turn leg stored/echoed in recap. Default 8000. */
  recapMaxCharsPerLeg?: number;
}

export class CursorSessionStore {
  private sessions = new Map<string, CursorSession>();
  private lastSessionId: string | null = null;
  private readonly sessionTtlMs: number | null;
  private readonly recapMaxTurns: number;
  private readonly recapMaxCharsPerLeg: number;
  /** Queued cold recap for the next formatInput after TTL expiry. */
  private coldRecapPending: string | null = null;

  constructor(opts: CursorSessionStoreOptions = {}) {
    this.sessionTtlMs = opts.sessionTtlMs === undefined ? null : opts.sessionTtlMs;
    this.recapMaxTurns = opts.recapMaxTurns ?? 8;
    this.recapMaxCharsPerLeg = opts.recapMaxCharsPerLeg ?? 8000;
  }

  /** Register a new session from cursor-agent output. */
  register(sessionId: string, workspace: string, model: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsedAt = new Date();
      existing.turnCount++;
    } else {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        workspace,
        model,
        turnCount: 1,
        turns: [],
      });
    }
    this.lastSessionId = sessionId;
  }

  /**
   * If the current lastSession is older than sessionTtlMs, remove it,
   * queue a cold recap for the next prompt, and clear lastSession so
   * the next spawn is fresh (no --continue).
   */
  expireLastSessionIfStale(nowMs: number = Date.now()): void {
    if (this.sessionTtlMs === null || this.lastSessionId === null) return;
    const s = this.sessions.get(this.lastSessionId);
    if (!s) {
      this.lastSessionId = null;
      return;
    }
    if (nowMs - s.lastUsedAt.getTime() <= this.sessionTtlMs) return;

    const recap = this.buildRecapBlock(s.turns);
    if (recap) this.coldRecapPending = recap;

    this.sessions.delete(this.lastSessionId);
    this.lastSessionId = null;
  }

  /** Pop the cold recap block (from TTL expiry) once, for the next user message. */
  consumeColdRecap(): string | null {
    const r = this.coldRecapPending;
    this.coldRecapPending = null;
    return r;
  }

  /** Append a completed turn after a successful result event. */
  recordCompletedTurn(sessionId: string | null, user: string, assistant: string): void {
    if (!sessionId) return;
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.turns.push({
      user: this.truncateLeg(user),
      assistant: this.truncateLeg(assistant.trim()),
    });
    while (s.turns.length > this.recapMaxTurns) s.turns.shift();
  }

  /** Get the last active session ID for --continue. */
  get lastSession(): string | null {
    return this.lastSessionId;
  }

  /** Get a specific session by ID. */
  get(sessionId: string): CursorSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** List all sessions (most recent first). */
  list(): CursorSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime(),
    );
  }

  /** Clear all sessions. */
  clear(): void {
    this.sessions.clear();
    this.lastSessionId = null;
    this.coldRecapPending = null;
  }

  private truncateLeg(text: string): string {
    const t = text.trim();
    if (t.length <= this.recapMaxCharsPerLeg) return t;
    return `${t.slice(0, this.recapMaxCharsPerLeg)}\n...[truncated]`;
  }

  private buildRecapBlock(turns: SessionTurn[]): string | null {
    if (!turns.length) return null;
    const lines: string[] = [
      '[Plumb: Prior Cursor session expired. Continuity recap — answer the new message after the separator.]',
      '',
      '### Earlier turns (recap)',
    ];
    const slice = turns.slice(-this.recapMaxTurns);
    for (let i = 0; i < slice.length; i++) {
      const t = slice[i]!;
      lines.push(`${i + 1}. **User:** ${t.user}`);
      lines.push(`   **Assistant:** ${t.assistant}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
    return lines.join('\n');
  }
}
