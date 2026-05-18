# PLUMB — Claude Code Reference

Plumb wraps any CLI coding agent into an A2A-compliant HTTP server.
`Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → stream parse → A2A events`

---

## Dev Commands

```bash
bun install                                        # install deps (frozen lockfile in CI)
bun run typecheck                                  # tsc --noEmit — must be zero errors
bun test test/conformance.test.ts                  # Phase 0 conformance gates
bun test                                           # full suite (6 test files)
bun run src/main.ts wrap cat --port 3001           # run locally (echo adapter)
bun run src/main.ts wrap "claude" --port 3003      # wrap Claude
plumb fleet validate                               # validate plumb.yaml
plumb fleet status                                 # health-check all fleet agents
```

CI runs `bun run typecheck` then `bun test` on every push to main and every PR.
Publish is gated on both passing (`prepublishOnly` hook in package.json).

---

## Project Structure

```
src/
  main.ts              Entry point — shebang + calls cli.ts
  cli.ts               Commander: wrap, fleet validate/status/up, detect-all
  types.ts             All core interfaces (AgentTask, AdapterEvent, AgentAdapter, etc.)
  config.ts            plumb.yaml parsing and validation (js-yaml)
  adapters/
    registry.ts        detectAdapter() — binary → adapter (detection order below)
    stream-json.ts     Shared utilities for JSON-streaming adapters
    echo.ts            EchoAdapter (cat) — Phase 0 conformance gate
    pi.ts              PiAdapter — persistent JSONL-RPC
    claude.ts          ClaudeAdapter — stream-json, oneshot
    cursor.ts          CursorAdapter — stream-json + session store, oneshot
    opencode.ts        OpenCodeAdapter — json-stream, oneshot
    venom.ts           VenomAdapter — stream-json, oneshot
    generic.ts         GenericAdapter — text passthrough, fallback
  core/
    executor.ts        PlumbExecutor implements A2A AgentExecutor
    server.ts          Express + @a2a-js/sdk, auth middleware, cleanup timer
    process.ts         ProcessManager, PersistentProcess, attachJsonlReader
    ledger.ts          Append-only JSONL (.plumb/ledger/{YYYY-MM-DD}.jsonl)
    task-store.ts      PlumbTaskStore — LRU (100 tasks) + TTL (60 min)
    session-store.ts   CursorSessionStore — multi-turn session tracking
test/
  conformance.test.ts  Phase 0 gates (server start, health, agent card, RPC, SSE, ledger)
  adapter-parse.test.ts parseLine fixtures for all adapters + stream-json utilities
  task-store.test.ts   LRU eviction, TTL cleanup, terminal state transitions
  persistent-process.test.ts ProcessManager and PersistentProcess
  rpc.test.ts          Pi JSONL-RPC correlated request/response
  session-store.test.ts Cursor session lifecycle and cold-recap logic
docs/                  Design docs (OPERATING.md, CONTRACT.md, core/, fleet/, soul/)
plumb.yaml             Fleet definition (6 agents, ports 3000–3004)
MANIFEST.yaml          Single source of truth — version, phase, adapters, build state
AGENTS.md              Session brief — read this too for full project context
```

---

## Architecture Flow

```
[plumb wrap <cli> --port <n>]
        |
   PlumbServer (Express + @a2a-js/sdk)
   ├── GET  /.well-known/agent-card.json   public
   ├── GET  /health                         public
   ├── POST /a2a/jsonrpc                    JSON-RPC 2.0 (Bearer auth if --key)
   └── *    /a2a/rest                       A2A REST (Bearer auth if --key)
        |
   PlumbExecutor.execute(ctx, bus)
   ├── ledger: task_submitted
   ├── detectAdapter(cli) → adapter
   ├── mode === 'oneshot'  → executeOneshot(task, config, adapter, bus)
   │   ├── spawn(cli, buildArgs(task, config))
   │   ├── write formatInput(task) → stdin, close
   │   ├── stdout line → parseLine() → AdapterEvent[] → bus.publish()
   │   ├── stderr → ledger: log
   │   └── exit → task_completed / task_failed
   └── mode === 'persistent' → executePersistent(task, config, adapter, bus)
       └── PersistentProcess.send() → correlated JSONL-RPC
```

---

## Adapter Pattern

**Detection order** (`src/adapters/registry.ts`): Echo → Pi → Claude → Cursor → OpenCode → VENOM → Generic (fallback)

