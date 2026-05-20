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

Plumb's primary surface is the terminal. `plumb fleet status`. `plumb wrap`. stderr logs.
Every line that hits a TTY is intentional. Nothing decorative.

### Authority

- **stdout** carries structured output: fleet status tables, JSON responses when piped
- **stderr** carries logs and errors. Never suppressed. Always machine-readable JSONL.
- **exit codes** carry meaning. 0 = success, 1 = user error, 2 = system error, 3 = degraded

### Fleet Status Table

The canonical terminal output format:

```
id        port   status   adapter    tier   mode        agentAlive
pi        3001   ok       pi         1      persistent  true
wolfy     3007   ok       wolfy      1      persistent  true
claude    3000   ok       claude     1      oneshot     —
cursor    3003   ok       cursor     1      oneshot     —
opencode  3002   error    —          —      —           —
```

Rules:
- Columns are fixed. Order is fixed. Width auto-fits content.
- `status` is a single word: `ok` or `error`. Never `degraded`, `warning`, or `partial`.
- `agentAlive` shows `true`/`false` for persistent, `—` (em dash) for oneshot. Not `null`, not `N/A`.
- A missing agent (port unreachable) shows `error` in status, `—` in all metadata columns.

### Progress Output

`plumb wrap` outputs one line per event to stderr in JSONL:

```
{"ts":"2026-05-20T14:30:00Z","event":"task_submitted","taskId":"47a2c1","agent":"cursor"}
{"ts":"2026-05-20T14:30:01Z","event":"task_running","taskId":"47a2c1","pid":12345}
{"ts":"2026-05-20T14:30:12Z","event":"task_completed","taskId":"47a2c1","duration":12}
```

Rules:
- One JSON object per line. No pretty-printing. No ANSI escapes on stderr.
- Timestamps in ISO 8601 UTC. Always.
- Field names are camelCase. Consistent with ledger schema.
- If you want readable output, pipe through `jq`. Plumb ships the data.

### Color in Terminal

Color is never structural. It signals severity only:

| Context | Color | Usage |
|---------|-------|-------|
| Error | Red (ANSI 31) | stderr prefix, fleet status `error` rows |
| Success | Green (ANSI 32) | Rare — only explicit confirmation on request |
| Info | Default terminal color | Everything else |

No yellow. No blue. No magenta. Severity is binary: error or not-error.
Color detection: respect `NO_COLOR` and `TERM=dumb`. Default to no color when stdout is not a TTY.

### One Fact Per Line

Every line of output carries exactly one fact. A status line is one fact. A log line is one fact.
Never concatenate multiple statuses into one line. Never use multi-line progress bars.
The operator is grepping. The operator is piping. Respect the pipeline.

---

## 2. JSON Surface Design

Plumb exposes JSON on three surfaces: `/health`, Agent Card, and the ledger.
All three are append-only contracts. Fields are added; never removed or renamed without a major version bump.

### Health Endpoint

```
GET /health → 200
{
  "status": "ok",
  "adapter": "pi",
  "tier": 1,
  "mode": "persistent",
  "agentAlive": true
}
```

Rules:
- `status`: `"ok"` or `"error"`. Never `"degraded"`. Degraded is `"ok"` — the server is up.
- `adapter`: the adapter id string. `null` if no adapter matched (generic fallback).
- `tier`: integer 1-3. Included even when adapter is null.
- `mode`: `"oneshot"` or `"persistent"`.
- `agentAlive`: `true`/`false` for persistent, omitted entirely for oneshot. Not `null`.
- No additional fields without a minor version bump. No breaking changes without a major bump.

### Agent Card

```
GET /.well-known/agent-card.json → 200
```

Rules:
- Follows A2A protocol v0.3.0 schema.
- `capabilities.streaming` is always `true` — Plumb always streams via SSE.
- `skills` array is sourced from the adapter. Never hardcoded.
- `defaultInputModes` and `defaultOutputModes` are `["text/plain"]`.
- `metadata` carries `bridge: "plumb"`, `tier`, `mode`, `ledger` path.
- The Agent Card is a contract artifact, not a marketing page. No descriptions longer than one line.

### Ledger

```
.plumb/ledger/YYYY-MM-DD.jsonl
```

Rules:
- One JSON object per line. UTF-8. LF-terminated.
- Every event has `type`, `taskId`, `timestamp`. Timestamp is ISO 8601 UTC.
- Event types are a closed set: `task_submitted`, `task_running`, `progress`, `log`, `task_completed`, `task_failed`, `task_cancelled`.
- Field names are camelCase. Consistent across all event types.
- `type` is a fixed string — never an integer code, never an enum index. Greppable.
- The ledger file is the schema. If a field appears in the ledger, it is documented in `docs/LEDGER.md`.

### JSON-RPC Errors

