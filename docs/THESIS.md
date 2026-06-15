# THESIS — What Plumb Actually Is, and Why It Wins

> A positioning bet, stated with its honest edges. Companion to DESIGN.md (the *how*).
> Draft for decision — the repositioning in §8 is the owner's call, not a done deal.
> Date: 2026-06-15.

---

## 0. One line

**Plumb is the uniform, zero-config, locally-owned record of what every CLI agent in a heterogeneous fleet did — including the agents that emit no telemetry of their own.** The A2A bridge is how tasks get in and out. The ledger is the product.

---

## 1. The mispositioning

Today Plumb sells itself as an **A2A transport bridge** ("quiet pipes for noisy agents"). Transport is a commoditizing category: A2A is a published standard, the SDK does the framing, and every agent vendor is shipping its own server mode. As that happens, "uniform bridge" value decays — the orchestrator can talk to each agent directly.

If Plumb stays defined as transport, it is on the losing side of its own success: the better A2A adoption gets, the less anyone needs a bridge.

The transport is real and useful. It is not the moat.

## 2. What Plumb actually is

Plumb already does something no transport layer needs to: it **parses every agent's stdout into one normalized event model** (`AdapterEvent`) and **records the full task lifecycle to an append-only local ledger**. Eight agents, one schema, one file format, queryable with `jq`, surviving crashes, owned entirely by the operator.

That capability — *uniform record across heterogeneous agents, captured by wrapping, with zero cooperation required from the agent's authors* — is the asset. The demand for it is now documented, not speculative: NIST AI RMF GOVERN, SOC 2 Type II (≥90-day retention), and ISO 42001 all require audit trails for autonomous agents, and teams running fleets of coding agents have no vendor-neutral way to get one.

## 3. The moat — and what is NOT the moat

**The moat is the combination, not any single piece:**

1. **Adapter breadth + `wrap <anything>` zero-config.** No SDK to adopt, no per-agent instrumentation project. You wrap the binary; you get the record. This covers the agents that ship no telemetry at all (cursor-agent, opencode, pi, wolfy, custom scripts) and unifies them with the ones that do.
2. **One normalized schema across vendors.** Datadog/Honeycomb show you Claude's native spans *or* LangChain's *or* CrewAI's — each in its own dialect. Plumb shows all your agents in one shape, reconciled.
3. **The local crash-true ledger.** A record that exists on disk, owned by the operator, when you can't or won't route telemetry to a SaaS backend. Air-gapped, offline, pre-incident, no egress.

**What is explicitly NOT the moat:**

- **OTLP/OpenTelemetry export.** It is essential for *distribution* (plugs into existing stacks) but it is a commoditization trap if mistaken for the product: the more value lives in the OTel backend, the more Plumb is "an exporter anyone could write against `claude stream-json`." Emit OTel as a feature. Do not stake the thesis on it.
- **"Ground truth" / tamper-evidence.** Plumb captures **stdout — the agent's self-report**, exactly as trustworthy as the agent's own native telemetry, no more. It is not an OS-level syscall monitor. It does not see what the agent did not print. Claiming otherwise is false and the first text-only agent falsifies it.

## 4. The richness/universality trade-off (state it plainly)

- **Lifecycle capture is universal and thin:** spawn, exit code, stderr, duration, stdout bytes — for *any* wrapped command, structured or not.
- **Action capture is rich but conditional:** "called tool X", "edited file Y" exists **only when the agent prints it** (stream-json: claude/cursor/venom; JSONL-RPC: pi/wolfy). A text/echo/generic agent yields prose, not structured actions.

Plumb's record is "uniform and zero-config," not "uniformly rich." Sell the first. Never imply the second.

## 5. The key assumption (validate before building recorder code)

The wedge depends on: **the long tail of agents does not self-instrument consistently.** This is *inferred, not verified* — the market scan found Claude-Code-specific OTel tooling, not proof that cursor-agent/opencode emit nothing.

Anthropic has already baked OTel into Claude Code. Assume the trajectory is *more* agents self-instrument over time. The wedge survives that trajectory for three durable reasons:

1. The long tail (custom agents, internal tools, shell-driven flows) never fully instruments.
2. Cross-vendor OTel still needs reconciliation into one operator-owned view.
3. Zero-config local capture beats standing up per-agent telemetry pipelines — especially pre-incident, offline, or air-gapped.

