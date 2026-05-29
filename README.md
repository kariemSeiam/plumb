# plumb

*Quiet pipes for noisy agents.*

Plumb wraps CLI coding agents as [A2A](https://google.github.io/A2A/) HTTP servers.
It has no LLM, no memory, no orchestration.
It spawns processes, reads stdout, writes JSONL, and exits.

One command. One ledger. Eight adapters. Zero dashboards.

```bash
plumb wrap claude --port 3000
```

Your CLI agent is now an A2A-compliant server.

---

## What that command does

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

Plumb reads `stdout`, parses it into events, streams them to your client via SSE, and writes every event to an append-only JSONL ledger. That's the entire pipeline.

---

## Try it in 60 seconds

```bash
# Terminal 1 — start a Plumb server
plumb wrap cat --port 3001

# Terminal 2 — send a task
curl -X POST http://localhost:3001/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tasks/send",
    "params": {
      "id": "demo",
      "message": { "role": "user", "parts": [{ "type": "text", "text": "Hello" }] }
    }
  }'
```

The SSE stream returns three events: `task` (working), `artifact-update` (the response), and the final `message`. The ledger records all of them.

```bash
# Read the ledger
cat .plumb/ledger/$(date +%Y-%m-%d).jsonl | jq '.'
```

---

## Fleet mode

Define your agents in `plumb.yaml`:

```yaml
version: "1"
agents:
  - id: claude
    cli: claude
    port: 3000
  - id: cursor
    cli: cursor-agent --print
    port: 3003
```

```bash
plumb fleet validate   # check config
plumb fleet up         # boot all agents
plumb fleet status     # health check all
```

Full schema: [docs/FLEET.md](./docs/FLEET.md)

## Adapters

Eight protocol parsers, one contract:

```typescript
interface AgentAdapter {
  buildArgs(task, config): string[]
  formatInput(task): string
  parseLine(line): AdapterEvent[]
  detect(): DetectionResult | null
}
```

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

Full contract: [docs/ADAPTERS.md](./docs/ADAPTERS.md)

---

## What Plumb refuses

| Refusal | Why |
|---------|-----|
| No dashboard | Health is `200` or `400`. A bar chart adds nothing. |
| No orchestration | You decide which agent. Plumb routes by label. |
| No LLM | Transport layer. Not intelligence layer. |
| No plugins | Adapter contract is the only extension point. |
| No memory | The ledger records. It does not learn. |
| No supervision | systemd does it better. |
| No platform | npm is the distribution. GitHub is the source. |

Each refusal is a wall that keeps the pipe from leaking into places it doesn't belong. [docs/soul/REFUSALS.md](./docs/soul/REFUSALS.md)

---

## The ledger

Every task leaves a trace. Append-only JSONL, one file per UTC day.

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"claude","message":"refactor auth"}
{"type":"task_running","taskId":"abc"}
{"type":"progress","taskId":"abc","text":"Looking at auth middleware...\n"}
{"type":"thinking","taskId":"abc","text":"Session refresh has a race condition..."}
{"type":"progress","taskId":"abc","text":"Found 3 violations\n"}
{"type":"task_completed","taskId":"abc"}
```

Never modified. Never deleted by Plumb. Crash-survivable — a missing `task_completed` IS the crash signal.

```bash
# Failed tasks today
jq 'select(.type=="task_failed") | {taskId, error}' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl

# Show thinking alongside output for a task
jq 'select(.taskId=="abc" and (.type=="thinking" or .type=="progress")) | .text' \
  .plumb/ledger/$(date +%Y-%m-%d).jsonl
```

Full schema: [docs/LEDGER.md](./docs/LEDGER.md)

---

## Architecture decisions — honest edges

Every choice is a bet. Here is where each bet could fail.

| Decision | Choice | Could fail when |
|----------|--------|----------------|
| Ledger | Append-only JSONL, query with jq | 10K+ tasks/day without DuckDB. No schema version — old and new entries mix. |
| Runtime | Bun | Smaller ecosystem, fewer deployments. Locked in if Bun stalls. |
| Streaming | A2A + SSE | No delivery guarantees. Client can miss final event. |
| Delivery | Fire-and-forget | Slow consumers buffer in memory. No exactly-once. |
| Config | YAML | YAML footguns (anchors, type coercion). CI validates. |

Full ADRs: [DESIGN.md](./DESIGN.md)

---

## Protocol surface

| Method | Path | Auth |
|--------|------|------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/.well-known/agent.json` | public (redirect) |
| GET | `/health` | public |
| POST | `/a2a/jsonrpc` | Bearer (if configured) |
| * | `/a2a/rest` | Bearer (if configured) |

---

## Development

```bash
bun install          # dependencies
bun test             # 101 tests, 0 fail
bun run typecheck    # TypeScript
plumb wrap cat --port 3001  # local test
```

## Install

```bash
bun add -g plumb-bridge
```

Requires Bun >= 1.1.0.

---

## Project

```
src/
  types.ts             AdapterEvent, LedgerEvent, AgentAdapter contract
  cli.ts               plumb wrap, fleet commands
  adapters/            8 adapters + binary registry
  core/
    executor.ts        Task dispatch, event routing, ledger, INK validation
    process.ts         ProcessManager + PersistentProcess
    server.ts          Express + A2A SDK, auth, Agent Card
    ledger.ts          Append-only JSONL
    task-store.ts      LRU + TTL task memory
    session-store.ts   Cursor multi-turn sessions
docs/
  DESIGN.md            ADRs with honest edges
  ARCHITECTURE.md      Pipeline, layers, crash resilience
  ADAPTERS.md          Adapter implementation guide
  LEDGER.md            Schema and query patterns
  FLEET.md             Fleet config
  soul/                PACT, REFUSALS, EVOLUTION
```

---

*The plumb bob hangs true because gravity is not negotiable.*
*Plumb hangs true because the adapter contract is not negotiable.*
*The operator is the architect.*
*Everything else is the operator's job.*

MIT
