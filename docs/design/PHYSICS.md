# PHYSICS — The Metaphor

> **Superseded by [DESIGN.md](../../DESIGN.md) §5 — Brand Physics.** This document is retained for historical reference. The authoritative brand physics now live in the Plumb Constitution.

```
A plumb bob is a lead weight on a string.
It does nothing except hang.
Its authority comes from gravity,
which is older than any building.
```

---

## The plumb bob

Hang a weight from a string. The weight settles. The string defines true vertical. Every wall ever built true is true because someone hung a plumb bob next to it.

Plumb's physical manifestation:

```
        │
        │  ← string (the A2A protocol)
        │
      ──┼──  ← reference plane (the adapter contract)
        │
        ●  ← brass plumb bob (the ledger — gravity-true, undeniable)
```

The string is the A2A protocol. Fixed. Non-negotiable. The reference plane is the adapter contract — the interface between LLM agents and the physical world. The brass bob is the ledger — append-only, crash-survivable, as close to gravity as software gets.

---

## Aqueduct

Roman aqueducts carried water across valleys using only gravity. No pumps. No valves. Just a consistent downward gradient.

Plumb carries tasks across subprocess boundaries using only the adapter contract. No orchestration. No intelligent routing. Just a consistent interface.

```
     ─────────────────────────────  ← pipe (Plumb + A2A)
     ↓   ↓   ↓   ↓   ↓   ↓   ↓      ← tasks flowing downhill
    ──  ──  ──  ──  ──  ──  ──     ← adapter contract at each point
```

The gradient is the protocol. The pipe is Plumb. The water is the task.

---

## Cistern

The Basilica Cistern in Istanbul holds 80,000 cubic meters of water. It does not pump. It does not filter. It holds. When the city needs water, it opens a valve.

Plumb's ledger is the cistern. It holds every task event ever recorded. When the operator needs to debug, they query. No indexing. No aggregation. No summarization. The cistern holds. The operator reaches in.

---

## Switchboard

Before automated telephone exchanges, human operators sat at switchboards. When a caller asked for a number, the operator plugged a cable into the corresponding jack. The operator did not know what the caller was going to say. The operator did not participate in the conversation. The operator connected.

Plumb's `/agents` endpoint is the switchboard. It shows which jacks are connected, which are busy, which are dead. The operator (or a higher-level orchestrator) decides which cable to plug in.

---

## The map

```
                    ┌─────────────────────┐
                    │    A2A Protocol      │  ← The string
                    │   (JSON-RPC + SSE)   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Plumb Bridge        │  ← The hanger
                    │  (adapter contract)   │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐       ┌─────▼─────┐       ┌─────▼─────┐
    │ CLI Agent │       │ CLI Agent │       │ CLI Agent │  ← The walls
    │  (pi)     │       │ (cursor)  │       │ (claude)  │
    └───────────┘       └───────────┘       └───────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Ledger (JSONL)      │  ← The plumb bob
                    │  gravity-true record │
                    └─────────────────────┘
```

---

## The limitation

Metaphors break. This one breaks at the edge of Plumb's responsibility.

A plumb bob cannot:
- Tell you if the foundation will hold
- Predict when the wall will crack
- Decide which wall to build next

Plumb cannot:
- Tell you if the agent is giving good answers
- Predict when the upstream CLI will change its format
- Decide which agent should handle a task

The operator is the architect. The operator decides which agents to trust, which tasks to route where, and when to upgrade the CLI versions. Plumb provides the reference. It does not provide the judgment.

This is not a bug. It is the design. Judgment is the operator's job. Plumb does one thing — hang true.
