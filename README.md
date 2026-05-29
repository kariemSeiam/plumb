```
   ____  _                 _
  |  _ \| |_   _ _ __ ___ | |__
  | |_) | | | | | '_ ` _ \| '_ \
  |  __/| | |_| | | | | | | |_) |
  |_|   |_|\__,_|_| |_| |_|_.__/
```

**Plumb** wraps CLI coding agents as [A2A](https://google.github.io/A2A/) HTTP servers. One endpoint. One ledger. Eight adapters. Zero dashboards.

> Plumb is not an agent. It has no LLM, no memory, no orchestration.
> It spawns processes, reads stdout, writes JSONL, and exits.
> Plumb is the pipe, not the water.

```
Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → stream parse → A2A events
```

---

## Install

```bash
bun add -g plumb-bridge
```

Requires [Bun](https://bun.sh) >= 1.1.0.

## One command

```bash
plumb wrap claude --port 3000
```

Your CLI agent is now an A2A-compliant server. Agent Card at `/.well-known/agent-card.json`, health at `/health`, tasks at `/a2a/jsonrpc`.

```bash
curl http://localhost:3000/.well-known/agent-card.json
```

## Fleet mode

Define your agents and boot them together:

```yaml
version: "1"
agents:
  - id: claude
    cli: claude
    port: 3000
  - id: cursor
    cli: cursor-agent --print
    port: 3003
  - id: wolfy
    cli: wolfy
    port: 3007
    mode: persistent
    timeout: 600
```

```bash
plumb fleet validate   # check config, detect adapters
plumb fleet up         # boot all agents
plumb fleet status     # health check all
```

Full `plumb.yaml` schema in [docs/FLEET.md](docs/FLEET.md).

## Adapters

| Adapter   | CLI             | Mode       | Protocol       |
|-----------|-----------------|------------|----------------|
| Echo      | `cat`           | oneshot    | text           |
| Pi        | `pi`            | persistent | JSONL-RPC      |
| Wolfy 🐺  | `wolfy`         | persistent | JSONL-RPC      |
| Claude    | `claude`        | oneshot    | stream-json    |
| Cursor    | `cursor-agent`  | oneshot    | stream-json    |
| OpenCode  | `opencode`      | oneshot    | json-stream    |
| VENOM     | `venom`         | oneshot    | stream-json    |
| Generic   | `any`           | oneshot    | text passthrough |

Adapters implement four methods: `buildArgs`, `formatInput`, `parseLine`, `detect`. Registry matches by binary name. Generic is the implicit fallback. Full contract in [docs/ADAPTERS.md](docs/ADAPTERS.md).

## What Plumb records

Every task leaves a trace. Append-only JSONL, one file per UTC day.

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"claude","message":"refactor auth","timestamp":"..."}
{"type":"task_running","taskId":"abc","timestamp":"..."}
{"type":"progress","taskId":"abc","text":"Looking at auth middleware...\n","timestamp":"..."}
{"type":"progress","taskId":"abc","text":"Found 3 violations\n","timestamp":"..."}
{"type":"thinking","taskId":"abc","text":"The middleware has a race condition in session refresh...","timestamp":"..."}
{"type":"task_completed","taskId":"abc","timestamp":"..."}
```

Never modified. Never deleted. Query with `jq` or DuckDB. Crash-survivable — a missing `task_completed` IS the crash signal.

```bash
# Failed tasks today
jq 'select(.type=="task_failed") | {taskId, error}' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl

# Reconstruct output for a task
jq -r 'select(.type=="progress" and .taskId=="<id>") | .text' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl

# Show thinking alongside output
jq 'select(.taskId=="<id>" and (.type=="thinking" or .type=="progress"))' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl
```

Full schema in [docs/LEDGER.md](docs/LEDGER.md).

## What Plumb refuses

```
❌ No dashboard      — health is a 200 or a 400, not a bar chart
❌ No orchestration  — Plumb routes by label, it doesn't decide
❌ No LLM            — transport layer, not intelligence layer
❌ No plugins        — adapter contract is the only extension point
❌ No memory         — the ledger records, it does not learn
❌ No supervision    — systemd handles process supervision
❌ No platform       — npm is the distribution, GitHub is the source
```

Each refusal protects a boundary. Full reasoning in [docs/soul/REFUSALS.md](docs/soul/REFUSALS.md).

## Architecture decisions — with honest edges

Every architecture decision is a bet. Plumb documents where each bet could be wrong.

| Decision | Choice | Honest edge |
|----------|--------|-------------|
| **Ledger** | Append-only JSONL, query with jq | No built-in query engine. Painful at 10K+ tasks/day without DuckDB. |
| **Runtime** | Bun | Smaller ecosystem, fewer production deployments. Locked in if Bun stalls. |
| **Streaming** | A2A + SSE | No delivery guarantees. Client can miss the final event. Ledger is the fallback. |
| **Delivery** | Fire-and-forget | No exactly-once. Slow consumers buffer in server memory. |
| **Config** | YAML plumb.yaml | YAML's footguns (anchors, type coercion, tabs). CI validates. |

Full ADRs with rationale and failure conditions in [DESIGN.md](DESIGN.md).

## Protocol surface

| Method | Path | Auth |
|--------|------|------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/.well-known/agent.json` | public (redirects to agent-card) |
| GET | `/health` | public |
| POST | `/a2a/jsonrpc` | Bearer (if configured) |
| * | `/a2a/rest` | Bearer (if configured) |

## Development

```bash
bun install                    # install dependencies
bun test                       # 101 tests, 0 expected failures
bun run typecheck              # TypeScript type checking
bun run src/main.ts wrap cat --port 3001  # run locally
```

## Project structure

```
src/
  types.ts             AdapterEvent, LedgerEvent, AgentAdapter contract
  cli.ts               plumb wrap, fleet validate/up/status
  main.ts              Entry point
  adapters/            8 adapter implementations + registry
  core/
    executor.ts        Task dispatch, event routing, ledger writes, INK validation
    process.ts         ProcessManager (oneshot) + PersistentProcess (RPC)
    server.ts          Express + @a2a-js/sdk, auth, Agent Card
    ledger.ts          Append-only JSONL, daily rotation
    task-store.ts      LRU + TTL bounded task memory
    session-store.ts   Cursor multi-turn session tracking
docs/
  DESIGN.md            Architecture Decision Records with honest edges
  ARCHITECTURE.md      Pipeline, layers, event flow, crash resilience
  ADAPTERS.md          Full adapter implementation guide
  LEDGER.md            Ledger schema and query patterns
  FLEET.md             Fleet config and lifecycle
  soul/                PACT, REFUSALS, EVOLUTION
```

## License

[MIT](./LICENSE)

---

*The plumb bob hangs true because gravity is not negotiable.*
*Plumb hangs true because the adapter contract is not negotiable.*
*Everything else is the operator's job.*
