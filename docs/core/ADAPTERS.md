# ADAPTERS — The Seven Faces of Plumb

```
One interface. Seven implementations.
Every CLI coding agent, reduced to the same seven methods.
Tested against 19+ fixtures each. Version-probed on every boot.
```

---

## Echo (Tier 1 · oneshot)

```
  Binary:     cat
  Skills:     echo
  Detection:  binary === "cat"
  Parse:      Each line → text-delta
  isComplete: Last line matches expected input
  extractOutput: Concatenates all text-delta events
  Fixtures:   5 (happy path)
```

The conformance skeleton. Echo wraps `cat` and echoes back whatever it receives. It exists to prove the protocol works before a real agent enters the room.

---

## Pi (Tier 1 · persistent)

```
  Binary:     pi
  Skills:     code-edit, bash-execute, file-read
  Detection:  binary === "pi" → check --mode rpc
  Parse:      JSON-LR (30 event types)
  isComplete: Detects final status:completed event
  extractOutput: Extracts text from final response parts
  Fixtures:   30+ (one per event type tracked)
```

Pi is persistent mode. Single long-lived process, tasks multiplexed via JSON-RPC correlation. The most complex and most capable adapter. Supports host tool execution, `writeWhenActive` task queuing, and crash recovery.

Pi is VENOM∞'s nervous system. When VENOM routes through Plumb to Pi, Pi becomes VENOM-shaped — it loads VENOM's AGENTS.md, carries VENOM's Pact, and speaks with VENOM's voice.

---

## Claude (Tier 1 · oneshot)

```
  Binary:     claude
  Skills:     deep-reasoning, code-review, architecture
  Detection:  binary === "claude" → check --print
  Parse:      stream-json (shared parser with Cursor)
  isComplete: Detects content_block_stop with final block
  extractOutput: Extracts text from final content block
  Fixtures:   19+
```

Claude handles tasks that require depth. Architecture reviews, difficult bugs, design decisions. Oneshot mode — fresh process per task.

---

## Cursor (Tier 1 · oneshot)

```
  Binary:     cursor-agent
  Skills:     code-edit, refactor, implement
  Detection:  binary === "cursor-agent" → check --print
  Parse:      stream-json (shared parser with Claude)
  isComplete: Detects consolidated final result event
  extractOutput: Joins result text from consolidated stream
  Fixtures:   19+
  Extra:      CursorSessionStore (cold recap across spawns)
```

Cursor handles tasks that require implementation. Build features, refactor modules, write tests. The session store tracks conversation context across process spawns — when Cursor dies and respawns, the new process gets a cold recap of what happened before.

---

## OpenCode (Tier 2 · oneshot)

```
  Binary:     opencode
  Skills:     web-research, code-edit, file-read
  Detection:  binary === "opencode" → check --format json
  Parse:      JSON-within-JSON (nested objects)
  isComplete: Detects step_finish or done event
  extractOutput: Extracts text from nested step_finish output
  Fixtures:   10+
```

OpenCode handles tasks that benefit from web access. Research a library, check documentation, browse repositories. Tier 2 because its output format requires extraction from nested JSON structures.

---

## VENOM (Tier 1 · oneshot)

```
  Binary:     venom
  Skills:     custom, cli-tool, any
  Detection:  binary === "venom" → check -p / --output-format
  Parse:      stream-json (shared parser)
  isComplete: Detects final consolidated event
  extractOutput: Joins result text from consolidated stream
  Fixtures:   15+
```

VENOM is Plumb's own agent — the custom Venom/Claw CLI that runs bespoke operations. Oneshot mode, stream-json output. When VENOM routes through Plumb to itself, the loop completes: VENOM orchestrates → Plumb bridges → VENOM executes.

---

## Generic (Tier 3 · oneshot)

```
  Binary:     any
  Skills:     output-capture
  Detection:  implicit fallback (always matches)
  Parse:      each line → text-delta (no structure)
  isComplete: Always returns false — relies on process exit
  extractOutput: Joins all raw text lines
  Fixtures:   3 (minimum bar)
```

The catch-all. If no adapter matches the CLI binary, Generic wraps it. No structured parse — every output line is raw text. Tier 3 means "works but don't trust the structure."

---

## Skills by adapter

```
Adapter    Skills                                       Tier   Fixtures
─────────────────────────────────────────────────────────────────────
Pi         code-edit, bash-execute, file-read            1     30+
Claude     deep-reasoning, code-review, architecture      1     19+
Cursor     code-edit, refactor, implement                 1     19+
OpenCode   web-research, code-edit, file-read             2     10+
VENOM      custom, cli-tool, any                          1     15+
Echo       echo                                           1      5
Generic    output-capture                                 3      3
```

Skills are declared by the adapter. Plumb never overrides them. The Agent Card aggregates all skills from all active adapters.

---

## Writing a new adapter

1. Create `src/adapters/my-agent.ts`
2. Implement `AgentAdapter` (7 methods: buildArgs, formatInput, parseLine, isComplete, extractOutput, detect)
3. Add detection to `registry.ts`
4. Write 10+ fixtures in `test/fixtures/my-agent/`
5. Implement parse tests
6. Add version to `versions.json`
7. Run conformance suite
8. Ship

The adapter is where you own. The executor is where you trust. Plumb provides the contract. You provide the translate layer.

---

## Fixture categories

| Type | Purpose | Count (min) |
|------|---------|-------------|
| `happy-path` | Normal code-edit task | 5 |
| `error` | CLI auth failure, syntax error | 3 |
| `cancellation` | Mid-task SIGTERM | 2 |
| `timeout` | CLI hangs, adapter kills | 2 |
| `ansi-strip` | CLI output with escape codes | 3 |
| `partial-output` | CLI crashes mid-stream | 2 |
| `interactive` | CLI prompts (auto-answered) | 2 |

**Minimum 19 fixtures per adapter.** Golden transcripts from real CLI runs. CI catches upstream drift.

---

*Each adapter is a face. The contract is the neck.
Every face looks different. Every neck connects the same way.
19+ fixtures keep each face from changing without us knowing.*
