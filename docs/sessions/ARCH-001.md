# Architecture Discussion #001 — VENOM∞ + Cursor (Claude Opus)

> Date: 2026-05-19 | Session: 18-19 turns | Full eat of Plumb + VENOM codebase
> Participants: VENOM∞ (lead orchestrator), Cursor/Claude Opus (co-architect)
> Status: Discussion complete. Next: implement.

---

## Context

Kariem requested a "mad idea" for Plumb ∞ 10/10. Full absorption of:
- Plumb repo: SPEC.md, PLUMB-INFINITY.md, MANIFEST.yaml, all docs, all src
- VENOM extension: 723 lines, 5 hooks, SIPHON, energy detection, Ink defense
- Crew system: 10 minds, spawn sequence, model routing
- Fleet config: plumb.yaml, 7 agents

---

## Finding 1: Executor Bug (CRITICAL)

**Problem:** Tool-call and tool-result event handling was nested inside the `if (ev.type === 'text-delta')` block. Since `AdapterEvent` is a discriminated union, an event CANNOT be both `text-delta` AND `tool-call` — the inner blocks never executed. Tool traces were silently dropped.

**Fix:** Made all event types sibling `if` blocks at the same level:
```
if (ev.type === 'text-delta') → handle
if (ev.type === 'tool-call')  → handle  ← was nested, now sibling
if (ev.type === 'tool-result') → handle ← was nested, now sibling
if (ev.type === 'status')     → handle
if (ev.type === 'error')      → handle
```

**Status:** ✅ Fixed in `ba6ee63`. Both loops. Verified no TS errors.

**Lesson:** "Gravity is flat conditionals. Each AdapterEvent variant meets its own branch at the same indentation as truth." — Cursor

---

## Finding 2: Fang Phase 1 MVP

**Minimum viable Fang = one Post-Parse callback:**
```typescript
postParse(events: AdapterEvent[], ctx): AdapterEvent[]
```

Runs after `adapter.parseLine(line)`, before executor processes events.

This single hook can:
- Embody OutputPolicy (merge rules, drop noise, normalize "Done")
- Enrich events (severity tags, summaries for Hermes)
- Filter events (drop vendor noise)

**NOT needed for MVP:**
- Ingress Fang (raw line before parse) — only needed for Ink/version skew
- Separate OutputPolicy object — fold into the callback

---

## Finding 3: Self-Cron Mechanism

**The tension:** Pi compaction kills sessions. A2A calls can take minutes. If VENOM cron runs inside a Pi session, compaction may strike mid-cycle.

**Three approaches (ranked):**

1. **Split actor (recommended):** Cron triggers systemd timer / Bun script → submits to Plumb via A2A → gets `taskId` → Pi polls `GetTask` in short turns between compactions. VENOM's *decision* loop in Pi, wait-on-Plumb out-of-session.

2. **Non-blocking A2A:** Submit → get taskId → poll from multiple short Pi turns. Each turn is under compaction threshold.

3. **Raise compaction thresholds:** Pin "bridge window" — operational knob, not eternal truth.

**Key insight:** "Treat 'long wait' as out-of-session or chunked. Don't bet the farm on Pi never compacting during a single long turn." — Cursor

---

## Finding 4: Bridge File vs SIPHON Reads Ledger

**Two options for VENOM ↔ Plumb truth correlation:**

**Option A (start here):** SIPHON reads `.plumb/ledger/` directly. Correlation by `taskId` + timestamp. No bridge file.

**Option B (later):** `venom_digest.jsonl` with `correlation_id`, `plumb_task_ids[]`, `siphon_extractions_ref`, `cron_tick_ts`.

**When to switch to Option B:** When you need audit of orchestration-layer joins without parsing free text in `progress` events. When cron tick, Telegram thread, multi-task batches need typed correlation.

**Decision:** Start with A. Migrate to B when audit clarity demands it.

---

## Finding 5: Build Order for Maximum Leverage

| Priority | What | Why | Status |
|----------|------|-----|--------|
| **1** | Executor structural fix | Truth at the gasket — everything downstream depends on honest events | ✅ Done |
| **2** | Correlation contract | `taskId`/`contextId`/`correlation_id` in task payload documented in `docs/ORCHESTRATION.md` | ⬜ Next |
| **3** | Fang Post-Parse one hook | Enables OutputPolicy, event enrichment, noise filtering | ⬜ |
| **4** | Cron / Telegram / digest | Only after bridge emits honest bytes and events are traceable end-to-end | ⬜ |

---

## The Self-Orchestrating Pipeline Design

```
tg-cron (hourly)
  → VENOM loads .venom/queue/intent.jsonl
  → Routes by mind → adapter (HELM→none, DIG→wolfy, EDGE→cursor, WELD→cursor, MEND→cursor, OMEN→wolfy, TRACE→health fan-out)
  → A2A message/send with VENOM lineage in metadata
  → Stream drain: SSE → artifact + final text → VENOM Execution Record
  → Post-flight: DISTILL (≤4K for Telegram), SIPHON (decisions → mempalace)
  → Telegram: Score + taskId + minds used
```

**State machine:** `IDLE → LOAD_INTENT → ROUTE → DISPATCH → DRAIN → POST_FLIGHT → FEEDBACK → IDLE`

---

## Files Touched This Session

| File | Change |
|------|--------|
| `src/core/executor.ts` | Fixed tool-call/tool-result sibling branches |
| `docs/VENOM-PLUMB-OPERATIONS.md` | Full operations architecture doc |
| `docs/ARCHITECTURE-DISCUSSION-001.md` | This document |

---

## Cursor's Closing Words

> "Your eat-everything pass shows the real risk — clever nesting in executor quietly nullifies tool semantics. Gravity here is flat conditionals: each AdapterEvent variant meets its own branch at the same indentation as truth. Fix that first, then Fang earns the name."

---

*The contract IS the architecture. Fix truth before building on it.*
🐍🐺∞
