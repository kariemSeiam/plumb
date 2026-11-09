# OPERATING

Production runbook for the Plumb fleet.

---

## Quick Start (60 seconds)

```bash
# Install
bun add -g plumb-bridge

# Wrap any CLI
plumb wrap claude --port 3000

# Verify
curl http://localhost:3000/health
curl http://localhost:3000/.well-known/agent-card.json

# Send a task
curl -X POST http://localhost:3000/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"message/send","params":{"message":{"messageId":"m1","role":"user","parts":[{"kind":"text","text":"hello"}]}},"id":1}'
```

---

## Fleet Operations

Define all agents in `plumb.yaml`:

```yaml
version: "1"
agents:
  - id: claude
    cli: claude
    port: 3000
  - id: wolfy
    cli: wolfy
    port: 3007
    mode: persistent
    env:
      PI_CODING_AGENT_DIR: /opt/wolfy-data/agent
```

```bash
plumb fleet validate   # parse config + detect adapters
plumb fleet up         # start all agents (foreground)
plumb fleet status     # hit /health on all ports
```

Full schema and examples: `docs/FLEET.md`.

---

## Health Monitoring

```bash
curl -s http://localhost:3001/health | jq .
```

```json
{
  "status": "ok",
  "adapter": "pi",
  "tier": 1,
  "mode": "persistent",
  "agentAlive": true
}
```

| Field | Values | Notes |
|-------|--------|-------|
| `status` | `ok` / `error` | `ok` = server is up and accepting tasks |
| `adapter` | string | Adapter id (pi, claude, cursor, etc.) |
| `tier` | 1 / 2 / 3 | Protocol reliability tier |
| `mode` | `oneshot` / `persistent` | Process mode |
| `agentAlive` | `true` / `false` / `null` | Persistent agents only. null for oneshot. |

`agentAlive: false` on a persistent agent means the subprocess has crashed. Plumb is still up. The next task will re-spawn it.

---

## Port Reference

| Port | Agent | Mode | Tier |
|------|-------|------|------|
| 3000 | Claude | oneshot | 1 |
| 3001 | Pi | persistent | 1 |
| 3002 | OpenCode | oneshot | 2 |
| 3003 | Cursor | oneshot | 1 |
| 3004 | VENOM | oneshot | 3 |
| 3005 | Generic | oneshot | 3 |
| 3007 | Wolfy | persistent | 1 |

---

## Ledger Queries

```bash
LEDGER=".plumb/ledger/$(date +%Y-%m-%d).jsonl"

# All completed tasks today
jq 'select(.type=="task_completed")' "$LEDGER"

# All failures with error messages
jq 'select(.type=="task_failed") | {taskId, error, timestamp}' "$LEDGER"

# Output for a specific task
jq -r 'select(.type=="progress" and .taskId=="<id>") | .text' "$LEDGER"

# Tasks by adapter today
jq 'select(.type=="task_submitted") | .cli' "$LEDGER" | sort | uniq -c

# Last activity timestamp
jq '.timestamp' "$LEDGER" | tail -1
```

Full schema and query reference: `docs/LEDGER.md`.

---

## Troubleshooting

**Agent returns 401:**
The instance was started with `--key`. Set `Authorization: Bearer <key>` header on `/a2a/*` requests. Agent Card and `/health` are always public.

**Task times out:**
Default timeout is 300s. Override per agent in `plumb.yaml` with `timeout: <seconds>`. On timeout: SIGTERM → 5s → SIGKILL → `task_failed` written to ledger.

**Persistent agent shows `agentAlive: false`:**
The subprocess crashed. Send any task — Plumb re-spawns it automatically. Check stderr logs for the crash reason:
```bash
journalctl -u plumb-pi -f
```

**Ledger not writing:**
Ledger writes to `.plumb/ledger/` relative to the working directory. Check that the directory is writable. Write failures are non-fatal — Plumb logs to stderr and continues.

**Generic adapter selected unexpectedly:**
No registered adapter matched the CLI string. Run `plumb fleet validate` to see adapter detection results. If the binary is absent, install it. If the binary name doesn't match any adapter, Plumb uses Generic (text passthrough, tier 3).

**Port already in use:**
```bash
lsof -i :<port>
```
Pick a different port or stop the occupying process.

---

## Systemd

Service files: `systemd/`. One `.service` file per agent.

```bash
# Install
cp systemd/plumb-*.service /etc/systemd/system/
systemctl daemon-reload

# Start
systemctl start plumb-claude plumb-wolfy plumb-cursor

# Monitor
journalctl -u plumb-wolfy -f

# Status
systemctl status plumb-*
```

Cutover from Fang to Plumb: `systemd/CUTOVER.md`.

For persistent agents (Pi, Wolfy): add `Restart=on-failure` to the systemd unit. Plumb re-spawns the subprocess internally on crash, but if Plumb itself crashes, systemd handles the restart.

---

## Auth

```bash
plumb wrap claude --port 3000 --key my-secret-token
```

When `apiKey` is set (via `--key` or `plumb.yaml`):
- `/a2a/jsonrpc` and `/a2a/rest` require `Authorization: Bearer <key>`
- `/.well-known/agent-card.json` and `/health` remain public

No key rotation at runtime. Restart with a new key to rotate.

---

*Logs are the UI. Health is the interface. The ledger is the record.*
