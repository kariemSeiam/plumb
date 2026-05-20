# PLUMB ARCHITECTURE

The bridge in one line:

```
Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → parseLine → A2A events + ledger
```

Plumb is not an agent. It has no LLM, no session memory, no orchestration. It spawns processes, parses stdout, maps events, writes JSONL. Everything else is out of scope.

---

## The Pipeline

```
[A2A client]
     │  POST /a2a/jsonrpc  message/send
     ▼
[PlumbServer]         ← Express + @a2a-js/sdk
     │  auth check (Bearer if apiKey set)
     │  extract text from A2A message parts
     ▼
[PlumbExecutor]       ← src/core/executor.ts
     │  ledger: task_submitted
     │  spawn or reuse persistent process
     │  ledger: task_running
     ▼
[Process]             ← src/core/process.ts
     │  write formatInput(task) to stdin
     │  read stdout line by line (LF-split, not Node readline)
     ▼
[AgentAdapter.parseLine]   ← src/adapters/<name>.ts
     │  raw stdout line → AdapterEvent[]
     │  [FangPostParse hook — if configured]
     ▼
[handleEvents]        ← PlumbExecutor private
     │  text-delta  → ledger: progress + bus: artifact-update
     │  tool-call   → ledger: progress + bus: artifact-update
     │  tool-result → ledger: progress + bus: artifact-update
     │  status: completed → ledger: task_completed + bus: message + bus.finished()
     │  error       → ledger: task_failed  + bus: status(failed) + bus.finished()
     ▼
[A2A SSE stream]      ← back to orchestrator
```

---

## Layer Responsibilities

| Layer | File(s) | Owns | Forbidden |
|-------|---------|------|-----------|
| CLI | `src/cli.ts` | `plumb wrap`, fleet commands | Business logic |
| Config | `src/config.ts` | plumb.yaml parse, FleetConfig, validation | Runtime decisions |
| Server | `src/core/server.ts` | Express routes, Agent Card, auth, task store | Process management |
| Executor | `src/core/executor.ts` | Task dispatch, event routing, ledger writes | Parsing CLI output |
| Adapters | `src/adapters/` | Protocol-specific parseLine, buildArgs, formatInput | State outside adapter |
| Process | `src/core/process.ts` | Subprocess lifecycle, stdin/stdout, kill | Interpreting output |
| Ledger | `src/core/ledger.ts` | Append JSONL, daily rotation | Reading back |
| Task Store | `src/core/task-store.ts` | LRU + TTL bounded task memory | Persistent storage |
| Session Store | `src/core/session-store.ts` | Cursor multi-turn tracking, cold recap | Other adapters |

---

## Process Modes

### Oneshot

New subprocess per task. State-free between tasks.

```
task arrives
  → ProcessManager.spawn(cmd, args)
  → write formatInput to stdin, close stdin
  → read stdout → parseLine → events → handleEvents
  → process exits (code 0 or N)
  → settled by exit code if not already settled by status event
```

Default timeout: 300s. Configurable per agent in plumb.yaml.
On timeout: SIGTERM → 5s → SIGKILL.

### Persistent

One long-lived subprocess. Tasks queue and execute serially.

```
first task
  → PersistentProcess.ensure() — spawns if not alive
  → waitUntilReady(30s) — waits for {"type":"ready"} stdout frame
  → setLineHandler(taskId) — routes subsequent lines to this task
  → write formatInput to stdin

subsequent tasks
  → queue behind active task
  → writeWhenActive — buffered until this task is active

crash
  → all taskHandlers receive {"type":"error","message":"Process crashed"}
  → process = null, re-spawned on next task
```

---

## Adapter Contract

Four methods. See `src/types.ts` for authoritative types. See `docs/ADAPTERS.md` for full guide.

```typescript
buildArgs(task, config) → string[]   // CLI flags
formatInput(task)       → string     // stdin content
parseLine(line)         → AdapterEvent[]  // stdout → events
detect()                → DetectionResult | null  // is binary installed?
```

---

## Event Flow

All event handling runs through one method: `PlumbExecutor.handleEvents`. Source: `src/core/executor.ts:68`.

The FangPostParse hook (if set) transforms `AdapterEvent[]` after `parseLine` and before `handleEvents`. This is the only shipped extension point. Type: `(events, ctx) => AdapterEvent[]`.

---

## Fang Extension Points

Five fang classes are specified in `docs/PLUMB-INFINITY.md`. One is shipped:

| Fang | Status | What it does |
|------|--------|-------------|
| **Post-Parse** | ✅ Shipped (`FangPostParse`) | Transforms events after parseLine, before handleEvents |
| Ingress | ❌ Planned | Normalize raw lines before parseLine |
| Pre-Parse | ❌ Planned | Strip vendor noise, classify frame type |
| Ledger Observer | ❌ Planned | React to every LedgerEvent (WAL, metrics, stall detection) |
| Recovery | ❌ Planned | Snapshot offsets, replay on restart |

---

## Ledger

Every task lifecycle event appended to `.plumb/ledger/YYYY-MM-DD.jsonl`.

- Append-only. Never modified. Never deleted by Plumb.
- Daily rotation: new file per UTC day.
- Write failure: logged to stderr, non-fatal. Task execution continues.
- Crash-survivable: file is written before the A2A bus event.

Full schema and query examples: `docs/LEDGER.md`.

---

## Protocol Surface

| Method | Path | Auth |
|--------|------|------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/.well-known/agent.json` | public (redirects to agent-card) |
| GET | `/health` | public |
| POST | `/a2a/jsonrpc` | Bearer (if apiKey configured) |
| * | `/a2a/rest` | Bearer (if apiKey configured) |

`/health` returns `{ status: 'ok', adapter, tier, mode, agentAlive }`.
`agentAlive` is `null` for oneshot adapters, `true/false` for persistent.

Agent Card includes: `protocolVersion`, `capabilities.streaming`, `skills`, and `metadata` with `bridge`, `tier`, `mode`, `ledger` path.

---

## JSONL Line Reader

`ProcessManager` and `PersistentProcess` use a custom LF-split reader (`attachJsonlReader`) instead of Node's `readline`. Reason: Node readline splits on U+2028 and U+2029 (line/paragraph separators), which are valid inside JSON strings in Pi's JSONL protocol. The custom reader splits on `\n` only. Source: `src/core/process.ts:12`.

---

*The contract IS the architecture. Plumb does not pretend otherwise.*
