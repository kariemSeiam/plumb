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
for port in 3000 3001 3002 3003 3004 3007; do
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

## Security cutover (Phase 0 — required)

Plumb now binds **`127.0.0.1` by default** (was: all interfaces). On redeploy with current code, agents are reachable only from the same host. This is the correct posture for a co-located orchestrator and requires no unit changes.

- **Same-host orchestrator (default):** nothing to do. Verify with `curl http://localhost:<port>/health`.
- **Cross-host caller:** add `--listen 0.0.0.0` to the unit's `ExecStart` **and** `--key ${PLUMB_KEY}` (set `PLUMB_KEY` in `/etc/plumb/agent.env`), and send `Authorization: Bearer $PLUMB_KEY` from the caller. Binding non-loopback without `--key`/`--deny` now refuses to start (override only with `--insecure`).

**Recommended unit hardening** (apply per-host; not pre-applied because they depend on FS layout — `/root/.bun`, `/home/plumb`):

```ini
[Service]
NoNewPrivileges=true
PrivateTmp=true
# Running as root today. To drop privileges, first ensure the plumb user can
# reach the bun binary and the ledger dir, then:
#   User=plumb
#   ProtectSystem=strict
#   ReadWritePaths=/home/plumb/.plumb
```

> ⚠️ **Port drift — reconcile before cutover.** The committed unit files bind Claude=3002, OpenCode=3004, VENOM=3005, but `plumb.yaml`, the table below, and ROADMAP say Claude=3000, OpenCode=3002, VENOM=3004. Confirm the live mapping and align the unit `ExecStart --port` values before deploying, or agents will land on the wrong ports.

## Ports

| Port | Agent    | Mode       | Tier | Service file |
|------|----------|------------|------|-------------|
| 3000 | Claude   | oneshot    | 1    | plumb-claude.service |
| 3001 | Pi       | persistent | 1    | plumb-pi.service |
| 3002 | OpenCode | oneshot    | 2    | plumb-opencode.service |
| 3003 | Cursor   | oneshot    | 1    | plumb-cursor.service |
| 3004 | VENOM    | oneshot    | 3    | plumb-venom.service |
| 3007 | Wolfy    | persistent | 1    | plumb-wolfy.service |