"Nobody else records agents" is already false. Do not write it. Write the three reasons above.

## 6. The gap — why this isn't the moat *yet* (evidence)

The asset is currently too thin to carry the thesis. All verified in code:

| Gap | Evidence | Why it kills the thesis |
|-----|----------|-------------------------|
| Ledger schema is anemic | `LedgerEvent` (`types.ts:98-106`): no `agent` id, no `duration`, no structured outcome, no tool events | You can't answer "which agent, how long, what did it do" — the core audit questions |
| Rich signal is thrown away | Executor parses `tool-call`/`tool-result` then **flattens to `progress` text** (`executor.ts:221-231`) | The most valuable data is captured and then destroyed at the ledger boundary |
| Docs describe a ledger that doesn't exist | `docs/core/LEDGER.md` documents `agent`, `pid`, `duration`, `output`, `task_interrupted` — none are written | Credibility: the spec for the moat asset is fiction |
| No read surface | CLI has `wrap/fleet/ps/status/send` — no `tail`/`replay`/`stats`/`diff` | A record you can only `jq` is not a product; the moat is unusable |
| Record is incomplete | No crash-resume (`grep` clean; `ledger.ts:16-24` only counts) | Dangling `task_running` with no terminal event undermines "complete record" |
| The recorder is itself an RCE | Default-open, all-interfaces, root systemd units (see review) | An audit/forensics tool that is itself exploitable is dead on arrival |

The good news: the foundations are already there. INK metadata (correlationId/depth/traceparent) is carried on ledger events — cross-task and cross-hop correlation is wired. `thinking` is already a structured ledger event. The SIPHON pipeline (ledger → decisions/patterns → memory) in the `∞` design *is* this thesis pointed at VENOM's memory; the recorder is the productization of that same substrate.

The single highest-leverage code change is small: **stop flattening tool events; write structured `tool_call`/`tool_result`/outcome ledger events with agent id and duration.** That one change converts the ledger from a transcript into a record.

## 7. Market pressure-test (honest)

- **The category is forming and crowding.** Claude Code ships native OTel; Bindplane, `agents-observe`, Augment, Nylas all play in "agent observability"; OTel GenAI semantic conventions are the standard (client spans stable early 2026, agent spans experimental-but-stable, Datadog/Honeycomb/New Relic supporting). You are *not* entering an empty field.
- **But the existing tools are per-vendor and SDK/API-level**, skewed Claude-Code-specific. The cross-vendor, process-wrap, zero-config, local-first quadrant is thin.
- **Who pays:** not individuals. Teams/orgs running multi-agent automation across *more than one* vendor who need audit, reproducibility, and debugging they can't get from any single vendor's SDK — and the compliance-driven subset (prove what the agent did).
- **Who this serves first, with certainty:** VENOM∞ and HVAR — Kariem's own heterogeneous mesh (Pi, Wolfy, Cursor, Claude, OpenCode). That value is immediate and does not depend on winning a market.

## 8. The strategic fork (owner's decision)

The discriminator that decides everything downstream:

- **(a) Recorder as the headline category.** Plumb competes *as* an agent-observability product. → You are now fighting funded observability vendors (Datadog et al.), solo. High ceiling, high burn, not a solo-win.
- **(b) Recorder as the differentiating feature.** The record is the wedge that makes Plumb the obvious way to *run* a heterogeneous agent fleet. Serves VENOM first; OSS adoption follows from being genuinely useful. → Keeps the recorder as moat without betting the house.

**Recommendation was (b)** — you can't out-resource Datadog, and (b) makes the recorder a reason-to-choose rather than a market to conquer.

**DECISION (2026-06-15): (a) — recorder as the headline product.** Owner's call, made with the §11 risks on the table. Recommendation noted and overridden; executing (a). What (a) demands, beyond (b):

