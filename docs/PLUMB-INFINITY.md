# PLUMB ∞ — The Inevitable Bridge

> *"Gravity does not persuade. It constrains."*
> Architecture ratified 2026-05-19 by VENOM∞ + Cursor (Claude Opus).
> Owner: Kariem Seiam. Lead architect: VENOM∞.

---

## I. What Plumb ∞ Is

Plumb is the thin, honest boundary between orchestrator intent and agent execution.

Not a platform. Not a dashboard. Not an agent.
A **conduit** governed by one rule: **the contract IS the architecture.**

Every word that crosses stdin/stdout is versioned, reproducible, falsifiable.
Silence is credibility. The ledger doesn't lie.

---

## II. The Five Fang Classes

Fang = extension system. Narrow. Typed. Deterministic. DAG-ordered.

| Fang | Fires | Responsibility | Forbidden |
|------|-------|----------------|-----------|
| **Ingress** | Before `PersistentProcess.routeLine` | Normalize transports. Correlate IDs. Ink headers → service params. | Rewrite user intent. |
| **Pre-Parse** | Before `parseLine` | Strip vendor noise. Unify JSONL quirks. Classify frame type. | Call into adapter internals. |
| **Post-Parse** | After `parseLine` | Map `AdapterEvent[]` → enrichment. Summaries for Hermes. Severity tags. OutputPolicy. | Replace final A2A without contract. |
| **Ledger Observer** | On every `LedgerEvent` append | Replicate to WAL. Prometheus. Stall detection. | Write back to execution path. |
| **Recovery** | On boot / after crash | Snapshot offsets. Task-envelope replay. Intent log → progress log. | Generic "memory." |

**OutputPolicy** (Post-Parse Fang):
- `text-delta-only` (default) — only explicit deltas accumulate
- `mergeFinalFromResponse` — protocol truth (`response.data`, tool traces) merged into `accumulated`

---

## III. The Pipeline

```
Hermes intent
  → ROUTE (card URL, tier, affinity)
PLUMB GATE (authenticate, correlate, enqueue)
  → ADAPTER BIND (wolfy | pi | cursor | claude | opencode | venom | echo)
  → PROCESS LANE (persistent | oneshot)
  → STREAM (stdin/stdout frames)
  → FANG: INGRESS
  → parseLine
  → FANG: POST-PARSE (OutputPolicy)
  → ENRICH (accumulated → final message)
  → A2A EMIT (task/message/artifact via SSE)
  → FANG: LEDGER OBSERVER → JSONL WAL
HERMES CLOSE LOOP (next task | replay)
```

---

## IV. Recovery — "Always Down"

| Tier | Failure | Response |
|------|---------|----------|
| Hermes | Crashed | idempotent replay via messageId dedup |
| Plumb | Crashed | WAL ahead of bus — accept logged before child write |
| Agent child | Died | Ledger `task_failed`, Fang triggers Hermes reschedule |
| Persistent mind | Corrupted | Continuity = agent storage. Bridge restores routing only. |

**Intent log** (accept) separate from **progress log** (ledger).
On restart: replay intent → skip completed → resume pending.

---

## V. Runtime Discovery

Adapter matrix queryable via protocol:
```
GET /a2a/agents → { agents: [{ id, name, tier, mode, alive, port }] }
```

Not a CLI command. A protocol surface. Hermes queries: "Who is alive?"

---

## VI. Symmetry — The Truth Partition

| Layer | Owns |
|-------|------|
| **Hermes** | Orchestration intent — which agent, what priority, when to retry |
| **Plumb** | Transport truth — bytes crossed, parsed, ledged |
| **Agent** | Model truth — what was thought, decided, built |

No layer lies to the one above. Partitioned accountability.

---

## VII. Current State → Target

| Component | State | Target |
|-----------|-------|--------|
| Adapter registry | ✅ 8 adapters | 8 adapters |
| Persistent processes | ✅ ProcessManager | ProcessManager |
| Ledger | ✅ JSONL/day | JSONL/day + WAL |
| Fleet | ✅ plumb.yaml | plumb.yaml |
| Fang: Ingress | ❌ | Phase 1 |
| Fang: Post-Parse | ❌ | Phase 1 |
| OutputPolicy | ❌ | Phase 1 |
| Fang: Ledger Observer | ❌ | Phase 2 |
| Fang: Recovery | ❌ | Phase 2 |
| Fang: Pre-Parse | ❌ | Phase 3 |
| Runtime discovery | ❌ | Phase 2 |
| WAL ahead of bus | ❌ | Phase 1 |
| Intent log | ❌ | Phase 2 |
| Per-adapter auth | ❌ | Phase 3 |
| Session continuity | ❌ | Phase 2 |

---

## VIII. The Owner

Plumb belongs to Kariem Seiam.
Architecture by VENOM∞ (lead) + Cursor (Claude Opus).
All commits: `Kariem Seiam <kariemseiam@gmail.com>`.

The contract IS the architecture.
Gravity does not persuade. It constrains.

🐍🐺∞
