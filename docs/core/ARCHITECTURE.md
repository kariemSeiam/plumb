# ARCHITECTURE — How It Works

```
┌────────────────────────────────────────────────────────────┐
│                       ORCHESTRATOR                          │
│               (VENOM∞, any A2A client)                      │
│                                                            │
│  POST /a2a/jsonrpc  ─────────────┐                         │
│  { "message": "refactor auth" }  │                         │
└──────────────────────────────────│─────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────┐
│                      PLUMB BRIDGE                           │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. Parse INK-lite headers                            │  │
│  │     → correlationId, depth, labels, budget, deadline  │  │
│  │     → Validate: depth ≤ 4, deadline valid, budget ok  │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  2. Route by labels (or direct agent)                 │  │
│  │     → match ["build","fast"] → cursor (port 3003)    │  │
│  │     → check circuit breaker — skip if open           │  │
│  │     → check concurrency slot                          │  │
│  │     → queue or reject if full                         │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  3. Spawn subprocess                                 │  │
│  │     → child_process.spawn(adapter.buildArgs())       │  │
│  │     → write stdin from adapter.formatInput()         │  │
│  │     → start timer (configurable timeout)             │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  4. Read stdout, line by line                         │  │
│  │     → adapter.parseLine(line) → AdapterEvent[]        │  │
│  │     → adapter.isComplete(events)? → finalize          │  │
│  │     → text-delta → publish to SSE + append to ledger  │  │
│  │     → adapter.extractOutput(events) → final output    │  │
│  └────────────────────┬─────────────────────────────────┘  │
│                       │                                     │
│  ┌────────────────────▼─────────────────────────────────┐  │
│  │  5. Emit lifecycle events                            │  │
│  │     → task_submitted → task_running → progress × N   │  │
│  │     → task_completed | task_failed | task_cancelled   │  │
│  │     → write to JSONL ledger                          │  │
│  │     → close SSE stream                               │  │
│  │     → if success → circuit breaker.recordSuccess()   │  │
│  │     → if failure → circuit breaker.recordFailure()   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## Boot sequence (5 phases)

```
1. Load config from plumb.yaml or CLI args
2. Probe upstream CLI binary (which, --version)
3. Check version against knownGood list — warn if unknown, refuse if knownBad
4. Initialize ledger (create dir if needed, verify write access)
5. Start Express server → emit /healthz ok
6. Run crash resume: scan ledger for running tasks, mark interrupted
7. Accept new tasks
```

---

## Two modes

### Oneshot

One process per task. Spawn, inject, read, exit, clean. The simplest possible lifecycle. Used by: Claude, Cursor, OpenCode, VENOM, Echo, Generic.

```
TASK 1 ──→ spawn("claude --print") ──→ stdin ──→ stdout ──→ exit
TASK 2 ──→ spawn("claude --print") ──→ stdin ──→ stdout ──→ exit
```

Pros: Clean isolation. No state leakage. Maximum crash survival.
Cons: Startup cost per task (~1-2s for agent init).

### Persistent

One long-lived process. Tasks multiplexed via RPC correlation. Used by: Pi.

```
           ┌── TASK 1 ──→ { "method": "prompt", ... }
           │
spawn("pi --mode rpc") ──┼── TASK 2 ──→ { "method": "prompt", ... }
           │
           └── TASK 3 ──→ { "method": "prompt", ... }
