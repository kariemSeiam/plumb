# ═══════════════════════════════════════════
# PLUMB · Quiet pipes for noisy agents
# ═══════════════════════════════════════════

```
╔══════════════════════════════════════════╗
║          PLUMB · v1.0.0                  ║
║                                          ║
║   ┌─────────┐     ┌─────────┐           ║
║   │ Claude  │     │  Cursor │           ║
║   │ :3002   │     │ :3003   │           ║
║   └────┬────┘     └────┬────┘           ║
║        │               │                ║
║   ┌────┴───────┬───────┴────┐           ║
║   │    PLUMB ( :3000 )      │           ║
║   │   The switchboard       │           ║
║   └────┬───────┬───────┬────┘           ║
║        │       │       │                ║
║   ┌────┴┐ ┌───┴───┐ ┌─┴──────┐         ║
║   │ Pi  │ │Venom  │ │OpenCode│         ║
║   │:3001│ │:3004  │ │:3005   │         ║
║   └─────┘ └───────┘ └────────┘         ║
║                                          ║
║   ┌──────────────────────────────────┐   ║
║   │ /agents · /ledger · /healthz     │   ║
║   │ A2A · JSON-RPC · SSE · INK-lite │   ║
║   └──────────────────────────────────┘   ║
╚══════════════════════════════════════════╝
```

Plumb wraps any CLI coding agent as an A2A server.
One AdapterContract. Eight implementations. One ledger format. Zero dashboards.

---

## Table of Contents

```
design/                — What Plumb looks like and how it speaks
  DESIGN.md            · Colors, typography, components
  VOICE.md             · The voice: state, don't hedge
  PHYSICS.md           · The plumb bob, gravity, the metaphor

core/                  — What Plumb is
  ARCHITECTURE.md      · How it works, end to end
  PROTOCOL.md          · A2A endpoints, INK-lite, SSE
  ADAPTERS.md          · 7 adapters, tiers, modes
  LEDGER.md            · Append-only JSONL, SIPHON extraction
  ERRORS.md            · Error taxonomy, cancellation, recovery
  CONFIG.md            · plumb.yaml format
  PULSE.md             · Observability, metrics, health

fleet/                 — What Plumb runs
  FLEET.md             · Multi-agent, routing, orchestrator
  OPERATIONS.md        · Deployment, systemd, Docker

soul/                  — What animates Plumb
  PACT.md              · VENOM∞ integration
  EVOLUTION.md         · v0.1 → v1.0.0 → afterlife
  REFUSALS.md          · What Plumb will never build

physical/              — The artifact
  BOB.md               · The brass plumb bob

∞.md                   — The horizon
```

---

## One sentence

Plumb is the adapter layer between any CLI agent and any A2A-compatible orchestrator. It does not think. It does not decide. It spawns, reads, writes, and exits. The ledger is the record. The operator is the intelligence.

---

## Quick facts

- **Runtime:** TypeScript on Bun
- **Protocol:** A2A via @a2a-js/sdk
- **Tests:** 90 tests, 156 assertions (7 test files, growing to 190+ at v1.0.0)
- **Adapters:** 8 (echo, pi, wolfy, claude, cursor, opencode, venom, generic)
- **Concurrency:** Configurable max (default 4)
- **Ledger:** Append-only JSONL
- **Refusal:** No dashboard, no LLM, no orchestration

---

## The origin

Plumb was not the first name. It was the last.

Three framings — The Notary's Bench (portable trust), The Plumb Line (gravity-true reference), The Port City (where strangers dock). Forty-five names explored. The bet column settled it at $10M: Plumb, because the name is boring enough to survive procurement and heavy enough to mean something on a machined brass bob.

The product saves the brand. Not the other way around.

---

*Plumb is the pipe. Not the water. Not the reservoir. Not the plumber.*
