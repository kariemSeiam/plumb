# plumb

*Quiet pipes for noisy agents.*

Plumb wraps CLI coding agents into [A2A](https://google.github.io/A2A/) HTTP servers.
It spawns subprocesses, reads stdout, writes JSONL, and exits.

One command. One ledger. Eight adapters. Zero dashboards.

---

## How it works

```
you ──→ POST /a2a/jsonrpc ──→ plumb ──→ claude (subprocess) ──→ stdout
                                           │
                                           ↓
                                      parseLine() → AdapterEvent[]
                                           │
                                     ┌─────┴──────┐
                                     ↓            ↓
                                  SSE stream   JSONL ledger
                                  (to you)     (on disk)
```

Plumb does not generate text. It does not decide. It does not remember.
It moves bytes from one process to another and records what happened.

---

## Try it

```bash
# Terminal 1 — start plumb
plumb wrap cat --port 3001

# Terminal 2 — send a task
curl -X POST http://localhost:3001/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "id": "demo",
      "message": {
        "role": "user",
        "parts": [{ "type": "text", "text": "Hello" }]
      }
    }
  }'
```

The SSE stream returns:

```
event: task_lifecycle_notification
data: {"kind":"task","id":"demo","status":{"state":"working"}}

event: artifact_update
data: {"kind":"artifact-update","artifact":{"parts":[{"type":"text","text":"Hello\n"}]}}

event: task_lifecycle_notification
data: {"kind":"message","id":"demo"}
```

The ledger records everything:

```bash
cat .plumb/ledger/$(date +%Y-%m-%d).jsonl | jq '.'
```

```jsonl
{"type":"task_submitted","taskId":"demo","cli":"cat","message":"Hello"}
{"type":"task_running","taskId":"demo"}
{"type":"progress","taskId":"demo","text":"Hello\n"}
{"type":"task_completed","taskId":"demo"}
```

---

## What plumb refuses

| Instead of | Plumb does | Why |
|-----------|------------|-----|
| A dashboard | Returns `200` or `400` | Health is binary. A chart adds nothing. |
| Orchestration | Routes by label | You decide which agent. Not Plumb. |
| An LLM | Spawns subprocesses | Transport layer. Not intelligence. |
| Plugins | One adapter contract | Changing it requires a commit and a test. |
| Memory | Records to a ledger | The ledger does not learn. SIPHON does. |
| Supervision | Runs tasks | systemd spawns and restarts. Plumb executes. |
| A platform | Ships on npm | GitHub is the source. No managed cloud. |

Each refusal protects a boundary. [Why →](docs/soul/REFUSALS.md)

---

## What plumb bets on

| Decision | Choice | Could fail when |
|----------|--------|----------------|
| Ledger | Append-only JSONL, `jq` to query | 10K+ tasks/day without DuckDB. Schema drift across versions. |
| Runtime | Bun | Ecosystem stalls. Node-only environments can't run it. |
| Streaming | A2A + SSE | Client disconnects miss final event. Ledger compensates. |
| Delivery | Fire-and-forget | No exactly-once. Slow consumers buffer in memory. |
| Config | YAML | Type coercion, anchors, tabs. CI catches most. |

Full ADRs with honest edges: [DESIGN.md](DESIGN.md)

---

## Fleet

```yaml
# plumb.yaml
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
plumb fleet validate   # check config
plumb fleet up         # boot all
plumb fleet status     # health check all
```

[Full reference →](docs/FLEET.md)

## Adapters

Eight protocol parsers, one contract.

| Adapter   | CLI             | Mode       | Protocol       |
|-----------|-----------------|------------|----------------|
| Echo      | `cat`           | oneshot    | text           |
| Pi        | `pi`            | persistent | JSONL-RPC      |
| Wolfy 🐺  | `wolfy`         | persistent | JSONL-RPC      |
| Claude    | `claude`        | oneshot    | stream-json    |
| Cursor    | `cursor-agent`  | oneshot    | stream-json    |
| OpenCode  | `opencode`      | oneshot    | json-stream    |
| VENOM     | `venom`         | oneshot    | stream-json    |
| Generic   | any             | oneshot    | text           |

Adapters implement `buildArgs`, `formatInput`, `parseLine`, `detect`.
The registry matches by binary name. Generic is the fallback.

[Contract →](docs/ADAPTERS.md)

## Surface

| Method | Path | Auth |
|--------|------|------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/.well-known/agent.json` | public (redirect) |
| GET | `/health` | public |
| POST | `/a2a/jsonrpc` | Bearer (if configured) |
| * | `/a2a/rest` | Bearer (if configured) |

## Setup

```bash
# Install
bun add -g plumb-bridge

# 101 tests, 0 fail
bun test

# Run locally
plumb wrap cat --port 3001
```

Requires Bun >= 1.1.0.

---

## Project

```
src/
  core/
    executor.ts        Task dispatch, INK validation, event routing, ledger
    process.ts         ProcessManager + PersistentProcess
    server.ts          Express + A2A SDK, auth, Agent Card
    ledger.ts          Append-only JSONL writer
    task-store.ts      LRU + TTL bounded task memory
    session-store.ts   Cursor multi-turn session tracking
  adapters/            8 adapters + binary registry
  types.ts             AdapterEvent, LedgerEvent, AgentAdapter
  cli.ts               plumb wrap, fleet commands
docs/
  DESIGN.md            Architecture Decision Records with honest edges
  ARCHITECTURE.md      Pipeline, layers, crash resilience
  ADAPTERS.md          Adapter implementation guide
  LEDGER.md            Schema and query patterns
  FLEET.md             Fleet config and lifecycle
  soul/                PACT, REFUSALS, EVOLUTION
```

---

*The plumb bob hangs true because gravity is not negotiable.*
*Plumb hangs true because the adapter contract is not negotiable.*
*The operator is the architect.*
*Everything else is the operator's job.*

MIT
