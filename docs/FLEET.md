# FLEET

Declare multiple agents in `plumb.yaml`. Boot them all with one command.

```bash
plumb fleet validate   # check config, detect adapters
plumb fleet up         # start all agents
plumb fleet status     # health check all
```

---

## plumb.yaml Schema

```yaml
version: "1"
agents:
  - id: <string>         # required. Stable identifier. Used in logs and ledger.
    cli: <string>        # required. CLI command (same as `plumb wrap <cli>`).
    port: <number>       # required. 1–65535. Must be unique across agents.
    mode: oneshot        # optional. 'oneshot' | 'persistent'. Default: auto-detected.
    name: <string>       # optional. Display name override for agent card.
    timeout: <number>    # optional. Task timeout in seconds. Default: 300.
    workdir: <string>    # optional. Working directory for spawned processes.
    apiKey: <string>     # optional. Bearer token for /a2a endpoints.
    labels: [<string>]   # optional. Labels for routing documentation.
    sessionStore: <bool> # optional. Enable CursorSessionStore (Cursor adapter only).
    env:                 # optional. Environment variables.
      KEY: value         # Supports ${VAR} substitution from host environment.
```

Config is immutable while running. Changes require restart.

---

## Full Example

```yaml
version: "1"
agents:
  - id: pi
    cli: pi
    port: 3001
    mode: persistent
    timeout: 600

  - id: wolfy
    cli: wolfy
    port: 3007
    mode: persistent
    timeout: 600
    name: "Wolfy"
    env:
      PI_CODING_AGENT_DIR: /opt/wolfy-data/agent

  - id: claude
    cli: claude
    port: 3000
    mode: oneshot

  - id: cursor
    cli: cursor-agent --print
    port: 3003
    mode: oneshot
    timeout: 300
    sessionStore: true

  - id: opencode
    cli: opencode
    port: 3002
    mode: oneshot

  - id: venom
    cli: venom
    port: 3004
    mode: oneshot
    labels: [orchestration, tier3]

  - id: generic
    cli: my-tool
    port: 3005
    mode: oneshot
```

---

## Commands

### plumb fleet validate

Checks the config file without starting anything.

- Parses `plumb.yaml` (or `plumb.yml`, or `./config/plumb.yaml` — first match wins).
- Detects installed adapters via `detect()`.
- Reports errors (duplicate IDs, invalid ports, missing required fields).
- Reports warnings (no registered adapter for CLI → will use generic fallback).

Exit 0 if valid, 1 if errors found.

### plumb fleet up

Starts all agents defined in `plumb.yaml`.

Each agent runs as a separate `plumb wrap` process on its assigned port. Fleet `up` is not a daemon — it blocks and forwards process signals. Use systemd for production.

### plumb fleet status

Hits `/health` on every agent port and prints a summary table.

```
id        port   status   adapter    tier   mode        agentAlive
pi        3001   ok       pi         1      persistent  true
wolfy     3007   ok       wolfy      1      persistent  true
claude    3000   ok       claude     1      oneshot     —
cursor    3003   ok       cursor     1      oneshot     —
opencode  3002   error    —          —      —           —
```

`agentAlive` is `true/false` for persistent agents, `—` for oneshot.

---

## Port Reference

Conventional assignments. Not enforced — pick any available port.

| Port | Agent | Mode |
|------|-------|------|
| 3000 | Claude | oneshot |
| 3001 | Pi | persistent |
| 3002 | OpenCode | oneshot |
| 3003 | Cursor | oneshot |
| 3004 | VENOM | oneshot |
| 3005 | Generic | oneshot |
| 3007 | Wolfy | persistent |

---

## Environment Substitution

`env` values support `${VAR}` syntax, substituted from the host process environment at load time.

```yaml
env:
  API_KEY: ${OPENAI_API_KEY}
  AGENT_DIR: ${HOME}/agents/wolfy
```

If `VAR` is not set in the environment, the literal string `${VAR}` is passed through unchanged.

---

## Systemd Integration

`plumb fleet up` is not a supervisor. For production, run each agent as a systemd service.

Service files live in `systemd/`. One file per agent.

```
systemd/plumb-pi.service
systemd/plumb-claude.service
systemd/plumb-cursor.service
systemd/plumb-opencode.service
systemd/plumb-venom.service
systemd/plumb-wolfy.service
```

Cutover procedure: `systemd/CUTOVER.md`.

Each service runs:
```
ExecStart=/usr/local/bin/plumb wrap <cli> --port <n>
```

For persistent agents (Pi, Wolfy), `Restart=on-failure` in the unit file handles crashes. Plumb itself does not auto-restart persistent processes across service restarts — each `plumb wrap` start spawns fresh.

---

## Upgrading

**Single agent (zero downtime for others):**
```bash
systemctl restart plumb-cursor
```

**Full fleet:**
```bash
systemctl restart plumb-pi plumb-claude plumb-cursor plumb-opencode plumb-venom plumb-wolfy
```

**Verify after restart:**
```bash
plumb fleet status
# or:
curl -s http://localhost:3001/health | jq .
```

---

*Fleet is enabling constraint. Two persistent agents plus the full plumb.yaml is the nervous system.*