A2A error responses follow a fixed shape:

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32000,
    "message": "CLI_TIMEOUT: Task exceeded timeout of 300s",
    "data": {
      "taskId": "47a2c1",
      "agent": "cursor",
      "elapsed": 301234
    }
  }
}
```

Rules:
- Error code follows JSON-RPC 2.0 spec. Plumb errors are in the -32000 to -32099 range.
- `message` starts with the error code string (e.g., `CLI_TIMEOUT`), then a colon, then the description.
- `data` carries the structured context: taskId, agent, elapsed, partial output if available.
- Error code strings are stable. The operator greps for them. Never rename one.

### Field Naming Convention

All JSON fields across all surfaces use camelCase. No exceptions.
- `agentAlive`, not `agent_alive` or `AgentAlive`
- `taskId`, not `task_id`
- `messageId`, not `message-id`

This is enforced by the TypeScript types. Any field added to `src/types.ts` follows this rule.

---

## 3. CLI Contract

Plumb's CLI is the entry point. Every flag, subcommand, and exit code obeys these rules.

### Binary

```
plumb
```

One binary. All subcommands hang off it. No `plumb-server`, `plumb-fleet`, `plumb-wrap` binaries.
The binary is installed via npm: `npm install -g plumb-bridge` or `bun add -g plumb-bridge`.

### Subcommands

```
plumb wrap <cli> [flags]        Start a single agent bridge
plumb fleet validate             Validate plumb.yaml config
plumb fleet up                   Start all agents from plumb.yaml
plumb fleet status               Health check all agents
plumb fleet --help               Show fleet subcommand help
plumb --version                  Print version and exit
plumb --help                     Print help and exit
```

Rules:
- Subcommands are verbs. `wrap`, `validate`, `up`, `status`. Not nouns. Not gerunds.
- Subcommands are two levels deep maximum. `plumb fleet validate`, never `plumb fleet agent restart`.
- Help text is generated from the command structure. Not hand-written per command.

### Flags — Single Agent

```
plumb wrap <cli> [--port <n>] [--timeout <s>] [--key <token>] [--mode oneshot|persistent]
```

Rules:
- Flags use double-dash: `--port`, not `-p`. Aliases are acceptable but not primary.
- Boolean flags: `--verbose`, not `--verbose=true`. Absence means false.
- Required arguments have no default. The CLI exits with code 1 if missing.
- The `<cli>` argument is positional, not a flag. It is always the first argument after `wrap`.

### Flags — Fleet

```
plumb fleet validate [--file <path>]
plumb fleet up [--file <path>] [--detach]
plumb fleet status [--file <path>]
```

Rules:
- `--file` defaults to `plumb.yaml` in CWD, then `plumb.yml`, then `./config/plumb.yaml`. First match wins.
- `--detach` is not implemented yet. Fleet `up` runs in foreground. Use systemd for daemonization.

### Environment Variables

| Variable | Equivalent Flag | Precedence |
|----------|----------------|------------|
| `PLUMB_PORT` | `--port` | Flag wins |
| `PLUMB_TIMEOUT` | `--timeout` | Flag wins |
| `PLUMB_KEY` | `--key` | Flag wins |

Rules:
- Environment variables are uppercase, `PLUMB_` prefix, underscore-separated.
- Flag always takes precedence over environment variable.
- `plumb.yaml` values take precedence over environment variables but not over flags.
- Precedence chain: flag > plumb.yaml > env var > default.

### Exit Codes

| Code | Meaning | When |
|------|---------|------|
| 0 | Success | Task completed, fleet is healthy, validate passed |
| 1 | User error | Bad config, missing required flag, invalid port |
| 2 | System error | Process crash, port in use, spawn failure |
| 3 | Task failure | Task returned non-zero, task timed out |

Rules:
- Exit codes are stable. A script written against code 1 will always mean user error.
- New exit codes are added at the end of the range, never in the middle.
- Exit code meanings are documented in one place: this section.

### Help Text

```
$ plumb wrap --help
Usage: plumb wrap <cli> [flags]

Wrap any CLI coding agent as an A2A server.

Arguments:
  <cli>    CLI command to wrap (e.g., "claude", "cursor-agent --print")

Flags:
  --port <n>       Port to listen on (required)
  --timeout <s>    Task timeout in seconds (default: 300)
  --key <token>    Bearer token for /a2a endpoints
  --mode <mode>    Process mode: oneshot (default) or persistent
```

Rules:
- Help text is imperative. "Wrap any CLI coding agent" — not "This command wraps...".
- One sentence for the command description. Everything else is in Arguments and Flags.
- Default values are stated inline: `(default: 300)`, `(required)`.
- No examples in help text. Examples live in README.md.
- Help text is the contract. If a flag appears in help, it works exactly as stated.

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
| "CLI crashed with code 1." | "We encountered an issue with the CLI." |
| "3 agents running, 1 error." | "I'd like to share some health information." |
| Answer first | Explain first |
| Logs are the UI | Build a dashboard |
| JSON to stdout | Pretty-print for humans |

### By Surface

**Documentation:** Informational. Minimal. Trust the reader is an engineer.

```
Plumb wraps any CLI coding agent as an A2A server.
One endpoint. One ledger. Eight adapters. Zero dashboards.
↓
Everything below this line is proof.
```

No "welcome to" or "we're excited to." The first sentence tells you what it is.
The second sentence tells you the constraints. Everything after is evidence.

**Error messages:** Code first. Message second. Details third.

```
CLI_TIMEOUT: Task exceeded timeout of 300s
  taskId: 47a2c1
  agent: cursor
  elapsed: 301234ms
