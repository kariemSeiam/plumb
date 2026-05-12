// PLUMB — Process Manager
// Spawns CLI agents, routes stdout/stderr, enforces SIGTERM→SIGKILL cancellation.
// Stolen from fangai's ProcessManager + attachJsonlReader.
// LF-only JSONL reader: does NOT use Node readline (which splits on U+2028/U+2029,
// breaking Pi's JSONL protocol where those codepoints are valid inside strings).

import { spawn, type ChildProcess } from 'node:child_process';

function log(level: string, msg: string, data?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    l: level,
    m: msg,
    ...(data ?? {}),
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}

export function attachJsonlReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): () => void {
  let buffer = '';

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    while (true) {
      const idx = buffer.indexOf('\n');
      if (idx === -1) break;
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) onLine(line);
    }
  };

  const onEnd = () => {
    if (buffer.length > 0) {
      const remaining = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (remaining.length > 0) onLine(remaining);
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.on('end', onEnd);
  return () => {
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
  };
}

export class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private killTimers = new Map<string, NodeJS.Timeout>();
  private cleanups = new Map<string, () => void>();

  spawn(
    taskId: string,
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> },
    handlers: {
      onLine: (line: string) => void;
      onError: (text: string) => void;
      onExit: (code: number | null, signal: string | null) => void;
    },
  ): ChildProcess {
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...(process.env as Record<string, string>), ...opts.env },
    });
    this.processes.set(taskId, proc);
    log('info', 'process_spawned', { taskId, cmd, pid: proc.pid });

    const detach = attachJsonlReader(proc.stdout!, handlers.onLine);
    this.cleanups.set(taskId, detach);

    let stderrBuf = '';
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) handlers.onError(line);
      }
    });

    proc.on('exit', (code, signal) => {
      log('info', 'process_exited', { taskId, code, signal });
      detach();
      this.processes.delete(taskId);
      this.cleanups.delete(taskId);
      const timer = this.killTimers.get(taskId);
      if (timer) { clearTimeout(timer); this.killTimers.delete(taskId); }
      handlers.onExit(code, signal);
    });

    proc.on('error', (err) => {
      log('error', 'process_error', { taskId, error: err.message });
      detach();
      this.processes.delete(taskId);
      this.cleanups.delete(taskId);
      handlers.onError(err.message);
      handlers.onExit(1, null);
    });

    return proc;
  }

  stdin(taskId: string, data: string, close = false): void {
    const proc = this.processes.get(taskId);
    if (!proc) return;
    proc.stdin!.write(data);
    if (close) proc.stdin!.end();
  }

  kill(taskId: string, timeout = 5000): void {
    const proc = this.processes.get(taskId);
    if (!proc) return;
    log('warn', 'process_kill', { taskId, timeout });
    proc.kill('SIGTERM');
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }, timeout);
    this.killTimers.set(taskId, timer);
  }

  async killAll(timeout = 5000): Promise<void> {
    const ids = [...this.processes.keys()];
    if (ids.length === 0) return;
    await Promise.all(ids.map(id => new Promise<void>(resolve => {
      const proc = this.processes.get(id);
      if (!proc) { resolve(); return; }
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* gone */ }
        resolve();
      }, timeout);
      proc.on('exit', () => { clearTimeout(timer); resolve(); });
      proc.kill('SIGTERM');
    })));
  }

  has(taskId: string): boolean { return this.processes.has(taskId); }
}

// ─── Persistent Process Manager ───────────────────────────────────────────
// Single long-running process for adapters with mode: 'persistent'.
// Tasks are queued. Lines route to active task. Task completes on protocol signal.

export class PersistentProcess {
  private proc: ChildProcess | null = null;
  private detachReader: (() => void) | null = null;
  private readonly cmd: string;
  private readonly args: string[];
  private readonly opts: { cwd?: string; env?: Record<string, string> };

  private taskHandlers = new Map<string, (line: string) => void>();
  private taskQueue: string[] = [];
  private activeTaskId: string | null = null;
  private writeBuffer = new Map<string, string[]>();

  /** Ready-frame detection — resolves waitUntilReady on { "type": "ready" }. */
  private readyEmitted = false;
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  readonly onCrash?: (crashedTaskId: string, remainingCount: number) => void;

