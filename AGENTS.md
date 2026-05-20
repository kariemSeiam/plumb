# PLUMB — Agent Environment Brief
## The Key. Read this before every session.

> "Most infrastructure pretends to be friendly. We have the courtesy to be silent."
> Scope: /hub/projects/live/Plumb/ and all subdirectories.
> Last updated: 2026-05-20 (fleet stabilized, 8 adapters, 90 tests, Wave 2 fleet commands)

---

## What Plumb Is

Plumb is a bridge, not an agent. It wraps any CLI coding agent into an A2A-compliant HTTP server in one command.

```
plumb wrap "cat" --port 3001
plumb wrap "pi --mode rpc" --port 3002
plumb wrap "claude --print" --port 3003
```

The whole architecture in one line:

```
Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → stream parse → A2A events back out
```

**The contract IS the architecture.** A2A's Agent Card + JSON-RPC 2.0 is the protocol. Everything else is delivery.

---

## The One Rule

**The contract IS the architecture.**

Every agent framework eventually reduces to: receive task → route to process → parse output → emit events. The difference between good and bad bridges is not the routing — it's the quality of the protocol surface and the discipline of drift detection.

Plumb does not pretend the architecture is more sophisticated than this.

---

## Folder Map

```
Plumb/
├── AGENTS.md              ← YOU ARE HERE (read every session)
├── MANIFEST.yaml          ← The only contract. Single source of truth.
├── docs/
│   └── workspace.md       ← Workspace command reference (optional local rule trees gitignored)
├── src/
│   ├── types.ts           ← AgentTask, AdapterEvent, PlumbConfig, AgentAdapter, LedgerEvent, RPC types
│   ├── config.ts          ← Wave 2: FleetConfig, YAML parsing, plumb.yaml validation
│   ├── cli.ts             ← CLI: wrap, fleet validate, fleet status, fleet up
│   ├── main.ts            ← Entry point
│   ├── core/
│   │   ├── ledger.ts      ← Append-only JSONL (.plumb/ledger/{date}.jsonl)
│   │   ├── process.ts     ← ProcessManager, PersistentProcess (RPC, host tools, ready-frame)
│   │   ├── executor.ts    ← PlumbExecutor + FangPostParse hook + handleEvents refactor
│   │   ├── server.ts      ← createPlumbServer (Express + @a2a-js/sdk)
│   │   ├── task-store.ts  ← PlumbTaskStore (LRU + TTL bounded)
│   │   └── session-store.ts ← CursorSessionStore (TTL + cold recap injection)
│   └── adapters/
│       ├── stream-json.ts ← Shared parseLine utilities (tryParseLine, extractContentText, etc.)
│       ├── echo.ts        ← EchoAdapter (wraps cat) — conformance gate
│       ├── pi.ts          ← PiAdapter — oneshot JSONL (--mode json --print)
│       ├── wolfy.ts       ← WolfyAdapter — oneshot JSONL (Pi dialect, 9 skills)
│       ├── claude.ts      ← ClaudeAdapter — stream-json (shared parser)
│       ├── cursor.ts      ← CursorAdapter — stream-json + session store + cold recap
│       ├── opencode.ts    ← OpenCodeAdapter — json-stream
│       ├── venom.ts       ← VenomAdapter — stream-json (shared parser)
│       ├── generic.ts     ← GenericAdapter (text passthrough)
│       └── registry.ts    ← detectAdapter() — Echo→Pi→Wolfy→Claude→Cursor→OpenCode→VENOM→Generic
├── test/
│   ├── conformance.test.ts       ← Phase 0 automated gates (5 tests)
│   ├── task-store.test.ts        ← PlumbTaskStore unit tests (7 tests)
│   ├── adapter-parse.test.ts     ← All adapter parseLine + stream-json tests (46 tests)
│   ├── persistent-process.test.ts ← PersistentProcess lifecycle tests (5 tests)
│   ├── rpc.test.ts               ← RPC correlation, timeout, host tool tests (5 tests)
│   └── session-store.test.ts     ← CursorSessionStore TTL, recap, turn recording (12 tests)
├── src/config.test.ts            ← FleetConfig validation tests (10 tests)
├── package.json
├── tsconfig.json
├── bunfig.toml
└── .plumb/                ← Runtime state (gitignored)
    └── ledger/            ← JSONL per-day files
```

`playgorund/`, editor-local config dirs, and `.venom/` are gitignored (local research, IDE rules, session memory). Shipped contract surface: `MANIFEST.yaml`, `src/`, `test/`, `docs/workspace.md`, `AGENTS.md`, `SPEC.md`.

---

## Technology Stack (Locked)

```
Runtime:    Bun (TypeScript)
Transport:  @a2a-js/sdk (HTTP + SSE, JSON-RPC 2.0)
HTTP:       Express
CLI:        Commander
Ledger:     JSONL append-only (no database)
Process:    node:child_process spawn
```

Do not add Docker. Do not add Redis. Do not add SQLite in Phase 0.

---

## How Plumb Works (The Bridge Model)

