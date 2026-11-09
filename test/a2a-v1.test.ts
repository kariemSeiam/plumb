// PLUMB — A2A v1.0 conformance tests
// In-process server (echo adapter). Seeds the task store for list/push tests.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import express from 'express';
import type { Server } from 'node:http';
import type { Task } from '@a2a-js/sdk';
import { createPlumbServer } from '../src/core/server.ts';
import { EchoAdapter } from '../src/adapters/echo.ts';

const PORT = 9141;
const BASE = `http://localhost:${PORT}`;
let http: Server;
let store: ReturnType<typeof createPlumbServer>['taskStore'];

async function rpc(method: string, params: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/a2a/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { res, body: (await res.json()) as any };
}
const V1 = { 'A2A-Version': '1.0' };

function task(id: string, state: Task['status']['state'], ctx: string, ts: string): Task {
  return {
    kind: 'task', id, contextId: ctx,
    status: { state, timestamp: ts },
    artifacts: [{ artifactId: `a-${id}`, parts: [{ kind: 'text', text: 'out' }] }],
    history: [{ kind: 'message', messageId: `m-${id}`, role: 'user', parts: [{ kind: 'text', text: 'in' }] }],
  };
}

beforeAll(async () => {
  const s = createPlumbServer({ adapter: new EchoAdapter(), cli: 'cat', port: PORT, name: 'a2a-v1-test' });
  store = s.taskStore;
  const app = express();
  s.setupApp(app);
  http = app.listen(PORT);
  for (let i = 0; i < 5; i++) {
    await store.save(task(`t${i}`, i % 2 ? 'completed' : 'working', i < 3 ? 'ctx-a' : 'ctx-b', `2026-01-01T00:00:0${i}Z`));
  }
});

afterAll(() => {
  http?.close();
});

describe('Agent Card (v1.0 discovery)', () => {
  it('is served at /.well-known/agent-card.json with supportedInterfaces and v0.3 fields', async () => {
    const card = (await (await fetch(`${BASE}/.well-known/agent-card.json`)).json()) as any;
    expect(card.supportedInterfaces[0]).toMatchObject({ protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(card.supportedInterfaces.map((i: any) => i.protocolVersion)).toContain('0.3');
    expect(card.supportedInterfaces[0].url).toEndWith('/a2a/jsonrpc');
    expect(card.capabilities.pushNotifications).toBe(true);
    expect(card.protocolVersion).toBe('0.3.0'); // v0.3 clients keep working
    expect(card.url).toBeDefined();
  });
});

describe('A2A-Version negotiation', () => {
  it('empty header is v0.3: legacy method names and shapes', async () => {
    const { res, body } = await rpc('message/send', {
      message: { kind: 'message', messageId: 'x1', role: 'user', parts: [{ kind: 'text', text: 'hi' }] },
    });
    expect(res.headers.get('a2a-version')).toBe('0.3');
    expect(body.result.kind).toBe('message');
  });

  it('unsupported version → VersionNotSupportedError -32009', async () => {
    const { res, body } = await rpc('GetTask', { id: 't0' }, { 'A2A-Version': '9.9' });
    expect(res.status).toBe(400);
    expect(body.error.code).toBe(-32009);
  });

  it('accepts the version as a query parameter', async () => {
    const res = await fetch(`${BASE}/a2a/jsonrpc?A2A-Version=1.0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetTask', params: { id: 't0' } }),
    });
    expect(((await res.json()) as any).result.status.state).toBe('TASK_STATE_WORKING');
  });

  it('v1.0 SendMessage: PascalCase method, ProtoJSON in and out', async () => {
    const { body } = await rpc('SendMessage', {
      message: { messageId: 'x2', role: 'ROLE_USER', parts: [{ text: 'hello v1' }] },
    }, V1);
    expect(body.error).toBeUndefined();
    expect(body.result.message.role).toBe('ROLE_AGENT');
    expect(body.result.message.parts[0].text.trim()).toBe('hello v1');
    expect(body.result.message.kind).toBeUndefined();
    expect(body.result.message.parts[0].kind).toBeUndefined();
  });

  it('v1.0 SendStreamingMessage: SSE events use StreamResponse wrappers', async () => {
    const res = await fetch(`${BASE}/a2a/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...V1 },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 7, method: 'SendStreamingMessage',
        params: { message: { messageId: 'x3', role: 'ROLE_USER', parts: [{ text: 'stream me' }] } },
      }),
    });
    const text = await res.text();
    const events = text.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const keys = Object.keys(e.result);
      expect(keys.length).toBe(1);
      expect(['task', 'message', 'statusUpdate', 'artifactUpdate']).toContain(keys[0]);
    }
    expect(text).not.toContain('"kind"');
  });

  it('v1.0 unknown method → -32601', async () => {
    const { body } = await rpc('message/send', {}, V1);
    expect(body.error.code).toBe(-32601);
  });
});