  constructor(
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> },
    callbacks?: { onCrash?: (crashedTaskId: string, remainingCount: number) => void },
  ) {
    this.cmd = cmd;
    this.args = args;
    this.opts = opts;
    this.onCrash = callbacks?.onCrash;
  }

  /**
   * Resolves once the child emits { "type": "ready" } over stdout,
   * or rejects on timeout after ensure() spawned the process.
   * Returns immediately if already ready.
   */
  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    if (this.readyEmitted) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('Timed out waiting for persistent agent ready frame')),
        timeoutMs,
      );
      this.readyWaiters.push({
        resolve: () => { clearTimeout(t); resolve(); },
        reject: (e: Error) => { clearTimeout(t); reject(e); },
      });
    });
  }

  private signalReady(): void {
    if (this.readyEmitted) return;
    this.readyEmitted = true;
    for (const w of this.readyWaiters) {
      try { w.resolve(); } catch { /* noop */ }
    }
    this.readyWaiters.length = 0;
  }

  async ensure(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return;

    this.proc = spawn(this.cmd, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.opts.cwd,
      env: { ...(process.env as Record<string, string>), ...this.opts.env },
    });

    log('info', 'persistent_spawned', { cmd: this.cmd, pid: this.proc.pid });

    this.detachReader = attachJsonlReader(this.proc.stdout!, (line) => {
      this.routeLine(line);
    });

    this.proc.stderr!.on('data', () => {
      // stderr from persistent process — ignored
    });

    this.proc.on('exit', () => {
      log('warn', 'persistent_exited', { activeTaskId: this.activeTaskId, queuedCount: this.taskQueue.length });
      if (this.detachReader) { this.detachReader(); this.detachReader = null; }

      // Reject pending ready-waiters on crash
      if (this.readyWaiters.length > 0) {
        for (const w of this.readyWaiters) {
          try { w.reject(new Error('Persistent process exited — ready wait aborted')); } catch { /* noop */ }
        }
        this.readyWaiters.length = 0;
      }
      this.readyEmitted = false;

      if (this.activeTaskId && this.taskHandlers.size > 0) {
        const crashedId = this.activeTaskId;
        const remaining = this.taskHandlers.size;
        const errorLine = JSON.stringify({ type: 'error', message: 'Process crashed unexpectedly' });
        for (const [, handler] of this.taskHandlers) {
          try { handler(errorLine); } catch { /* swallow */ }
        }
        this.onCrash?.(crashedId, remaining);
      }
      this.proc = null;
      this.activeTaskId = null;
      this.writeBuffer.clear();
    });

    await new Promise<void>((resolve) => {
      this.proc!.once('spawn', () => resolve());
      this.proc!.once('error', () => { this.proc = null; resolve(); });
    });
  }

  private routeLine(line: string): void {
    // Intercept protocol frames before task routing
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && parsed.type === 'ready') {
        this.signalReady();
        return; // swallow — not a task event
      }
    } catch { /* not JSON or not a ready frame — fall through to task routing */ }

    if (!this.activeTaskId) return;
    const handler = this.taskHandlers.get(this.activeTaskId);
    handler?.(line);
  }

  setLineHandler(taskId: string, handler: (line: string) => void): void {
    this.taskHandlers.set(taskId, handler);
    if (!this.activeTaskId && this.taskQueue.length === 0) {
      this.activeTaskId = taskId;
      this.taskQueue.push(taskId);
      this.flushBuffer(taskId);
    } else {
      this.taskQueue.push(taskId);
    }
  }

  removeLineHandler(taskId: string): void {
    this.taskHandlers.delete(taskId);
    this.writeBuffer.delete(taskId);
    this.taskQueue = this.taskQueue.filter(id => id !== taskId);
    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
      this.advanceQueue();
    }
  }

  private advanceQueue(): void {
    if (this.activeTaskId) return;
    while (this.taskQueue.length > 0) {
      const next = this.taskQueue[0];
      if (this.taskHandlers.has(next)) {
        this.activeTaskId = next;
        this.flushBuffer(next);
        return;
      }
      this.taskQueue.shift();
    }
  }

  private flushBuffer(taskId: string): void {
    const chunks = this.writeBuffer.get(taskId);
    if (!chunks || chunks.length === 0) return;
    for (const chunk of chunks) this.write(chunk);
    this.writeBuffer.delete(taskId);
  }

  writeWhenActive(taskId: string, data: string): void {
    if (!this.proc) return;
    if (this.activeTaskId === taskId) {
      this.write(data);
      return;
    }
    let chunks = this.writeBuffer.get(taskId);
    if (!chunks) { chunks = []; this.writeBuffer.set(taskId, chunks); }
    chunks.push(data);
  }

  write(data: string): void {
    if (!this.proc) return;
    this.proc.stdin!.write(data);
  }

  async kill(): Promise<void> {
    if (this.proc) {
      log('info', 'persistent_kill', {});
      if (this.detachReader) { this.detachReader(); this.detachReader = null; }
      this.proc.kill('SIGTERM');
      this.proc = null;
      this.activeTaskId = null;
      this.writeBuffer.clear();
    }
  }

  get isAlive(): boolean { return this.proc !== null && this.proc.exitCode === null; }
  getActiveTaskId(): string | null { return this.activeTaskId; }
}
