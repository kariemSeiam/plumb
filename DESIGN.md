# Plumb Design — Architecture Decision Records

> Every architecture decision is a bet on the structure of the world.
> These are Plumb's bets, stated with their honest edges.
>
> *Pattern borrowed from bedrock.md — each ADR says where it could be wrong.*

---

## ADR-001: JSONL Ledger — append-only, daily rotation, no indexing

### Context

Every task event must be recorded for debugging, audit, and the VENOM∞ SIPHON extraction pipeline. The ledger is the system of record — crash-survivable, queryable, and independently readable without Plumb running.

### Decision

- Format: newline-delimited JSON (JSONL), one line per event
- Rotation: daily files at `.plumb/ledger/YYYY-MM-DD.jsonl`
- Access pattern: write-only from Plumb, read-only from operator tools (jq, DuckDB, custom scripts)
- No index, no schema registry, no compaction

### Rationale

- **Crash survival**: append-only means a crash at any point leaves all prior data intact. No partial-write corruption of prior records.
- **Zero dependencies**: any tool that reads text files can query the ledger. No database process, no connection pool, no schema migrations.
- **Maximum simplicity**: JSONL is a text file. It ships with every Unix. The operator doesn't install anything to read it.
- **Daily rotation**: bounds file size naturally. A day's worth of events from a 7-agent fleet at 1 req/min fits in ~100KB. Even at 1 req/sec, a day is ~80MB — trivial for any modern filesystem.
- **SIPHON compatibility**: the VENOM∞ extraction pipeline reads the same files the operator reads. No ETL step.

### Honest edges

- **No query engine built in.** Querying the ledger at scale means either accepting line-by-line grep or standing up DuckDB/ClickHouse yourself. Plumb ships the data, not the query infrastructure. If your fleet reaches 10K tasks/day, raw JSONL becomes painful without an external index.
- **Daily rotation means 366 files/year.** Filesystem metadata overhead for 366 files is negligible, but if you need multi-year compliance archives, you'll need compression and archival tooling outside Plumb.
- **No schema version in the file.** If `LedgerEvent` types change across Plumb versions, old and new entries live side by side with different shapes. The operator must handle schema drift in queries. A `version` field was considered and rejected — it pushes complexity into every write path instead of the few read paths.
- **Write failure is non-fatal.** The ledger is not the primary delivery mechanism; A2A SSE is. If the filesystem is full, Plumb logs the write failure and continues executing tasks. This means the ledger can have gaps during full-disk events, which SIPHON must tolerate.

---

## ADR-002: Bun Runtime

### Context

Plumb needs a TypeScript runtime for the HTTP server, process management, filesystem I/O, and streaming. Node.js is the incumbent. Bun is the challenger.

### Decision

- Runtime: Bun (targeting >= 1.1)
- Package manager: bun (not npm)
- Test runner: `bun test` (not Jest, not Vitest)
- No `tsc` compilation step — Bun runs TypeScript directly

### Rationale

- **Startup speed**: Bun starts and runs TypeScript files 10-15x faster than Node + ts-node or Node + tsc-watch. For a CLI tool like `plumb wrap` and `plumb fleet up`, startup latency is UX. Sub-second startup matters.
- **Built-in tooling**: Bun bundles a test runner, package manager, and TypeScript transpiler. Zero configuration files for build tooling. The entire dev loop is `bun test` and `bun run src/main.ts`.
- **Process management**: Bun's `Bun.spawn()` API is ergonomic for Plumb's core use case — spawning child processes, streaming stdout, handling signals. Node's `child_process` works but requires more ceremony for streaming line-by-line parsing.
- **Hot path**: Plumb is not compute-bound. It's I/O-bound (spawn processes, read stdout, write ledger). Bun's I/O performance advantage over Node in the relevant benchmarks is marginal but consistent. The real win is ergonomics, not throughput.

### Honest edges

- **Bun is not Node.** Despite Node-compatibility mode, Bun has edge cases in `node:child_process` semantics, `node:buffer` behavior, and stream backpressure. Every Bun-specific feature we use (Bun.spawn, Bun.file, Bun.write) is a lock-in. If Bun's compatibility breaks with a future Node LTS feature we need, migration costs real time.
- **Smaller ecosystem.** Bun's package manager resolves `node_modules` differently. Some npm packages with native bindings or install hooks fail under Bun. Cursor adapter works because Cursor-agent is a subprocess, not an npm dep — but the test runner and type checker are Bun-native and any upstream breakage blocks CI.
- **Fewer production deployments.** Node runs everywhere — AWS Lambda, Google Cloud Run, Kubernetes sidecars, Raspberry Pis. Bun's deployment story is improving but not equivalent. If an operator wants to run Plumb in an environment that only has Node (e.g., an AWS-managed Node runtime), they can't without significant rework.
- **The bet is that Bun survives as a maintained project.** Bun 1.0 shipped September 2023. It's actively developed, well-funded, and solves real problems. But it's younger than Node, npm, or Yarn. If Bun's development slows or the company pivots, Plumb inherits that risk.

---

## ADR-003: A2A with SSE Streaming

### Context

Plumb must deliver task events (text deltas, tool calls, status changes) from a CLI subprocess back to an HTTP client in real-time. The A2A protocol uses JSON-RPC 2.0 with streaming support. The transport choice for streaming determines latency, complexity, and ecosystem compatibility.

