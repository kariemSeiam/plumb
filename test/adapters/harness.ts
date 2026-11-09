// Shared harness: a fake CLI binary behind a real `plumb wrap` server.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Fake {
  dir: string;
  bin: string;
  server: ChildProcess;
  url: string;
  stop(): void;
}

export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

/** Write `<tmp>/<name>` as an executable sh script and wrap it on `port`. */
export async function startFake(name: string, script: string, port: number): Promise<Fake> {
  const dir = mkdtempSync(join(tmpdir(), `plumb-${name}-`));
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  const server = spawn('bun', ['run', 'src/main.ts', 'wrap', bin, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = `http://localhost:${port}`;
  const start = Date.now();
  for (;;) {
    try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* not up yet */ }
    if (Date.now() - start > 10000) { server.kill('SIGKILL'); throw new Error('server timeout'); }
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    dir, bin, server, url,
    stop() { server.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); },
  };
}

export function rpc(url: string, method: string, params: unknown): Promise<Response> {
  return fetch(`${url}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

export function userMessage(text: string) {
  return { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text }] } };
}

/** message/send; returns the raw JSON response as a string for substring checks. */
export async function send(url: string, text: string): Promise<string> {
  const res = await rpc(url, 'message/send', userMessage(text));
  return JSON.stringify(await res.json());
}

/** Start message/stream, return the SSE reader and the task id once it appears. */
export async function openStream(url: string, text: string) {
  const res = await rpc(url, 'message/stream', userMessage(text));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let seen = '';
  let taskId: string | undefined;
  while (!taskId) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += dec.decode(value);
    taskId = seen.match(/"taskId":"([^"]+)"/)?.[1];
  }
  return { reader, taskId, seen: () => seen };
}

export { existsSync, readFileSync, join };
