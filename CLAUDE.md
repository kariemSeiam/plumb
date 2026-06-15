# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Plumb wraps any CLI coding agent into an [A2A](https://google.github.io/A2A/)-compliant HTTP server in one command (`plumb wrap claude --port 3000`). It spawns the agent as a subprocess, writes the task to its stdin, parses its stdout line-by-line into A2A events streamed back over SSE, and records every lifecycle event to an append-only JSONL ledger. It is a transport layer — it does not call an LLM, orchestrate, or remember.

The contract is the architecture: `Orchestrator → HTTP/JSON-RPC → Plumb → stdin/stdout → CLI agent → parseLine → A2A events out`.

## Commands

```bash
bun test                      # full suite (~117 tests across 8 files); also the CI gate
bun test test/rpc.test.ts     # single file
bun test -t "circuit"         # single test by name pattern
bun run typecheck             # tsc --noEmit — THE lint/correctness gate (no separate linter)
bun run start                 # plumb CLI (= bun run src/main.ts)
plumb wrap cat --port 3001    # smoke test: wrap `cat`, the echo conformance adapter
```

`bun run typecheck` against deps produces noise; the project's gate is that **`tsc --noEmit` output filtered to `^src/` lines is empty**. Requires Bun >= 1.1.0 (ESM, `.ts` imported directly — note the explicit `.ts` extensions in imports). No build step.

## CLI surface (`src/cli.ts`)

- `wrap <cli>` — start one bridge. Flags: `--port`, `--name`, `--workdir`, `--timeout` (sec), `--key` (Bearer token), `--deny` (reject all when no key — secure-by-default).
- `fleet validate|status|up` — multi-agent operations driven by `plumb.yaml` (see `src/config.ts`).
- `ps` / `status [name]` — discover running agents via the filesystem registry.
- `send <agent> [message]` — fire a `message/send` JSON-RPC to a running agent (resolves via registry, `--port`, or `--url`).

**Gotcha:** wrap with the *bare binary name* (`plumb wrap opencode`, `plumb wrap claude`), not the full invocation — the adapter's `buildArgs` appends the protocol flags itself (e.g. `run --format json`). Passing them yourself double-applies them.

## Architecture

Layers under `src/`:

- **`core/server.ts`** — `createPlumbServer()`: builds the Agent Card, wires Express + `@a2a-js/sdk`. Endpoints: `/.well-known/agent-card.json` and `/health` (public), `/a2a/jsonrpc` + `/a2a/rest` (Bearer-gated when `--key` set; `timingSafeEqual` comparison). That is the entire endpoint surface.
- **`core/executor.ts`** — `PlumbExecutor implements AgentExecutor`. The heart. Validates INK metadata, dispatches to oneshot or persistent flow, and routes every adapter event through one shared `handleEvents()` method (text → SSE artifact + ledger `progress`; tool-call/result → formatted text; `thinking` → ledger only, never streamed; `status:completed`/`error` → finalize). A `FangPostParse` hook can transform events between `parseLine` and `handleEvents`.
- **`core/process.ts`** — `ProcessManager` (oneshot: process-per-task, SIGTERM→5s→SIGKILL on cancel/timeout) and `PersistentProcess` (long-lived, RPC-correlated). Uses a **custom LF-only JSONL reader (`attachJsonlReader`), not Node `readline`** — readline splits on U+2028/U+2029, which are valid inside Pi's JSONL strings.
- **`core/ledger.ts`** — append-only JSONL writer at `.plumb/ledger/{YYYY-MM-DD}.jsonl`. The missing `task_completed` line *is* the crash signal. Write failures are non-fatal (logged to stderr).
- **`core/task-store.ts`** / **`core/session-store.ts`** — LRU+TTL-bounded task memory (100 tasks / 60 min); Cursor multi-turn session tracking with cold-recap injection.
- **`core/registry.ts`** — filesystem agent discovery (one JSON file per running agent under `.plumb/registry/` or `$XDG_RUNTIME_DIR`). Powers `ps`/`status`/`send`. No daemon, no lock.
- **`adapters/`** — 8 adapters, one contract.

### Two modes (`adapter.mode`)

- **oneshot** — spawn per task, inject stdin, read stdout, exit. Claude, Cursor, OpenCode, VENOM, Echo, Generic.
- **persistent** — one long-lived process, tasks multiplexed by RPC correlation, with a 30s ready-frame wait. Pi, Wolfy.

### Adapters — the only contract

An adapter implements four methods (`src/types.ts: AgentAdapter`): `buildArgs` (CLI flags), `formatInput` (task → stdin string), `parseLine` (one stdout line → `AdapterEvent[]`), `detect` (is the binary installed?). `src/adapters/stream-json.ts` holds shared `parseLine` helpers reused by the Claude/Cursor/VENOM stream-json adapters.

`detectAdapter(cli)` in **`src/adapters/registry.ts`** matches by binary name at word boundaries, first-match-wins in priority order, with `GenericAdapter` (text passthrough) as the fallback. **Adding an adapter means importing it into `KNOWN_ADAPTERS` there** — there is no plugin system.

> Two files named `registry.ts`: `adapters/registry.ts` = adapter *detection*; `core/registry.ts` = running-agent *discovery*. Different jobs.

### INK metadata (mesh routing)

`message/send` may carry `metadata` fields validated at admission in the executor (`TaskMetadata` in `src/types.ts`): `correlationId`, `depth` (rejected at `maxDepth`, default 4; auto-incremented per hop), `budgetMs`, `deadlineUnixMs`, `senderUnixMs`, `priority`, `idempotencyKey`, `traceparent`/`tracestate` (W3C). Budget/deadline checks are **admission-control only** — there is no wall-clock enforcement during execution yet. Per-field length caps and W3C-format checks apply; malformed `traceparent` is stripped, not rejected.

A2A part normalization: the executor accepts both `{type:'text'}` (A2A standard) and `{kind:'text'}` (Plumb internal) part shapes.

## Conventions

- **`docs/core/ARCHITECTURE.md` is design intent, not all built.** It describes a circuit breaker, concurrency gating, version probing (`versions.json`/knownGood), a 5-phase boot sequence, crash-resume-on-boot, and `/healthz`+`/readyz` endpoints — **none of these exist in `src/`** (verified). Anchor every factual claim to `src/`, `README.md`, and the test files; treat the prose docs as aspirational unless code confirms.
- **Terminology lock** (enforced in surfaces — code comments, docs, identifiers): adapter (not muscle), ledger (not memory), core (not skeleton), conduit (not body), bridge (not route). Body metaphors are banned outside research notes.
- **Refusals are deliberate boundaries.** No dashboard, no LLM in the bridge, no memory/context assembly, no plugin system, no orchestration. The README's "What plumb refuses" table and `docs/soul/REFUSALS.md` explain why — read them before adding a feature that crosses one.
- **Voice in docs/output:** answer first, no hedging, no emojis. State or say "Unknown."
- Match existing file conventions: top-of-file `// PLUMB — <Component>` comment, explicit `.ts` import extensions, structured logging via `src/core/log.ts` (`log(level, event, fields)`), not `console.log`.

## Map

`MANIFEST.yaml` (single source of truth), `AGENTS.md` (folder map + contract brief), `README.md` (usage), `docs/` (deep reference — see caveat above), `systemd/` (production unit files), `plumb.yaml` (fleet definition). Runtime state in `.plumb/` is gitignored.
