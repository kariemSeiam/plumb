# plumb

*Quiet pipes for noisy agents.*

Plumb wraps CLI coding agents into [A2A](https://google.github.io/A2A/) HTTP servers.
It spawns subprocesses, reads stdout, writes JSONL, and exits.
That is the entire pipeline. Nothing else.

One command. One ledger. Eight adapters. Zero dashboards.

---

## Why

Every AI agent has a CLI. Claude has `claude --print`. Cursor has `cursor-agent`. Pi has `pi`. Wolfy has `wolfy`. They all read from stdin, write to stdout, and speak different protocols.

Plumb is the adapter layer that makes them interchangeable. One A2A endpoint. One ledger format. Eight protocol parsers. The orchestration — which agent, what task, when — is yours.

---

## How

```
you ──→ POST /a2a/jsonrpc ──→ Plumb ──→ claude (subprocess) ──→ stdout
                                          │
                                          ↓
                                     parseLine() → AdapterEvent[]
                                          │
                                    ┌─────┴──────┐
                                    ↓            ↓
                                 SSE stream   JSONL ledger
                                 (to you)     (on disk)
```

Plumb does not generate text. It does not decide. It does not remember. It moves bytes from one process to another and records what happened.

---

## Try

```bash
# Terminal 1
plumb wrap cat --port 3001

# Terminal 2
curl -X POST http://localhost:3001/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "message/send",
    "params": {
      "id": "demo",
      "message": { "role": "user", "parts": [{ "type": "text", "text": "Hello" }] }
    }
  }'

# See the ledger
cat .plumb/ledger/$(date +%Y-%m-%d).jsonl | jq '.'
```

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

---

## Adapters

Eight protocol parsers, one contract. Adapters implement `buildArgs`, `formatInput`, `parseLine`, `detect`. The registry matches by binary name. Generic is the fallback.

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

[Full contract →](docs/ADAPTERS.md)

---

## The ledger

Every event, every task, every completion — appended to `.plumb/ledger/YYYY-MM-DD.jsonl`. Never modified. Never deleted by Plumb. Crash-survivable — a missing `task_completed` IS the crash signal.

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"claude","message":"refactor auth"}
{"type":"task_running","taskId":"abc"}
{"type":"progress","taskId":"abc","text":"Looking at auth middleware...\n"}
{"type":"thinking","taskId":"abc","text":"Session refresh has a race condition..."}
{"type":"progress","taskId":"abc","text":"Found 3 violations\n"}
{"type":"task_completed","taskId":"abc"}
```

```bash
# Failed tasks today
jq 'select(.type=="task_failed") | {taskId, error}' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl

# Show thinking alongside output
jq 'select(.taskId=="abc" and (.type=="thinking" or .type=="progress")) | .text' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl
```

[Full schema →](docs/LEDGER.md)

---

## What Plumb refuses — and why

These are not limitations. They are walls that keep the pipe from leaking.

| Refusal | Why |
|---------|-----|
| **No dashboard** | Health is `200` or `400`. A bar chart adds nothing. |
| **No orchestration** | You route by label. Plumb does not decide which agent deserves a task. |
| **No LLM** | Transport layer. Not intelligence layer. Plumb doesn't call model APIs. |
| **No plugins** | The adapter contract is the only extension point. Changing it requires a commit and a test. |
| **No memory** | The ledger records. It does not learn, summarize, or cross-reference. SIPHON does that. |
| **No supervision** | systemd spawns processes. Plumb executes tasks. systemd restarts on crash. Plumb does not. |
| **No platform** | npm is the distribution. GitHub is the source. There is no managed cloud. |

Each refusal protects a boundary. Full reasoning in [docs/soul/REFUSALS.md](docs/soul/REFUSALS.md).

---

## Architecture bets — and their honest edges

Every architecture decision is a bet. These are the failure conditions of each bet.

| Decision | Choice | Could fail when |
|----------|--------|----------------|
| **Ledger** | Append-only JSONL, query with jq | 10K+ tasks/day without DuckDB becomes slow. No schema version in file — old and new entries mix. |
| **Runtime** | Bun | Smaller ecosystem than Node. Locked in if Bun's development stalls. |
| **Streaming** | A2A + SSE | SSE has no delivery guarantees. Client can miss the final event. Ledger is the fallback. |
| **Delivery** | Fire-and-forget | No exactly-once. Slow consumers buffer in server memory. |
| **Config** | YAML plumb.yaml | YAML's footguns (anchors, type coercion, tabs). CI validates on commit. |

Full ADRs with rationale and mitigations in [DESIGN.md](DESIGN.md).

---

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

# Run tests
bun test             # 101 pass, 0 fail
bun run typecheck    # TypeScript

# Run locally
plumb wrap cat --port 3001
```

Requires Bun >= 1.1.0.

---

## Project

```
src/
  types.ts             AdapterEvent, LedgerEvent, AgentAdapter
  cli.ts               plumb wrap, fleet commands
  adapters/            8 adapters + binary registry
  core/
    executor.ts        Task dispatch, INK validation, event routing, ledger
    process.ts         ProcessManager + PersistentProcess
    server.ts          Express + A2A SDK, auth, Agent Card
    ledger.ts          Append-only JSONL writer
    task-store.ts      LRU + TTL bounded task memory
    session-store.ts   Cursor multi-turn session tracking
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
