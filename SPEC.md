# PLUMB SPEC

## Living contract

Stays aligned with **`MANIFEST.yaml`** (product state), **`src/types.ts`** (interfaces), and **`src/`** (behavior). If this file disagrees with those, **trust the code and manifest first**, then update this doc.

**Last synced:** 2026-05-23 — `plumb-bridge@0.1.3`, 99 tests / 182 assertions, INK metadata v2 (Day 1 complete), adapters: echo, pi, wolfy, claude, cursor, opencode, venom, generic.

---

## What Plumb is

One sentence: a bridge between orchestrators that speak **A2A** and agents that speak **stdin/stdout**.

```
Orchestrator → HTTP/JSON-RPC → Plumb → subprocess → CLI agent → parseLine → AdapterEvent[] → A2A + ledger
```

Plumb is not an agent. It has no LLM, no session memory, no orchestration. It spawns processes (or holds one persistent process), parses stdout lines, maps them to events, and writes **append-only JSONL**. Everything else is out of scope or refused.

### Architectural Invariants

These are the load-bearing walls. Every feature decision must pass these tests.

**The "Wire + Minimum Policy" Principle:**

> *Plumb is a wire plus a minimum policy plane required for safety. The policy plane will not grow into orchestration.*

**What the policy plane covers:**
- DOS protection (deadline admission, depth cap, request size limit)
- Budget admission (prevents runaway mesh traversal — not fork-bomb prevention)
- Self-preservation (rate limits, bulkheads — Day 7)
- Clock skew detection (`senderUnixMs`)
- Caller identity enforcement (authentication at the wire)

