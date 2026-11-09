# PULSE — The Heartbeat

```
Every task lifecycle event stored.
Queryable. Aggregateable. Survivable.
Not a dashboard. A database.
The operator brings the dashboard.
```

---

## The pulse database

SQLite. One file. Append-only. Located at `.plumb/pulse.db`.

```sql
CREATE TABLE pulses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,             -- ISO 8601
  kind TEXT NOT NULL,           -- event type
  taskId TEXT,
  agentId TEXT,
  status TEXT,                  -- completed / failed / cancelled / timeout / interrupted
  duration INTEGER,             -- milliseconds
  errorCode TEXT,               -- CLI_TIMEOUT, CLI_RUNTIME_ERROR, BREAKER_OPEN, etc.
  data TEXT                     -- JSON blob with context
);

CREATE INDEX idx_pulses_ts ON pulses(ts);
CREATE INDEX idx_pulses_kind ON pulses(kind);
CREATE INDEX idx_pulses_agent ON pulses(agentId);
```

---

## Pulse kinds

### Task lifecycle
```
task.submitted          ← Request received
task.running            ← Process spawned
task.completed          ← Process exited 0 or isComplete+extractOutput
task.failed             ← Process exited non-zero / parse error
task.cancelled          ← Cancel request executed
task.timeout            ← Exceeded adapter timeout
task.interrupted        ← Crash detected on server restart
task.orphaned           ← Parent task died mid-flight
task.uncertain          ← Two-phase commit ambiguity (completing w/o end)
```

### Adapter errors
```
cli.crash               ← Subprocess exit code non-zero
cli.timeout             ← Subprocess killed for hanging
cli.killed              ← Subprocess SIGKILLed (hung after SIGTERM)
adapter.parse_error     ← Adapter couldn't parse stdout
adapter.no_output       ← CLI produced zero parseable output
```

### Circuit breaker
```
breaker.opened          ← N consecutive failures, circuit opened
breaker.closed          ← Circuit closed (normal operation)
breaker.half_open       ← Circuit probing with single task
breaker.tripped         ← Probe failed, circuit reopened
```

### Health
```
ledger.full             ← Disk > 95%, ledger degraded
ledger.error            ← Ledger write failed (non-disk)
server.startup          ← Server boot sequence completed
server.shutdown         ← Server graceful shutdown
resume.complete         ← Crash resume scan done, N tasks interrupted
```

### Budget
```
budget.exceeded         ← Task exceeded token/duration/cost limit
budget.starved          ← Task granted less than 50% of requested budget
```

---

## Query examples

```bash
# Tasks per agent, today
sqlite3 .plumb/pulse.db "SELECT agentId, COUNT(*) as tasks FROM pulses WHERE kind='task.completed' GROUP BY agentId"

# Failure rate per agent
sqlite3 .plumb/pulse.db "SELECT agentId, COUNT(*) as failures FROM pulses WHERE kind LIKE 'task.failed' OR kind='cli.crash' GROUP BY agentId"

# Average task duration
sqlite3 .plumb/pulse.db "SELECT AVG(duration) as avg_duration_ms FROM pulses WHERE kind='task.completed'"

# Tasks that timed out in last hour
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE kind='task.timeout' AND ts > datetime('now', '-1 hour')"

# Circuit breaker events
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE kind LIKE 'breaker.%'"

# Interrupted tasks from last crash
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE kind='task.interrupted'"

# Orphan cascade
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE kind='task.orphaned'"
```

---

## Health endpoints

### `/healthz` — Alive check

```json
{
  "status": "ok",
  "uptime": 7200,
  "version": "1.0.0"
}
```

Returns `200 OK` if the server is running. Always returns `ok` unless the process is dying.

### `/readyz` — Readiness check

```json
{
  "status": "ok",
  "agents": 4,
  "running": 4,
  "degraded": 0,
  "breakers": { "closed": 4, "open": 0, "half_open": 0 },
  "ledger": "healthy",
  "disk": { "used": "45%", "available": "55GB" },
  "memory": { "used": "85MB", "ceiling": "500MB" },
  "interrupted": { "lastResume": "2026-05-13T18:00:00Z", "count": 3 }
}
```

Returns `200 OK` only if the fleet is operational. Degraded agents don't fail the check — they're reported in `degraded`. The operator decides what to do.

---

## Metrics (Prometheus-compatible)

```
plumb_tasks_total{agentId, status}
plumb_tasks_active{agentId}
plumb_task_duration_seconds{agentId, status}
plumb_adapter_exits_total{agentId, exitCode}
plumb_breaker_state{agentId}               # 0=closed, 1=open, 2=half_open
plumb_breaker_failures_total{agentId}
plumb_ledger_writes_total{agentId, status} # status=ok|degraded|failed
plumb_memory_usage_bytes
```

Exported at `/metrics`. Standard Prometheus scrape target.

---

## Redaction

The pulse DB never stores:
- API keys, tokens, passwords, PII
- The full task prompt (only truncated to 200 chars)
- `Authorization` headers, `X-Api-Key` headers
- File paths containing `/home/` (masked to `~/...`)

The ledger has the full data. The pulse DB has the signals.

---

## Performance budgets

| Metric | Default | Hard Limit | Failure Behavior |
|--------|---------|------------|------------------|
| Server startup | 5s | 15s | Exit 1 |
| Agent-card latency | 50ms | 200ms | Log warning |
| Task accepted latency | 100ms | 500ms | Log warning |
| First stream event | 500ms | 5s | Log warning |
| Cancellation latency | 200ms | 2s | SIGTERM → SIGKILL |
| Adapter timeout | 300s | 600s | SIGKILL + task failed |
| Memory ceiling (idle) | 100MB | 500MB | Restart adapter |
| Max log per task | 10MB | 50MB | Truncate + warning |
| Ledger write latency | 10ms | 100ms | Degrade (async write) |

---

## The one rule: no SQL on the hot path

Pulse is SQLite. Writing to SQLite on every task event is fine (~1ms). Querying it for runtime routing decisions is not.

**Rule:** Pulse is a historical record, never a runtime data source.

| Domain | In-memory | Pulse (SQLite) |
|--------|-----------|----------------|
| Circuit breaker state | `Map<agentId, BreakerState>` | `breaker.*` events for history |
| Concurrency slots | `Map<agentId, number>` | — |
| Agent health | `/readyz` poll response | History of failures |
| Routing decisions | Label → agent lookup from plumb.yaml | — |

Everything the hot path needs fits in memory. If a routing decision requires a query, the architecture is wrong.

Differentiation:
- **In-process memory** for runtime decisions → 0μs read, no I/O, no backpressure
- **SQLite pulse DB** for the operator's queries and Grafana scrapes → 1-50ms read, acceptable for dashboards
- **JSONL ledger** for crash-survivable truth → append-only, no indexes, no queries

Route with memory. Record with SQLite. Survive with JSONL. Each tier has a different latency budget and a different failure mode. Confuse them and a 1ms route decision becomes a 50ms bottleneck at scale.

---

*Pulse is not a dashboard. Pulse is a data source.
The operator brings the dashboard, the alert, the Grafana.
Plumb ships the raw signal and the performance budgets that keep it honest.*
