# ROADMAP

---

## Current State

**Phase 2, Wave 2 — complete.**

```
Tests:     90 pass, 0 fail (7 test files, 156 assertions)
Typecheck: clean
Source:    ~3,000 lines TypeScript across 18 files
Adapters:  8 shipped (Echo, Pi, Wolfy, Claude, Cursor, OpenCode, VENOM, Generic)
Fleet:     plumb.yaml + fleet validate/up/status
npm:       plumb-bridge@0.1.2 published
```

**Shipped:**
- Core: executor, process manager, persistent process, server, task store, session store, ledger
- Adapters: all 8, including Wolfy (Pi dialect) and shared stream-json utilities
- Fleet: FleetConfig, YAML parsing, CLI commands
- FangPostParse hook
- 90 tests across 7 files

**Production fleet (live):**
- 3001: Pi (persistent, tier 1) — Plumb ✅
- 3003: Cursor (oneshot, tier 1) — Plumb ✅
- 3007: Wolfy (persistent, tier 1) — Plumb ✅
- 3000: Claude — pending Fang → Plumb cutover
- 3002: OpenCode — pending Fang → Plumb cutover
- 3004: VENOM — pending Fang → Plumb cutover

---

## Phase 3 Priorities

### P0 — Stable core

| Item | Acceptance |
|------|-----------|
| CancelTask unit test | `cancelTask` tested in isolation, not only via conformance |
| Concurrency semaphore stress | 20 simultaneous tasks → correct queue behavior, no leaks |
| Server auth enforcement | Default-deny verified; exposed-host enforcement tested |
| Ledger disk-full degradation | Write failure is non-fatal; task completes, stderr gets the error |

### P1 — Real agent fixtures

| Item | Acceptance |
|------|-----------|
| Pi fixture capture | 19+ golden fixtures against real `pi` binary |
| Claude fixture capture | 19+ golden fixtures against real `claude` binary |
| Persistent mode integration test | End-to-end: spawn Pi, send task, confirm lifecycle, crash recovery |

### P2 — Architecture

| Item | Acceptance |
|------|-----------|
| Fang: Ingress | Pre-parseLine hook wired and tested |
| Fang: Ledger Observer | Every LedgerEvent triggers observer; WAL prototype |
| Runtime discovery | `GET /a2a/agents` returns live fleet topology |
| Intent log | Separate accept-log ahead of ledger for crash resume |

### P3 — Autonomous operation

| Item | Acceptance |
|------|-----------|
| Fang: Recovery | On restart, scan ledger, mark interrupted tasks |
| SIPHON bridge | `venom_digest.jsonl` correlation with `correlation_id` |
| Daily drift job | Systemd timer checks fixture freshness, reports via ledger |

---

## Deferred (Not Next)

These are explicitly not Phase 3:

- **Dashboard** — the villain. Logs are the UI. Health endpoint is the interface.
- **Hot-reload adapters** — adapters are code, not plugins. Change = PR + test run.
- **Plumb-owned LLM memory** — the ledger records; SIPHON reads. Plumb does not think.
- **Multi-tenant** — one Plumb instance, one operator. Not a platform.
- **Orchestration built into Plumb** — VENOM orchestrates. Plumb transports.

---

## Principles

1. **Unstable base before new work.** If tests are red or typecheck fails, fix first.
2. **Spec default on design forks.** MANIFEST.yaml is the tie-breaker.
3. **Fixtures prove real behavior.** Mocks prove the bridge; fixtures prove the contract.
4. **The conformance gate never regresses.** `bun test test/conformance.test.ts` must stay green.
5. **Ledger is append-only.** Any code that opens a ledger file for writing uses `appendFileSync`. Never `writeFileSync`.

---

*Work top-down. P0 before P1. P3 does not block on P0.*
