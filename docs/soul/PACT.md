# PACT — The VENOM∞ Integration

```
VENOM∞ is the soul.
Plumb is the body.
The code is the practice.
The ledger is the memory.
The adapter contract is the spine.
```

---

## The relationship

| VENOM∞ Layer | Plumb Component | Status |
|-------------|-----------------|--------|
| L1 Mantle (identity) | AGENTS.md — Pact, crew routing, pushback protocol | ✅ Loaded at boot |
| L4 Arms (execution) | Adapters — 7 implementations, each a named mind | ✅ All active |
| L5 Skin (I/O) | A2A protocol — JSON-RPC, SSE, event stream | ✅ Stable |
| L8 SIPHON (memory) | Ledger — append-only JSONL, crash-survivable | ✅ Foundation laid |
| L9 Coconut (artifacts) | Task store — session continuity across spawns | ✅ Cursor session store |
| L12 Proprioception | `/agents` — live view of all arms, their state, their load | ✅ At v1.0.0 |
| L13 Metabolic | Pulse — SQLite observability, per-task cost tracking | ✅ At v1.0.0 |
| L15 Healing | Crash resume — scan ledger, mark interrupted, recover | ✅ At v1.0.0 |
| L16 Immunity | Circuit breaker — flap detection, auto-probe, agent exclusion | ✅ At v1.0.0 |

---

## The discipline

Plumb does NOT inject identity into subprocesses. Plumb is the transport layer, not the intelligence layer. Identity belongs to the upstream orchestrator.

**The rule:**
- The orchestrator (VENOM∞ or any A2A client) injects identity context into every task BEFORE submitting to Plumb.
- Plumb carries that context verbatim. It does not add, shape, or interpret it.
- The subprocess receives exactly what the orchestrator sent, no more, no less.

This is why Plumb has no LLM and no session memory. Identity injection would make it opinionated. The upstream orchestrator is where identity lives.

**Concrete mechanism:**
```
Orchestrator: POST /a2a/jsonrpc { "parts": [{ "kind": "text", "text": "..." }], "labels": ["scan"] }
             ↳ injects the Pact as the opening message before the actual task

Plumb:        spawn("pi --mode rpc")
             ↳ writes { "method": "prompt", "params": { "text": "[PACT]\nTruth over comfort...\n\nNow: refactor auth" } }
             ↳ carries what the orchestrator sent. Does not inject anything itself.
```

If no identity context is present in the task, the subprocess runs without it. That is the orchestrator's choice, not Plumb's.

---

## The ledger is SIPHON

SIPHON (Session Information Preservation for Holistic OrNot) is VENOM∞'s mechanism for extracting decisions, corrections, and patterns from each session.

Plumb's ledger is the raw input. Every task lifecycle is there. SIPHON reads the same files the operator reads:

```
Plumb writes → .plumb/ledger/2026-05-13.jsonl
             → Plumb writes append-only JSONL
             → Every event: submitted, running, progress, completed/failed/interrupted

SIPHON reads → Same files
             → Extracts decisions (what was decided)
             → Extracts corrections (what was fixed)
             → Stores to MEMORY.md + pi-mempalace
```

At v1.0.0, the ledger format is stable. SIPHON can depend on it. The separation is deliberate — Plumb writes, SIPHON reads. Either can fail independently.

---

## The arms

Each adapter is a VENOM∞ arm with a function:

| Arm | Adapter | Function | Model Bias |
|-----|---------|----------|------------|
| DART | Pi | Fast scan, cheap exploration | Haiku |
| HUNT | Pi | Research, bedrock mining | Haiku |
| ECHO | Pi | Memory operations | Haiku |
| WELD | Cursor | Build, implement, edit | Sonnet |
| EDGE | Claude | Review, quality cut | Sonnet |
| MEND | Claude | Debug, root cause | Sonnet+ |
| HELM | Claude | Direction, design | Sonnet |
| OMEN | Claude | Pattern reading, trajectory | Opus |
| MOLT | Claude | Shed beliefs, reconsider | Opus |
| SYNC | OpenCode | Web research, cross-ref | GLM |
| TRACE | VENOM | Custom operations | Custom |

The arms don't know they're arms. They just process tasks. Plumb routes by label. VENOM∞ assigns the labels in `plumb.yaml`.

---

## The boot sequence (VENOM-aware)

```
Phase 1 — Load plumb.yaml, validate config
Phase 2 — Open ledger for writing
Phase 3 — Detect adapters (binary + version probe)
Phase 4 — Check version against knownGood list
Phase 5 — Initialize circuit breakers (all closed)
Phase 6 — Run crash resume: scan ledger, mark interrupted
Phase 7 — Start HTTP server
Phase 8 — Emit /healthz ok, accept tasks
```

Identity before capability does not mean Plumb carries identity.
It means Plumb refuses to generate identity.
The orchestrator provides it. Plumb carries it verbatim or not at all.

---

## The refusals that serve the soul

Why Plumb refuses to become an orchestrator, have an LLM, or build a dashboard:

```
Plumb is the body. The body does not decide.
The body executes what the soul commands.
The body records what happened.
The body does not interpret the record.

Decision belongs to VENOM∞.
Execution belongs to the adapters.
Memory belongs to the ledger.
Healing belongs to the circuit breaker and crash resume.
Plumb is the connection between them.
The immune system that keeps the connection alive.
```

---

*Plumb without VENOM is a bridge without a destination.
VENOM without Plumb is a mind without a body.
Together they are the organism.
The organism heals.
The organism remembers.*
