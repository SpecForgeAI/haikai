# 2026-05-31 — Async Verification & Self-Repair Orchestration (design + grill)

Source snapshot of the verification feature as designed on branch
`feature/spec-verification-and-self-repair`. Authoritative spec:
`haikai/specs/2026-05-20-async-verification-orchestration/spec.md`
(decisions D1–D10.3) + `hooks-design.md` + `flow-diagram.html` +
`petclinic-lifecycle.html`. Not yet implemented — this is the design.

## What the feature is

Replaces the weak `verify-tasks` box-check with a real verification model
around `/orchestrate`. A task group is verified across every repo it
touched. The unit is a **cell** = `(task_group, repo, verifier)`;
verifiers = `inline` (local build/test, deterministic), `rubric`
(LLM scores diff vs committed rubric), `ci-trigger` + `observe` (remote
CI / long-running quality, async). Verdict ∈ {pass, fail, pending,
timeout, skipped}. The **D5 AND gate** passes iff every required cell is
pass/skipped. A failed cell routes to **self-repair** (D4): an LLM
classifies `flaky | real | infra | out-of-scope` and, when `real`, writes
a scoped fix-task for that `(group, repo)` cell; capped attempts.

## The model (post-grill)

- **Verification is agent-followed instructions, not a Python runtime
  (D10).** Delivered like `/orchestrate-tasks` — a command (`verify-task-group`)
  + the `verification-loop` agent. There is no `orchestrate` engine that
  fires hooks; the agent does everything.
- **No code guards (D10.1).** No hard stop, no `blocking`/`advisory` hook
  split, no directives, no `HookBlocked`. The only stop is the gate not
  passing (the loop's own logic). The per-cell attempt cap is an
  instruction. Rationale: the loop is cooperative (not adversarial) and
  output is git-revertible commits, so the only failure that would justify
  a code guard — unbounded *and* uncatchable downstream — does not occur.
- **Async re-entry = re-invoke, not parked (D10.2).** A run is one-shot;
  on a late CI verdict the **mailbox** re-invokes the loop (resume the
  session if alive, else a fresh run). Equivalent because `jobs.db` is the
  durable source of truth. Re-entry must be idempotent (reconcile against
  recorded state).
- **`advance()` records; the loop dispatches dependents (D10.3).**
  `advance` only records `terminal:pass`; the loop then reads
  `orchestration.yml` and `Task`-dispatches the now-ready groups'
  implementers. No runtime scheduler.
- **Runtime = irreducible I/O only:** the mailbox (stable webhook URL —
  verify, dedup, correlate by D1 commit trailers, record, re-invoke),
  `jobs.db` (append-only state store written through thin recorders —
  `record_verdict`/`record_hook`/`advance`/`open_repair`/`update_checklist`),
  and the SSE progress stream (D6). None hold verification logic.
- **Hooks are side-effect extensions** the loop fires from `hooks.yaml`
  at transition points (`tool:`/`agent:`/`builtin:` refs); none gate. A
  check that must hold a group back is a verdict cell, not a hook.

## Decision lineage (in spec.md)

D1 commit-trailer correlation · D2 jobs.db state store · D3 per-(repo,connector)
token keying · D4 repair classifier · D5 cross-repo AND gate · D6 SSE stream ·
D7 per-repo verify enable/disable (config, not a hook) · D8 discovery of
verifier commands (pinned) · D9 connectors are thin CLI adapters, implementer
triggers CI, runtime ingests · **D10** verification is agentic instructions /
**D10.1** no code guards / **D10.2** async re-entry = re-invoke / **D10.3**
advance records, loop dispatches.

## Grill outcomes (`:grill`, 2026-05-31)

Resolved: D10.2 (async re-entry), D10.3 (advance vs dispatch), an
`/orchestrate-tasks` gating gap (verification was wired into only the
subagent path), and command duplication (single + multi `verify-task-group`
docs were thinned to delegate to the `verification-loop` agent as the one
source — 12 duplicated phase docs deleted). The `hooks-design.md` substrate
was collapsed 719→~140 lines (the earlier "runtime fires / in-process Python
`@hook` registry / blocking / directives" model superseded by D10).

## Artifacts

- `haikai-profiles/default/commands/verify-task-group/{single-agent,multi-agent}/verify-task-group.md`
- `haikai-profiles/default/agents/{verification-loop,inline-runner,rubric-verifier,repair-engine}.md`
- `/orchestrate-tasks` gains a per-group verify step.
- Interactive diagrams (mirrored to GitHub Pages, `OzzieBelazi/sx-flow-preview`).