**Interface** (from `src/types.ts` — match exactly):

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly binary: string;
  readonly tier: 1 | 2 | 3;
  readonly displayName: string;
  readonly mode: 'oneshot' | 'persistent';
  skills: Array<{ id: string; name: string; tags: string[] }>;

  buildArgs(task: AgentTask, config: PlumbConfig): string[];
  formatInput(task: AgentTask): string;
  parseLine(line: string): AdapterEvent[];
  detect(): Promise<DetectionResult | null>;
}
```

**Adding a new adapter:**
1. Create `src/adapters/<name>.ts` implementing `AgentAdapter`
2. For JSON-streaming agents, import helpers from `src/adapters/stream-json.ts`:
   - `tryParseLine(line)` — parse JSON, fallback to raw text
   - `extractContentText(event)` — extract text from `message.content[]`
   - `isConsolidatedAssistant(event, streamPartial)` — skip dedup events
   - `textDelta(text)`, `statusEvent(state)`, `errorEvent(message)` — event builders
3. Add to `detectAdapter()` in `src/adapters/registry.ts` before `GenericAdapter`
4. Add fixtures to `test/adapter-parse.test.ts`
5. Add to `MANIFEST.yaml` adapters section

**Tiers:** 1 = highest value (pi, claude, cursor, echo), 2 = opencode, 3 = fallback (venom, generic)

---

## Core Infrastructure

### Ledger (`src/core/ledger.ts`)
Append-only JSONL at `.plumb/ledger/{YYYY-MM-DD}.jsonl`. One JSON object per line, rolls over daily.
Ledger failure is **non-fatal** — log to stderr, continue. Query with `jq`.

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"cat","message":"hello","timestamp":"..."}
{"type":"task_running","taskId":"abc","timestamp":"..."}
{"type":"progress","taskId":"abc","text":"hello\n","timestamp":"..."}
{"type":"task_completed","taskId":"abc","timestamp":"..."}
```

### PlumbTaskStore (`src/core/task-store.ts`)
LRU-bounded (default 100 tasks). Terminal tasks (completed/failed/cancelled) expire after 60 min TTL.
Evicts stale tasks first on cap overflow. Periodic cleanup runs every 5 minutes in the server.

### ProcessManager / PersistentProcess (`src/core/process.ts`)
- Spawns via `node:child_process.spawn` with `stdio: ['pipe','pipe','pipe']`
- `attachJsonlReader()` splits on `\n` only — does **not** use Node's `readline` (which splits on U+2028/U+2029)
- Graceful shutdown: SIGTERM → wait `killTimeout` ms → SIGKILL
- `PersistentProcess` holds a single long-running process for Pi, writes/reads correlated JSONL-RPC frames

### CursorSessionStore (`src/core/session-store.ts`)
Tracks `session_id`, workspace, model, turn count. Optional TTL: stale sessions inject "cold recap" instead of `--continue`. Truncates turn history to prevent unbounded growth.

---

## Core Types (`src/types.ts`)

```typescript
// Input to every adapter
interface AgentTask {
  id: string;
  message: string;
  context?: { workdir?: string; metadata?: Record<string, unknown> };
}

// Unified output event model
type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'status'; state: 'working' | 'completed' | 'failed' }
  | { type: 'error'; message: string; code?: string };

// Adapter config resolved from CLI flags or plumb.yaml
interface PlumbConfig {
  cli: string;
  port: number;
  name?: string;
  workdir?: string;
  env?: Record<string, string>;
  taskTimeout?: number;
  killTimeout?: number;
  apiKey?: string;
}

// Ledger event union (7 types — see types.ts for full definition)
type LedgerEvent =
  | { type: 'task_submitted'; taskId: string; cli: string; message: string; timestamp: string }
  | { type: 'task_running'; ... }
  | { type: 'progress'; ... }
  | { type: 'log'; ... }
  | { type: 'task_completed'; ... }
  | { type: 'task_failed'; ... }
  | { type: 'task_cancelled'; ... };
```

---

## Code Conventions

**Naming:**
- `PascalCase` for classes and interfaces: `PlumbExecutor`, `AgentAdapter`, `LedgerEvent`
- `camelCase` for methods and variables: `buildArgs`, `formatInput`, `parseLine`
- `UPPER_CASE` for module-level constants: `LEDGER_DIR`, `TERMINAL_STATES`
- Suffix `-Adapter` on adapter classes, `-Event`/`-Task`/`-Result` on data types
- Prefix `try` on fallible parsers that return data or null: `tryParseLine`
- Include unit in time variable names: `sessionTtlMs`, `taskTimeout` (seconds implied by config)

