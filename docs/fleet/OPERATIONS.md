# OPERATIONS — Deployment

```
Plumb is not a service.
Plumb is a process.
Run it with systemd, Docker, or a tmux pane.
Whatever fits your ops model.
The circuit breaker and crash resume handle the rest.
```

---

## systemd

```ini
# /etc/systemd/system/plumb@.service
[Unit]
Description=Plumb agent %i
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/bun run /opt/plumb/src/main.ts wrap "%i"
Restart=on-failure
RestartSec=5
EnvironmentFile=/etc/plumb/agent.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable plumb@pi
systemctl enable plumb@cursor
systemctl enable plumb@claude
systemctl start plumb@pi
```

One service file, templated by agent name. Environment variables from `/etc/plumb/agent.env`.

---

## Docker

```dockerfile
FROM oven/bun:latest
WORKDIR /opt/plumb
COPY package.json bun.lock ./
RUN bun install --production
COPY src/ ./src/
EXPOSE 3001
ENV PLUMB_PORT=3001
ENTRYPOINT ["bun", "run", "src/main.ts", "wrap", "--", "--port", "3001"]
```

```yaml
# docker-compose.yml
version: "3"
services:
  plumb-pi:
    build: .
    command: ["bun", "run", "src/main.ts", "wrap", "pi --mode rpc", "--port", "3001"]
    ports: ["3001:3001"]
    volumes: ["./.plumb:/opt/plumb/.plumb"]
    env_file: [".env"]

  plumb-cursor:
    build: .
    command: ["bun", "run", "src/main.ts", "wrap", "cursor-agent --print", "--port", "3003"]
    ports: ["3003:3003"]
    volumes: ["./.plumb:/opt/plumb/.plumb"]
    env_file: [".env"]
```

Each agent in its own container. Shared `.plumb` volume for the ledger.

---

## Bare metal

```bash
# tmux pane per agent
tmux new -s plumb -d
tmux send-keys -t plumb "bun run src/main.ts wrap pi --mode rpc --port 3001" Enter
tmux split-window -t plumb
tmux send-keys -t plumb "bun run src/main.ts wrap cursor-agent --print --port 3003" Enter
```

Or with the orchestrator script:

```bash
./orchestrator/plumb-orchestrator.sh start 3001 pi
./orchestrator/plumb-orchestrator.sh start 3003 cursor
./orchestrator/plumb-orchestrator.sh status
```

---

## Pre-flight checklist

Before a production deployment:

```
□ bun install --production
□ plumb.yaml written and validated
□ API keys set in environment or .env
□ Ports available (check: ss -tlnp)
□ Ledger directory writable
□ Pulse DB directory writable (if enabled)
□ systemd service file installed (if using)
□ /healthz returns 200
□ /readyz returns 200 (may show agents starting up)
□ Each agent's /a2a/jsonrpc accepts a task
□ Circuit breaker initialized (closed on all agents)
□ Conformance suite passes: bun test
```

---

## Crash recovery

Plumb handles two kinds of crash:

### Graceful shutdown (SIGTERM, deploy)

```
1. Server receives SIGTERM
2. Kill all subprocesses (SIGTERM → 5s → SIGKILL)
3. Write task_cancelled for in-flight tasks
4. Close ledger
5. Exit 0
```

### Hard crash (SIGKILL, OOM, power loss)

```
1. Process dies. Subprocesses become orphans.
2. Ledger has running tasks without completed/failed events.
3. On restart, crash resume runs:
   - Scan today's ledger for task_running w/o terminal event
   - Mark each task_interrupted
   - Log: "N tasks interrupted from previous session"
   - Accept new tasks
```

The ledger is the source of truth. The missing `task_completed` event IS the signal.

---

## Circuit breaker monitoring

Check breaker status on `/readyz`:

```bash
curl -s http://localhost:3000/readyz | jq '.breakers'
# {
#   "closed": 4,
#   "open": 0,
#   "half_open": 0
# }
```

An open breaker means an agent is flapping and needs attention:

```bash
# Check what caused the breaker to open
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE kind LIKE 'breaker.%'"

# Check recent failures for that agent
sqlite3 .plumb/pulse.db "SELECT * FROM pulses WHERE agentId='cursor' AND kind LIKE 'cli.%' ORDER BY ts DESC LIMIT 10"
```

Circuit breaker auto-recovers after cooldown (default 120s). If it repeatedly opens and closes, the agent needs investigation (OOM, auth expiry, upstream CLI change).

---

## Upgrade path

```
1. Stop the agent:  systemctl stop plumb@cursor
2. Pull new code:   git pull
3. Install deps:    bun install --production
4. Restart:         systemctl start plumb@cursor
5. Verify:          curl localhost:3003/healthz
6. Check ledger:    query for interrupted tasks
7. Check breakers:  query /readyz for breaker state
```

On restart, crash resume marks any interrupted tasks, and circuit breakers initialize closed.

---

*Deployment should be boring.
If your deployment involves more than systemctl or docker-compose,
you are over-engineering a pipe.
Crash recovery and circuit breakers make the pipe survivable, not exciting.*
