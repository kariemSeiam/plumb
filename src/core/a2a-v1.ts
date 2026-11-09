// PLUMB — A2A v1.0 binding shim
// The SDK speaks v0.3 on the wire. This middleware sits in front of the
// JSON-RPC handler: `A2A-Version: 1.0` requests are translated to v0.3 and the
// replies (JSON and SSE) back to v1.0 ProtoJSON. Empty header = v0.3, untouched.
// Source of truth: a2aproject/A2A specification/a2a.proto (lf.a2a.v1).

import type { NextFunction, Request, Response } from 'express';
import type { PlumbTaskStore } from './task-store.ts';

export const VERSION_NOT_SUPPORTED = -32009;
export const SUPPORTED_VERSIONS = ['0.3', '1.0'] as const;

type Json = Record<string, any>;

const METHODS_V1_TO_V03: Record<string, string> = {
  SendMessage: 'message/send',
  SendStreamingMessage: 'message/stream',
  GetTask: 'tasks/get',
  CancelTask: 'tasks/cancel',
  SubscribeToTask: 'tasks/resubscribe',
  CreateTaskPushNotificationConfig: 'tasks/pushNotificationConfig/set',
  GetTaskPushNotificationConfig: 'tasks/pushNotificationConfig/get',
  ListTaskPushNotificationConfigs: 'tasks/pushNotificationConfig/list',
  DeleteTaskPushNotificationConfig: 'tasks/pushNotificationConfig/delete',
  GetExtendedAgentCard: 'agent/getAuthenticatedExtendedCard',
};

const STATE_TO_V1: Record<string, string> = {
  submitted: 'TASK_STATE_SUBMITTED',
  working: 'TASK_STATE_WORKING',
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  canceled: 'TASK_STATE_CANCELED',
  'input-required': 'TASK_STATE_INPUT_REQUIRED',
  rejected: 'TASK_STATE_REJECTED',
  'auth-required': 'TASK_STATE_AUTH_REQUIRED',
  unknown: 'TASK_STATE_UNSPECIFIED',
};
const STATE_FROM_V1 = Object.fromEntries(Object.entries(STATE_TO_V1).map(([k, v]) => [v, k]));

/** Read the requested protocol version: header, then `A2A-Version` query param. Empty = 0.3. */
export function requestedVersion(req: Request): string {
  const header = req.header('A2A-Version');
  const q = req.query?.['A2A-Version'];
  const raw = (header ?? (typeof q === 'string' ? q : '')).trim();
  return raw === '' ? '0.3' : raw;
}

// ── Parts ──────────────────────────────────────────────────────────────
function partToV1(p: Json): Json {
  const out: Json = {};
  if (p.metadata) out.metadata = p.metadata;
  if (p.kind === 'file' && p.file) {
    if (p.file.bytes !== undefined) out.raw = p.file.bytes;
    if (p.file.uri !== undefined) out.url = p.file.uri;
    if (p.file.name) out.filename = p.file.name;
    if (p.file.mimeType) out.mediaType = p.file.mimeType;
  } else if (p.kind === 'data') {
    out.data = p.data;
  } else {
    out.text = p.text ?? '';
  }
  return out;
}

function partFromV1(p: Json): Json {
  const out: Json = {};
  if (p.metadata) out.metadata = p.metadata;
  if (p.raw !== undefined || p.url !== undefined) {
    const file: Json = p.raw !== undefined ? { bytes: p.raw } : { uri: p.url };
    if (p.filename) file.name = p.filename;
    if (p.mediaType) file.mimeType = p.mediaType;
    return { ...out, kind: 'file', file };
  }
  if (p.data !== undefined) return { ...out, kind: 'data', data: p.data };
  return { ...out, kind: 'text', text: p.text ?? '' };
}

// ── Objects: v0.3 → v1 ────────────────────────────────────────────────
function messageToV1(m: Json): Json {
  const { kind: _k, role, parts, ...rest } = m;
  return {
    ...rest,
    role: role === 'agent' ? 'ROLE_AGENT' : 'ROLE_USER',
    parts: (parts ?? []).map(partToV1),
  };
}

function statusToV1(s: Json): Json {
  const out: Json = { ...s, state: STATE_TO_V1[s.state] ?? 'TASK_STATE_UNSPECIFIED' };
  if (s.message) out.message = messageToV1(s.message);
  return out;
}

