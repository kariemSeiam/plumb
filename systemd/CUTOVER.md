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

## Cutover (one agent at a time)

```
# Stop Fang, start Plumb for each agent
systemctl stop fang-pi      && systemctl start plumb-pi
systemctl stop fang-claude   && systemctl start plumb-claude
systemctl stop fang-cursor   && systemctl start plumb-cursor
systemctl stop fang-opencode && systemctl start plumb-opencode
systemctl stop fang-venom    && systemctl start plumb-venom
```

## Verify

```
# Health checks — all should return status: ok
for port in 3001 3002 3003 3004 3005; do
  echo -n ":$port "; curl -s http://localhost:$port/health | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['adapter'], d['status'])"
done

# Check agent cards
curl -s http://localhost:3001/.well-known/agent-card.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['name'], d['capabilities'])"
```

## Rollback (if needed)

```
systemctl stop plumb-pi plumb-claude plumb-cursor plumb-opencode plumb-venom
systemctl start fang-pi fang-claude fang-cursor fang-opencode fang-venom
```

## Ports

| Port | Agent   | Mode       | Tier |
|------|---------|------------|------|
| 3001 | Pi      | persistent | 1    |
| 3002 | Claude  | oneshot    | 1    |
| 3003 | Cursor  | oneshot    | 1    |
| 3004 | OpenCode| oneshot    | 2    |
| 3005 | VENOM   | oneshot    | 3    |