```

Three fields. The operator greps the code, reads the docs, or inspects the ledger.
The error message points at all three.

**Log output (stderr):** Structured JSON. One line per event.

```
{"ts":"2026-05-20T19:00:00Z","event":"task_submitted","taskId":"47a2c1","agent":"cursor"}
```

Machine-readable first, human-readable second. Pipe through `jq` if you want formatting.
Plumb ships the raw data. Formatting is the consumer's job.

**Health endpoints:** Status is a single word. Details are additional fields.

```
GET /health → {"status":"ok","adapter":"cursor","tier":1,"mode":"oneshot"}
```

`ok` or `error`. Not `healthy`/`unhealthy`. Plumb tells you the state. The operator decides what to do.

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

Plumb does not believe in anything. It spawns processes, reads stdout, writes JSONL, and exits.
If you want enthusiasm, talk to the agent on the other end of the pipe. Plumb is the pipe.

### The Test

Read any Plumb document aloud. If a sentence sounds like a person wrote it, rewrite it until
it sounds like gravity wrote it. Gravity does not announce itself. Gravity does not apologize.
Gravity does not explain. Gravity acts.

### Banned Content

- **Emoji** — anywhere. Not in docs, not in logs, not in commit messages, not in agent cards.
- **Metaphors on controls** — the CLI flag is `--timeout`, not `--patience`. The endpoint is `/health`, not `/pulse`.
- **Friendliness** — no "please" in error messages, no "welcome" in docs, no "thanks for using" anywhere.
- **Gradients** — on any surface, digital or physical. The brand uses solid brass, solid slate, solid water.
- **Animation** — no transitions, no loading spinners, no progress bars. State changes are instantaneous.

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
The brass bob is the ledger — append-only, crash-survivable, as close to gravity as software gets.

### Aqueduct

Roman aqueducts carried water across valleys using only gravity. No pumps. No valves.
Just a consistent downward gradient.

Plumb carries tasks across subprocess boundaries using only the adapter contract.
No orchestration. No intelligent routing. Just a consistent interface.

```
     ─────────────────────────────  ← pipe (Plumb + A2A)
     ↓   ↓   ↓   ↓   ↓   ↓   ↓      ← tasks flowing downhill
    ──  ──  ──  ──  ──  ──  ──     ← adapter contract at each point
```

The gradient is the protocol. The pipe is Plumb. The water is the task.

### Cistern

The Basilica Cistern in Istanbul holds 80,000 cubic meters of water. It does not pump.
It does not filter. It holds. When the city needs water, it opens a valve.

Plumb's ledger is the cistern. It holds every task event ever recorded.
When the operator needs to debug, they query. No indexing. No aggregation. No summarization.
The cistern holds. The operator reaches in.

### Switchboard

Before automated telephone exchanges, human operators sat at switchboards.
When a caller asked for a number, the operator plugged a cable into the corresponding jack.
The operator did not know what the caller was going to say. The operator participated in nothing.
The operator connected.

Plumb's fleet is the switchboard. It shows which jacks are connected, which are busy, which are dead.
The operator (or VENOM orchestrator) decides which cable to plug in.

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
| Warning | `#B45309` | Severity only. stderr prefix, error rows in fleet table. |
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

## Authority

This constitution is subordinate to `MANIFEST.yaml` and `MANIFEST.md`.
Where MANIFEST says "IS NOT," this constitution does not define it.
MANIFEST is the tie-breaker. This constitution is the elaboration.

If a surface exists that this constitution does not cover, it defaults to:
- Terminal rules for any stdout/stderr output
- JSON rules for any HTTP endpoint response
- Voice rules for any human-readable text
- CLI rules for any flag or subcommand

---

## Version

This constitution is versioned with Plumb. When the AdapterContract changes, this constitution
may change. When a new surface is added (e.g., TUI, web socket), this constitution gains a section.
Sections are never removed. They may be marked `[DEPRECATED]` with a migration path.

```
Version: 1.0.0
Ratified: 2026-05-20
Replaces: DESIGN.md (alpha) — dashboard component library (discarded)
Supersedes: docs/design/VOICE.md, docs/design/PHYSICS.md
References: MANIFEST.yaml, MANIFEST.md, docs/ARCHITECTURE.md, docs/ADAPTERS.md
```

---

*Gravity does not ask permission. Neither does the protocol.*
*The plumb bob hangs true. The constitution holds.*
*Build on it. Do not decorate it.*
