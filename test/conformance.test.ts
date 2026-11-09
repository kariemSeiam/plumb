// PLUMB — Conformance Test Suite
// Phase 0 gates as automated tests. Run with `bun test`.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';

const PORT = 9100;
const BASE_URL = `http://localhost:${PORT}`;
let server: ChildProcess;

function waitForServer(url: string, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeout) return reject(new Error('Server timeout'));
      setTimeout(check, 100);
    };
    check();
  });
}

describe('Phase 0 Conformance', () => {
  beforeAll(async () => {
    // Clean ledger
    const ledgerPath = '.plumb/ledger';
    if (existsSync(ledgerPath)) {
      rmSync(ledgerPath, { recursive: true });
    }

    // Start server
    server = spawn('bun', ['run', 'src/main.ts', 'wrap', 'cat', '--port', String(PORT)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await waitForServer(`${BASE_URL}/health`);
  }, 20_000);

  afterAll(() => {
    if (server) {
      server.kill('SIGTERM');
    }
  });

  it('Gate 2: Server starts and responds to health check', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { status: string; adapter: string };
    expect(data.status).toBe('ok');
    expect(data.adapter).toBe('echo');
  });

  it('Gate 3: Agent Card is valid', async () => {
    const res = await fetch(`${BASE_URL}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as {
      name: string;
      url: string;
      capabilities: { streaming: boolean };
    };
    expect(card.name).toBeDefined();
    expect(card.url).toBe(BASE_URL);
    expect(card.capabilities).toBeDefined();
    expect(card.capabilities.streaming).toBe(true);
  });

  it('Gate 4: Task accepted via JSON-RPC', async () => {
    const res = await fetch(`${BASE_URL}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-msg-001',
            role: 'user',
            parts: [{ kind: 'text', text: 'hello plumb' }],
          },
        },
        id: 'test-1',
      }),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      error?: unknown;
      result?: { kind: string };
    };
    expect(data.error).toBeUndefined();
    expect(data.result).toBeDefined();
    expect(data.result!.kind).toBe('message');
  });

  it('Gate 5: Echo adapter returns input text', async () => {
    const testMessage = 'conformance test input';
    const res = await fetch(`${BASE_URL}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            messageId: 'test-msg-002',
            role: 'user',
            parts: [{ kind: 'text', text: testMessage }],
          },
        },
        id: 'test-2',
      }),
    });

    const data = (await res.json()) as {
      result?: { parts?: Array<{ text?: string }> };
    };
    const resultText = data.result?.parts?.[0]?.text ?? '';
    expect(resultText.trim()).toBe(testMessage);
  });

  it('Gate 6: Ledger contains lifecycle events', async () => {
    // Give ledger time to flush
    await new Promise(r => setTimeout(r, 500));

    const today = new Date().toISOString().slice(0, 10);
    const ledgerPath = `.plumb/ledger/${today}.jsonl`;

    expect(existsSync(ledgerPath)).toBe(true);

    const content = readFileSync(ledgerPath, 'utf-8');
    const lines = content.trim().split('\n').map(l => JSON.parse(l));
    const types = lines.map(e => e.type);

    expect(types).toContain('task_submitted');
    expect(types).toContain('task_running');
    expect(types).toContain('task_completed');
  });
});
