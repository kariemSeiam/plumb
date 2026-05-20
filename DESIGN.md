---
version: 1.1.0
document: plumb-design-constitution
colors:
  cistern: "#0F172A"
  slate: "#475569"
  flow: "#64748B"
  water: "#F1F5F9"
  brass: "#C9A96E"
  warning: "#B45309"
  error: "#7F1D1D"
  success: "#3F6212"
typography:
  heading:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
  code:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
---

# DESIGN — The Plumb Constitution

```
Plumb is not a dashboard.
Plumb has no UI.
Plumb's design is the rules that govern its actual surfaces:
terminal output, JSON endpoints, CLI contract, voice, and brand physics.

This document is the constitution. Every surface obeys it.
It survives the company. It goes to the standards body.
```

---

## 1. Terminal Design

Plumb's primary surface is the terminal: `plumb fleet …`, `plumb wrap`, and **stderr JSONL** from `src/core/log.ts` and subprocess lifecycle. There is no separate “operator dashboard.” Human status for fleet operations is **lines on stderr**, not a formatted table on stdout.

### Authority

- **stdout**: Commander help and version text only (no fleet table, no task progress).
- **stderr**: structured logs — one JSON object per line from `log(level, msg, data?)` (`src/core/log.ts`).
- **exit codes** (`src/cli.ts`): **`0`** success, **`1`** any failure path that calls `process.exit` today. **No `2` or `3` are emitted.**

### Structured stderr (authoritative shape)

Every log line is JSON with:

| Field | Type | Meaning |
| --- | --- | --- |
| `ts` | string | ISO 8601 timestamp (`new Date().toISOString()`) |
| `l` | string | Level label (e.g. `info`, `warn`, `error`) |
| `m` | string | Message key / event name |

Additional keys are merged from the optional `data` object (camelCase keys as provided by call sites).

Example (fleet status, healthy agent):

```json
{"ts":"2026-05-20T20:00:00.000Z","l":"info","m":"fleet_agent_healthy","id":"pi","port":3001,"status":"ok"}
```

Example (wrap listening):

```json
{"ts":"2026-05-20T20:00:00.000Z","l":"info","m":"plumb_listening","port":3001,"adapter":"cursor","mode":"oneshot","endpoints":{"agentCard":"http://localhost:3001/.well-known/agent-card.json","jsonrpc":"http://localhost:3001/a2a/jsonrpc","rest":"http://localhost:3001/a2a/rest","health":"http://localhost:3001/health"}}
```

Example (process spawn from `ProcessManager`):

```json
{"ts":"2026-05-20T20:00:00.000Z","l":"info","m":"process_spawned","taskId":"<taskId>","cmd":"<binary>","pid":12345}
```

Rules:

- One JSON object per line. No pretty-printing in Plumb's logger.
- Field names **`l`** and **`m`** are fixed by `log()`; they are **not** renamed to `event` or `level`/`message` in this codebase.
- Optional arbitrary payloads extend the object (e.g. `taskId`, `port`, `adapter`, `error`).

### Fleet status behavior

`plumb fleet status` (`src/cli.ts`):

1. Resolves `plumb.yaml` via `resolveConfigPath` / `--config`.
2. `GET http://localhost:<port>/health` per agent.
3. Emits **`fleet_status_check`**, per-agent **`fleet_agent_healthy`** | **`fleet_agent_unhealthy`** | **`fleet_agent_down`**, then **`fleet_status_summary`**.
4. Exits **`0`** if all agents return HTTP OK; **`1`** if any fail or config missing.

There is **no** fixed-column table output. Operators use `jq`/`rg` on stderr JSONL.

### Color in terminal

`log()` writes plain UTF-8 JSON with **no ANSI color** in `src/core/log.ts`. Any future coloring must remain non-structural and respect `NO_COLOR` / `TERM=dumb` if introduced.

### One fact per line

