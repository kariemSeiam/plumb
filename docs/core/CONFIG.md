# CONFIG — plumb.yaml

```
One file to define the entire fleet.
Read at startup. Immutable while running.
Change it, restart. That's the pattern.
```

---

## Reference

```yaml
# plumb.yaml v1
version: "1"

agents:
  pi:
    cli: "pi --mode rpc"
    port: 3001
    mode: persistent
    tier: 1
    workdir: "/home/user/project"
    timeout: 600
    maxConcurrent: 1          # persistent mode forced to 1
    labels: [scan, fast, cheap]
    env:
      PI_API_KEY: "${PI_API_KEY}"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"

  claude:
    cli: "claude --print"
    port: 3002
    mode: oneshot
    tier: 1
    timeout: 300
    maxConcurrent: 2
    labels: [review, deep, reason]

  cursor:
    cli: "cursor-agent --print"
    port: 3003
    mode: oneshot
    tier: 1
    timeout: 300
    maxConcurrent: 2
    labels: [build, edit, implement]
    sessionStore: true         # enable cold recap

  opencode:
    cli: "opencode"
    port: 3004
    mode: oneshot
    tier: 2
    timeout: 300
    maxConcurrent: 1
    labels: [research, web]

  venom:
    cli: "venom -p --output-format json"
    port: 3005
    mode: oneshot
    tier: 1
    timeout: 120
    maxConcurrent: 1
    labels: [custom, cli, tool]

circuitBreaker:
  enabled: true
  failureThreshold: 5          # N failures in windowMs → open
  windowMs: 60000              # rolling window for failure counting
  cooldownMs: 120000           # time before half-open probe
  failureTypes:                # which adapter errors count
    - CLI_RUNTIME_ERROR
    - CLI_TIMEOUT
    - CLI_KILLED
    - ADAPTER_PARSE_ERROR

recovery:
  crashResume: true            # scan ledger for interrupted tasks on start
  maxResumeTasks: 50           # max tasks to mark interrupted at once

server:
  host: "127.0.0.1"
  infoPort: 3000               # combined agent card + health
  auth:
    apiKey: "${PLUMB_API_KEY}" # env var, not plaintext
  logging:
    level: info
    format: json
    dir: "./.plumb/logs"
  ledger:
    dir: "./.plumb/ledger"
    retention: 90d
  pulse:
    enabled: true
    path: "./.plumb/pulse.db"
```

---

## Agent fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `cli` | Yes | — | The CLI command string |
| `port` | Yes | — | Port for this agent's Plumb server |
| `mode` | Yes | `oneshot` | `oneshot` or `persistent` |
| `tier` | No | auto-detected | 1, 2, or 3 |
| `workdir` | No | CWD | Working directory |
| `timeout` | No | 300 | Task timeout in seconds |
| `maxConcurrent` | No | 4 (oneshot), 1 (persistent) | Max simultaneous processes |
| `labels` | No | `[]` | Routing labels |
| `env` | No | `{}` | Environment variables (supports `${VAR}`) |
| `sessionStore` | No | false | Enable session store (Cursor only) |

## Server fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `host` | No | `127.0.0.1` | Bind address |
| `infoPort` | No | 3000 | Combined agent card + health port |
| `auth.apiKey` | Conditional | none (enforced) | ⚡ Required when `host != 127.0.0.1`. Skipped for loopback. Validated at boot — missing key on exposed host exits with `SERVER_CONFIG_INVALID`. |
| `logging.level` | No | `info` | Log level |
| `logging.format` | No | `json` | Log format |
| `logging.dir` | No | `./.plumb/logs` | Log directory |
| `ledger.dir` | No | `./.plumb/ledger` | Ledger directory |
| `ledger.retention` | No | `90d` | Ledger retention |
| `pulse.enabled` | No | false | Enable pulse DB |
| `pulse.path` | No | `./.plumb/pulse.db` | Pulse DB path |

## Circuit breaker fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `enabled` | No | true | Enable circuit breaker |
| `failureThreshold` | No | 5 | Failures before opening breaker |
| `windowMs` | No | 60000 | Rolling window for failures |
| `cooldownMs` | No | 120000 | Cooldown before half-open probe |
| `failureTypes` | No | see above | Which error codes count |

## Recovery fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `crashResume` | No | true | Scan ledger for interrupted tasks on start |
| `maxResumeTasks` | No | 50 | Max interrupted tasks to mark at once |

---

## Environment variable substitution

Values containing `${VAR_NAME}` are replaced with the environment variable value at startup. If the variable is not set, Plumb logs a warning and uses the literal string.

---

## Multi-agent boot

```
plumb start
  → Read plumb.yaml
  → For each agent:
     → Probe CLI binary
     → Detect adapter
     → Check version against knownGood list
     → Spawn process
     → Register in /agents + init circuit breaker
  → Run crash resume (scan ledger for interrupted tasks)
  → Start info server on server.infoPort
  → Emit health: ok (or degraded)
```

If any agent fails to start (CLI not found, auth missing, port in use, version knownBad):
- That agent is marked `error` in `/agents`
- Other agents start normally
- The boot continues without blocking

On boot, auth validation runs before any agent starts:
1. If `host == 127.0.0.1` → auth not required
2. If `host` is any other address → `auth.apiKey` must be set (env var or literal)
3. Missing key on exposed host → boot exits with `SERVER_CONFIG_INVALID`

---

## Version pinning

Plumb ships `versions.json` per adapter:

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
| Version in `knownGood` | Proceed |
| Version unknown | Log warning, proceed (may fail fixtures) |
| Version in `knownBad` | Exit 1 with structured error |

---

*The config file is the source of truth.
What you see in plumb.yaml is exactly what you get at runtime.
No surprise agents. No phantom ports. No silent drift.*