**What the policy plane will never cover:**
- Smart routing across discovered peers (expose data via `GET /a2a/peers` but don't route)
- Internal retries (surface 503 + `Retry-After` only)
- Agent selection (that's orchestration)
- Task prioritization beyond admission
- Content-based or capability-based dispatch

**The Orchestration Test:**

> *Plumb makes no decisions that depend on the content or declared capability of the agents it forwards to. Plumb decides whether to accept, throttle, or kill — never which agent does what.*

**Authentication Principle:**

> *Plumb enforces caller identity at the wire. Plumb does not make decisions based on caller identity beyond admission.*

**Schema Evolution Rule:**

> *Unknown fields in `params.message.metadata` MUST be ignored. Adding a field is never a wire-breaking change.*

**Resource Isolation Note:** Plumb does not provide OS-level resource isolation for child processes (fork-bomb prevention, fd limits, memory caps). Operators are responsible for cgroup/ulimit/prlimit confinement of the Plumb process and its children. This may be added in a future version but is out of scope for v0.2.

---

## What exists right now

```
src/
  types.ts           AgentTask, AdapterEvent, PlumbConfig, AgentAdapter, DetectionResult, LedgerEvent, RPC types
  config.ts          FleetConfig, YAML parsing, plumb.yaml validation, fleet up/status/validate
  cli.ts             plumb wrap <cli>, fleet validate/status/up
  main.ts            Entry
  adapters/
    stream-json.ts   Shared parseLine utilities (tryParseLine, extractContentText, etc.)
    echo.ts          EchoAdapter — `cat` — conformance gate
    pi.ts            PiAdapter — oneshot JSONL (--mode json --print)
    wolfy.ts         WolfyAdapter — oneshot JSONL (Pi dialect, 9 skills)
    claude.ts        ClaudeAdapter — stream-json (shared parser)
    cursor.ts        CursorAdapter — `cursor-agent --print` stream-json + session store + cold recap
    opencode.ts      OpenCodeAdapter — `opencode` + run --format json
    venom.ts         VenomAdapter — `venom -p` stream-json (shared parser)
    generic.ts       GenericAdapter — fallback for any CLI
    registry.ts      detectAdapter() — Echo→Pi→Wolfy→Claude→Cursor→OpenCode→VENOM; Generic implicit last
  core/
    ledger.ts        append-only JSONL → .plumb/ledger/{YYYY-MM-DD}.jsonl
    process.ts       ProcessManager, PersistentProcess (RPC, host tools, ready-frame)
    executor.ts      PlumbExecutor — @a2a-js/sdk AgentExecutor + FangPostParse + handleEvents refactor
    server.ts        Express — Agent Card, JSON-RPC, REST, health
    task-store.ts    PlumbTaskStore — LRU + TTL bounded task store
    session-store.ts CursorSessionStore — TTL + cold recap injection
test/
  conformance.test.ts       Phase 0 automated gates (5 tests)
  task-store.test.ts        PlumbTaskStore unit tests (7 tests)
  adapter-parse.test.ts     All adapter parseLine + stream-json tests (46 tests)
  persistent-process.test.ts PersistentProcess lifecycle tests (5 tests)
  rpc.test.ts               RPC correlation, timeout, host tool tests (5 tests)
  session-store.test.ts     CursorSessionStore TTL, recap, turn recording (12 tests)
src/config.test.ts          FleetConfig validation tests (10 tests)
```

**Smoke check:**

```bash
bun run src/main.ts wrap cat --port 3001
# GET /.well-known/agent-card.json → 200
# POST /a2a/jsonrpc message/send → task runs
# Ledger lines: task_submitted → task_running → progress → task_completed
```

---

## INK Metadata Protocol

Every A2A message can carry structured metadata in `params.message.metadata`:

```typescript
interface TaskMetadata {
  correlationId?: string;    // Multi-hop trace across mesh (max 128 chars)
  depth?: number;            // A2A hop count (not local dispatches), maxDepth configurable
  budgetMs?: number;         // Wall-clock budget from origin, real elapsed subtracted per hop
  deadlineUnixMs?: number;   // Admission deadline — wall-clock enforcement in Day 5
  senderUnixMs?: number;     // Sender's wall-clock at hop origination (clock skew detection)
  priority?: 'critical' | 'normal' | 'background';
  idempotencyKey?: string;   // Dedup key (max 256 chars)
  traceparent?: string;      // W3C traceparent
  tracestate?: string;       // W3C tracestate (max 512 chars)
}
```

**Enforcement (admission-time only):**

1. **Deadline:** `deadlineUnixMs` past → reject.
2. **Depth:** `depth >= maxDepth` → reject. `depth++` per hop. Negative → reject.
3. **Budget:** `remaining = budgetMs - (inboundUnixMs - senderUnixMs)`. `<= 0` → reject.
4. **Precedence:** If `budgetMs` and `deadlineUnixMs` both set and disagree, `deadlineUnixMs` wins. Log warning.
5. **senderUnixMs absent:** Accept at `depth == 0` (full budget). Reject at `depth > 0`.
6. **Validation:** Negative depth/budget rejected. Malformed traceparent stripped. Field length limits enforced.

**Unknown fields MUST be ignored** (schema evolution rule).

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

**Registry:** `src/adapters/registry.ts` tries **Echo → Pi → Wolfy → Claude → Cursor → OpenCode → VENOM** by matching `binary` against the `wrap` CLI string; if none match, **`GenericAdapter`** wraps the raw CLI string.

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

**Run:** `bun test` (90 tests, 156 assertions across 7 files). Conformance subset: `bun test test/conformance.test.ts`.

Source of truth for pass/fail labels: **`MANIFEST.yaml`** → `success_metrics`.

---

## Build and release state

See **`MANIFEST.yaml`** → `build_state` and `identity.version` (aligned with npm package **`plumb-bridge`**).

**Done:** core, cli, conformance, echo, generic, pi, wolfy, claude, cursor, opencode, venom, session-store, task-store, RPC, persistent-process, fleet CLI (validate/status/up), FangPostParse hook, npm publish.

**Phase 3 next:** Fang Ingress, Ledger Observer, runtime discovery, intent log. See `docs/ROADMAP.md`.

---

## Decisions (stable)

| Topic | Choice |
|-------|--------|
| Runtime | TypeScript on **Bun** |
| Protocol | **A2A** via `@a2a-js/sdk` |
| Process | `node:child_process` spawn; persistent lane for Pi and Wolfy |
| State on disk | JSONL ledger only — no database |
| Entry | `plumb wrap <cli> --port <n>` |
| Extension | `FangPostParse` — transforms events after parseLine, before executor |
| INK metadata location | `params.message.metadata` (JSON-RPC body, survives proxies) |
| INK deadline semantic | `deadlineUnixMs` is **admission control only** until Day 5 ships wall-clock enforcement |
| INK budget calculation | Real elapsed (`inboundUnixMs - senderUnixMs`), not a fixed constant |
| INK budget vs deadline | `deadlineUnixMs` is canonical. `budgetMs` is derived hint on egress. If both set and disagree, deadline wins, log warning |
| INK senderUnixMs absent | Accept at `depth == 0` (top-of-mesh), use full budget. Reject at `depth > 0` — inter-Plumb traffic without it means broken budget arithmetic |
| INK depth cap | Configurable via `PlumbConfig.maxDepth`, default 4. Counts A2A hops only |
| Ledger replication | CRDT merge (HLC + UUID), not Raft — per-task monotonic writes commute |
| Bulkhead | Fixed % in v0.2, WFQ with floors in v0.3 |
| Idempotency TTL | Independent of budget. 60s default, configurable per adapter |
| Idempotency scope | `(callerIdentity, idempotencyKey)` — not global |
| Idempotency concurrent | Duplicate mid-flight returns existing taskId immediately, no queue |
| Request size limit | 10MB (`express.json({ limit: '10mb' })`)

---

## What Plumb will never build

Not deferred — refused: dashboard-as-UI, Plumb-owned LLM memory, orchestration product, TUI/ANSI for the bridge, hot-reload plugin marketplace, smart routing, internal retries, content-based dispatch. Adapters are code in **`src/adapters/`** plus registry order.

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
