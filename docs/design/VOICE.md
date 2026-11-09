# VOICE — How Plumb Speaks

> **Superseded by [DESIGN.md](../../DESIGN.md) §4 — Voice.** This document is retained for historical reference. The authoritative voice contract now lives in the Plumb Constitution.

```
Plumb has no enthusiasm.
Plumb has no personality.
Plumb has precision.
Everything else is noise.
```

---

## The voice contract

| Do | Don't |
|----|-------|
| State | Hedge |
| "Task timed out after 300s." | "It seems the task may have timed out." |
| "CLI crashed with code 1." | "We encountered an issue with the CLI." |
| "3 agents running, 1 degraded." | "I'd like to share some health information." |
| Answer first | Explain first |
| Logs are the UI | Build a dashboard |
| JSON to stdout | Pretty-print for humans |

---

## By surface

### Documentation (README, docs site)

Informational. Minimal. Trust the reader to be an engineer.

```
Plumb wraps any CLI coding agent as an A2A server.
One endpoint. One ledger. Seven adapters. Zero dashboards.
↓
Everything below this line is proof.
```

No "welcome to" or "we're excited to." The first sentence tells you what it is. The second sentence tells you the constraints. Everything after is evidence.

### Log output (stderr)

Structured JSON. One line per event. Machine-readable first, human-readable second.

```
{"ts":"2026-05-13T19:00:00Z","level":"info","event":"task_submitted","taskId":"47a2c1","agent":"pi"}
{"ts":"2026-05-13T19:00:01Z","level":"info","event":"task_running","taskId":"47a2c1","pid":12345}
{"ts":"2026-05-13T19:00:12Z","level":"info","event":"task_completed","taskId":"47a2c1","duration":12}
```

If you want a human-readable version, pipe it through `jq`. Plumb ships the raw data. Formatting is the consumer's job.

### Error messages

Code first. Message second. Details third.

```
CLI_TIMEOUT: Task exceeded timeout of 300s
  taskId: 47a2c1
  agent: cursor
  elapsed: 301234ms
  partialOutput: "..."
```

Three fields. That's it. The operator greps the code, reads the docs, or inspects the ledger. The error message points at all three.

### Health endpoints

Status is a single word. Details are additional.

```json
GET /healthz → {"status":"ok"}
GET /readyz  → {"status":"ok","agents":4,"degraded":1}
```

Not healthy/unhealthy — Plumb tells you. Degraded is a valid state. The operator decides what to do.

---

## What Plumb never says

```
❌ "We're excited to announce..."
❌ "It seems like the task may have..."
❌ "Based on our analysis..."
❌ "I'd be happy to help you with..."
❌ "Great question!"
❌ "Let me break that down for you..."
❌ "Our platform enables..."
❌ "We believe in..."
```

Plumb does not believe in anything. It spawns processes, reads stdout, writes JSONL, and exits. If you want enthusiasm, talk to the agent on the other end of the pipe. Plumb is the pipe.

---

## The test

Read any Plumb document aloud. If a sentence sounds like a person wrote it, rewrite it until it sounds like gravity wrote it.

Gravity does not announce itself. Gravity does not apologize. Gravity does not explain. Gravity acts. Plumb documents act.
