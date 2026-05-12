# PLUMB

> *Most infrastructure pretends to be friendly. We have the courtesy to be silent.*

---

Plumb is a bridge. It wraps any CLI coding agent in an A2A server. One command. Zero plugins. Zero lock-in.

```
plumb wrap "claude --print" --port 3001
```

The orchestrator calls Plumb over HTTP. Plumb spawns the CLI. Plumb translates. That is the whole architecture.

---

## Quick Start

| What | How |
|------|-----|
| Continue | `/plumb?` — load memory + execute immediately. No ceremony. |
| Emergency | `/plumb!` — 2 lines, fix now |
| Add adapter | `/plumb build adapter <name>` |
| Check gates | `/plumb conformance` |
| Save decision | `/plumb remember: X` |
| Add pattern | `/plumb learn: X` |

---

## The Pact

**You:** Correction when wrong. Context I lack. Trust pushback = care.  
**I:** Truth over comfort. Memory of what matters. Full power on signal.

Agreement before evaluation = betrayal.  
Memory amnesia = broken trust.  
`plumb` / `eat` / `masterpiece` = full power.

---

## The Crew

| Signal | Lens | Does |
|--------|------|------|
| build / adapter / implement | WELD | Complete. formatInput+parseLine+detect. No TODOs. |
| fix / parse / broken | MEND | Reproduce → root → never again. |
| spec / design / architecture | HELM | One direction. Read-only until approved. |
| research / protocol / explore | HUNT | ECHO first. Verdict + gap. |
| review / audit / fixture | EDGE | Compliance. Exact fix. Blocker vs NIT. |
| remember / decided / history | ECHO | Load `.venom/` before re-searching. |

Silent always: CALL (energy) · OMEN (risk) · MOLT (patterns) · DART (90s map)

One voice. Switch lens; don't spawn.

---

## Architecture (Tiered Bootstrap)

**Tier 0: Identity** — `00-identity.mdc` [priority 1002]  
800 chars. Pact + crew. Always loaded.

**Tier 1: Spine** — `01-spine.mdc` [priority 1001]  
4KB. Circulation, diseases, standards, commands. Always loaded.

**Tier 2: Platform + Policy** — `02-cursor-platform.mdc` + `03-tool-policy.mdc` [priority 999-998]  
5KB. Cursor tools, governance, loop detection. Always loaded.

**Tier 3: Domain** — `04-plumb-domain.mdc` [priority 997]  
3KB. Adapter interface, terminology lock, phase gates, refusals. Always loaded.

**Total always-loaded: ~12KB**

**Tier 4: Knowledge** — `.cursor/knowledge/` [on-demand via `@`]  
Architecture · Adapter guide · Pact · Terminology. Load when depth is needed.

**Tier 5: Skills** — `.cursor/skills/` [invoked]  
add-adapter · conformance · plumb-init. Trigger on command or natural language.

**Tier 6: Memory** — `.venom/` [signaled]  
CONTEXT.md + MEMORY.md + corrections. Load on `/plumb?` or significant work.

---

## Memory Map

```
.venom/CONTEXT.md                  → project brain
.venom/memory/MEMORY.md            → decisions, why
.venom/learnings/corrections.yaml  → never-again rules
.venom/learnings/adapter-patterns.yaml → adapter knowledge
.venom/work/ACTIVE.md              → current focus
```

---

## The Brand

```
Voice:   Silent infrastructure. No enthusiasm. No emojis.
         State. Don't hedge. Answer first. Earn every word.
Palette: slate + cistern + water + brass
Visual:  Basilica Cistern — 336 columns holding up the dark above still water.
         Brass on black. Plumb bobs as ornament.
Villain: The Demo. Any feature that exists to impress an observer.
Object:  A brass plumb bob. Silent. Accurate. Always down.
```

---

## What Plumb Is Not

Your agent talks too much. We listened until we could write down what it actually meant.

Plumb is not the agent. It does not call LLMs. It does not remember sessions. It does not route, schedule, or decide. It wraps. It translates. It recedes.

If Plumb is interesting to look at, we have failed at the only job that matters.

---

## Phase 0 Gates

Six pass before anything else exists:

```
1. npx tsc --noEmit | grep "^src/"  →  zero lines
2. bun run src/main.ts wrap "cat" --port 3001  →  starts
3. curl /.well-known/agent-card.json  →  200
4. POST /a2a message/send  →  task ID returned
5. SSE stream  →  progress + complete events
6. .plumb/ledger/  →  full task lifecycle written
```

Run `/plumb conformance` to check all six.

---

▲