### Decision

- Protocol: Google A2A (Agent-to-Agent) via `@a2a-js/sdk`
- Streaming transport: Server-Sent Events (SSE)
- Task lifecycle: `tasks/send` with JSON-RPC 2.0, SSE for artifact updates
- Agent card: `/.well-known/agent-card.json` per A2A spec

### Rationale

- **A2A is the right protocol for agent-to-agent communication.** It's designed for exactly this use case — one agent sending a task to another and receiving streaming results. JSON-RPC 2.0 gives us request/response semantics for task submission; SSE gives us real-time progress without polling.
- **SSE over WebSocket**: SSE is simpler — unidirectional (server→client), native browser support, works over HTTP/1.1 and HTTP/2, no upgrade handshake, no reconnection logic to write. For Plumb's use case (server pushes events to one client per task), SSE is sufficient. WebSocket would add complexity for bidirectional communication that Plumb doesn't need from the transport layer.
- **A2A SDK handles framing.** The `@a2a-js/sdk` package provides `ExecutionEventBus` with `publish()` and `finished()` methods, JSON-RPC 2.0 framing, and SSE serialization. Plumb doesn't implement the A2A wire protocol — it uses the SDK and maps adapter events to A2A artifacts.
- **Agent Card is self-describing.** Every Plumb instance exposes its capabilities, adapters, and protocol version via `/.well-known/agent-card.json`. An orchestrator can discover Plumb's surface without out-of-band configuration.

### Honest edges

- **A2A 1.0 is new (March 2026).** The SDK and protocol are stable but young. Edge cases around task cancellation, error propagation, and partial delivery are still being resolved in the ecosystem. Plumb's `host_tool_cancel` implementation required working around an SDK gap.
- **SSE has no built-in delivery guarantees.** If the client disconnects mid-stream, the server doesn't know until it tries to write and gets an error. Plumb's ledger is the reliable record — the SSE stream is a best-effort real-time view. If delivery confirmation becomes a requirement, we need application-level ACKs (see ADR-004).
- **A2A's Part type is too rigid for CLI output.** A2A defines `Part` as `{ type: "text" | "file" | "data" }`. CLI agents emit tool calls, tool results, status changes, and thinking content — none of which map cleanly to A2A Parts. Plumb uses artifact-update events for these, which works but stretches the A2A model. A future A2A version may add better primitives; until then, Plumb carries this mapping.
- **No client SDK in Plumb's repo.** Plumb is a server. It doesn't ship a client library. Any orchestrator that wants to talk A2A must bring its own client or implement the wire protocol. This is by design (separation of concerns), but it means every orchestrator integration is custom.

---

## ADR-004: Fire-and-Forget Delivery

### Context

When Plumb delivers a task event to the A2A client (SSE) and writes it to the ledger, should it wait for confirmation that the client received it? Should it retry on failure?

### Decision

- Delivery: fire-and-forget over SSE
- Reliability: ledger is the system of record, not the SSE stream
- No ACK from client, no retry on SSE write failure
- Ledger writes are synchronous (blocking `appendFileSync`)

### Rationale

- **Ledger is the source of truth, not the SSE stream.** If the client disconnects and misses events, the ledger contains the complete record. The client (or SIPHON) can replay from the ledger. Plumb doesn't need to buffer undelivered events or maintain client state.
- **SSE is best-effort real-time.** The client gets events as they happen. If the connection drops, the client reconnects and submits a new task — or queries the ledger for the previous task's result. This is simpler than implementing application-level ACKs, message queues, or exactly-once delivery semantics.
- **Synchronous ledger writes before the SSE write.** The event is on disk before it's sent to the client. If the SSE write fails but the ledger write succeeded, the task result is preserved. The client can recover by checking the ledger.
- **No client state on the server.** Plumb doesn't track which events the client has received. This keeps the server stateless between tasks, simplifies crash recovery, and eliminates a class of memory leaks.

### Honest edges

- **Clients can miss the final event.** If the SSE connection drops during the final `task_completed` event, the client never receives it. The client sees an incomplete stream (task_running with no conclusion). The ledger has the truth, but the client must know to query it. This is the most common fire-and-forget failure mode.
- **No backpressure signal.** Plumb writes to the SSE stream without knowing if the client is keeping up. A slow consumer on a fast producer will cause buffering in the HTTP server's write buffer, potentially consuming memory. For Plumb's use case (one task at a time, streaming text deltas), this is rarely a problem — but at high concurrency with large outputs, it's a risk.
- **Synchronous file I/O on hot path.** `appendFileSync` blocks the event loop. At low concurrency (Plumb's target: one task per adapter), this is fine. At high concurrency with large task volumes, synchronous disk writes on every event could become a bottleneck. If this bites, the fix is async writes with a write buffer, which adds complexity and changes the crash-survival guarantee.
- **No exactly-once guarantee.** Fire-and-forget means the client may see events 0, 1, or N times depending on disconnects and reconnects. The ledger provides exactly-once-at-rest, not exactly-once-in-flight. Idempotency keys (proposed in the ∞-scale-analysis) could bridge this gap but aren't implemented.

---

*Architecture decisions are bets, not truths. These ADRs document the bets Plumb has made and the conditions under which each bet would fail. Update them when a bet's edge becomes reality.*
