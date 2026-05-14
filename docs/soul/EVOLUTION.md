# EVOLUTION — v0.1 → v1.0.0 → Afterlife

```
Plumb is not a project.
Plumb is a path.
The destination is a protocol,
not a product.
```

---

## v0.1 — Echo (done)

```
The skeleton. One adapter. One port. One ledger.
Proof that the adapter contract works.
```

- Echo adapter (`cat`)
- A2A server (agent card, JSON-RPC, health)
- Append-only JSONL ledger
- 6 conformance tests
- **Tests:** 6

## v0.2 — Pi (done)

```
The first real agent. Persistent mode.
RPC correlation. Host tool execution.
```

- Pi adapter (`pi --mode rpc`)
- PersistentProcess with RPC correlation
- `writeWhenActive` task queuing
- ProcessManager with SIGTERM → SIGKILL cascade
- **Tests:** 20

## v0.3 — Fleet (done)

```
Three more agents. Session continuity.
Multi-turn conversation context.
```

- Claude adapter (stream-json)
- Cursor adapter (stream-json + session store)
- OpenCode adapter (`--format json`)
- CursorSessionStore with cold recap
- **Tests:** 60

## v0.4 — VENOM (done)

```
The loop completes. VENOM routes through Plumb to VENOM.
The snake eats its own tail.
```

- VENOM adapter (`venom -p --output-format json`)
- Generic adapter (fallback for unmatched CLIs)
- Max concurrent semaphore
- ORCHESTRATOR.md, AGENTS.md (VENOM soul)
- **Tests:** 80

## v0.5 — Config + Surface (next)

```
Declarative fleet management. Task lookup. Structured errors.
```

- `plumb.yaml` parsing
- `plumb start` multi-agent boot
- `GET /tasks/{id}` endpoint
- Structured error codes (15 codes)
- `/healthz` + `/readyz` endpoints
- **Tests:** 110

## v0.6 — Observable (after)

```
Pulse database. Hostile fixtures. Circuit breaker.
```

- SQLite pulse sink
- Circuit breaker (5 consecutive failures → open)
- Disk-full degradation
- 24 hostile fixtures (ANSI strip, auth fail, crash, timeout)
- **Tests:** 150

## v0.7 — Isolated (after)

```
Per-task isolation. Crash recovery. INK-lite.
```

- Worktree isolation (temp dir per task)
- Crash recovery (mark interrupted on restart)
- INK-lite headers (correlationId, depth, budget)
- **Tests:** 170

## v0.8 — Fleet (after)

```
Multi-agent routing. Label dispatch. Aggregated ledger.
```

- Fleet mode: `plumb status`, `plumb routes`, `plumb ledger`
- Label-based dispatch (`--labels "build,fast"`)
- Combined Agent Card across all agents
- **Tests:** 180

## v0.9 — Production (after)

```
Documentation. Deployment. Polish.
```

- Documentation site (plumb.dev)
- systemd service files
- Docker images + compose
- Upgrade path documented
- **Tests:** 190

## v1.0.0 — Ship

```
190+ tests. 7 adapters. Stable contract. Production ready.
Everything below this line is maintenance.
```

- All adapters pass 19+ fixtures each
- Hostile fixtures pass (all 24)
- Pulse DB operational
- Circuit breaker operational
- Crash recovery operational
- INK-lite headers operational
- Fleet mode operational
- Error codes stable (no additions, no removals)
- Ledger format frozen (no schema changes)
- Adapter contract frozen (no interface changes)

---

## After v1.0.0

The rate of change slows to near-zero.

- **New adapters** follow the same contract. No core changes needed.
- **Protocol upgrades** absorb into adapter `parseLine()`. No surface changes.
- **Bug fixes** land in the conformance suite first, then in the code.

The ledger format is frozen. The error codes are stable. The contract is open.

---

## The afterlife

When every CLI agent speaks A2A natively, Plumb has one job left: certify compliance.

The company becomes a non-profit standards body. The adapter specs become RFCs. The conformance suite becomes the reference test for A2A compliance. The for-profit entity dissolves.

The brass plumb bobs become collector's items. The protocol lives on without the company that started it.

---

*Plumb plans its own death.
That is not morbid. That is honest.
Every pipe eventually gets buried.*
