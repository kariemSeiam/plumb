# CONTRACT — The Adapter Interface

```
This is the moat.

One interface. Seven implementations.
Every CLI agent, no matter how different,
reduced to the same five methods.
Plus isComplete and extractOutput.
The contract is tested against 19+ fixtures per adapter.
```

---

## The interface

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly binary: string;
  readonly tier: 1 | 2 | 3;
  readonly displayName: string;
  readonly mode: 'oneshot' | 'persistent';
  skills: Array<{ id: string; name: string; tags: string[] }>;

  buildArgs(task: AgentTask, config: PlumbConfig): string[];
  formatInput(task: AgentTask): string;
  parseLine(line: string): AdapterEvent[];
  isComplete(events: AdapterEvent[]): boolean;
  extractOutput(events: AdapterEvent[]): string;
  detect(): Promise<DetectionResult | null>;
}
```

Seven methods. That's the entire bridge.

---

## Method by method

### `buildArgs(task, config) → string[]`

Translate an A2A task into CLI arguments. Plumb does not parse shell strings. It receives an array of arguments and passes them to `child_process.spawn()`.

```
"refactor the auth module"
  → ["--print", "--model", "composer-2-fast", "--input", "refactor ..."]
```

No shell injection. No quoting bugs. No `splitCli()` edge cases. Arrays only.

### `formatInput(task) → string`

Translate an A2A task into stdin for the subprocess. Some agents (Pi in persistent mode) expect a JSON-RPC envelope. Others (Claude in print mode) expect raw text.

```
Pi:      {"jsonrpc":"2.0","method":"prompt","params":{"text":"..."}}
Claude:  "refactor the auth module\n"
Echo:    "refactor the auth module\n"
```

### `parseLine(line) → AdapterEvent[]`

The critical method. Every line of stdout from the subprocess passes through here. The adapter returns zero or more events.

```typescript
type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'status'; state: 'working' | 'completed' | 'failed' }
  | { type: 'error'; message: string; code?: string };
```

The adapter owns the parse logic. The executor owns the lifecycle. If a new CLI format appears, the adapter is the only thing that changes.

### `isComplete(events: AdapterEvent[]) → boolean`

Signal completion without relying on exit codes. The executor calls this after each parseLine pass. Returns `true` when the accumulated events indicate the CLI has finished its output.

```
Echo:    checks for the last line matching expected input
Claude:  detects final "task_completed" status event
Cursor:  checks for consolidated final result
OpenCode: detects step_finish or done event
Generic:  always returns false — relies on process exit
```

### `extractOutput(events: AdapterEvent[]) → string`

Extract the final output from accumulated events after `isComplete` returns true. The executor calls this once, just before settling the task.

```
Echo:    concatenates all text-delta events
Claude:  extracts text from final content_block
Cursor:  joins result text from consolidated stream
OpenCode: extracts from nested step_finish output
Generic:  joins all raw text lines
```

### `detect() → DetectionResult | null`

Auto-detect the CLI binary. Check `which <binary>`, probe `--version`, verify the tier matches expectations. Returns `null` if the CLI isn't installed.

---

## Tier definitions

| Tier | Meaning | Example | Precision | Fixture count |
|------|---------|---------|-----------|---------------|
| 1 | Machine-readable output (JSONL, stream-json) | Pi, Claude, Cursor, VENOM | Exact parse, no loss | 19+ |
| 2 | Structured but nested (JSON-within-JSON) | OpenCode | Parse with extraction | 10+ |
| 3 | Best-effort (ANSI, interactive prompts) | Generic fallback | Human-readable, lossy | 3 |

**Minimum 19 fixtures per adapter.** Categories: happy-path (5), error (3), cancellation (2), timeout (2), ansi-strip (3), partial-output (2), interactive (2).

Tier determines conformance requirements. Tier 1 adapters must pass all 19+ fixtures. Tier 3 adapters get a minimum bar: output is captured, but parse correctness is not guaranteed.

---

## Version probing

On adapter init, Plumb runs `<binary> --version` and compares against `versions.json`:

```json
{
  "adapter": "claude",
  "knownGood": ["1.0.0", "1.1.0", "1.2.0"],
  "knownBad": ["0.9.0"],
  "lastVerified": "2026-05-13"
}
```

| Scenario | Action |
|----------|--------|
| Version in `knownGood` | Proceed normally |
| Version unknown | Log warning, proceed (may fail fixtures) |
| Version in `knownBad` | Refuse to start, emit structured error |

---

## The registry

```
Adapters tried in order (first match wins):
  1. Echo     — binary: "cat"
  2. Pi       — binary: "pi"
  3. Claude   — binary: "claude"
  4. Cursor   — binary: "cursor-agent"
  5. OpenCode — binary: "opencode"
  6. VENOM    — binary: "venom"
  7. Generic  — (implicit fallback, always matches)
```

One match. One adapter per process. No chaining. No multiplexing.

---

## What each adapter must pass

| Requirement | Echo | Pi | Claude | Cursor | OpenCode | VENOM | Generic |
|-------------|------|----|--------|--------|----------|-------|---------|
| happy-path (5) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| error (3) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| cancellation (2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| timeout (2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| ansi-strip (3) | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| partial-output (2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| interactive (2) | — | ✓ | ✓ | ✓ | — | — | — |
| **Total** | 15+ | 30+ | 19+ | 19+ | 19+ | 19+ | 3 |

---

## Fixture format

Each fixture is a JSON file in `test/fixtures/<adapter>/`:

```json
{
  "adapter": "claude",
  "upstreamVersion": "1.2.3",
  "fixture": "happy-01",
  "input": "Add a rate limit to the auth endpoint",
  "expectedEvents": [...],
  "expectedOutput": {"text": "..."},
  "maxDurationMs": 60000,
  "capturedAt": "2026-05-13T..."
}
```

Fixtures are golden transcripts from real CLI runs. They are the contract. If the upstream CLI changes its format, the fixture breaks and CI catches it.

---

## Why this contract wins

1. **It is complete.** Seven methods cover every CLI agent that exists.
2. **It is minimal.** Remove any method and a real adapter breaks.
3. **It is testable.** Every method returns deterministic output for known input. 19+ fixtures prove it.
4. **It is stable.** The interface has not changed since the first echo adapter shipped.
5. **Version-probed.** No silent drift. Version mismatch is detected at init, not at 3am.
6. **It is the line.** Everything above this contract (orchestrators, agents, UIs) belongs to someone else. Plumb owns only this line.

---

*The contract is the moat. Not the code. Not the brand. The one interface that every CLI agent can be reduced to. Tested against 19+ golden fixtures per adapter. Version-probed on every boot.*
