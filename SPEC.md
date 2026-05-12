# PLUMB SPEC
## The living contract. Stays in sync with code. Replaces nothing, supersedes everything.
> Last synced: 2026-05-12 — Session 1. Code exists. Bridge runs. Echo passes.

---

## § What Plumb Is

One sentence: a bridge between orchestrators that speak A2A and agents that speak stdin/stdout.

```
Orchestrator → HTTP/JSON-RPC → Plumb → subprocess → CLI agent → parse → A2A events
```

Plumb is not an agent. It has no LLM. It has no memory. It has no loop.
It spawns processes, parses lines, and emits events. That's the architecture.
Everything else is a refusal.

---

## § What Exists Right Now

```
src/
  types.ts           Contract: AgentTask, AdapterEvent, PlumbConfig, AgentAdapter, LedgerEvent
  cli.ts             Entry: plumb wrap <cli> --port <n>
  main.ts            3 lines
  core/
    ledger.ts        Append-only JSONL → .plumb/ledger/{date}.jsonl
    process.ts       ProcessManager + LF-only JSONL reader
    executor.ts      PlumbExecutor implements @a2a-js/sdk AgentExecutor
    server.ts        Express + @a2a-js/sdk: Agent Card, JSON-RPC, REST, health
  adapters/
    echo.ts          EchoAdapter wraps `cat` — the conformance gate
    generic.ts       GenericAdapter — text passthrough for any CLI
    registry.ts      detectAdapter(cli) → right adapter or Generic
```

**Verified working:**
```bash
bun run src/main.ts wrap cat --port 3001
# → Agent Card at /.well-known/agent-card.json
# → JSON-RPC at /a2a/jsonrpc
# → message/send "hello" → response "hello\n"
# → ledger: task_submitted → task_running → progress → task_completed
```

---

## § The Adapter Interface

Three methods. That's it.

```typescript
interface AgentAdapter {
  // What to write to the CLI's stdin
  formatInput(task: AgentTask): string;

  // How to parse one stdout line into events
  parseLine(line: string): AdapterEvent[];

  // Is this binary installed on the current machine?
  detect(): Promise<DetectionResult | null>;

  // Supporting metadata
  readonly id: string;
  readonly binary: string;
  readonly mode: 'oneshot' | 'persistent';
  readonly tier: 1 | 2 | 3;
  buildArgs(task: AgentTask, config: PlumbConfig): string[];
}
```

**Event types** (`AdapterEvent`):
- `text-delta` — text fragment (accumulates into final message)
- `tool-call` / `tool-result` — logged, forwarded as artifact
- `status` — `working` | `completed` | `failed`
- `error` — task fails, bus.finished()

**Process lifecycle:**
1. `spawn(cmd, args)` — ProcessManager handles stdin/stdout/stderr/exit
2. `stdin ← adapter.formatInput(task)` — written, then stdin closed (oneshot)
3. `stdout line → adapter.parseLine(line)` — zero or more AdapterEvents
4. `exit 0` → task_completed if not already settled
5. `exit N / timeout` → task_failed

---

## § The Protocol Surface

```
GET  /.well-known/agent-card.json   public, always
GET  /.well-known/agent.json        redirects to agent-card.json
GET  /health                        public, always
POST /a2a/jsonrpc                   JSON-RPC 2.0 — message/send, message/stream, tasks/*
     /a2a/rest                      HTTP+JSON REST surface (same operations)
```

If `apiKey` is set, `/a2a/jsonrpc` and `/a2a/rest` require `Authorization: Bearer <key>`.
Agent Card and health are always public. This is the A2A spec requirement.

**Agent Card shape:**
```json
{
  "name": "<adapter>-plumb",
  "protocolVersion": "0.3.0",
  "capabilities": { "streaming": true },
  "skills": [...],
  "metadata": { "bridge": "plumb", "tier": 1, "mode": "oneshot", "ledger": ".plumb/ledger/..." }
}
```

---

## § The Ledger

Every task event is one line in `.plumb/ledger/{YYYY-MM-DD}.jsonl`.

```jsonl
{"type":"task_submitted","taskId":"...","cli":"cat","message":"hello","timestamp":"..."}
{"type":"task_running","taskId":"...","timestamp":"..."}
{"type":"progress","taskId":"...","text":"hello\n","timestamp":"..."}
{"type":"task_completed","taskId":"...","timestamp":"..."}
```

All seven event types: `task_submitted` | `task_running` | `progress` | `log` | `task_completed` | `task_failed` | `task_cancelled`

Query: `jq 'select(.taskId == "abc")' .plumb/ledger/2026-05-12.jsonl`
The ledger never mutates. Ledger write failure is non-fatal — log to stderr, continue.

