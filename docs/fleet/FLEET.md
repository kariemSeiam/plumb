# FLEET — Multi-Agent Orchestration

```
One plumb.yaml defines the entire fleet.
plumb start reads it. plumb status queries it.
The operator never touches a port number again.
Circuit breakers protect the fleet from flapping agents.
Crash resume ensures the fleet recovers from restart.
```

---

## The topology

```
                          ┌─────────────────────┐
                          │  plumb.yaml          │
                          │  (declarative config)│
                          └──────────┬──────────┘
                                     │ plumb start
                                     ▼
                          ┌─────────────────────┐
                          │  plumb info server   │
                          │  :3000               │
                          │                      │
                          │  GET /agents         │
                          │  GET /healthz        │
                          │  GET /readyz         │
                          │  GET /.well-known/   │
                          └──┬───┬───┬───┬───┬──┘
                             │   │   │   │   │
         ┌───────────────────┘   │   │   │   └──────────────┐
         │                       │   │   │                  │
    ┌────▼────┐           ┌──────▼───▼───▼──────┐    ┌─────▼─────┐
    │ pi:3001 │           │ cursor:3003         │    │ venom:3005│
    │persist  │           │ oneshot             │    │ oneshot   │
    │tier 1   │           │ tier 1              │    │ tier 1    │
    │labels:  │           │ labels:             │    │ labels:   │
    │scan,fast│           │ build,edit          │    │ custom    │
    │breaker: │           │ breaker:            │    │ breaker:  │
    │ closed  │           │ closed              │    │ closed    │
    └─────────┘           └─────────────────────┘    └───────────┘
```

Each agent runs on its own port. The info server (:3000) provides the combined view.

---

## Commands

```bash
plumb start
  # Reads plumb.yaml, probes versions, breaks circuit breakers,
  # runs crash resume, spawns all agents, starts info server
  # Returns: table of agents, their ports, and breaker states

plumb status
  # Shows all agents, their status, task count, uptime, breaker state
  # Returns:
  #   pi      3001  running   47 tasks  2h uptime  breaker: closed
  #   cursor  3003  running   12 tasks  2h uptime  breaker: closed
  #   claude  3002  degraded  8 tasks   1h uptime  ⚠ breaker: OPEN

plumb status --brief
  # Compact view, one line per agent

plumb status --json
  # Raw JSON for scripting

plumb routes
  # Shows label → agent mapping
  # Excludes agents with open circuit breakers
  # Returns:
  #   build,edit     → cursor:3003
  #   scan,fast,cheap → pi:3001
  #   review,deep     → claude:3002  ⚠ breaker OPEN — not routing
  #   custom          → venom:3005
  #   research,web    → opencode:3004

plumb task --labels "build,fast" "Refactor the auth module"
  # Routes by label to matching agent
  # Skips agents with open circuit breakers
  # Queues if all matching agents are busy
  # Fails fast if no matching agent is available

plumb task --agent cursor "Refactor the auth module"
  # Routes to specific agent by name (bypasses label routing)
  # Still respects circuit breaker — fails with BREAKER_OPEN

plumb task --all "Grep for TODO"
  # Routes to ALL agents in parallel
  # Combined results

plumb ledger
  # Cross-agent ledger query
  # Returns entries from all agent ledgers, merged chronologically

plumb ledger --agent cursor --failed --since 1h
  # Filtered query: failures from cursor in last hour
  # Useful for understanding why a breaker tripped
```

---

## Circuit breaker awareness in fleet mode

Every agent has a circuit breaker initialized at boot.

```
Status on /agents:
  pi:      running,  breaker: closed,    failures: 0
  cursor:  running,  breaker: closed,    failures: 0
  claude:  degraded, breaker: OPEN,      failures: 7  ← not routing
```

When a breaker is open:
- `plumb routes` excludes that agent
- `plumb task --labels X` skips that agent
- `plumb task --agent <name>` explicitly fails with `BREAKER_OPEN`
- `/readyz` reports the agent as degraded

When the breaker auto-recovers (cooldown expires, probe succeeds):
- Agent reappears in routes
- `/readyz` reports recovered
- Normal operations resume

---

## Label routing

Labels are static, operator-defined, and explicit. No LLM decides which agent handles a task. The operator assigns labels in `plumb.yaml`. The operator picks labels when submitting.

```
plumb task --labels "build,fast" "Refactor auth"
  → Plumb finds agents with BOTH labels: ["build", "fast"]
  → Matches: cursor (labels: [build, edit])
  → Excludes agents with open breakers
  → If no agent has ALL requested labels: reject with TASK_ROUTING_FAILED
  → If multiple agents have ALL requested labels: reject with TASK_ROUTING_AMBIGUOUS
    (Operator must pick a single agent or define non-overlapping label sets)
```

Label routing is NOT:
- Semantic (it doesn't understand what "build" means)
- Weighted (no agent is preferred over another)
- Cost-aware (it doesn't check token budgets)
- Capability-checking (it doesn't verify the agent can do the task)

The label system is explicit and dumb. That's the point. The operator decides.

---

## Crash resume in fleet mode

On `plumb start`:
1. Each agent runs crash resume independently
2. Ledger scan marks interrupted tasks
3. Agents come online with clean state
4. Info server shows `interrupted: { count: N }`
5. Normal operations resume

No operator intervention needed. The record of what was lost is preserved.

---

*The fleet is not a team. The fleet is a set of tools.
The circuit breaker is the immune system.
The crash resume is the healing factor.
The operator decides which tool for which job.*
