# REFUSALS — What Plumb Will Never Build

```
The hardest decisions are not what to build.
They are what to never build.
Plumb's refusals are its architecture.
```

---

## No dashboard

A dashboard implies that Plumb's health can be summarized in charts. It cannot. Plumb's health is a `400` response or a `200` response. Either the pipe is open or it is closed. A bar chart of task throughput adds nothing to that signal.

If you want a dashboard, pipe the pulse DB into Grafana. Plumb ships the data source. Not the visualization.

## No orchestration

Orchestration implies that Plumb should decide which agent handles which task based on capability, cost, or availability. Plumb does not know what a task requires. It does not know what an agent can do. It knows labels, which are assigned by the operator.

The operator decides. Plumb routes. That is the boundary.

## No LLM

Plumb does not call OpenAI, Anthropic, Google, or any model API. It spawns subprocesses and reads stdout. If a subprocess needs an LLM, that is the subprocess's concern. Plumb is the transport layer, not the intelligence layer.

## No plugins

A plugin system implies that the surface area of Plumb is extensible by third parties. It is not. The adapter contract is the only extension point. Changing an adapter requires a commit and a test run. There is no marketplace. There is no hot reload.

## No memory

The ledger records. It does not learn. It does not summarize. It does not cross-reference tasks from different agents. SIPHON (a separate process) reads the ledger and extracts meaning. Plumb writes the raw data. SIPHON produces the intelligence. Neither depends on the other.

## No process supervision

Plumb spawns processes and cleans them up on task completion. It does not auto-restart crashed processes. It does not health-check-loop. It does not alert on failure. systemd handles process supervision. Plumb handles task execution.

## No platform

Plumb has no marketplace, no extension registry, no third-party ecosystem. The npm package is the distribution. The GitHub repo is the source. There is no managed cloud service. There is no enterprise tier.

---

## Why the refusals are the strategy

Every refusal protects something:

```
No dashboard    → protects the operator from false comfort
No orchestration → protects the operator's decision authority
No LLM          → protects the boundary between transport and intelligence
No plugins      → protects the adapter contract from scope creep
No memory       → protects the ledger from corruption by interpretation
No supervision  → protects the boundary with systemd (who does it better)
No platform     → protects the company from becoming the product it should dissolve into
```

---

## What Plumb will accept

Plumb accepts being called:

- "Just a bridge"
- "Only an adapter layer"
- "Basically some process management"
- "A bit boring"
- "Not that innovative"

Every one of these is correct. Plumb is not innovative. It is precise. Precision outlasts innovation.

---

*The refusals are not limitations.
They are the walls that keep the pipe from leaking into places it doesn't belong.*
