# PROTOCOL — A2A Surface + INK-lite

```
Plumb speaks A2A with INK-lite headers.
A2A is the reference protocol. The contract is protocol-independent.
If A2A loses, the adapter contract survives.
If MCP wins, ship protocol/mcp.ts — same adapter contract, new shell.
```

---

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/.well-known/agent-card.json` | No | A2A agent discovery |
| GET | `/healthz` | No | Server alive |
| GET | `/readyz` | No | All agents ready + sub-agent liveness |
| POST | `/a2a/jsonrpc` | Optional | Submit task (JSON-RPC 2.0) |
| POST | `/a2a/rest` | Optional | Submit task (REST) |
| GET | `/tasks/{id}` | Optional | Task status + output |
| GET | `/tasks/{id}/events` | Optional | SSE stream of task events |
| POST | `/tasks/{id}/cancel` | Optional | Cancel running task |
| GET | `/agents` | Optional | Fleet status (operator only) |

Auth: `Authorization: Bearer <key>`. Applies to all `/a2a/*` and `/tasks/*`. Never applies to `/.well-known/*` or `/healthz`.

---

## Agent Card

```json
{
  "name": "plumb",
  "version": "1.0.0",
  "description": "A2A bridge for CLI coding agents",
  "protocolVersion": "0.3.0",
  "capabilities": { "streaming": true },
  "skills": [
    { "id": "code-edit", "name": "Code editing" },
    { "id": "bash-execute", "name": "Command execution" },
    { "id": "file-read", "name": "File reading" },
    { "id": "deep-reasoning", "name": "Deep analysis" },
    { "id": "code-review", "name": "Code review" },
    { "id": "architecture", "name": "Architecture design" },
    { "id": "refactor", "name": "Code refactoring" }
  ],
  "metadata": {
    "agents": [
      { "id": "pi", "port": 3001, "tier": 1, "mode": "persistent" },
      { "id": "claude", "port": 3002, "tier": 1, "mode": "oneshot" },
      { "id": "cursor", "port": 3003, "tier": 1, "mode": "oneshot" }
    ]
  }
}
```

---

## Task lifecycle

```
States (irreversible):
  submitted → running → completed
                      → failed
                      → cancelled
                      → interrupted (server crash detected on restart)
```

### Submit

```json
POST /a2a/jsonrpc
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "parts": [
        { "kind": "text", "text": "Refactor the auth module" }
      ]
    },
    "labels": ["build", "fast"]
  },
  "id": "1"
}
```

Response: `202 Accepted` with task ID.

### Stream (SSE)

```http
GET /tasks/{id}/events
Accept: text/event-stream

event: task-status
data: {"taskId":"47a2c1","status":"running","ts":"2026-05-13T19:00:01Z"}

event: task-output
data: {"taskId":"47a2c1","text":"Reading src/auth.ts...","ts":"2026-05-13T19:00:02Z"}

event: task-status
data: {"taskId":"47a2c1","status":"completed","ts":"2026-05-13T19:00:12Z"}
```

### Poll

```json
GET /tasks/47a2c1

{
  "taskId": "47a2c1",
  "status": "completed",
  "submittedAt": "2026-05-13T19:00:00Z",
  "completedAt": "2026-05-13T19:00:12Z",
  "output": {
    "role": "agent",
    "parts": [{ "kind": "text", "text": "Refactored auth module..." }]
  },
  "metadata": {
    "agentId": "cursor",
    "adapterVersion": "1.0.0",
    "duration": 12
  }
}
```

### Cancel

```json
POST /tasks/47a2c1/cancel

{ "status": "cancelled" }
```

Plumb sends SIGTERM to the subprocess. If it doesn't exit in 5s, SIGKILL. The ledger records `task_cancelled`.

---

## INK-lite headers

Every request can carry these headers. They form the minimum coherence layer between parent and child tasks.

| Header | Format | Required | Purpose |
|--------|--------|----------|---------|
| `X-Plumb-Correlation-Id` | UUIDv7 | No | Idempotency + lineage |
| `X-Plumb-Version` | `"1"` | No | INK envelope version |
| `X-Plumb-Depth` | Integer | No | Nesting depth (0 = root) |
| `X-Plumb-Parent-Id` | UUIDv7 | No | Parent task ID, null for root |
| `X-Plumb-Intent` | String ≤60 | No | Verb-object description |
| `X-Plumb-Budget-Tokens` | Integer | No | Token ceiling |
| `X-Plumb-Budget-Duration-Ms` | Integer | No | Wall-clock ceiling |
| `X-Plumb-Budget-Cost-Usd` | Float | No | Cost ceiling |
| `X-Plumb-Deadline` | ISO 8601 | No | Hard deadline (now+1s ≤ deadline ≤ now+24h) |
| `X-Plumb-Trace-Id` | UUIDv7 | No | Cross-system trace |
| `X-Plumb-Priority` | 0-3 | No | Priority (0=low, 3=critical) |

### Validation rules

| Header | Rule | Error Code |
|--------|------|------------|
| `X-Plumb-Version` | exactly `"1"` | `INK_VERSION` |
| `X-Plumb-Correlation-Id` | UUIDv7, unique within 24h | `INK_DUP_CORRELATION` |
| `X-Plumb-Depth` | ≤ 4 | `INK_RECURSION_LIMIT` |
| `X-Plumb-Deadline` | > now+1s, ≤ now+24h | `INK_DEADLINE_INVALID` |
| `X-Plumb-Budget-*` | positive | `INK_BUDGET_INVALID` |

Duplicate `Correlation-Id` within 24h → return cached result, do NOT re-execute.  
Depth > 4 → reject.  
Deadline less than 1s from now or more than 24h from now → reject.

---

## INK-lite envelope (full)

```typescript
interface InkEnvelope {
  inkVersion: '1';
  correlationId: string;           // UUIDv7
  taskId: string;                  // UUIDv7
  parentId: string | null;
  depth: number;                   // 0 for root
  intent: string;                  // ≤ 60 chars, verb-object
  prompt: string;                  // ≤ 64 KiB
  budget?: {
    tokens?: number;
    durationMs?: number;
    costUsd?: number;
  };
  deadline?: string;               // ISO 8601
  meta?: {
    labels?: Record<string, string>;
    priority?: 0 | 1 | 2 | 3;
    traceId?: string;
  };
}
```

---

## SSE event types

```
task-submitted    → { taskId, agentId, ts }
task-running      → { taskId, agentId, pid, ts }
task-output       → { taskId, text, ts }
task-error        → { taskId, text, ts }
task-completed    → { taskId, duration, ts }
task-failed       → { taskId, errorCode, errorMessage, ts }
task-cancelled    → { taskId, ts }
task-interrupted  → { taskId, ts, previousStatus }
```

Every event has `taskId`, `ts`, and event-specific fields. No redundant nesting. Machine-parseable on first line.

---

## Orphan cascade protocol

When a parent task is cancelled or fails, its children must be notified.

```
Parent task dies → Plumb detects via:
  - Process exit (stdin EOF, child exit code)
  - Circuit breaker trip
  - Cancel request from operator

On detection:
  1. Mark parent as failed/cancelled in ledger
  2. Walk descendants (children of parent task)
  3. For each child: send SIGTERM, wait 5s, then SIGKILL
  4. Mark each as "cancelled (orphan)" in ledger with ancestor reference
  5. Emit pulse: task.orphaned { taskId, ancestorId }
```

No child agent is responsible for detecting parent death. Plumb is the witness.

---

## Crash resume

On every Plumb start, before accepting new tasks:

```
1. Scan today's ledger for tasks in 'running' or 'submitted' state
2. These tasks died when the server crashed
3. Mark each as 'interrupted' with error code TASK_INTERRUPTED
4. Log: N tasks interrupted from previous session
5. New tasks accepted only after resume scan is complete
```

The ledger is the source of truth. Missing `task_completed` IS the signal.

---

## Protocol independence

The adapter contract at `src/types.ts` is protocol-independent. Protocol shells sit on top:

```
┌─────────────────────┐  ┌─────────────────────┐
│   A2A shell         │  │   MCP shell          │
│   protocol/a2a/     │  │   protocol/mcp/      │
│   JSON-RPC + SSE    │  │   tool calls + res   │
│   INK-lite headers  │  │   MCP transport      │
└────────┬────────────┘  └────────┬────────────┘
         │                        │
         └──────────┬─────────────┘
                    ▼
         ┌─────────────────────┐
         │   AdapterContract   │
         │   src/types.ts      │
         │   7 methods         │
         └─────────────────────┘
```

A2A is shipped as the reference protocol because it has the richest feature set (idempotency, streaming, INK-lite, agent cards). But the adapter contract does not depend on it. Implementing `protocol/mcp.ts` requires:
1. Map MCP tool-call → `buildArgs()` + `formatInput()`
2. Map CLI output → MCP tool-result
3. Wire circuit breaker, ledger, and pulse to MCP lifecycle events

Estimated: ~200 lines of TypeScript. The contract is the moat. MCP is just another shell.

---

*The protocol is the surface. The contract is the moat. Keep both stable. Keep both boring.*
