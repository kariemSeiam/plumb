// PLUMB — INK Metadata Conformance Tests
// Verifies INK metadata extraction, enforcement, and ledger propagation.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';

const PORT = 9110;
const BASE_URL = `http://localhost:${PORT}`;
const LEDGER_DIR = '.plumb/ledger';
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

function sendTask(metadata: Record<string, unknown>, text = 'hello plumb'): Promise<Response> {
  return fetch(`${BASE_URL}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: `test-${Date.now()}`,
          role: 'user',
          parts: [{ kind: 'text', text }],
          metadata,
        },
      },
      id: `req-${Date.now()}`,
    }),
  });
}

/** Read ledger entries filtered by optional correlationId. */
function readLedger(correlationId?: string): Record<string, unknown>[] {
  const today = new Date().toISOString().slice(0, 10);
  const ledgerPath = `${LEDGER_DIR}/${today}.jsonl`;
  if (!existsSync(ledgerPath)) return [];
  const lines = readFileSync(ledgerPath, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.map(l => JSON.parse(l)).filter(e =>
    !correlationId || (e.ink as Record<string, unknown> | undefined)?.correlationId === correlationId
  );
}

describe('INK Metadata', () => {
  beforeAll(async () => {
    if (existsSync(LEDGER_DIR)) rmSync(LEDGER_DIR, { recursive: true });

    server = spawn('bun', ['run', 'src/main.ts', 'wrap', 'cat', '--port', String(PORT)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await waitForServer(`${BASE_URL}/health`);
  }, 20_000);

  afterAll(() => {
    if (server) server.kill('SIGTERM');
  });

  it('propagates correlationId to ledger', async () => {
    const correlationId = 'corr-test-001';
    const res = await sendTask({ correlationId });
    expect(res.ok).toBe(true);

    await new Promise(r => setTimeout(r, 300));
    const entries = readLedger(correlationId);
    expect(entries.length).toBeGreaterThan(0);

    const submitted = entries.find(e => e.type === 'task_submitted') as Record<string, unknown>;
    expect(submitted).toBeDefined();
    const ink = submitted.ink as Record<string, unknown>;
    expect(ink.correlationId).toBe(correlationId);
    // senderUnixMs should be auto-stamped with arrival time
    expect(typeof ink.senderUnixMs).toBe('number');
    expect(ink.senderUnixMs as number).toBeGreaterThan(0);
  });

  it('enforces deadlineUnixMs — rejects expired deadline at admission', async () => {
    const deadlineUnixMs = Date.now() - 1000; // 1 second ago — expired
    const res = await sendTask({ deadlineUnixMs });
    expect(res.ok).toBe(true);
    const data = await res.json() as { error?: { message?: string } };
    // Task was rejected before spawning — SDK wraps as internal error
    expect(data.error).toBeDefined();
  });

  it('enforces depth — rejects depth >= maxDepth (4)', async () => {
    const res = await sendTask({ depth: 4 });
    expect(res.ok).toBe(true);
    const data = await res.json() as { error?: { message?: string } };
    expect(data.error).toBeDefined();
  });

  it('rejects inter-Plumb traffic without senderUnixMs (depth > 0)', async () => {
    const res = await sendTask({ depth: 2 }); // no senderUnixMs
    expect(res.ok).toBe(true);
    const data = await res.json() as { error?: { message?: string } };
    expect(data.error).toBeDefined();
  });

  it('accepts depth 0 without senderUnixMs (top-of-mesh)', async () => {
    const correlationId = 'corr-depth0-no-sender';
    const res = await sendTask({ depth: 0, correlationId }); // no senderUnixMs, fine at depth 0
    expect(res.ok).toBe(true);

    await new Promise(r => setTimeout(r, 300));
    const entries = readLedger(correlationId);
    const submitted = entries.find(e => e.type === 'task_submitted') as Record<string, unknown> | undefined;
    expect(submitted).toBeDefined();
    const ink = submitted!.ink as Record<string, unknown>;
    expect(ink.depth).toBe(1); // incremented from 0 to 1
  });

  it('rejects negative depth', async () => {
    const res = await sendTask({ depth: -1 });
    expect(res.ok).toBe(true);
    const data = await res.json() as { error?: { message?: string } };
    expect(data.error).toBeDefined();
  });

  it('allows depth 0-3 and increments', async () => {
    const correlationId = 'corr-depth-inc-v3';
    const res = await sendTask({ depth: 2, correlationId, senderUnixMs: Date.now() });
    expect(res.ok).toBe(true);

    await new Promise(r => setTimeout(r, 300));
    const entries = readLedger(correlationId);
    const submitted = entries.find(e => e.type === 'task_submitted') as Record<string, unknown> | undefined;
    expect(submitted).toBeDefined();
    const ink = submitted!.ink as Record<string, unknown>;
    // Depth should be incremented from 2 to 3
    expect(ink.depth).toBe(3);
  });

  it('enforces budgetMs — subtracts real elapsed time', async () => {
    // Set budget so tight that real elapsed (>1ms) exhausts it
    const senderUnixMs = Date.now() - 10; // pretend the sender started 10ms ago
    const budgetMs = 200; // generous budget that should still leave room
    
    // Test with a budget already mostly consumed by elapsed time
    const res = await sendTask({ budgetMs: 5, senderUnixMs: Date.now() - 100 });
    expect(res.ok).toBe(true);
    const data = await res.json() as { error?: { message?: string } };
    expect(data.error).toBeDefined();
  });

  it('propagates priority, traceparent, tracestate through ledger', async () => {
    const correlationId = 'corr-w3c-v2';
    const metadata = {
      correlationId,
      priority: 'critical',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'rojo=00f067aa0ba902b7',
    };
    const res = await sendTask(metadata);
    expect(res.ok).toBe(true);

    await new Promise(r => setTimeout(r, 300));
    const entries = readLedger(correlationId);
    const submitted = entries.find(e => e.type === 'task_submitted') as Record<string, unknown> | undefined;
    expect(submitted).toBeDefined();
    const ink = submitted!.ink as Record<string, unknown>;
    expect(ink.priority).toBe('critical');
    expect(ink.traceparent).toBe(metadata.traceparent);
    expect(ink.tracestate).toBe(metadata.tracestate);
  });

  it('strips malformed traceparent instead of rejecting', async () => {
    const res = await sendTask({ traceparent: 'not-a-valid-traceparent' }, 'malformed tp');
    expect(res.ok).toBe(true);

    // Task should succeed normally since malformed traceparent is stripped, not rejected
    const data = await res.json() as { result?: { parts?: Array<{ text?: string }> } };
    expect(data.result).toBeDefined();
  });

  it('omits ink from ledger when no metadata provided', async () => {
    const res = await sendTask({}, 'plain text no metadata');
    expect(res.ok).toBe(true);

    await new Promise(r => setTimeout(r, 300));
    const allEntries = readLedger();
    const submittedEntries = allEntries.filter(e => e.type === 'task_submitted');
    // At least one submitted entry should exist without ink
    const noInkEntries = submittedEntries.filter(e => !e.ink || Object.keys(e.ink as Record<string, unknown>).length === 0);
    expect(noInkEntries.length).toBeGreaterThan(0);
  });
});