**Imports (order):**
```typescript
import { spawn } from 'node:child_process';   // 1. Node built-ins
import express from 'express';                  // 2. Third-party
import type { AgentAdapter } from '../types.ts'; // 3. Internal (relative, typed)
import { tryParseLine } from './stream-json.ts'; // 4. Sibling utilities
```

**TypeScript:**
- Strict mode is on — no `any`, no `!` non-null assertions without a comment explaining why
- Use `readonly` on adapter fields that must not be reassigned
- Discriminated unions (not class hierarchies) for event types

**Comments:**
- Header comments: 2–3 lines explaining module purpose, nothing else
- Inline: only when the WHY is non-obvious (workaround, subtle invariant, Unicode edge case)
- No multi-paragraph docstrings. No TODO/FIXME left in shipped code.

**Error logging:** structured JSON to stderr — `{ ts, l: 'error'|'warn'|'info', m: string, ...data }`

---

## Hard Constraints

These are permanent refusals for Phase 0 and beyond unless explicitly unlocked in MANIFEST.yaml:

| Forbidden | Reason |
|-----------|--------|
| Docker | Adds infra dependency; not needed for a pipe |
| Redis / SQLite / any DB | Ledger is the store. No DB in the bridge. |
| LLM calls in Plumb | Plumb routes; it does not reason |
| TUI / dashboard | Logs are the UI. Health endpoint is the monitor. |
| Memory / context assembly | Memory belongs to the wrapped agent |
| Plugin system | Adapters are in `src/adapters/`. Import them in registry.ts. |
| Multi-model support | Models live inside the wrapped agent |
| Streaming to human terminal | Plumb bridges SSE to orchestrators, not humans |
| Session continuity via ledger | Ledger is append-only; it does not feed back in |

---

## Terminology Lock

| Never Say | Always Say |
|-----------|-----------|
| Body | Conduit |
| Skeleton | Core |
| Muscles | Adapters |
| Blood | Task pipeline |
| Memory (in Plumb) | Ledger |
| Dashboard | Logs / Health |
| Agent loop | Bridge / Router |

Body metaphors are banned from all code, docs, and comments.

---

## Phase / Build State

Current: **Phase 2, Wave 2** (Config + Fleet Boot)

All Phase 0 items are complete. All Phase 1 adapter items are complete.
Wave 2 delivered: `plumb fleet validate`, `plumb fleet status`, `plumb.yaml` parsing.
`plumb fleet up` is Wave 2 final item.

Check `MANIFEST.yaml` → `build_state` for the authoritative done list and next step.

---

## Conformance Gates (Phase 0)

All six must pass before any ship:

1. `bun run typecheck` — zero TypeScript errors
2. `bun run src/main.ts wrap cat --port 3001` — server starts
3. `GET /.well-known/agent-card.json` → 200 + valid Card JSON
4. `POST /a2a/jsonrpc` with `message/send` → returns task ID
5. SSE stream from `message/send` → receives `progress` + `completed` events
6. `.plumb/ledger/{date}.jsonl` → contains full task lifecycle after task runs

Run `bun test test/conformance.test.ts` to check gates 2–6 automatically.

---

## Fleet Configuration (`plumb.yaml`)

```yaml
version: "1"
agents:
  - id: claude
    cli: claude
    port: 3000
    mode: oneshot
    name: claude

  - id: pi
    cli: pi --mode rpc
    port: 3001
    mode: persistent
    timeout: 600
    name: pi
```

Config is resolved in this order: `plumb.yaml` → `plumb.yml` → `./config/plumb.yaml`.
Loaded once at boot, validated, then immutable. See `src/config.ts`.

---

## Error Recovery

| Scenario | Response |
|----------|----------|
| CLI crashes mid-task | `onExit` fires → `task_failed` ledger event → `bus.finished()` |
| Task timeout | Timer → SIGTERM → wait `killTimeout` → SIGKILL → `task_failed` |
| Ledger write fails | Log to stderr, continue. Non-fatal. |
| Port in use | Commander exits with error. Pick another port. |
| `@a2a-js/sdk` request fails | SDK handles it. Plumb does not retry. Orchestrator decides. |
| Bearer token missing (--key set) | 401 Unauthorized. Public routes unaffected. |

---

## Before Making Changes

1. Read `MANIFEST.yaml` — know current phase, done list, next step
2. Run `bun run typecheck` — confirm baseline is clean
3. Run `bun test` — confirm all gates pass before touching anything
4. Check `AGENTS.md` for fuller session context and project philosophy