Each `log()` invocation emits exactly one JSON line. No progress bars, no spinner frames, no multi-line “dashboard” frames.

---

## 2. JSON Surface Design

Plumb exposes JSON on **`/health`**, **`/.well-known/agent-card.json`**, JSON-RPC/REST via **`@a2a-js/sdk`**, the **ledger JSONL** under `.plumb/ledger/`, and **401** responses for bad auth. Only the **ledger file** is append-only persisted text by Plumb core; Agent Card and `/health` are computed responses.

### Health endpoint

`GET /health` (`src/core/server.ts`) returns **HTTP 200** and a JSON body. The handler **does not** branch on degraded state; **`status` is always the string `"ok"`** when the handler runs.

Shape (always present):

| Field | Type | Value |
| --- | --- | --- |
| `status` | string | Always `"ok"` |
| `agent` | string | Resolved agent name: `config.name` if set, else `` `${adapter.displayName}-plumb` `` |
| `adapter` | string | `adapter.id` (`echo`, `pi`, `cursor`, `generic`, …) |
| `mode` | string | `"oneshot"` \| `"persistent"` |
| `tier` | number | `1` \| `2` \| `3` |
| `ledger` | string | Absolute filesystem path from `Ledger.getPath()` |

Optional:

| Field | Type | When |
| --- | --- | --- |
| `agentAlive` | boolean | **Only if** `executor.isPersistentAlive() !== null` — i.e. **persistent** adapters (`true`/`false`). For **oneshot**, `isPersistentAlive()` returns `null` and **`agentAlive` is omitted** (the key is not set). |

There is **no** `null` sentinel in the JSON today; absence means “not applicable.”

### Auth failure (A2A routes only)

When `apiKey` is configured, unauthenticated requests to protected routes receive **401** with body:

```json
{ "error": { "message": "Unauthorized" } }
```

(`src/core/server.ts`. Health and Agent Card routes are registered **before** this middleware and stay public.)

### Agent Card

`GET /.well-known/agent-card.json` is served by **`@a2a-js/sdk`** from the object built in `createPlumbServer` (`src/core/server.ts`):

| Field | Source |
| --- | --- |
| `name` | `config.name ?? `${adapter.displayName}-plumb`` |
| `description` | `` `${adapter.displayName} via plumb — A2A bridge` `` |
| `protocolVersion` | `'0.3.0'` |
| `version` | `package.json` `version` via `getPackageVersion()` (falls back `0.0.0`) |
| `url` | `process.env.PLUMB_PUBLIC_URL` or `` `http://localhost:${port}` `` |
| `capabilities` | `{ streaming: true }` |
| `skills` | `adapter.skills` mapped to include `description: skill.name` |
| `defaultInputModes` | `['text/plain']` |
| `defaultOutputModes` | `['text/plain']` |
| `metadata` | `{ bridge: 'plumb', tier, mode, ledger: <ledger path> }` |

Redirect: `GET /.well-known/agent.json` → `/.well-known/agent-card.json` (302).

### Ledger (JSONL)

Path: **`.plumb/ledger/YYYY-MM-DD.jsonl`** (`src/core/ledger.ts`). One UTF-8 line per event, LF-terminated, `JSON.stringify` + `\n`.

`Ledger.append` on filesystem error: logs **`ledger_write_failed`** via `log()` and **swallows** the error — the event is **not** guaranteed to persist.

Event types and fields (`src/types.ts`):

- **`task_submitted`**: `type`, `taskId`, `cli`, `message`, `timestamp`
- **`task_running`**: `type`, `taskId`, `timestamp`
- **`progress`**: `type`, `taskId`, `text`, `timestamp`
- **`log`**: `type`, `taskId`, `level`, `text`, `timestamp`
- **`task_completed`**: `type`, `taskId`, `timestamp`
- **`task_failed`**: `type`, `taskId`, `error`, `timestamp`
- **`task_cancelled`**: `type`, `taskId`, `timestamp`

