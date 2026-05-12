# PLUMB SPEC

## Living contract

Stays aligned with **`MANIFEST.yaml`** (product state), **`src/types.ts`** (interfaces), and **`src/`** (behavior). If this file disagrees with those, **trust the code and manifest first**, then update this doc.

**Last synced:** 2026-05-12 — `plumb-bridge@0.1.2`, Phase 0 metrics PASS, adapters: echo, pi, claude, cursor, opencode, venom, generic.

---

## What Plumb is

One sentence: a bridge between orchestrators that speak **A2A** and agents that speak **stdin/stdout**.

```
Orchestrator → HTTP/JSON-RPC → Plumb → subprocess → CLI agent → parseLine → AdapterEvent[] → A2A + ledger
```

Plumb is not an agent. It has no LLM, no session memory, no orchestration. It spawns processes (or holds one persistent process), parses stdout lines, maps them to events, and writes **append-only JSONL**. Everything else is out of scope or refused.

---

## What exists right now

```
src/
  types.ts           AgentTask, AdapterEvent, PlumbConfig, AgentAdapter, DetectionResult, LedgerEvent
  cli.ts             plumb wrap <cli> --port <n>
  main.ts            Entry
  adapters/
    stream-json.ts   Shared parseLine utilities (tryParseLine, extractContentText, etc.)
    echo.ts          EchoAdapter — `cat` — conformance gate
    pi.ts            PiAdapter — persistent JSONL-RPC
    claude.ts        ClaudeAdapter — stream-json (shared parser)
    cursor.ts        CursorAdapter — `cursor-agent --print` stream-json (shared parser)
    opencode.ts      OpenCodeAdapter — `opencode` + run --format json
    venom.ts         VenomAdapter — `venom -p` stream-json (shared parser)
    generic.ts       GenericAdapter — fallback for any CLI
    registry.ts      detectAdapter() — order matters; generic is implicit last
  core/
    ledger.ts        append-only JSONL → .plumb/ledger/{YYYY-MM-DD}.jsonl
    process.ts       ProcessManager, PersistentProcess (writeWhenActive)
    executor.ts      PlumbExecutor — @a2a-js/sdk AgentExecutor
    server.ts        Express — Agent Card, JSON-RPC, REST, health
    task-store.ts    PlumbTaskStore — LRU + TTL bounded task store
test/
  conformance.test.ts   Phase 0 automated gates
  task-store.test.ts    Unit tests for PlumbTaskStore
  adapter-parse.test.ts  Unit tests for all adapter parseLine + stream-json utilities
```

**Smoke check:**

```bash
bun run src/main.ts wrap cat --port 3001
# GET /.well-known/agent-card.json → 200
# POST /a2a/jsonrpc message/send → task runs
# Ledger lines: task_submitted → task_running → progress → task_completed
```

---

## AgentAdapter (contract)

Authoritative shape is **`src/types.ts`**. Summary:

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

**Registry:** `src/adapters/registry.ts` tries **Echo → Pi → Claude → Cursor → OpenCode → VENOM** by matching `binary` against the `wrap` CLI string; if none match, **`GenericAdapter`** wraps the raw CLI string.

**Host IDE adapter:** not shipped — the packaged host application is not a headless agent CLI (`MANIFEST.yaml` notes).

---

## Adapter events vs ledger

**`AdapterEvent`** (stdout parsing — what adapters emit):

- `text-delta` — text fragment; executor appends to task output, writes **`progress`** to ledger, streams artifact-update on the A2A bus.
- `tool-call` / `tool-result` — typed for agent-like output; extend executor behavior if a CLI needs them surfaced.
- `status` — `state: 'working' | 'completed' | 'failed'`; **`completed`** settles the task early (before process exit) when the protocol signals done.
- `error` — task failure.

**`LedgerEvent`** (disk — one JSON object per line in `.plumb/ledger/{date}.jsonl`):

`task_submitted` | `task_running` | `progress` | `log` | `task_completed` | `task_failed` | `task_cancelled`

Never rewrite or delete ledger files. Write failure is non-fatal (stderr JSON log).

---

## Protocol surface

From **`src/core/server.ts`**:

| Method | Path | Notes |
|--------|------|--------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/.well-known/agent.json` | redirect → agent-card |
| GET | `/health` | public — includes `agentAlive` for persistent agents |
| POST | `/a2a/jsonrpc` | JSON-RPC 2.0 (`message/send`, etc.) |
| (mounted) | `/a2a/rest` | REST surface from SDK |

If **`apiKey`** is set in config, **`Authorization: Bearer <key>`** is required for `/a2a/*` (not for Agent Card or health).

**Agent Card** includes `protocolVersion`, `capabilities.streaming`, `skills`, and `metadata` with `bridge`, `tier`, `mode`, `ledger` path.

---

## Phase 0 gates (automated)

| Metric | Test idea | Status |
|--------|-----------|--------|
| `agent_card_test` | Valid Agent Card from running server | **PASS** |
| `task_lifecycle_test` | `message/send` completes | **PASS** |
| `ledger_survival_test` | Ledger contains lifecycle for a task | **PASS** |
| `routing_test` | `wrap cat` echo behavior | **PASS** |

**Run:** `bun test test/conformance.test.ts` (also runs via `npm run test` / `prepublishOnly`).

Source of truth for pass/fail labels: **`MANIFEST.yaml`** → `success_metrics`.

---

## Build and release state

See **`MANIFEST.yaml`** → `build_state` and `identity.version` (aligned with npm package **`plumb-bridge`**).

**Done (high level):** core, cli, conformance, echo, generic, pi, claude, opencode, npm publish for current line.

**Next:** git `main` + version tag aligned with `package.json`; CI publish needs GitHub **`NPM_TOKEN`** for tag-driven workflow.

---

## Decisions (stable)

| Topic | Choice |
|-------|--------|
| Runtime | TypeScript on **Bun** |
| Protocol | **A2A** via `@a2a-js/sdk` |
| Process | `node:child_process` spawn; persistent lane for Pi |
| State on disk | JSONL ledger only — no DB in Phase 0 |
| Entry | `plumb wrap <cli> --port <n>` |

---

## What Plumb will never build

Not deferred — refused: dashboard-as-UI, Plumb-owned LLM memory, orchestration product, TUI/ANSI for the bridge, hot-reload plugin marketplace. Adapters are code in **`src/adapters/`** plus registry order.

---

## Identity

**Name:** Plumb  
**npm:** `plumb-bridge`  
**Tagline:** Quiet pipes for noisy agents.  
**Voice:** State, don’t hedge. Logs are the UI.

**Terminology (surface):** adapter, ledger, core, bridge/conduit — not body/skeleton/muscle metaphors on shipped docs or API.

---

## The number that matters

**Conformance:** `bun test test/conformance.test.ts` must stay green before release. Per-adapter CLIs need their own fixtures when you change `parseLine` or upstream CLI output.

---

*The plumb bob hangs true because gravity is not negotiable. The protocol gap is not negotiable either.*
