```
   ____  _                 _
  |  _ \| |_   _ _ __ ___ | |__
  | |_) | | | | | '_ ` _ \| '_ \
  |  __/| | |_| | | | | | | |_) |
  |_|   |_|\__,_|_| |_| |_|_.__/
```

**Quiet pipes for noisy agents.**

[![CI](https://github.com/kariemSeiam/plumb/actions/workflows/ci.yml/badge.svg)](https://github.com/kariemSeiam/plumb/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/plumb-bridge)](https://www.npmjs.com/package/plumb-bridge)
[![License: MIT](https://img.shields.io/badge/License-MIT-brass.svg)](./LICENSE)

---

Plumb wraps any CLI coding agent into an [A2A](https://google.github.io/A2A/)-compliant HTTP server in one command.

```
Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → stream parse → A2A events
```

## Install

```bash
bun add -g plumb-bridge
```

Requires [Bun](https://bun.sh) >= 1.1.0.

## Quick Start

```bash
# Wrap any CLI as an A2A agent
plumb wrap cat --port 3001              # Echo (conformance gate)
plumb wrap "pi --mode rpc" --port 3002 # Pi (persistent JSONL-RPC)
plumb wrap claude --port 3000           # Claude Code (stream-json)
plumb wrap cursor-agent --port 3003     # Cursor (stream-json)
plumb wrap opencode --port 3002         # OpenCode (json-stream)
plumb wrap venom --port 3004            # VENOM (stream-json)
plumb wrap wolfy --port 3007            # Wolfy (persistent, PI_CODING_AGENT_DIR)
plumb wrap "./my-tool" --port 3005      # Generic (any CLI)
```

Once running:

```bash
# Agent Card (public, unauthenticated)
curl http://localhost:3001/.well-known/agent-card.json

# Health check
curl http://localhost:3001/health

# Send a task via JSON-RPC
curl -X POST http://localhost:3001/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "msg-001",
        "role": "user",
        "parts": [{ "kind": "text", "text": "Hello from Plumb" }]
      }
    },
    "id": "req-1"
  }'
```

## Fleet Mode

Define multiple agents in `plumb.yaml`:

```yaml
version: "1"
agents:
  - id: pi
    cli: pi
    port: 3001
    mode: persistent
  - id: claude
    cli: claude
    port: 3002
  - id: cursor
    cli: cursor-agent --print
    port: 3003
```

```bash
plumb fleet validate          # Check config
plumb fleet up                # Boot all agents
plumb fleet status            # Health check all
```

## Adapters

| Adapter   | CLI             | Mode       | Tier | Protocol     |
|-----------|-----------------|------------|------|--------------|
| Echo      | `cat`           | oneshot    | 1    | text         |
| Pi        | `pi`            | persistent | 1    | jsonl-rpc    |
| Wolfy 🐺  | `wolfy`         | persistent | 1    | jsonl-rpc    |
| Claude    | `claude`        | oneshot    | 1    | stream-json  |
| Cursor    | `cursor-agent`  | oneshot    | 1    | stream-json  |
| OpenCode  | `opencode`      | oneshot    | 2    | json-stream  |
| VENOM     | `venom`         | oneshot    | 3    | stream-json  |
| Generic   | any             | oneshot    | 3    | text         |

Adapters implement one interface: `buildArgs`, `formatInput`, `parseLine`, `detect`. Registry matches by binary name. Generic is the implicit fallback.

## Auth

```bash
plumb wrap claude --port 3003 --key my-secret-token
```

When `--key` is set, `/a2a/*` endpoints require `Authorization: Bearer <key>`. Agent Card and health remain public per A2A spec.

## Ledger

Every task lifecycle event is appended to `.plumb/ledger/{YYYY-MM-DD}.jsonl`:

```jsonl
{"type":"task_submitted","taskId":"abc","cli":"cat","message":"hello","timestamp":"..."}
{"type":"task_running","taskId":"abc","timestamp":"..."}
{"type":"progress","taskId":"abc","text":"hello\n","timestamp":"..."}
{"type":"task_completed","taskId":"abc","timestamp":"..."}
```

Append-only. Never modified. Query with `jq`. Crash-survivable.

## Architecture

```
src/
  types.ts           Core interfaces (AgentTask, AdapterEvent, AgentAdapter, LedgerEvent)
  cli.ts             CLI: plumb wrap <cli> --port <n>, fleet commands
  main.ts            Entry point
  adapters/
    stream-json.ts   Shared parseLine utilities
    echo.ts          EchoAdapter (cat) — conformance gate
    pi.ts            PiAdapter — persistent JSONL-RPC
    claude.ts        ClaudeAdapter — stream-json
    cursor.ts        CursorAdapter — stream-json + session tracking
    opencode.ts      OpenCodeAdapter — json-stream
    venom.ts         VenomAdapter — stream-json
    wolfy.ts         WolfyAdapter — persistent JSONL-RPC, PI_CODING_AGENT_DIR
    generic.ts       GenericAdapter — text passthrough
    registry.ts      detectAdapter() — binary matching
  core/
    ledger.ts        Append-only JSONL
    process.ts       ProcessManager + PersistentProcess
    executor.ts      PlumbExecutor (A2A AgentExecutor)
    server.ts        Express + @a2a-js/sdk
    task-store.ts    LRU + TTL bounded task store
    session-store.ts Cursor multi-turn session tracking
```

## Development

```bash
bun install                    # Install dependencies
bun test                       # Run all tests (90 tests)
bun run typecheck              # TypeScript type checking
bun run src/main.ts wrap cat --port 3001  # Run locally
```

## Protocol Surface

| Method | Path | Auth |
|--------|------|------|
| GET | `/.well-known/agent-card.json` | public |
| GET | `/health` | public |
| POST | `/a2a/jsonrpc` | Bearer (if configured) |
| * | `/a2a/rest` | Bearer (if configured) |

## License

[MIT](./LICENSE)

---

*The plumb bob hangs true because gravity is not negotiable. The protocol gap is not negotiable either.*
