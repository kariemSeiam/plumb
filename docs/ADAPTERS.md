# ADAPTERS

The contract that every CLI agent must satisfy to join the mesh.
One interface. Eight implementations. Generic as the implicit fallback.

---

## The Contract

Authoritative source: `src/types.ts`.

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
  detect(): Promise<DetectionResult | null>;
}
```

Four methods. No more.

| Method | Input | Output | Responsibility |
|--------|-------|--------|----------------|
| `buildArgs` | task, config | `string[]` | CLI flags for this task. No shell injection. |
| `formatInput` | task | `string` | What to write to stdin. JSONL for Pi/Wolfy; plain text for Claude. |
| `parseLine` | stdout line | `AdapterEvent[]` | Every line the process writes. Zero or more events per line. |
| `detect` | — | `DetectionResult \| null` | Is the binary installed? What version? Returns null if absent. |

---

## AdapterEvent

The normalized event language. Every adapter speaks these — regardless of what the underlying CLI outputs.

```typescript
type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'status'; state: 'working' | 'completed' | 'failed' }
  | { type: 'error'; message: string; code?: string };
```

**What the executor does with each:**

| Event | Executor action |
|-------|----------------|
| `text-delta` | Append to accumulated output. Write `progress` to ledger. Publish `artifact-update` on A2A bus. |
| `tool-call` | Format as `[tool] {input}`. Same ledger + bus path as text-delta. |
| `tool-result` | Format as `→ ✓/✗ output`. Same ledger + bus path. |
| `status: completed` | Settle task. Write `task_completed` to ledger. Publish final message. `bus.finished()`. |
| `status: failed` / `error` | Settle task. Write `task_failed` to ledger. Publish error status. `bus.finished()`. |

Once `settled = true`, subsequent events from the same process are ignored.

---

## Tiers

| Tier | Meaning | Examples |
|------|---------|---------|
| 1 | Full protocol — machine-readable output, tested against golden fixtures | Echo, Pi, Wolfy, Claude, Cursor |
| 2 | Structured but nested — requires extra parsing, partial fixture coverage | OpenCode |
| 3 | Best-effort — text passthrough or unstable protocol | VENOM, Generic |

Tier affects routing confidence. Orchestrators that care about reliability prefer tier-1 adapters.

---

## Modes

**Oneshot** — one subprocess per task. Process exits when the task is done.

```
task arrives → spawn(cmd, args) → write formatInput to stdin → close stdin
→ read stdout lines → parseLine each → emit events → process exits → settled
```

**Persistent** — one long-lived subprocess. Tasks queue and execute serially.

```
first task → spawn process → waitUntilReady (30s max) → write formatInput
subsequent tasks → process already running → write to stdin when active
crash → taskHandlers notified via error event → re-spawn on next task
```

Persistent processes receive a `{ "type": "ready" }` frame on stdout when initialized.
If no ready frame arrives within 30 seconds but the process is alive, execution proceeds anyway.

---

## Registry Order

`src/adapters/registry.ts` tries adapters in this order, matching against the `wrap` CLI string:

```
Echo → Pi → Wolfy → Claude → Cursor → OpenCode → VENOM
```

If none match: **Generic** (implicit fallback, wraps any CLI as text passthrough).

Detection is by binary name substring match. `cursor-agent` matches Cursor. `pi` matches Pi.
`my-tool` matches nothing → Generic.

---

## Shipped Adapters

| id | binary | tier | mode | protocol | source |
|----|--------|------|------|----------|--------|
| echo | `cat` | 1 | oneshot | text | `src/adapters/echo.ts` |
| pi | `pi` | 1 | oneshot | jsonl-rpc | `src/adapters/pi.ts` |
| wolfy | `wolfy` | 1 | oneshot | jsonl-rpc (Pi dialect) | `src/adapters/wolfy.ts` |
| claude | `claude` | 1 | oneshot | stream-json | `src/adapters/claude.ts` |
| cursor | `cursor-agent` | 1 | oneshot | stream-json | `src/adapters/cursor.ts` |
| opencode | `opencode` | 2 | oneshot | json-stream | `src/adapters/opencode.ts` |
| venom | `venom` | 3 | oneshot | stream-json | `src/adapters/venom.ts` |
| generic | any | 3 | oneshot | text | `src/adapters/generic.ts` |

Shared parse utilities for stream-json adapters (Claude, Cursor, VENOM): `src/adapters/stream-json.ts`.

---

## Building an Adapter

1. Create `src/adapters/<name>.ts`.
2. Implement `AgentAdapter`. All four methods required.
3. Import and add to the `KNOWN_ADAPTERS` array in `src/adapters/registry.ts` — position determines priority.
4. Write parse tests in `test/adapter-parse.test.ts`. Minimum: one happy-path fixture, one error fixture.

**Detection utility:**

```typescript
import { detectBinary } from './detect.ts';

detect(): Promise<DetectionResult | null> {
  return detectBinary('my-binary', 1, 'stream-json');
}
```

`detectBinary` runs `my-binary --version`, parses the output, and returns a `DetectionResult` or null if the binary is absent or returns a non-zero exit code.

**parseLine invariants:**

- Must be pure. No side effects except on adapter-owned state (e.g., session tracking).
- Empty or whitespace-only lines: return `[]`.
- Non-JSON lines from tier-1 adapters: return `[{ type: 'text-delta', text: line + '\n' }]`.
- Completion signal: return `[{ type: 'status', state: 'completed' }]`. Do not rely on process exit alone.
- Never throw. Catch parse errors, emit `text-delta` or `error`.

---

## Testing

Tests live in `test/adapter-parse.test.ts`. Pattern:

```typescript
describe('MyAdapter', () => {
  const adapter = new MyAdapter();

  it('parses assistant text', () => {
    const events = adapter.parseLine('{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}');
    expect(events).toEqual([{ type: 'text-delta', text: 'hello' }]);
  });

  it('parses completion', () => {
    const events = adapter.parseLine('{"type":"result","subtype":"success"}');
    expect(events).toEqual([{ type: 'status', state: 'completed' }]);
  });

  it('handles non-JSON lines', () => {
    const events = adapter.parseLine('bare text output');
    expect(events[0]?.type).toBe('text-delta');
  });
});
```

Run: `bun test test/adapter-parse.test.ts`

---

*The contract IS the architecture. The adapter IS the moat.*