function artifactToV1(a: Json): Json {
  return { ...a, parts: (a.parts ?? []).map(partToV1) };
}

export function taskToV1(t: Json): Json {
  const { kind: _k, ...rest } = t;
  const out: Json = { ...rest, status: statusToV1(t.status) };
  if (t.artifacts) out.artifacts = t.artifacts.map(artifactToV1);
  if (t.history) out.history = t.history.map(messageToV1);
  return out;
}

/** v0.3 event/result object → v1 StreamResponse / SendMessageResponse wrapper. */
function wrapperToV1(r: Json): Json {
  switch (r.kind) {
    case 'task': return { task: taskToV1(r) };
    case 'message': return { message: messageToV1(r) };
    case 'status-update': {
      const { kind: _k, final: _f, status, ...rest } = r;
      return { statusUpdate: { ...rest, status: statusToV1(status) } };
    }
    case 'artifact-update': {
      const { kind: _k, artifact, ...rest } = r;
      return { artifactUpdate: { ...rest, artifact: artifactToV1(artifact) } };
    }
    default: return r;
  }
}

function pushConfigToV1(r: Json): Json {
  return { taskId: r.taskId, ...(r.pushNotificationConfig ?? {}) };
}

/** Translate one v0.3 JSON-RPC response to v1, given the (v1) method that was called. */
export function responseToV1(method: string, body: Json): Json {
  if (!body || body.error || body.result === undefined) return body;
  const r = body.result;
  let result: unknown = r;
  switch (method) {
    case 'SendMessage':
    case 'SendStreamingMessage':
    case 'SubscribeToTask':
      result = wrapperToV1(r);
      break;
    case 'GetTask':
    case 'CancelTask':
      result = taskToV1(r);
      break;
    case 'CreateTaskPushNotificationConfig':
    case 'GetTaskPushNotificationConfig':
      result = pushConfigToV1(r);
      break;
    case 'ListTaskPushNotificationConfigs':
      result = { configs: (r as Json[]).map(pushConfigToV1), nextPageToken: '' };
      break;
    case 'DeleteTaskPushNotificationConfig':
      result = {};
      break;
  }
  return { ...body, result };
}

// ── Requests: v1 → v0.3 ───────────────────────────────────────────────
function messageFromV1(m: Json): Json {
  return {
    ...m,
    kind: 'message',
    role: m.role === 'ROLE_AGENT' ? 'agent' : 'user',
    parts: (m.parts ?? []).map(partFromV1),
  };
}

/** Translate v1 params to the v0.3 shape the SDK understands. */
export function paramsFromV1(method: string, p: Json = {}): Json {
  switch (method) {
    case 'SendMessage':
    case 'SendStreamingMessage': {
      const c = p.configuration ?? {};
      const configuration: Json = { blocking: !c.returnImmediately };
      if (c.acceptedOutputModes) configuration.acceptedOutputModes = c.acceptedOutputModes;
      if (c.historyLength !== undefined) configuration.historyLength = c.historyLength;
      if (c.taskPushNotificationConfig) {
        const { taskId: _id, tenant: _t, ...cfg } = c.taskPushNotificationConfig;
        configuration.pushNotificationConfig = cfg;
      }
      return { message: messageFromV1(p.message ?? {}), configuration, metadata: p.metadata };
    }
    case 'GetTask':
      // v1: unset = no limit. The v0.3 SDK treats unset as "no history".
      return { id: p.id, historyLength: p.historyLength ?? Number.MAX_SAFE_INTEGER };
    case 'CreateTaskPushNotificationConfig': {
      const { taskId, tenant: _t, ...cfg } = p;
      return { taskId, pushNotificationConfig: cfg };
    }
    case 'GetTaskPushNotificationConfig':
    case 'DeleteTaskPushNotificationConfig':
      return { id: p.taskId, pushNotificationConfigId: p.id };
    case 'ListTaskPushNotificationConfigs':
      return { id: p.taskId };
    default:
      return p; // CancelTask / SubscribeToTask: { id }
  }
}

// ── ListTasks (not in the v0.3 SDK; served from the task store) ───────
const encodeToken = (ts: string, id: string) => Buffer.from(`${ts}\n${id}`).toString('base64url');
function decodeToken(tok: string): [string, string] | null {
  const [ts, id] = Buffer.from(tok, 'base64url').toString().split('\n');
  return ts !== undefined && id !== undefined ? [ts, id] : null;
}

