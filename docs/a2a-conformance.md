# A2A v1.0 conformance

Plumb targets A2A v1.0 (`lf.a2a.v1`, [a2a.proto](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto)
and the [specification](https://a2a-protocol.org/latest/specification/)) over the JSON-RPC binding,
and keeps v0.3 clients working on the same endpoint. This list was written from the proto and the
spec text, not from search snippets. Every "done" row names the test in `test/a2a-v1.test.ts`
(or the older suite) that proves it. Run them with `bun test test/a2a-v1.test.ts`.

## How versions work

`POST /a2a/jsonrpc` reads `A2A-Version` (header, or the `A2A-Version` query parameter).

- Empty or `0.3`: the SDK's v0.3 wire format, untouched (`message/send`, `kind` fields, lowercase states).
- `1.0`: PascalCase methods and ProtoJSON bodies. `src/core/a2a-v1.ts` translates them to the v0.3 core and back, for JSON and SSE.
- Anything else: `VersionNotSupportedError`, code `-32009`, HTTP 400.

The Agent Card is one document for both: v1.0 clients read `supportedInterfaces`, v0.3 clients read `url` and `protocolVersion`.

## Operations (JSON-RPC binding)

| Operation | Status | Proof |
|---|---|---|
| Agent Card at `/.well-known/agent-card.json` | done | `Agent Card (v1.0 discovery)` |
| `supportedInterfaces` (JSONRPC, 1.0 first, 0.3) | done | same |
| `A2A-Version` negotiation, empty = 0.3 | done | `A2A-Version negotiation` (empty header, query param) |
| `VersionNotSupportedError` (-32009) | done | `unsupported version` |
| `SendMessage` | done | `v1.0 SendMessage` |
| `SendStreamingMessage` (SSE `StreamResponse` wrappers) | done | `v1.0 SendStreamingMessage` |
| `GetTask` (unset `historyLength` = full history) | done | `GetTask returns a ProtoJSON task` |
| `ListTasks`: contextId, status, statusTimestampAfter, pageSize (1–100, default 50), pageToken, historyLength, includeArtifacts, totalSize | done | `ListTasks` tests (order, pagination, filters, `-32602`) |
| `CancelTask` | done, translated only | method mapping in `a2a-v1.ts`; no v1 test |
| `SubscribeToTask` | done, translated only | method mapping in `a2a-v1.ts`; no v1 test |
| `CreateTaskPushNotificationConfig` | done | `Push notification config CRUD` |
| `GetTaskPushNotificationConfig` | done | same |
| `ListTaskPushNotificationConfigs` | done, single page | same (`nextPageToken` is always empty; `pageSize` ignored) |
| `DeleteTaskPushNotificationConfig` | done | same |
| `GetExtendedAgentCard` | not supported | the card does not advertise it; the SDK answers with its own error |
| Unknown v1 method | `-32601` | `unknown method` |
| v0.3 method names still work | done | `Gate 4/5` in `test/conformance.test.ts`, `v0.3 method names still work` |

## Data model

| Item | Status | Note |
|---|---|---|
| `TASK_STATE_*` enum strings | done | mapped both ways, `GetTask` test |
| `ROLE_USER` / `ROLE_AGENT` | done | `SendMessage` and `GetTask` tests |
| Flat `Part` (`text`, `raw`, `url`, `data`, `filename`, `mediaType`) | done | text parts are tested; file and data parts are translated but untested |
| No `kind` discriminator | done | asserted in the streaming and `SendMessage` tests |
| `Task.history`, `artifacts`, `metadata` | done | `ListTasks` tests |
| `statusUpdate.final` | dropped | v1 has no such field; terminal state is the signal |

## Missing, on purpose

| Item | Why |
|---|---|
| gRPC binding | separate card |
| HTTP+JSON (REST) binding in v1.0 form | `/a2a/rest` still serves the SDK's v0.3 REST shape and does no version negotiation |
| `tenant` routing | one agent per server |
| ErrorInfo `data` on errors | errors carry `code` and `message` only |
| Push payload in v1 form | the SDK sender posts the v0.3 task object to the configured URL |
| Persistent push configs | held in memory, lost on restart |
| Agent Card signatures | not produced |

## Known limits

- `ListTasks` only sees tasks still in the store (100 max, terminal tasks dropped after 60 minutes).
- Push notification URLs are fetched by the server as given. Do not expose an unauthenticated
  `/a2a/jsonrpc` to untrusted callers; start with an API key. Restricting target hosts is not done yet.