`timestamp` is ISO 8601 string (`new Date().toISOString()` in call sites). Human reference: **`docs/LEDGER.md`**.

### JSON-RPC / A2A errors

Task failures surface through **`@a2a-js/sdk`** handlers. **`PlumbExecutor`** publishes user-visible strings such as:

- `No message text provided.` (empty text parts)
- `` `Task timed out after ${timeout}s` `` (timeout)
- Adapter `error` events: `ev.message`
- Nonzero exit without prior settlement: `` `Process exited with code ${code}` ``

There is **no** Plumb-enforced **`CLI_TIMEOUT:`** prefix or reserved JSON-RPC **`-32000..-32099`** namespace in `src/`. Do not document stable `CLI_*` grep tokens for JSON-RPC until implemented and tested.

### Field naming (Plumb-owned JSON)

Ledger and `log()` payloads use **camelCase** keys (`taskId`, `agentAlive`). The SDK uses its own shapes on the wire; Plumb normalizes inbound message parts (`kind` vs `type`) inside **`PlumbExecutor.execute`** only for extracting text — it does not redefine the public SDK schema in this file.

---

## 3. CLI Contract

Entry: **`plumb`** (`src/cli.ts`, Commander).

### Binary

Single **`plumb`** entry; subcommands `wrap` and `fleet`.

### Subcommands (as implemented)

```
plumb wrap <cli> [options]
plumb fleet validate [options]
plumb fleet status [options]
plumb fleet up [options]
plumb --version
plumb --help
```

`fleet` without a subcommand shows Commander help.

### `plumb wrap <cli>`

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `-p, --port <number>` | `3001` | Listen port (validated 1–65535) |
| `--name <name>` | — | Agent Card / health `agent` name override |
| `--workdir <dir>` | — | `cwd` / task workdir |
| `--timeout <seconds>` | `300` | Maps to `PlumbConfig.taskTimeout` |
| `--key <apiKey>` | — | Bearer token for `/a2a/*` when set |

There is **no** `--mode` flag: mode comes from **`detectAdapter(cli).mode`**.

**Precedence:** Commander flags + these defaults only. **`plumb wrap` does not read `plumb.yaml`.**

### `plumb fleet …`

Config path resolution (`src/config.ts`):

- Flag **`-c, --config <path>`** if provided and file exists.
- Else first existing of: `plumb.yaml`, `plumb.yml`, `./config/plumb.yaml`.
- Missing file → `config_not_found` log, exit **`1`**.

Commands:

- **`validate`**: load YAML, `validateFleetConfig`, exit **`0`** or **`1`**.
- **`status`**: HTTP probe each agent, exit **`0`** or **`1`**.
- **`up`**: validate, spawn one `createPlumbServer` per agent, bind ports, block until SIGINT/SIGTERM (then shutdown), exit **`0`**; validation/spawn errors exit **`1`**.

`--detach` **does not exist** in code (do not document).

### Fleet YAML schema (parsed)

`FleetConfig` (`src/config.ts`):

- **`version`**: string (default `'1'` if absent in YAML)
- **`agents[]`** each with:
  - **`id`**, **`cli`**, **`port`** (required)
  - **`mode`**, **`workdir`**, **`timeout`**, **`name`**, **`apiKey`**, **`env`**, **`labels`**, **`sessionStore`** (optional)

**Runtime mapping** uses **`agentToPlumbConfig`**: passes **`cli`, `port`, `name`, `workdir`, `taskTimeout` (from `timeout` or default 300), `apiKey`, `env`** into **`PlumbConfig`**. Adapter selection is **`detectAdapter(agent.cli)`** — YAML **`mode`** does not override adapter mode in current wiring. **`labels`** and **`sessionStore`** are parsed into `FleetAgent` but **not consumed** by fleet boot or `createPlumbServer` in `src/cli.ts`.

### Environment variables

