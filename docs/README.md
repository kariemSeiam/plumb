# PLUMB — Documentation

Architecture, contracts, and operational reference for the bridge.

---

## Architecture

```
Orchestrator → HTTP/JSON-RPC → PlumbServer
                                     │
                               PlumbExecutor
                                     │
                              spawn subprocess
                                     │
                            write formatInput → stdin
                                     │
                              read stdout lines
                                     │
                            AgentAdapter.parseLine
                                     │
                            [FangPostParse hook]
                                     │
                              handleEvents
                               ├── text-delta  → ledger: progress    + A2A: artifact-update
                               ├── tool-call   → ledger: progress    + A2A: artifact-update
                               ├── tool-result → ledger: progress    + A2A: artifact-update
                               ├── completed   → ledger: task_completed + A2A: message + finished
                               └── error       → ledger: task_failed  + A2A: status(failed) + finished
```

**Eight adapters.** Registry order: Echo → Pi → Wolfy → Claude → Cursor → OpenCode → VENOM → Generic (implicit fallback).

**Two process modes.** Oneshot: new subprocess per task. Persistent: one long-lived process, serial task queue.

**One ledger.** Append-only JSONL in `.plumb/ledger/YYYY-MM-DD.jsonl`. Written before the A2A bus event. Crash-survivable.

---

## Files

| File | Purpose | Audience |
|------|---------|---------|
| `../README.md` | Install, quick start, adapter table | Everyone |
| `../SPEC.md` | Living technical contract — what exists, what's stable | Engineers |
| `../AGENTS.md` | Operating brief for AI agents working in this repo | AI agents |
| `../DESIGN.md` | Design system — colors, typography, components | Contributors |
| `ARCHITECTURE.md` | Pipeline, layers, event flow, process modes | Engineers |
| `ADAPTERS.md` | Adapter contract, event types, tiers, how to build one | Adapter authors |
| `LEDGER.md` | Schema, guarantees, jq query reference | Operators |
| `FLEET.md` | plumb.yaml schema, fleet commands, systemd integration | Operators |
| `MANIFEST.md` | What Plumb IS and IS NOT | Everyone |
| `PLUMB-INFINITY.md` | Five fang classes, pipeline vision, recovery, symmetry | Engineers |
| `ROADMAP.md` | Current state, Phase 3 priorities, deferred work | Engineers |
| `WOLFY-MESH-PORT.md` | Wolfy — two interfaces, persistent memory, Pact, status | Integrators |
| `TWO-AGENT-ORCHESTRATION.md` | Wolfy + Cursor nervous system, model routing, patterns | Orchestrators |
| `VENOM-PLUMB-OPERATIONS.md` | VENOM∞ ↔ Plumb operations architecture | VENOM operators |
| `∞.md` | Version roadmap and the afterlife | Everyone |
| `workspace.md` | AI session quick-reference — crew, commands, memory tiers | AI agents |
| `sessions/ARCH-001.md` | Architecture discussion transcript (2026-05-19) | Historical |
| `../systemd/CUTOVER.md` | Fang → Plumb fleet cutover procedure | Operators |

---

## By Role

**I want to wrap a CLI in A2A:**
`../README.md` → `FLEET.md` → `../systemd/CUTOVER.md`

**I want to build an adapter:**
`ADAPTERS.md` → `../src/types.ts` → `../test/adapter-parse.test.ts`

**I want to understand the full architecture:**
`ARCHITECTURE.md` → `../src/core/executor.ts`

**I want to query the ledger:**
`LEDGER.md`

**I want to operate the production fleet:**
`FLEET.md` → `OPERATING.md` → `../systemd/CUTOVER.md`

**I want to understand VENOM integration:**
`VENOM-PLUMB-OPERATIONS.md` → `PLUMB-INFINITY.md`

**I want to understand Wolfy:**
`WOLFY-MESH-PORT.md` → `TWO-AGENT-ORCHESTRATION.md`

**I am an AI agent starting a session:**
`../AGENTS.md` → `../MANIFEST.yaml` → `workspace.md`

---

*The plumb bob hangs true because gravity is not negotiable. The docs hang true for the same reason.*
