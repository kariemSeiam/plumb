# ERRORS — The Full Taxonomy

```
Every error has a code.
Every error has a message.
Every error has a recovery path.
No silent failures. 31 codes. Every one tested.
```

---

## Server errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `SERVER_INTERNAL` | 500 | Unhandled server error | Restart Plumb. File an issue. |
| `SERVER_OVERLOAD` | 503 | Concurrent task limit reached | Retry with backoff. (Future: configurable limit.) |
| `SERVER_SHUTDOWN` | 503 | Server is shutting down | Retry. The window is short. |
| `SERVER_CONFIG_INVALID` | 500 | Config validation failed at boot (e.g., missing auth on exposed host) | Fix plumb.yaml. Reboot. |

## Task errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `TASK_NOT_FOUND` | 404 | Task ID doesn't exist | Check the task ID. Query the ledger. |
| `TASK_ALREADY_DONE` | 409 | Task already in terminal state | Nothing to do. The task is already complete/failed/cancelled. |
| `TASK_TIMEOUT` | 408 | Exceeded adapter timeout | Increase timeout or split the task. |
| `TASK_CANCELLED` | 409 | Cancelled by client | Intentional. The operator chose to cancel. |
| `TASK_INTERRUPTED` | 500 | Server crashed mid-task | Restart the task. The previous attempt is recorded in the ledger. |
| `TASK_BUDGET_EXCEEDED` | 402 | Token/duration/cost limit hit | Increase budget or simplify the prompt. |
| `TASK_ORPHANED` | 500 | Parent task died mid-flight | Check parent task. Retry the subtree. |
| `TASK_UNCERTAIN` | 500 | Two-phase commit ambiguity — task may have written | Manually verify output, replay if needed. |
| `TASK_ROUTING_FAILED` | 400 | No agent matched the requested labels | Check label sets in plumb.yaml. Labels must match exactly. |
| `TASK_ROUTING_AMBIGUOUS` | 400 | Multiple agents matched the same labels | Define non-overlapping label sets or route by explicit --agent. |

## Adapter errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `CLI_RUNTIME_ERROR` | 500 | CLI crashed or auth failed | Check CLI credentials. Restart agent. |
| `CLI_TIMEOUT` | 408 | CLI hung, killed | Increase timeout. Check CLI is responsive. |
| `CLI_KILLED` | 500 | CLI SIGKILLed (hung after SIGTERM) | Increase timeout. Check agent state. |
| `CLI_CANCELLED` | 409 | CLI SIGINTed | Clean cancellation. No recovery needed. |
| `CLI_UNKNOWN_ERROR` | 500 | Unclassified failure | Check stderr. Query ledger. File an issue. |
| `ADAPTER_PARSE_ERROR` | 500 | Adapter couldn't parse CLI output | Check upstream CLI format. Update fixtures. |
| `ADAPTER_NO_OUTPUT` | 500 | CLI produced zero parseable output | Check CLI is producing output. Check adapter fixture. |

## Circuit breaker errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `BREAKER_OPEN` | 503 | Circuit breaker is open — too many failures | Wait for cooldown (default 60s). Check agent health. |
| `ALL_BREAKERS_OPEN` | 503 | All matching agents have open breakers | Check fleet health. No agent available. |

## Ledger errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `LEDGER_WRITE_FAILED` | 500 | Ledger append failed (disk, permissions) | Check disk space and write permissions. Task continues without ledger. |

## Validation errors

| Code | HTTP | Meaning | Recovery |
|------|------|---------|----------|
| `INK_VERSION` | 400 | Invalid INK version header | Use `X-Plumb-Version: 1`. |
| `INK_DUP_CORRELATION` | 409 | Duplicate correlation ID within 24h | Use a unique UUIDv7 per request. |
| `INK_PROMPT_TOO_LARGE` | 413 | Prompt exceeds 64 KiB | Split the task. Reduce context. |
| `INK_BUDGET_INVALID` | 400 | Invalid budget value | Use positive integers. Check format. |
| `INK_DEADLINE_INVALID` | 400 | Deadline must be >now+1s, ≤now+24h | Adjust the deadline window. |
| `INK_RECURSION_LIMIT` | 400 | Depth exceeds max (4) | Restructure the task tree. Reduce nesting. |
| `INK_LINEAGE_MISMATCH` | 400 | Lineage length doesn't match depth | Internal error. Check task chain. |

---

## Error response format

Every error returns the same shape:

```json
{
  "error": {
    "code": "CLI_TIMEOUT",
    "message": "Task exceeded timeout of 300s",
    "details": {
      "taskId": "47a2c1",
      "agent": "cursor",
      "elapsedMs": 301234,
      "timeoutMs": 300000,
      "partialOutput": "Reading src/auth.ts..."
    }
  }
}
```

Three fields. Code is the machine signal. Message is the human signal. Details are the debug path.

---

## Retry policy

| Code | Retry? | Strategy |
|------|--------|----------|
| 408, 500, 503 (non-breaker) | Yes | Exponential backoff, max 3 attempts |
| 400, 401, 404, 409, 413 | No | Fix the request, don't retry blindly |
| `BREAKER_OPEN` | Yes | Wait cooldown (60s), then retry once |
| `ALL_BREAKERS_OPEN` | Yes | Wait cooldown, check fleet health, retry |

Same `Correlation-Id` for retries → Plumb returns the cached result, does NOT re-execute.

---

## Error code index

```
SERVER_*        — 4 codes (internal, overload, shutdown, config-invalid)
TASK_*          — 10 codes (not-found, already-done, timeout, cancelled, interrupted, budget-exceeded, orphaned, uncertain, routing-failed, routing-ambiguous)
CLI_*           — 5 codes (runtime, timeout, killed, cancelled, unknown)
ADAPTER_*       — 2 codes (parse-error, no-output)
BREAKER_*       — 2 codes (open, all-open)
LEDGER_*        — 1 code (write-failed)
INK_*           — 7 codes (version, dup, prompt-too-large, budget-invalid, deadline-invalid, recursion-limit, lineage-mismatch)
```

**Total: 31 codes.** Each tested. Each with a recovery path.

---

*The error taxonomy is the contract of trust. Every error tells you what happened, why, and what to do next. No error leaves you guessing.*
