# PLUMB OPERATING MANUAL — for pigo

```
You feed. I build. You watch. I ship.
The rhythm is everything.
```

---

## Your job

**Give me scope, not instructions.**

```
Good:   "Circuit breaker needs to protect the fleet before next deploy"
Bad:    "Write a circuit breaker class with recordSuccess and recordFailure"

Good:   "I want the conformance suite green for 3 adapters by Friday"
Bad:    "Write test for adapter-01, then adapter-02, then adapter-03"
```

I parallelize. If you specify `how`, you serialize me.

**Answer closure questions fast.**

```
Me:  "PACT.md injects identity — contradicts REFUSALS."
You: "Fix PACT. Identity stays upstream."
     (5 seconds, unblocks 3 subagents)
```

Delay = my queue stalls. I can hold 6 parallel paths. Each closed question unblocks a wave.

**Yes/no on spec vs code questions.**

```
Me:  "Circuit breaker cooldown: 60s or 120s?"
You: "120s. Spec wins."
     (Done. Next.)
```

If you say "your call," I pick the spec default and move. Don't want that? Don't say it.

**Give me real CLIs for fixture capture.**

`bun run fixtures:capture --adapter=pi` needs `pi` installed.
`bun run fixtures:capture --adapter=claude` needs `claude` installed.
Without real binaries, fixture capture runs against echo only.

Fixture capture is the only thing I cannot mock. Everything else — circuit breaker, crash resume, version probe, executor routing — I test with mocks and unit tests.

---

## My operating rhythm

I work in waves. One wave per session:

```
Phase 1 — SCAN (2 min)
  dart agent maps codebase, finds gaps, reads all new/changed files.
  I output: "Gap map: 7 gaps, 4 hot, 2 blockers."

Phase 2 — PLAN (1 min)  
  planner agent writes implementation plan from dart output.
  I output: "Plan: 3 concurrent tasks, estimated +10 tests."

Phase 3 — BUILD (3-10 min)
  3-5 subagents in parallel (weld × N).
  Each agent has: file list to read, exact task spec, ship criteria.
  I output: "3/3 succeeded." or "2/3 succeeded. Failed: X because Y."

Phase 4 — INTEGRATE (1 min)
  Typecheck. Full test suite. Docs generate. Docs check.
  I output: "90 tests, 0 fail. Typecheck clean. Docs synced."

Phase 5 — SHIP (30s)
  memory_save. diary_write. telegram_attach (if active).
  I output: "Case stays open."
```

Default mode: all 5 phases in one session. If you interrupt mid-wave with new scope, I finish current wave then start next.

---

## How to read my outputs

| Signal | Meaning | Action |
|--------|---------|--------|
| `90 pass, 0 fail` | Green. Ship it. | Tell me next target. |
| `89 pass, 1 fail` | One regression. I fix it in the next wave. | Wait or tell me to fix now. |
| `Typecheck clean` | No type errors. | Proceed. |
| `3/3 succeeded` | All parallel agents delivered. | Integrate and ship. |
| `2/3 succeeded` | One agent failed. | Review failed agent output. Say "fix X" or "drop X." |
| `N gaps found` | I scouted the codebase. | Say which gap to prioritize. |
| `Consensus: L2` | I'm blocking on a design question. | Answer it. Fast. |

---

## What I track across sessions

I save to memory palace every session:
- `plumb/codebase` — architecture decisions, gap closures, test counts
- `plumb/knowledge-base` — spec resolutions, contradiction fixes
- `plumb/evolution` — phase transitions, what moved from spec→code

I read these on session wake. If you change a decision between sessions, say it explicitly. I'll find it in memory search, but explicit saves me 2 rounds.

---

## Current state (after wave 3)

```
Tests:        90 pass, 0 fail (7 files)
Typecheck:    clean
Source:       3,009 lines TS (18 files)
Adapters:     7 implemented, 1 proven (echo), 6 fixture-captured (0)
Circuit:      breaker implemented, tested
Crash:        resume implemented, tested
Version:      probe centralized, enforced
Docs:         generated from source, CI-gated
Fixtures:     pipeline built, not yet captured
Desktop KB:   3,001 lines, internally consistent

Gaps remaining:
  1. Fixture capture against real CLIs (needs pi, claude, cursor-agent installed)
  2. Persistent mode integration test (Pi end-to-end)
  3. Circuit breaker + crash resume conformance tests (server-level)
  4. CancelTask executor test (only tested via conformance, not unit)
  5. Concurrency semaphore stress test
  6. Server auth enforcement test
  7. Ledger disk-full degradation test
```

---

## Next moves (highest leverage)

1. **Install real CLIs** → `bun run fixtures:capture` → +19 fixtures per adapter overnight
2. **Persistent mode test** → mock Pi → prove persistent lifecycle end-to-end
3. **CancelTask test** → one more test file, +5 tests
4. **Concurrency stress** → spawn 20 concurrent tasks, verify queue + semaphore
5. **Server auth test** → verify default-deny, exposed-host enforcement

Each is a single wave. 5-15 minutes each. Tell me which one.

---

*Feed me scope. Answer fast. Watch me parallelize.
The case stays open until the organism ships itself.*