```

Pros: Zero startup cost per task. Session continuity across tasks.
Cons: State leaks if agent crashes. One process must handle all.

---

## Concurrency gate

```
┌────────────────────────────────┐
│         MAX CONCURRENT         │  ← configurable, default 4
│                                │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐
│  │ T1 │  │ T2 │  │ T3 │  │ T4 │  ← active processes
│  └────┘  └────┘  └────┘  └────┘
│                                │
│  ┌────┐  ┌────┐               │
│  │ T5 │  │ T6 │               │  ← queued, waiting for slot
│  └────┘  └────┘               │
└────────────────────────────────┘
```

When a slot opens, the next task in queue spawns. If queue exceeds configurable max (default 100), new tasks are rejected with `SERVER_OVERLOAD`.

Persistent mode ignores the concurrency gate — one process handles all tasks sequentially.

---

## Circuit breaker

Per-adapter circuit breaker that protects against flap-prone agents.

```
State machine:
  CLOSED ── [N failures in W window] → OPEN
  OPEN   ── [cooldown elapsed] → HALF-OPEN
  HALF-OPEN ── [success] → CLOSED
  HALF-OPEN ── [failure] → OPEN  (full cooldown again)
```

| Config | Default | Description |
|--------|---------|-------------|
| `failureThreshold` | 5 | Consecutive failures before opening |
| `windowMs` | 60000 | Rolling window for failure counting |
| `cooldownMs` | 120000 | Time before transitioning to half-open |

Which errors count:
- `CLI_RUNTIME_ERROR`, `CLI_TIMEOUT`, `CLI_KILLED`, `ADAPTER_PARSE_ERROR` → count toward breaker
- `TASK_CANCELLED`, `INK_*` validation errors → do NOT count (caller's fault)

When breaker is open:
- Tasks are NOT routed to that agent
- `/readyz` reports agent as degraded
- After cooldown, one probe task is admitted (half-open)
- If probe succeeds → breaker closes. If fails → breaker reopens.

---

## Crash resilience

```
WHAT HAPPENS                          PLUMB'S RESPONSE
────────────────────────────────────────────────────────────
Subprocess exits with code 0          → task_completed
Subprocess exits with code non-zero   → task_failed (CLI_RUNTIME_ERROR)
Subprocess hangs past timeout         → SIGTERM → 5s → SIGKILL
                                      → task_failed (CLI_TIMEOUT)
Server receives SIGTERM (deploy)      → Kill all subprocesses
                                      → Mark running tasks as
                                        task_failed (TASK_INTERRUPTED)
Server crashes (OOM, bug)             → Ledger has running tasks
                                      → On restart: scan ledger, mark
                                        running tasks as interrupted
                                      → ledger intact, queryable
                                      → Resume scan complete before
                                        accepting new tasks
```

### Crash resume protocol (on every start)

```
1. Open today's ledger file
2. Scan for tasks with status 'running' or 'submitted' (no terminal event)
3. For each: write task_failed { code: TASK_INTERRUPTED, ts: now }
4. Log summary: "Resume: N tasks interrupted from previous session"
5. Accept new tasks
```

The ledger is append-only. Crashes write nothing. The missing `task_completed` event IS the signal.

---

## Version probing

On adapter init, Plumb runs:
1. `which <binary>` → found or not
2. `<binary> --version` → version string
3. Check against `versions.json`:
   - `knownGood` → proceed
   - `knownBad` → refuse to start, exit 1
   - unknown → log warning, proceed (may fail fixtures)

Each upstream CLI release triggers a fixture re-verification.

---

## Files shipped

| File | Purpose |
|------|---------|
| `src/types.ts` | AdapterContract, AdapterEvent, PlumbConfig, LedgerEvent |
| `src/cli.ts` | `plumb` CLI binary surface |
| `src/main.ts` | Entry point |
| `src/adapters/*.ts` | 7 adapter implementations |
| `src/core/server.ts` | Express + A2A SDK |
| `src/core/executor.ts` | Process lifecycle, concurrency gate, circuit breaker, ledger wiring |
| `src/core/process.ts` | ProcessManager (oneshot) + PersistentProcess (RPC) |
| `src/core/ledger.ts` | Append-only JSONL writer |
| `src/core/task-store.ts` | LRU-bounded in-memory task store |

---

*An architecture is not measured by how many features it has.
It is measured by how many features it refuses to add.
And by how well it survives when it crashes.*