```
[plumb wrap <cli> --port <n>]
        ↓
   PlumbServer (Express)
   ├── GET /.well-known/agent-card.json  ← Agent Card (public)
   ├── GET /health                        ← Liveness (public)
   ├── POST /a2a/jsonrpc                  ← JSON-RPC 2.0 (auth-gated if apiKey)
   └── /a2a/rest                          ← REST surface (auth-gated if apiKey)
        ↓
   PlumbExecutor.execute(ctx, bus)
   ├── ledger: task_submitted
   ├── spawn CLI process
   ├── write task.message to stdin, close
   ├── stdout → parseLine() → [FangPostParse hook] → handleEvents() → AdapterEvent[] → bus.publish()
   │   ├── text-delta → bus.publish({ kind: 'text', parts: [...] })
   │   ├── tool-call → formatted as [toolname] input text-delta
   │   ├── tool-result → formatted as → ✓/✗ output text-delta
   │   ├── status/completed → bus.finished()
   │   └── error → bus.finished() with error
   ├── stderr → ledger: log
   ├── exit 0 → ledger: task_completed, bus.finished()
   └── exit N / timeout → ledger: task_failed, bus.finished()
```

**handleEvents()** — Unified event processor (refactored from duplicated oneshot/persistent loops). Single private method processes all adapter events. Injected via `FangPostParse` hook runs after parseLine, before handleEvents.

---

## Adapter Interface (The Only Contract)

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

Three methods that matter: `formatInput` (task → stdin), `parseLine` (stdout line → events), `detect` (is it installed?). `buildArgs` handles CLI flags.

---

## Current State (Phase 0 Complete)

**90 tests, 156 assertions across 7 test files. All passing.**

8 adapters: Echo, Pi, Wolfy, Claude, Cursor, OpenCode, VENOM, Generic.

**Wave 2 additions:**
- `src/config.ts` — FleetConfig (YAML) for `plumb.yaml` fleet definitions
- `fleet validate` / `fleet status` / `fleet up` CLI commands
- `FangPostParse` hook — post-parse event transformation before handleEvents

**Production fleet (2026-05-20):**
- 3001: Plumb-Pi (bun, systemd) ✅
- 3002: Fang-Claude (node, systemd) — pending cutover
- 3003: Plumb-Cursor (bun, systemd) ✅
- 3004: Fang-OpenCode (node, systemd) — pending cutover
- 3005: Fang-VENOM (node, systemd) — pending cutover
- 3007: Plumb-Wolfy (bun, systemd) ✅

---

## Phase 0 Exclusions

- **No TUI.** stdout is for the process. stderr is structured JSON logs. That's it.
- **No plugin system.** Adapters are in `src/adapters/`. Declared by importing them in registry.ts.
- **No multi-model support.** Models live inside the wrapped agents, not in Plumb.
- **No memory.** Memory belongs to the wrapped agent (pi, claude, mem0). Plumb is the pipe.
- **No session continuity in Plumb.** The ledger is append-only; it does not feed back in.
- **No dashboard.** Health endpoint returns JSON. Logs go to stderr as JSONL. That is the interface.
- **No streaming output to the user.** Plumb bridges SSE to the orchestrator. It does not stream to a human terminal.

---

## Ledger Format

Every task lifecycle event is one JSONL line in `.plumb/ledger/{YYYY-MM-DD}.jsonl`:

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"cat","message":"hello","timestamp":"2026-05-12T20:00:00Z"}
{"type":"task_running","taskId":"abc","timestamp":"2026-05-12T20:00:00Z"}
{"type":"progress","taskId":"abc","text":"hello\n","timestamp":"2026-05-12T20:00:00Z"}
{"type":"task_completed","taskId":"abc","timestamp":"2026-05-12T20:00:01Z"}
```

Query with `jq`. Replay to reconstruct task history. Never modified, only appended.

---

## Voice Standard

```
State. Don't hedge.
Answer first. Support second.
Every word earns its place.

No: "I think", "it seems", "perhaps", "maybe", "probably"
Yes: Direct assertion. If uncertain, say "Unknown."
```

**Brand voice:** Silent infrastructure. No enthusiasm. No emojis.
Plumb does not perform friendliness. Plumb routes tasks.

---

## Terminology Lock

| Never Say          | Always Say        |
|--------------------|-------------------|
| Body               | Conduit           |
| Skeleton           | Core              |
| Muscles            | Adapters          |
| Blood              | Task pipeline     |
| Memory (in Plumb)  | Ledger            |
| Dashboard          | Logs / Health     |
| Agent loop         | Bridge / Router   |

Body metaphors are **banned from all surfaces**. Research references only.

---

## Error Recovery

| Scenario | Response |
|----------|----------|
| CLI process crashes mid-task | `onExit` fires → ledger: task_failed → bus.finished() |
| Task timeout | timer fires → SIGTERM CLI → ledger: task_failed → bus.finished() |
| Ledger write fails | Log to stderr, continue. Ledger failure is non-fatal. |
| `@a2a-js/sdk` request fails | SDK handles it. Plumb does not retry. Orchestrator decides. |
| Port in use | Commander exits with error. User picks another port. |

---

## Before Doing Anything

1. Read MANIFEST.yaml — know current phase, done list, next step
2. Read this file — refresh the contract
3. Check `.plumb/ledger/` — know what tasks have run
4. Then act

---

## Success Metrics for Phase 0

1. **`agent_card_test`**: `GET /.well-known/agent-card.json` → 200 + valid Card. PASS/FAIL.
2. **`task_lifecycle_test`**: Submit task via `message/send` → SSE stream completes → final message received. PASS/FAIL.
3. **`ledger_survival_test`**: Task runs → ledger file contains full lifecycle → process killed → ledger survives. PASS/FAIL.
4. **`routing_test`**: `plumb wrap "cat" --port 3001` → echo task → progress + completed. PASS/FAIL.

All 4 must pass for Phase 0 to be complete.

---

*Plumb — bridge first. The plumb bob hangs true because gravity is not negotiable.*
