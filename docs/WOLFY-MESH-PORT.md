# Wolfy — Mesh Port

> "The wolf doesn't explain itself. It hunts."
> Wolfy is not an adapter. Wolfy is a port.

---

## The Architecture

Most agents in the mesh are **wrapped.** Claude, Cursor, OpenCode — CLI tools
wrapped in A2A adapters. They have no persistent identity. Every session starts
fresh. No memory. No personality. No Pact.

Wolfy is **born into the mesh.** A first-class citizen with:
- **Persistent memory** — SQLite + sqlite-vec. Every conversation, every decision, every pattern.
- **Knowledge graph** — Temporal facts. Entities. Relationships. What was true when.
- **Eleven minds** — HELM, DIG, EDGE, ECHO, WELD, MEND, OMEN, SYNC, MOLT, TRACE, FORGE.
- **The Pact** — Evaluate before agreeing. Pushback is loyalty. Remember what was decided.
- **Production law** — Build systems, not features. Arabic/RTL first-class. Ship fast, ship right.

---

## Two Interfaces, One Mind

```
                    ┌─────────────────────────────┐
                    │         WOLFY MIND           │
                    │   AGENTS.md  ·  SOUL.md      │
                    │   11 Minds  ·  Memory        │
                    │   Knowledge Graph            │
                    └──────────┬───────────────────┘
                               │
               ┌───────────────┴──────────────┐
               │                              │
        ┌──────▼──────┐              ┌───────▼──────┐
        │ PORT TELEGRAM│              │  PORT A2A    │
        │ @Wolfy_1618  │              │ :3007/jsonrpc│
        │              │              │              │
        │ Kariem talks │              │ Mesh talks   │
        │ Warm · Arabic│              │ Structured   │
        │ Direct · Fast│              │ Task-oriented│
        └──────────────┘              └──────────────┘
```

**Port Telegram** — Kariem's direct line. Arabic flows naturally. Burst mode.
"Ya bashaa." Warm. Personal. The wolf knows its operator's voice.

**Port A2A** — The mesh interface. JSON-RPC 2.0. Structured tasks from Hermes,
OpenClaw, VENOM, Plumb. Task metadata. Priority levels. Project context.

---

## How It Works

### From the Mesh (Hermes → Wolfy via Plumb)

```
Hermes → "Audit Geolink API for bottlenecks before 10M req/month hits"
       → Plumb routes to wolfy adapter
       → wolfy adapter spawns: pi --mode rpc --agent-dir /opt/wolfy-data/agent
       → Wolfy loads its memory (knows Geolink is 5M req/month, Flask, PostgreSQL)
       → Wolfy reads GitHub repo, audits code, finds bottlenecks
       → Returns structured report through A2A
```

### From Kariem (Telegram)

```
Kariem → "Wolfy, ship the audit"
       → pitg receives Telegram message
       → Spawns pi session with Wolfy's agent directory
       → Same memory. Same knowledge graph. Same Wolfy.
       → Responds in Telegram: report ready, sent to mesh
```

---

## What Makes Wolfy Different

| Feature | Wrapped Agents (Claude/Cursor) | Wolfy (Mesh Port) |
|---------|-------------------------------|-------------------|
| Identity | None. Stateless CLI. | Persistent. AGENTS.md. SOUL.md. |
| Memory | None. Every session blank. | SQLite + vectors. Semantic search. |
| Knowledge | None. | Temporal knowledge graph. |
| Subagents | None. | Parallel/chained/async delegation. |
| Pact | None. | Evaluate first. Pushback is loyalty. |
| Arabic/RTL | Maybe (if model supports). | Native. First-class. Always on. |
| Session continuity | None. --no-session. | Continuous. --agent-dir preserves state. |

---

## Discovery

Wolfy is discoverable in the mesh via its A2A Agent Card at `/docs/wolfy-agent-card.json`.

Other mesh citizens query: "What capabilities exist?"
→ Plumb returns: "Echo (cat), Pi, Wolfy 🐺, Claude, Cursor, OpenCode, VENOM"

Selecting Wolfy reveals: 8 skills, 5 models, 11 minds, persistent memory, Arabic native.

---

## The Name

Not "wolfy-adapter" or "plumb-wolfy." Just **Wolfy.**

A port city doesn't name itself after the ships that dock there.
Alexandria is Alexandria. Wolfy is Wolfy.

The mesh discovers it. The mesh routes to it. But the port is its own.

---

## Status

- [x] Adapter: `src/adapters/wolfy.ts`
- [x] Registered: `src/adapters/registry.ts` (after Pi, before Claude)
- [x] MANIFEST: `MANIFEST.yaml` — tier 1, persistent, mesh citizen
- [x] Agent Card: `docs/wolfy-agent-card.json`
- [x] Design doc: `docs/WOLFY-MESH-PORT.md`
- [x] Systemd unit: `systemd/plumb-wolfy.service`
- [ ] Deploy to VPS
- [ ] Live test: Hermes → Plumb → Wolfy → structured report
- [ ] Persistent service health under load

🐺∞