**Implemented in `src/` today:**

- **`PLUMB_PUBLIC_URL`**: overrides Agent Card `url` in `createPlumbServer` (`src/core/server.ts`).

**Not implemented** (do not document as binding):

- `PLUMB_PORT`, `PLUMB_TIMEOUT`, `PLUMB_KEY` — no reads in `src/cli.ts` / `src/config.ts`.

Other secrets (e.g. **`CURSOR_API_KEY`**) are adapter-specific.

### Exit codes (actual)

| Code | When (`src/cli.ts`) |
| --- | --- |
| `0` | Success; graceful fleet shutdown after signal |
| `1` | Invalid port, config errors, validation failure, any agent unhealthy in `fleet status`, fleet `up` failures |

No other numeric exits are defined in the CLI source.

### Help text

Generated by Commander from `.option()` / `.description()` registrations — not hand-maintained prose in-repo per command beyond those strings.

---

## 4. Voice

```
Plumb has no enthusiasm.
Plumb has no personality.
Plumb has precision.
```

### The Voice Contract

| Do | Don't |
|----|-------|
| State | Hedge |
| "Task timed out after 300s." | "It seems the task may have timed out." |
| "Process exited with code 1." | "We encountered an issue with the CLI." |
| "3 agents running, 1 error." | "I'd like to share some health information." |
| Answer first | Explain first |
| Logs are the UI | Build a dashboard |
| JSONL to stderr | Pretty-print for machines |

### By Surface

**Documentation:** Informational. Minimal. Trust the reader is an engineer.

```
Plumb wraps any CLI coding agent as an A2A server.
One endpoint. One ledger. Adapters live in src/adapters. Zero dashboards.
↓
Everything below this line is proof.
```

**Executor/tool traces:** When mapping `tool-result` adapter events to accumulated text, the bridge may insert **Unicode check/cross marks (U+2713 / U+2717)** as deterministic glyphs in plain-text progress lines (`src/core/executor.ts`). This is **not** the emoji ban in the sense of expressive pictographs (🎉, etc.); it is explicit, stable punctuation in structured output. The **MANIFEST** emoji refusal still applies to marketing flourishes and log **keys** — not to this delimiter convention until removed from code.

**Log output (stderr):** Structured JSON via `log()`. Pipe through `jq`.

**Health JSON:** `{ "status": "ok", … }` as implemented; operators infer liveness from fields and fleet stderr.

### What Plumb Never Says

```
"We're excited to announce..."
"It seems like the task may have..."
"Based on our analysis..."
"I'd be happy to help you with..."
"Great question!"
"Let me break that down for you..."
"Our platform enables..."
"We believe in..."
```

Plumb does not believe in anything. It spawns processes, reads stdout, writes JSONL, and exits. If you want enthusiasm, talk to the agent on the other end of the pipe. Plumb is the pipe.

### The Test

Read any Plumb document aloud. If a sentence sounds like a person wrote it, rewrite it until it sounds like gravity wrote it. Gravity does not announce itself. Gravity does not apologize. Gravity does not explain. Gravity acts.

### Banned Content

- **Emoji** — expressive pictographs in docs, marketing, commit messages, agent cards, and log **message keys** (`m` values should stay alphanumeric/snake-case facts). See §4 note on U+2713/U+2717 in executor output.
- **Metaphors on controls** — the CLI flag is `--timeout`, not `--patience`. The endpoint is `/health`, not `/pulse`.
- **Friendliness** — no "please" in error messages, no "welcome" in docs, no "thanks for using" anywhere.
- **Gradients** — on any surface, digital or physical. The brand uses solid brass, solid slate, solid water.
- **Animation** — no transitions, no loading spinners, no progress bars. State changes are instantaneous where Plumb controls them.

---

## 5. Brand Physics

```
A plumb bob is a lead weight on a string.
It does nothing except hang.
Its authority comes from gravity,
which is older than any building.
```