describe('GetTask / ListTasks (v1.0)', () => {
  beforeAll(async () => {
    // Earlier tests created real tasks; keep only the seeded ones.
    for (const t of store.list()) if (!/^t\d$/.test(t.id)) await store.delete(t.id);
  });

  it('GetTask returns a ProtoJSON task', async () => {
    const { body } = await rpc('GetTask', { id: 't1' }, V1);
    expect(body.result.status.state).toBe('TASK_STATE_COMPLETED');
    expect(body.result.history[0].role).toBe('ROLE_USER');
    expect(body.result.kind).toBeUndefined();
  });

  it('lists newest first with totalSize, no artifacts by default', async () => {
    const { body } = await rpc('ListTasks', {}, V1);
    expect(body.result.tasks.map((t: any) => t.id)).toEqual(['t4', 't3', 't2', 't1', 't0']);
    expect(body.result.totalSize).toBe(5);
    expect(body.result.pageSize).toBe(50);
    expect(body.result.nextPageToken).toBe('');
    expect(body.result.tasks[0].artifacts).toBeUndefined();
  });

  it('paginates with pageToken until exhausted', async () => {
    const seen: string[] = [];
    let token = '';
    for (let i = 0; i < 5; i++) {
      const { body } = await rpc('ListTasks', { pageSize: 2, pageToken: token, includeArtifacts: true }, V1);
      seen.push(...body.result.tasks.map((t: any) => t.id));
      expect(body.result.totalSize).toBe(5);
      token = body.result.nextPageToken;
      if (!token) break;
    }
    expect(seen).toEqual(['t4', 't3', 't2', 't1', 't0']);
  });

  it('filters by contextId, status and statusTimestampAfter', async () => {
    const ctx = await rpc('ListTasks', { contextId: 'ctx-b' }, V1);
    expect(ctx.body.result.tasks.map((t: any) => t.id)).toEqual(['t4', 't3']);
    const st = await rpc('ListTasks', { status: 'TASK_STATE_COMPLETED' }, V1);
    expect(st.body.result.tasks.map((t: any) => t.id)).toEqual(['t3', 't1']);
    const ts = await rpc('ListTasks', { statusTimestampAfter: '2026-01-01T00:00:03Z' }, V1);
    expect(ts.body.result.tasks.map((t: any) => t.id)).toEqual(['t4', 't3']);
  });

  it('rejects bad pageSize, pageToken and status with -32602', async () => {
    for (const p of [{ pageSize: 0 }, { pageSize: 101 }, { pageToken: '!!' }, { status: 'NOPE' }]) {
      const { body } = await rpc('ListTasks', p, V1);
      expect(body.error.code).toBe(-32602);
    }
  });

  it('historyLength 0 drops history', async () => {
    const { body } = await rpc('ListTasks', { historyLength: 0, pageSize: 1 }, V1);
    expect(body.result.tasks[0].history).toEqual([]);
  });
});

describe('Push notification config CRUD (v1.0)', () => {
  it('create → get → list → delete', async () => {
    const created = await rpc('CreateTaskPushNotificationConfig', {
      taskId: 't0', id: 'cfg1', url: 'http://127.0.0.1:1/hook', token: 'tok',
    }, V1);
    expect(created.body.error).toBeUndefined();
    expect(created.body.result).toMatchObject({ taskId: 't0', id: 'cfg1', url: 'http://127.0.0.1:1/hook' });

    const got = await rpc('GetTaskPushNotificationConfig', { taskId: 't0', id: 'cfg1' }, V1);
    expect(got.body.result).toMatchObject({ taskId: 't0', id: 'cfg1', token: 'tok' });

    const list = await rpc('ListTaskPushNotificationConfigs', { taskId: 't0' }, V1);
    expect(list.body.result.configs.map((c: any) => c.id)).toEqual(['cfg1']);
    expect(list.body.result.nextPageToken).toBe('');

    const del = await rpc('DeleteTaskPushNotificationConfig', { taskId: 't0', id: 'cfg1' }, V1);
    expect(del.body.error).toBeUndefined();
    const after = await rpc('ListTaskPushNotificationConfigs', { taskId: 't0' }, V1);
    expect(after.body.result.configs).toEqual([]);
  });

  it('unknown task → TaskNotFound -32001', async () => {
    const { body } = await rpc('CreateTaskPushNotificationConfig', { taskId: 'nope', url: 'http://127.0.0.1:1/x' }, V1);
    expect(body.error.code).toBe(-32001);
  });

  it('v0.3 method names still work', async () => {
    const set = await rpc('tasks/pushNotificationConfig/set', {
      taskId: 't2', pushNotificationConfig: { id: 'legacy', url: 'http://127.0.0.1:1/h' },
    });
    expect(set.body.error).toBeUndefined();
    const list = await rpc('tasks/pushNotificationConfig/list', { id: 't2' });
    expect(list.body.result.map((c: any) => c.pushNotificationConfig.id)).toContain('legacy');
  });
});
