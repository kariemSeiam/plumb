# VENOM ∞ ↔ Plumb — Operations Architecture

> Ratified 2026-05-19. VENOM∞ (lead) + Cursor/Claude Opus (co-design).
> Owner: Kariem Seiam. Part of Plumb ∞ constitution.

---

## I. The Split (Non-Negotiable)

| Layer | Owns | Lives In |
|-------|------|----------|
| **VENOM∞** | Orchestration intent — what runs, priority, retries, Telegram narrative, Pact | `/root/.pi/agent/` |
| **Plumb** | Transport truth — stdin/stdout framed, parsed, A2A emitted, JSONL ledged | `/home/plumb/` |
| **CLI Agents** | Model/task truth — Wolfy, Cursor, Claude, VENOM worker | Various |

---

## II. Self-Orchestrating Pipeline (1-Hour Cycle)

```
tg-cron (hourly)
  → VENOM loads intent queue (.venom/queue/intent.jsonl)
  → Route: pick adapter by mind + fleet card
  → A2A submit: message/send with VENOM lineage in metadata
  → Stream drain: SSE → artifact + final text → VENOM Execution Record
  → Post-flight: DISTILL (Telegram truncation), SIPHON (decisions → memory)
  → Feedback: Telegram verdict + taskId for ledger replay
```

**Plumb stays cold between tasks.** Persistent ports (Wolfy) kept warm via `fleet up`.

---

## III. Ten Minds → Plumb Adapter Routing

| Mind | Primary Adapters | Role |
|------|-----------------|------|
| **HELM** | None — issues intents, reads cards | Decomposition, rollback |
| **DIG** | wolfy, pi | Root-cause, architecture |
| **EDGE** | cursor, venom, claude | Audits, patches |
| **ECHO** | Internal (mempalace) | Recall before dispatch |
| **WELD** | cursor, opencode, claude | Implement, scaffold |
| **MEND** | cursor, venom, generic | Fix loops, reproducible |
| **OMEN** | wolfy, DIG sibling | Speculative branches |
| **SYNC** | Pre-dispatch modifier | Energy/tone injection |
| **MOLT** | HELM + generic | Kill stale queues, rotate |
| **TRACE** | echo, curl/cat, GET /health | Fleet topology ≤60s |

**Rule:** WELD never owns reconciliation unless EDGE blesses completion.

---

## IV. SIPHON → Plumb Fang Bridge

| Side | Owns | Format |
|------|------|--------|
| VENOM SIPHON | Semantic extraction (decisions, corrections, confidence) | YAML / mempalace |
| Plumb Fang Ledger Observer | Physical truth (task_submitted → completed) | `.plumb/ledger/*.jsonl` |
| Bridge contract | `venom_digest.jsonl` with correlation_id | `.venom/bridge/plumb-affined.jsonl` |

**Forbidden:** Rewriting `.plumb/ledger` lines from VENOM side. Append-only soul.

---

## V. Telegram Cron Loop

```
tg-cron hourly → webhook → VENOM reads COMPASS
  → dequeue next batch (max N parallel)
  → A2A to Plumb ports
  → aggregate summaries
  → DISTILL to ≤4K Telegram chunks
  → post: Score + taskId link + minds used
```

**Failure:** Plumb /health bad → TRACE pings fleet → Telegram gets one silent line: `PORT 3003 unhealthy — skip`.

---

## VI. Plumb Docs Structure (10/10 Convergence)

| Doc | Purpose |
|-----|---------|
| `docs/ORCHESTRATION.md` | VENOM-Plumb contract: metadata keys, contextId conventions, retry/idempotency |
| `docs/FANG-SPEC.md` | Five Fang hooks, DAG order, OutputPolicy enum, observer rules |
| `docs/TRUTH-PARTITION.md` | Semantic vs transport vs model truth |
| `docs/FLEET-OPERATIONS.md` | plumb.yaml, systemd/Docker, production stance |
| `docs/VENOM-ADAPTER-MATRIX.md` | Mind → adapter table + escalation |
| `docs/SECURITY.md` | Bearer/JWT, Ink parallels, Telegram secret segregation |
| `docs/CHANGELOG-CONTRACT.md` | A2A protocolVersion bumps vs SPEC |

---

## VII. Hidden Engine — .venom Structure

```
.venom/
├── bridge/
│   └── plumb-affined.jsonl     ← SIPHON → Plumb correlation ledger
├── queue/
│   └── intent.jsonl            ← { mind, adapter_id, objective, deps, correlation_id }
├── state/
│   ├── fleet-health.json       ← TRACE topology cache
│   └── cycle-state.json        ← { last_tick, completed_tasks, stalled_tasks }
└── build/
    └── pipeline.yaml           ← Build wave definitions
```

**State machine:** IDLE → LOAD_INTENT → ROUTE → DISPATCH → DRAIN → POST_FLIGHT → FEEDBACK → IDLE

---

## VIII. Constitution

This document is co-equal with `PLUMB-INFINITY.md` and `SPEC.md`.
Plumb stays silent infrastructure. VENOM stays the mind.
The contract IS the architecture.

🐍🐺∞