---

## § Phase 0 Gates (all must pass)

| Gate | Test | Status |
|------|------|--------|
| `agent_card_test` | `GET /.well-known/agent-card.json` → 200 + valid Card schema | **NEEDS FIXTURE** |
| `task_lifecycle_test` | `message/send` → SSE produces progress + final message | **NEEDS FIXTURE** |
| `ledger_survival_test` | task runs → kill process → ledger file intact with full lifecycle | **NEEDS FIXTURE** |
| `routing_test` | `plumb wrap cat --port <free>` → echo task → correct response | **NEEDS FIXTURE** |

Next action: write `src/test/conformance.test.ts`. Run with `bun test`. All four pass → Phase 0 complete.

---

## § Adapter Build Order

Phase 0 done. What ships next, in order:

1. **Conformance test** — `src/test/conformance.test.ts` — 4 fixtures, all pass required
2. **Pi adapter** — `src/adapters/pi.ts` — persistent JSONL RPC, Tier 1
   - `formatInput` → `{"id":"...","type":"prompt","message":"..."}\n`
   - `parseLine` → map pi event types to AdapterEvents (ref: `fangai/src/adapters.ts` PiAdapter)
   - mode: `persistent`, uses `PersistentProcess`
3. **Claude adapter** — `src/adapters/claude.ts` — stream-json, Tier 1
   - `buildArgs` → `-p --output-format stream-json --verbose`
   - `parseLine` → type=assistant → text-delta, type=result → status
4. **Cursor adapter** — `src/adapters/cursor.ts` — stream-json, Tier 1

Each adapter ships with its own fixture before it's declared stable. No fixture → no ship.

---

## § Decisions Made (immutable)

| Decision | Choice | Rejected |
|----------|--------|---------|
| Language | TypeScript/Bun | Go, Python |
| Protocol | A2A `@a2a-js/sdk` v0.3.13 | Custom HTTP, MCP |
| Process model | `node:child_process` spawn, LF-only JSONL reader | readline (U+2028 bug) |
| State | Ledger (JSONL append-only) | SQLite, Redis |
| Interface | HTTP+SSE (Express) | WebSocket, gRPC |
| Adapter mode | oneshot (spawn per task) + persistent (Pi) | pooled processes |
| Entry point | `plumb wrap <cli> --port <n>` | config file only |
| VENOM relationship | Consumer of principles, independent codebase | Fork, arm |

---

## § What Plumb Will Never Build

These are not deferred. They are refused.

1. **Dashboard.** Logs are the UI. Enterprise will ask. The answer is no.
2. **Memory.** Memory belongs to the wrapped agent. Plumb is the pipe.
3. **Orchestration.** Routing, fan-out, cost decisions — separate product.
4. **TUI.** stderr is structured JSON. stdout is for the subprocess. No ANSI renderer.
5. **Plugin system.** Adapters live in `src/adapters/`. Registry is `detectAdapter()`. No hot-reload, no discovery.

---

## § Identity

```
Name:     Plumb
Tagline:  Quiet pipes for noisy agents.
Voice:    Most infrastructure pretends to be friendly. We have the courtesy to be silent.
Villain:  The Demo — software optimized for the screenshot, not the deployment.
Object:   Brass plumb bob, machined, weighted to gravity. Sent for real bugs.
Afterlife: When every CLI speaks A2A, the company dissolves. The protocol survives.
```

**Palette:** Slate `#1a1a2e` · Cistern `#0d0d1a` · Water `#16c79a` · Brass `#c5a55a`
**Type:** Inter 700/400 · JetBrains Mono · Mark: ▲ (plumb bob silhouette, not a logo)

**Terminology lock:**

| Research (refs/ only) | Surface (everywhere else) |
|-----------------------|--------------------------|
| Body | Conduit |
| Skeleton | Core |
| Muscles | Adapters |
| Blood | Task pipeline |
| Memory | Ledger |
| Hearts | Circuit breakers |
| SIPHON | Recovery |
| Soul | Validator |

Body metaphors in code, commits, docs, or API responses → reject.

---

## § The Only Number That Matters

Conformance fixture pass rate. Not stars. Not users. Not tokens/week.

`echo` adapter: target 4/4 (Phase 0).
`pi` adapter: target 4/4 + Pi-specific fixtures (Phase 1).
`claude` adapter: target 4/4 + Claude-specific fixtures (Phase 1).

Every adapter gets a score. Every release publishes the scores.
A score below 100% blocks the release.

---

*The plumb bob hangs true because gravity is not negotiable.*
*The protocol gap is not negotiable either.*
*Ship the conformance test. Then Pi. Then Claude.*
*The pipe holds.*