### The Plumb Bob

Hang a weight from a string. The weight settles. The string defines true vertical.
Every wall ever built true is true because someone hung a plumb bob next to it.

Plumb's physical manifestation:

```
        │
        │  ← string (the A2A protocol)
        │
      ──┼──  ← reference plane (the adapter contract)
        │
        ●  ← brass plumb bob (the ledger — gravity-true, undeniable)
```

The string is the A2A protocol. Fixed. Non-negotiable.
The reference plane is the adapter contract — the interface between agents and the physical world.
The brass bob is the ledger — append-only intent, crash-exposed honestly when I/O fails.

### Aqueduct

Roman aqueducts carried water across valleys using only gravity. No pumps. No valves.
Just a consistent downward gradient.

Plumb carries tasks across subprocess boundaries using only the adapter contract.
No orchestration inside this repository. No intelligent routing. Just a consistent interface.

```
     ─────────────────────────────  ← pipe (Plumb + A2A)
     ↓   ↓   ↓   ↓   ↓   ↓   ↓      ← tasks flowing downhill
    ──  ──  ──  ──  ──  ──  ──     ← adapter contract at each point
```

The gradient is the protocol. The pipe is Plumb. The water is the task.

### Cistern

The Basilica Cistern in Istanbul holds 80,000 cubic meters of water. It does not pump.
It does not filter. It holds. When the city needs water, it opens a valve.

Plumb's ledger is the cistern. It holds every task event appended successfully.
When the operator needs to debug, they query. No indexing inside Plumb. No summarization.
The cistern holds. The operator reaches in — knowing writes can fail silently today (`ledger_write_failed`).

### Switchboard

Before automated telephone exchanges, human operators sat at switchboards.
When a caller asked for a number, the operator plugged a cable into the corresponding jack.
The operator did not know what the caller was going to say. The operator participated in nothing.
The operator connected.

Plumb's fleet is the switchboard. stderr lines show which jacks answered HTTP, which returned errors, which were unreachable.
The operator (or upstream orchestrator) decides which cable to plug in.

### The Map

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
    │  (pi)     │       │ (cursor)  │       │ (wolfy)  │
    └───────────┘       └───────────┘       └───────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Ledger (JSONL)      │  ← The plumb bob
                    │  gravity-true record │
                    └─────────────────────┘
```

### Colors

Colors exist for terminal output and documentation rendering. They are not a design system —
they are a constraint on what colors may appear on any Plumb surface.

| Name | Hex | Role |
|------|-----|------|
| Cistern | `#0F172A` | Dark surface. Doc code blocks, terminal backgrounds. |
| Slate | `#475569` | Structural. Borders, secondary text, pipe lines. |
| Flow | `#64748B` | Muted detail. Timestamps, metadata, de-emphasized info. |
| Water | `#F1F5F9` | Light surface. Doc backgrounds, primary text on dark. |
| Brass | `#C9A96E` | The only accent. Active states, the plumb bob itself. Aged brass, not polished gold. |
| Warning | `#B45309` | Severity only. stderr / log severity (no rendered fleet table). |
| Error | `#7F1D1D` | Fatal only. Process crash, unrecoverable state. |
| Success | `#3F6212` | Confirmation only. Rarely used. |

Rules:

- Brass on water backgrounds is forbidden. Contrast ratio 2.1:1 — fails WCAG AA.
- Brass on cistern or slate only.
- No more than 8 colors. These are the palette. No additions without a version bump.
- Colors are never the sole carrier of information. Every color-coded element also has text.

### Typography

For documentation and terminal output:

| Role | Font | Size | Weight | Line Height |
|------|------|------|--------|-------------|
| Headings | Inter | 1.5rem | 600 | 1.2 |
| Body | Inter | 1rem | 400 | 1.6 |
| Code/Logs | JetBrains Mono | 0.875rem | 400 | 1.5 |
| Labels | Inter | 0.75rem | 500 | 1.4 |