- **The foundation becomes disqualifying, not embarrassing.** A forensics/audit product that is itself a default-open root RCE is dead on arrival with the exact buyers (a) targets. Phase 0 (§10) is now a *launch gate*, not hygiene.
- **Tamper-evidence on the integrity axis.** Plumb can't prove *completeness* (self-report — §3) but it can prove *integrity*: hash-chain the append-only ledger (each line carries the prior line's hash) so any post-hoc edit is detectable. Cheap, on-brand ("the ledger doesn't lie" becomes literally verifiable), and directly answers the auditor's question (a) lives or dies on.
- **Redaction at the boundary.** Agent stdout leaks secrets/PII; an audit product must scrub-or-vault before the ledger.
- **A five-second competitive line.** Against Datadog/Bindplane/agents-observe: *"One operator-owned record across every agent you run — including the ones that emit no telemetry — wrapped, not instrumented."* Sharpen before any landing page.
- **Honest division of labor.** I can build the record, the read surface, the integrity chain, the OTel mapping, and the positioning docs. I cannot run go-to-market, fund support, or close enterprise deals. (a) needs those; they are yours, or (a) stalls at "great OSS nobody's paid to adopt."

## 9. The v1 surface that wins (under option b)

Keep the spine (refusals intact: no LLM, no orchestration, no dashboard). Add:

1. **Rich ledger events** — structured `tool_call`/`tool_result`/`file_touch`/`outcome`, each stamped with `agent`, `duration`, exit code, and token/cost when the agent prints it. (Small change; biggest payoff. §6.)
2. **A read surface** — `plumb tail` (live follow), `plumb replay <taskId>` (reconstruct a run), `plumb stats` (per-agent count, p50/p95 duration, failure rate, tool histogram), `plumb diff <a> <b>` (compare two runs). CLI/TUI only — `jq` underneath, no dashboard. On-brand.
3. **OTel GenAI-aligned schema + OTLP export** — align event shapes to the standard; optional `--otlp <endpoint>` so the record drops into existing stacks. Feature, not thesis (§3).
4. **Crash-resume** — make the record complete, finally make `LEDGER.md` true.

## 10. Roadmap (Phase 0 is non-negotiable)

- **Phase 0 — Earn the right (this week).** Secure-by-default (bind localhost, require key/deny, harden + `User=` the units, rotate template keys); fix the `inkByTaskId` leak; reconcile `ARCHITECTURE.md` + `LEDGER.md` to code. You do not build a forensics product on a default-open root RCE and fictional specs.
- **Phase 1 — The record (the moat).** Rich ledger events + crash-resume + read surface (`tail`/`replay`/`stats`) + ledger hash-chain (tamper-evidence) + boundary redaction. *(Under decision (a), the hash-chain and redaction are launch-blocking, not optional.)*
- **Phase 2 — Distribution.** OTel GenAI alignment + OTLP export.
- **Phase 3 — The mesh.** The `∞` vision (Fang classes, Hermes, runtime discovery) — *only if* the record lands and pulls demand.

## 11. Honest edges (where this bet breaks)

- **Self-report, not ground truth.** If buyers need tamper-evident action proof, Plumb's stdout capture is insufficient and a syscall/eBPF monitor wins. Plumb's honesty is "what the agent said it did," recorded faithfully — not "what the agent did."
- **The category may consolidate around OTel + vendor backends** before Plumb's cross-vendor wedge matters. If every agent emits clean OTel and one backend reconciles it, the normalization value erodes.
- **The self-instrumentation assumption (§5) may fail faster than expected.** Anthropic moved first; others may follow within a year.
- **OTel export commoditizes Plumb** if it becomes the headline rather than a feature.
- **The market is forming, not proven at the SMB/solo tier.** Demand is documented at the compliance/enterprise tier — exactly where a solo OSS tool has the least reach. Hence option (b): serve the one user you're certain of (VENOM) and let usefulness, not a go-to-market, drive adoption.

## 12. Repositioning copy (proposal — owner's call, §8)

Soften/retire the "distributed nervous system / mesh" language: it oversells the serial-persistent reality *and* describes the orchestration Plumb refuses. Point the existing "the ledger doesn't lie" / "honest edges" voice at the record. Candidate spine:

> **The record for your agents. Every task, every tool call, recorded true — across every agent you run.**

Keep "quiet pipes for noisy agents" as the transport tagline; let the record be the headline. Final wording is the owner's decision.

---

*A thesis is a bet on where value concentrates. This one bets it concentrates in the operator-owned, cross-vendor record — not the transport that carries it, and not a SaaS backend that rents it back. Update this doc when an edge in §11 becomes reality.*
