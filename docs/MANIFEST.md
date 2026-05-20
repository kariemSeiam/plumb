# MANIFEST — What Plumb IS and IS NOT

```
Plumb is a protocol bridge.
Plumb is an adapter contract.
Plumb is an append-only ledger.
Plumb is a process lifecycle manager.
Plumb is a switchboard for agents.
Plumb is a circuit breaker for flapping agents.
Plumb is a crash resume protocol.
Plumb is a brass plumb bob on a desk.
------------------------------------------------
Plumb is NOT an agent.
Plumb is NOT an orchestrator.
Plumb is NOT a dashboard.
Plumb is NOT a plugin system.
Plumb is NOT a model provider.
Plumb is NOT a memory layer.
Plumb is NOT a process supervisor.
Plumb is NOT a platform.
```

---

## IS

| Plumb IS | Why |
|----------|-----|
| A bridge between A2A orchestrators and CLI agents | One AdapterContract. Eight implementations. Generic as fallback. |
| An append-only JSONL ledger | Every task lifecycle recorded. Crash-survivable. Queryable with `jq`. |
| A process lifecycle manager | Oneshot (spawn per task) and persistent (long-lived, serial queue). Configurable timeout. |
| A session continuity layer | CursorSessionStore with TTL expiry and cold recap injection. |
| A fleet switchboard | plumb.yaml + fleet validate/up/status. |
| A FangPostParse extension point | One typed hook: transform events after parseLine, before executor. |
| A brand with gravity | Brass plumb bob. Cistern dark. No gradient, no glow, no animation. |
| An honest count | 90 tests, 156 assertions, zero flakes. |

## IS NOT

| Plumb IS NOT | Why Not |
|--------------|---------|
| An agent | Plumb has no LLM, no session memory, no tools. It spawns processes and reads stdout. |
| An orchestrator | Plumb routes by labels. It does not plan, prioritize, or optimize. The operator decides. |
| A dashboard | The health endpoint returns JSON. Logs go to stderr. That is the interface. |
| A plugin system | Adapters are code in `src/adapters/`. Changing one requires a PR and a test run. |
| A model provider | Plumb doesn't call OpenAI, Anthropic, or any API. It talks to subprocesses. |
| A memory layer | The ledger records. It does not learn, summarize, or cross-reference. SIPHON is a separate process. |
| A process supervisor | Plumb spawns and cleans up. It does not auto-restart, health-check-loop, or alert. systemd does that. |
| A platform | Plumb has no marketplace, no extension registry, no third-party ecosystem. |
| A business model | Plumb is a pipe. Pipes get buried. The company dissolves into a standards body when the protocol wins. |

---

## The refusals are the strategy

"The hardest decisions are not what to build. They are what to never build."

Every item in IS NOT is a deliberate choice. Adding any of them would make Plumb better at the demo and worse at the job. Plumb optimizes for the 3AM pager, not the launch video.

---

## What survives

When Plumb the company dissolves, these survive in a standards body:

1. The AdapterContract — one interface for all CLI coding agents
2. The ledger format — append-only JSONL, crash-survivable
3. The error taxonomy — 30 error codes, each with a meaning
4. The conformance suite — 190+ tests that define what "working" means
5. The fixture system — golden transcripts that catch upstream drift
6. The circuit breaker — flap detection that protects the fleet from itself
7. The crash resume — ledger scan that turns crashes into data

Everything else — the Express server, the CLI binary, the design system, the brass bobs — decomposes.
