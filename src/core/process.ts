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
