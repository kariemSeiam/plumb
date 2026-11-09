# LEDGER — The Gravity-True Record

```
Every task lifecycle written to disk.
Append-only. Crash-survivable. Queryable.
No database. No index. No aggregation.
Just lines in a file.
The ledger IS the crash resume protocol.
```

---

## Format

One JSON object per line. `.plumb/ledger/{YYYY-MM-DD}.jsonl`. Rotated daily.

```json
{"type":"task_submitted","taskId":"47a2c1","agent":"cursor","labels":["build","fast"],"message":"Refactor auth module","timestamp":"2026-05-13T19:00:00Z"}
{"type":"task_running","taskId":"47a2c1","agent":"cursor","pid":12345,"timestamp":"2026-05-13T19:00:01Z"}
{"type":"progress","taskId":"47a2c1","text":"Reading src/auth.ts...","timestamp":"2026-05-13T19:00:02Z"}
{"type":"progress","taskId":"47a2c1","text":"Refactoring...","timestamp":"2026-05-13T19:00:05Z"}
{"type":"task_completed","taskId":"47a2c1","duration":12,"output":"Refactored auth module...","timestamp":"2026-05-13T19:00:12Z"}
```

One object per line. Valid JSON. No trailing commas. No wrapping array. Every line independently parseable.

---

## Event types

| Event | When | Fields |
|-------|------|--------|
| `task_submitted` | Request received | taskId, agent, labels, message |
| `task_running` | Process spawned | taskId, agent, pid |
| `progress` | stdout parsed | taskId, text |
| `log` | stderr or adapter log | taskId, level, text |
| `task_completed` | Process exited 0 or isComplete+extractOutput | taskId, duration, output |
| `task_failed` | Process exited non-zero or parse error | taskId, errorCode, errorMessage, partialOutput |
| `task_cancelled` | Cancel request executed | taskId |
| `task_interrupted` | Crash resume detected mid-flight task | taskId, previousStatus, ts |

---

## Crash resume

On every start, before accepting new tasks:

```
1. Open today's ledger file
2. Scan for tasks with type=task_running or type=task_submitted
   that have NO corresponding task_completed, task_failed, or task_cancelled
3. For each: write task_interrupted { taskId, previousStatus, ts }
4. Log: "Resume: N tasks interrupted from previous session"
5. Accept new tasks
```

The missing `task_completed` event IS the signal. Plumb does not auto-retry. The operator decides.

---

## Query patterns

```bash
# Last 10 events, newest first
jq -s 'reverse | .[-10:]' .plumb/ledger/2026-05-13.jsonl

# All failed tasks today
jq -s '.[] | select(.type == "task_failed")' .plumb/ledger/2026-05-13.jsonl

# All tasks for one agent
jq -s '.[] | select(.agent == "cursor")' .plumb/ledger/2026-05-13.jsonl

# Tasks that ran longer than 30s
jq -s '.[] | select(.type == "task_completed" and .duration > 30)' .plumb/ledger/2026-05-13.jsonl

# Full lifecycle of one task
jq -s '.[] | select(.taskId == "47a2c1")' .plumb/ledger/2026-05-13.jsonl

# Interrupted tasks (crash survivors)
jq -s '.[] | select(.type == "task_interrupted")' .plumb/ledger/2026-05-13.jsonl
```

No SQL. No API. Just `jq`. Every operator has `jq`. Every operator can query the ledger.

---

## Crash survival

```
WHAT HAPPENS              LEDGER STATE
─────────────────────────────────────────────
Server crashes mid-task   → task_running exists
                              without task_completed
                           → crash resume: mark task_interrupted
                           → operator sees interrupted tasks

Write fails mid-task      → Non-fatal. Log warning to stderr.
                              Task continues. Next write retries.

Ledger disk full          → Degrade mode. Async writes.
                              Alert on /readyz.
```

The ledger append operation is `O(1)` and non-blocking. A write failure never blocks task execution. If the ledger can't write, Plumb logs to stderr and continues. The task runs. The record is best-effort.

---

## Retention

Default: 90 days. Configurable in `plumb.yaml`. Old files are rotated out by a daily cron within Plumb. No auto-deletion until the retention window passes.

```
.plumb/ledger/
├── 2026-05-13.jsonl    ← today, active
├── 2026-05-12.jsonl    ← yesterday, sealed
├── 2026-05-11.jsonl    ← 2 days ago, sealed
...
└── 2026-02-13.jsonl    ← 90 days ago, last retained
```

Sealed files are never rewritten. The daily file is append-only until midnight.

---

## SIPHON extraction

The ledger is the input. SIPHON is a separate process that reads the ledger and extracts decisions, corrections, and patterns.

SIPHON is NOT built into Plumb. SIPHON reads the same files the operator reads — `.plumb/ledger/*.jsonl`. Plumb provides the record. SIPHON provides the intelligence.

```
Plumb writes → JSONL ledger → SIPHON reads → MEMORY.md → pi-mempalace
```

This separation is deliberate. Plumb stays dumb. SIPHON stays separate. Either can fail without taking the other down.

---

*The ledger is not a feature. The ledger is the proof.
It is also the crash recovery protocol.
A missing task_completed event is worth a thousand log lines.*
