# Plumb Fleet Cutover — v0.∞.∞

## Prerequisites

1. Bun 1.3+ installed: `curl -fsSL https://bun.sh/install | bash`
2. Deps installed: `cd /home/plumb && bun install`
3. Tests pass: `bun test`
4. Env file: `cp systemd/agent.env.template /etc/plumb/agent.env && chmod 600`
   Fill in actual API keys from existing Fang config.

## Install

```
cp systemd/plumb /usr/local/bin/plumb && chmod +x /usr/local/bin/plumb
cp systemd/plumb-*.service /etc/systemd/system/
systemctl daemon-reload
```

## Service Files

```
systemd/plumb-pi.service
systemd/plumb-claude.service
systemd/plumb-cursor.service
systemd/plumb-opencode.service
systemd/plumb-venom.service
systemd/plumb-wolfy.service
```

## Cutover (one agent at a time)

```bash
# Stop Fang, start Plumb for each agent
systemctl stop fang-pi      && systemctl start plumb-pi
systemctl stop fang-claude   && systemctl start plumb-claude
systemctl stop fang-cursor   && systemctl start plumb-cursor
systemctl stop fang-opencode && systemctl start plumb-opencode
systemctl stop fang-venom    && systemctl start plumb-venom

# Wolfy (new — no Fang equivalent)
systemctl start plumb-wolfy
```

## Verify

```bash
# Health checks — all should return status: ok
for port in 3000 3001 3003 3004 3007; do
  echo -n ":$port "; curl -s http://localhost:$port/health | jq '{adapter, status, agentAlive}'
done

# Persistent agents must show agentAlive: true
curl -s http://localhost:3001/health | jq .agentAlive   # Pi
curl -s http://localhost:3007/health | jq .agentAlive   # Wolfy

# Monitor logs
journalctl -u plumb-pi -f
journalctl -u plumb-wolfy -f
```

## Rollback (if needed)

```bash
systemctl stop plumb-pi plumb-claude plumb-cursor plumb-opencode plumb-venom
systemctl start fang-pi fang-claude fang-cursor fang-opencode fang-venom
```

## Ports

| Port | Agent    | Mode       | Tier | Service file |
|------|----------|------------|------|-------------|
| 3000 | Claude   | oneshot    | 1    | plumb-claude.service |
| 3001 | Pi       | persistent | 1    | plumb-pi.service |
| 3002 | OpenCode | oneshot    | 2    | plumb-opencode.service |
| 3003 | Cursor   | oneshot    | 1    | plumb-cursor.service |
| 3004 | VENOM    | oneshot    | 3    | plumb-venom.service |
| 3007 | Wolfy    | persistent | 1    | plumb-wolfy.service |