class InvalidParams extends Error {}

export function listTasks(store: PlumbTaskStore, p: Json = {}): Json {
  const pageSize = p.pageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new InvalidParams('pageSize must be an integer between 1 and 100');
  }
  let cursor: [string, string] | null = null;
  if (p.pageToken) {
    cursor = decodeToken(String(p.pageToken));
    if (!cursor) throw new InvalidParams('invalid pageToken');
  }
  let after = 0;
  if (p.statusTimestampAfter) {
    after = Date.parse(p.statusTimestampAfter);
    if (Number.isNaN(after)) throw new InvalidParams('invalid statusTimestampAfter');
  }
  const unfiltered = !p.status || p.status === 'TASK_STATE_UNSPECIFIED';
  const wantState = unfiltered ? undefined : STATE_FROM_V1[p.status];
  if (!unfiltered && !wantState) throw new InvalidParams(`unknown status ${p.status}`);

  const ts = (t: Json): string => t.status?.timestamp ?? '';
  // Newest first; id breaks ties so the cursor is a total order.
  const matching = (store.list() as Json[])
    .filter(t => !p.contextId || t.contextId === p.contextId)
    .filter(t => !wantState || t.status.state === wantState)
    .filter(t => !after || (ts(t) !== '' && Date.parse(ts(t)) >= after))
    .sort((a, b) => (ts(a) !== ts(b) ? (ts(a) < ts(b) ? 1 : -1) : a.id < b.id ? 1 : -1));

  const start = cursor
    ? matching.findIndex(t => ts(t) < cursor![0] || (ts(t) === cursor![0] && t.id < cursor![1]))
    : 0;
  const rest = start < 0 ? [] : matching.slice(start);
  const page = rest.slice(0, pageSize);
  const last = page[page.length - 1];

  return {
    tasks: page.map(t => {
      const out = taskToV1(t);
      if (!p.includeArtifacts) delete out.artifacts;
      if (p.historyLength !== undefined && out.history) {
        out.history = p.historyLength === 0 ? [] : out.history.slice(-p.historyLength);
      }
      return out;
    }),
    nextPageToken: rest.length > pageSize && last ? encodeToken(ts(last), last.id) : '',
    pageSize,
    totalSize: matching.length,
  };
}

// ── Middleware ────────────────────────────────────────────────────────
function rpcError(res: Response, id: unknown, code: number, message: string, status = 200) {
  res.status(status).json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

export function a2aVersionMiddleware(taskStore: PlumbTaskStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') return next();
    const version = requestedVersion(req);
    if (!(SUPPORTED_VERSIONS as readonly string[]).includes(version)) {
      return rpcError(
        res, req.body?.id, VERSION_NOT_SUPPORTED,
        `A2A-Version ${version} is not supported (supported: ${SUPPORTED_VERSIONS.join(', ')})`, 400,
      );
    }
    res.setHeader('A2A-Version', version);
    if (version === '0.3') return next();

    const body = req.body as Json | undefined;
    const v1Method: unknown = body?.method;
    if (!body || typeof v1Method !== 'string') return next(); // let the SDK report the malformed request

    if (v1Method === 'ListTasks') {
      try {
        return void res.json({ jsonrpc: '2.0', id: body.id ?? null, result: listTasks(taskStore, body.params) });
      } catch (e) {
        if (e instanceof InvalidParams) return rpcError(res, body.id, -32602, e.message);
        throw e;
      }
    }
    const mapped = METHODS_V1_TO_V03[v1Method];
    if (!mapped) return rpcError(res, body.id, -32601, `Method not found: ${v1Method}`);

    req.body = { ...body, method: mapped, params: paramsFromV1(v1Method, body.params) };

    const json = res.json.bind(res);
    res.json = ((b: Json) => json(responseToV1(v1Method, b))) as typeof res.json;
    const write = res.write.bind(res) as (chunk: any, ...rest: any[]) => boolean;
    (res as any).write = (chunk: any, ...rest: any[]) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      const out = text.replace(/^data: (.*)$/gm, (_m, payload: string) => {
        try { return `data: ${JSON.stringify(responseToV1(v1Method, JSON.parse(payload)))}`; }
        catch { return `data: ${payload}`; }
      });
      return write(out, ...rest);
    };
    next();
  };
}
