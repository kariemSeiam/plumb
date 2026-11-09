# LEDGER

The append-only record. Every task that passes through Plumb leaves a trace.

```
.plumb/ledger/2026-05-20.jsonl
.plumb/ledger/2026-05-21.jsonl
...
```

One file per UTC day. One JSON object per line. Never modified. Never deleted by Plumb.

---

## Schema

Authoritative type: `src/types.ts` — `LedgerEvent`.

### task_submitted

```json
{
  "type": "task_submitted",
  "taskId": "abc-123",
  "cli": "claude",
  "message": "Implement X",
  "timestamp": "2026-05-20T14:30:00.000Z"
}
```

Written immediately when a task is accepted. Before any subprocess spawns.

### task_running

```json
{
  "type": "task_running",
  "taskId": "abc-123",
  "timestamp": "2026-05-20T14:30:00.100Z"
}
```

Written when the subprocess starts or when the persistent process accepts the task.

### progress

```json
{
  "type": "progress",
  "taskId": "abc-123",
  "text": "Reading file...\n",
  "timestamp": "2026-05-20T14:30:01.200Z"
}
```

Written for every `text-delta`, `tool-call`, and `tool-result` event. One ledger line per event. `text` is the raw fragment — partial lines are possible.

### log

```json
{
  "type": "log",
  "taskId": "abc-123",
  "level": "error",
  "text": "some stderr line",
  "timestamp": "2026-05-20T14:30:01.500Z"
}
```

Written when the subprocess writes to stderr. Level is always `"error"` for now.

### task_completed

```json
{
  "type": "task_completed",
  "taskId": "abc-123",
  "timestamp": "2026-05-20T14:30:15.000Z"
}
```

Written when the adapter emits `status: completed` or when the process exits with code 0 (and the task was not already settled).

### task_failed

```json
{
  "type": "task_failed",
  "taskId": "abc-123",
  "error": "Process exited with code 1",
  "timestamp": "2026-05-20T14:30:15.000Z"
}
```

Written when the adapter emits `error`, when the process exits non-zero, or when the task times out.

### task_cancelled

```json
{
  "type": "task_cancelled",
  "taskId": "abc-123",
  "timestamp": "2026-05-20T14:30:05.000Z"
}
```

Written when `cancelTask` is called on an active task.

---

## Guarantees

- **Append-only.** Plumb never seeks back, never overwrites, never truncates.
- **Crash-survivable.** Each `appendFileSync` call completes before the corresponding A2A bus event fires.
- **Non-fatal write failure.** If the ledger write fails (disk full, permissions), Plumb logs to stderr and continues. Task execution is not interrupted.
- **Daily rotation.** File path is computed from `new Date().toISOString().slice(0, 10)` (UTC). If a task crosses midnight, events land in different files.

---

## Queries

All queries assume today's ledger. Replace `$(date +%Y-%m-%d)` as needed.

```bash
LEDGER=".plumb/ledger/$(date +%Y-%m-%d).jsonl"
```

**All events today:**
```bash
cat "$LEDGER"
```

**All completed tasks:**
```bash
jq 'select(.type=="task_completed")' "$LEDGER"
```

**All failed tasks with errors:**
```bash
jq 'select(.type=="task_failed") | {taskId, error, timestamp}' "$LEDGER"
```

**Full timeline for a specific task:**
```bash
jq 'select(.taskId=="abc-123")' "$LEDGER"
```

**Reconstruct full output for a task:**
```bash
jq -r 'select(.type=="progress" and .taskId=="abc-123") | .text' "$LEDGER"
```

**Count tasks submitted today:**
```bash
jq 'select(.type=="task_submitted")' "$LEDGER" | jq -s 'length'
```

**Tasks by CLI (adapter):**
```bash
jq 'select(.type=="task_submitted") | .cli' "$LEDGER" | sort | uniq -c | sort -rn
```

**Last completed timestamp:**
```bash
jq 'select(.type=="task_completed") | .timestamp' "$LEDGER" | tail -1
```

**Tasks that timed out:**
```bash
jq 'select(.type=="task_failed" and (.error | contains("timed out")))' "$LEDGER"
```

**Duration estimate (submitted → completed):**
```bash
jq -s '
  group_by(.taskId) |
  map({
    taskId: .[0].taskId,
    start: map(select(.type=="task_submitted")) | .[0].timestamp,
    end: map(select(.type=="task_completed")) | .[0].timestamp
  }) |
  map(select(.start and .end))
' "$LEDGER"
```

---

## Integration

**SIPHON (VENOM):** Reads `.plumb/ledger/` directly. Correlates by `taskId`. The `task_submitted.message` field carries the original prompt. `progress` events carry the agent output. Never write back.

**External tools:** The ledger is plain JSONL. `jq`, `grep`, `awk`, Python, any stream processor works. No proprietary format.

**Drift detection:** `task_submitted` without a matching `task_completed` or `task_failed` within the expected timeout window indicates an interrupted task.

---

*The ledger doesn't lie. Crashed processes write their last line. Queries are the interface.*
