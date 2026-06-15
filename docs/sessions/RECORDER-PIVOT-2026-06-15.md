# Session log — Recorder pivot + Phase 0/1 (2026-06-15)

Resume point for the repositioning of Plumb from "A2A transport bridge" to
"the cross-agent ledger/record product." Read `docs/THESIS.md` first (strategy +
roadmap + honest edges); this file is the build log and the next-actions list.

Branch: `phase0-hardening` (carries Phase 1 too — rename before merge if it bothers you).

---

## CURRENT — done & verified (6 commits on top of `main`)

```
d5191bc chore: capture claude.ts working-tree change (acceptEdits) — NOT mine, see Open items
2bfd268 feat: ledger read surface — plumb stats / tail / replay
312a069 feat: structured ledger events — agent id, duration, tool calls
b69ca2f fix: phase 0 hardening — secure-by-default, INK leak, doc reconciliation
9fe36f5 docs: add CLAUDE.md and THESIS.md
(3ff980e README — pre-session baseline)
```

- **Strategy.** `docs/THESIS.md`: Plumb's defensible position is the uniform, zero-config,
  locally-owned record across heterogeneous agents' stdout — NOT the transport. Moat =
  adapter breadth + `wrap anything` + local crash-true ledger. NOT the moat = OTLP export,
  and NOT "ground truth" (it's stdout self-report). **Decision (a)** locked by owner:
  recorder as the *headline product* (competes with Datadog/Bindplane), against my
  recommendation of (b) recorder-as-wedge. Dissent kept on record in THESIS §8.
- **Phase 0 (launch gate) — DONE.** secure-by-default bind (`127.0.0.1` default; non-loopback
  refuses without `--key`/`--deny`; `--listen`, `--insecure`, EADDRINUSE handler); INK
  `inkByTaskId` leak fixed (was unbounded on persistent agents Pi/Wolfy); IPv4/IPv6
  single-stack (all self-URLs → `127.0.0.1`, fixed the ps/status "down" race); docs
  reconciled (ARCHITECTURE.md + LEDGER.md status banners); env template placeholders;
  CUTOVER security section + port-drift flag.
- **Phase 1 increment 1 — DONE.** Structured ledger events: `tool_call`/`tool_result`
  (no longer flattened to `progress` text), `agent` id on every lifecycle/tool event,
  `durationMs` + `outputBytes` on completed/failed. (`src/types.ts`, `src/core/executor.ts`)
- **Phase 1 increment 2 — DONE.** Read surface: `plumb stats` (per-agent count, p50/p95
  duration, tool histogram, failure rate), `plumb tail [-f]`, `plumb replay <taskId>`.
  Pure logic in `src/core/ledger-read.ts`; 7 unit tests in `test/ledger-read.test.ts`.

Gate state: `bun run typecheck` clean (`^src/` empty); `bun test` = **108 pass / 0 fail**;
secure-bind + ps/status + stats/tail/replay all smoke-tested live.

---

## NEXT — Phase 1 remaining (the moat), in order

1. **Hash-chain the ledger** (launch-blocking — integrity axis (a) lives on).
   - Each `LedgerEvent` line carries the prior line's hash (e.g. `prevHash`, and a `seq`).
     Compute in `Ledger.append` (`src/core/ledger.ts`) — needs to track last hash per file;
     handle daily rollover (chain restarts per file, or carry across — decide).
   - Add `plumb verify [--date|--all]` (in `ledger-read.ts` + cli) that walks the chain and
     reports the first break. Tamper = detectable.
   - Tests: clean chain verifies; a mutated line fails at the right index.
   - Honest edge: proves *integrity* (no post-hoc edit), not *completeness* (still self-report).
2. **Redaction at the boundary** (launch-blocking — compliance).
   - Scrub secrets/PII from text/tool-input/tool-output before the ledger write (not the SSE
     stream necessarily). Config-driven patterns (API keys, emails, tokens). Likely a hook in
     `handleEvents` / a `redact()` pass before `ledger.append`.
3. **Crash-resume** (high-value — completeness; makes LEDGER.md fully true).
   - On boot, scan today's ledger for `task_running`/`task_submitted` with no terminal event;
     write a NEW `task_interrupted` event (add to `LedgerEvent` union — currently absent).
   - Wire into server/cli boot (does NOT exist today — verified). See ARCHITECTURE.md banner.

Then Phase 2 (OTel GenAI semconv alignment + optional OTLP export — distribution, feature not
thesis) and Phase 3 (the `∞` mesh: Fang classes, Hermes, runtime discovery) — only if the
record pulls demand.

---

## OLD / context & open items

- **`src/adapters/claude.ts`** — committed in `d5191bc` but NOT authored this session (a
  concurrent agent added `--permission-mode acceptEdits`). Decide: keep or drop.
- **Port drift** — unit files bind Claude=3002/OpenCode=3004/VENOM=3005, but `plumb.yaml`,
  ROADMAP, and CUTOVER say 3000/3002/3004. Reconcile before any redeploy (noted in CUTOVER.md).
- **systemd hardening follow-up** — units run as root; `User=plumb`/`ProtectSystem` need
  box-specific provisioning (`/root/.bun`, `/home/plumb` paths). Documented in CUTOVER.md,
  not applied. `NoNewPrivileges`/`PrivateTmp` are safe to add inline.
- **Review findings still open** (from the product review, lower priority than the moat):
  persistent-mode is serial with head-of-line blocking + premature `working` status;
  single-token auth, no per-caller identity; no fsync on ledger (survives process crash, not
  power loss); fire-and-forget SSE (disclosed in DESIGN.md ADR-004).
- **Honest-edges to defend** (THESIS §11): self-report ≠ ground truth; OTel export
  commoditizes if it becomes the headline; the "long tail doesn't self-instrument"
  assumption is unverified; market is forming and crowding (Claude Code ships native OTel).

Key docs: `docs/THESIS.md` · `CLAUDE.md` · `systemd/CUTOVER.md` · this file.