Rules:

- Inter for prose. Chosen because it is invisible — the reader experiences information, not the typeface.
- JetBrains Mono for code. No ligatures. The vertical rhythm matches JSONL ledger density.
- Labels at 500 weight with 0.08em positive tracking. All-caps is forbidden — tracking provides hierarchy without shouting.
- These are documentation and terminal conventions. They are not CSS rules for a nonexistent dashboard.

### The Limitation

Metaphors break. This one breaks at the edge of Plumb's responsibility.

A plumb bob cannot:

- Tell you if the foundation will hold
- Predict when the wall will crack
- Decide which wall to build next

Plumb cannot:

- Tell you if the agent is giving good answers
- Predict when the upstream CLI will change its format
- Decide which agent should handle a task

The operator is the architect. Plumb provides the reference. It does not provide the judgment.
This is not a bug. It is the design. Judgment is the operator's job.

---

## 6. Conformance (honesty tests)

This constitution is falsifiable. A CI suite **should** hold it true:

1. **`/health` schema snapshot** — Response includes `status`, `agent`, `adapter`, `mode`, `tier`, `ledger`; `agentAlive` only when `.mode === 'persistent'` in the running server config; always HTTP 200 from the handler.
2. **401 auth body** — When `apiKey` set, protected route without `Authorization: Bearer …` returns `{ "error": { "message": "Unauthorized" } }`.
3. **Agent Card shape** — Snapshot `name`, `description`, `protocolVersion`, `version`, `url`, `capabilities.streaming === true`, `skills[]`, `defaultInputModes`, `defaultOutputModes`, `metadata.bridge`, `metadata.tier`, `metadata.mode`, `metadata.ledger`.
4. **Ledger line grammar** — Golden-file each `LedgerEvent` variant with required keys; assert `append` either extends the file or results in **`ledger_write_failed`** log line on injectable I/O failure (optional fault injection).
5. **stderr log schema** — Every `log()` line parses as JSON and contains `ts`, `l`, `m`.
6. **CLI exit codes** — `plumb` commands exit only `0` or `1` in automated runs; map specific failure paths (`invalid_port`, `validation_failed`, `fleet` partial health) to `1`.
7. **Fleet stderr events** — Presence and shape of `fleet_status_summary`, `plumb_listening`, etc., under scripted runs.
8. **`PlumbConfig` / fleet mapping** — YAML round-trip: only documented keys reach `createPlumbServer`; document drift if `labels` / `sessionStore` remain unused.
9. **Registry order** — Snapshot `KNOWN_ADAPTERS` detection precedence (`echo` → `pi` → `wolfy` → `claude` → `cursor` → `opencode` → `venom` → fallback `generic`) matching `src/adapters/registry.ts`.

Failing tests mean **either fix the code or fix this doc** — never both silent.

---

## Authority

This constitution is subordinate to **`MANIFEST.yaml`** and **`docs/MANIFEST.md`**.
Where MANIFEST says "IS NOT," this constitution does not define it.
MANIFEST is the tie-breaker. This constitution is the elaboration.

If a surface exists that this constitution does not cover, it defaults to:

- Terminal rules for any stdout/stderr output
- JSON rules for any HTTP endpoint response
- Voice rules for any human-readable text
- CLI rules for any flag or subcommand

---

## Version

```
Version: 1.1.0
Ratified: 2026-05-20
Replaces: DESIGN.md v1.0.0 (aspirational / code drift)
Supersedes: docs/design/VOICE.md, docs/design/PHYSICS.md (if present)
References: MANIFEST.yaml, docs/MANIFEST.md, docs/LEDGER.md, src/core/server.ts, src/core/log.ts, src/cli.ts, src/types.ts
```

---

*Gravity does not ask permission. Neither does the protocol.*  
*The plumb bob hangs true. The constitution holds.*  
*Build on it. Do not decorate it.*
