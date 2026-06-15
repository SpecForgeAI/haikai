# Async verification & self-repair orchestration

The verification model layered onto the Haikai lifecycle ([[haikai-sdd]]):
after a task group is implemented, it is **verified across every repo it
touched** before dependent groups proceed, and failures route to a capped
**self-repair** loop. Specified at
`haikai/specs/2026-05-20-async-verification-orchestration/`. Distinct from
the older v1 [[haikai-orchestrator]] (which had no real verification step)
and from the `/implement-tasks` box-check at
`workflows/implementation/verification/verify-tasks.md`.

## The cell

The unit of verification is a **cell** = `(task_group, repo, verifier)`.
Four verifiers per `(group, repo)`:

| Verifier | Kind | Who produces the verdict |
|---|---|---|
| `inline` | deterministic, sync | the `inline-runner` subagent runs pinned build/test commands |
| `rubric` | non-deterministic, sync | the `rubric-verifier` subagent scores the diff vs the committed rubric |
| `ci-trigger` | async | the implementer triggers CI; the verdict returns later via the inbound-gateway |
| `observe` | async | long-running quality/security signal; lands later via the inbound-gateway |

Verdict ∈ {pass, fail, pending, timeout, skipped}. A repo can disable a
verifier via config (D7) → its cell is `skipped` and excluded from the gate.

## The D5 AND gate

`gate(group) = pass` iff every required cell is `pass`/`skipped`; `fail` if
any cell is `fail`; else `pending`. Dependent groups don't advance until the
parent's gate passes. The gate *decision* is the loop's, but `advance()` is a
**guarded write** — it records `terminal:pass` only on a green, not-yet-advanced
gate, so the loop cannot record a red-gate advance (see
[[../decisions/verification-is-agentic-not-runtime]], D10.1).

## The verification-loop (the driver)

A single agent role drives one group: collect verdicts → fire hooks →
evaluate the gate → branch. It embodies the project's judgment/mechanism
split (same philosophy as [[ast-vs-llm-split]]): everything that takes
judgement is the loop's; the runtime is only irreducible I/O.

- **Branch on pass:** `advance()` records `terminal:pass` (guarded: green +
  not-yet-advanced only); the loop then reads `orchestration.yml` and
  dispatches the now-ready groups' implementers (D10.3). No runtime scheduler.
- **Branch on fail:** `open_repair` + dispatch the `repair-engine`, which
  classifies `flaky | real | infra | out-of-scope` (D4) and writes a scoped
  fix-task on `real`. Per-cell attempt cap (an instruction); escalate on
  exhaustion.
- **Async re-entry (D10.2):** the loop is one-shot. When a `ci-trigger` /
  `observe` verdict lands minutes-to-days later, the **inbound-gateway** starts
  a **fresh** loop run that reconstructs from `jobs.db` (never a resumed
  session — D10.2). Re-entry is idempotent.
- **Observer drift:** a late `observe` flip after the group advanced reopens
  only that cell and pauses dependents for a compensating fix-task.

## Runtime = irreducible I/O

The only code (everything else is the agent following instructions, D10):

- **Inbound-gateway** — a FastAPI webhook route with a stable URL: verify provider
  signature, dedup on the delivery id, correlate the commit SHA to a cell via
  the **authenticated SHA→cell binding** recorded at CI-trigger time (D10.4 —
  not by grepping commit trailers), record the verdict, and **re-invoke** the
  loop. It routes; it decides nothing. The reason it can't be the agent: a URL
  must stay reachable regardless of which agent is running.
- **State store** — `jobs.db`, written through the recorder tools — **guarded
  writes** (D10.1: refuse a red-gate advance, double-advance, or over-cap repair)
  (`record_verdict`, `record_hook`, `advance`, `open_repair`,
  `update_checklist`).
- **SSE stream** (D6) — always-on progress projection; how a human watches a
  run live (and the cost backstop for a runaway repair loop).

## Hooks are side-effects, not control

The loop fires handlers from `hooks.yaml` at transition points
(`post_implement`, `pre_verify`, `gate_evaluated`, `pre_repair`,
`post_repair`, `observer_drift`) by kind (`tool:`/`agent:`/`builtin:`). They
add behaviour (audit, dashboards, notify); **none gate**. Anything that must
hold a group back is a verdict cell. (Earlier the substrate was modelled as a
runtime-fired in-process Python `@hook` registry with blocking handlers +
directives — superseded by D10; collapsed in `hooks-design.md`.)

## Delivery

A first-class Haikai command, `verify-task-group` — a **flat,
flag-guarded command like `/orchestrate-tasks`** (not a single/multi-agent
subdir split) that only invokes the `verification-loop` agent, the single
source of the procedure: `{{IF use_claude_code_subagents}}` delegate to the
subagent, `{{UNLESS}}` follow its Steps 1–8 inline. `/orchestrate-tasks`
invokes it once per group; `advance()` releasing dependents is the DAG
hand-off.

Verifier *commands* are discovered from repo data and pinned (D8, the same
[[agentic-discovery]] hypothesis→probe→assess loop); hooks are in-process not
`.sh` for the same reason discovery and the rest are Windows-clean
([[../decisions/windows-first-compatibility]]).

## Cross-references

- [[haikai-sdd]] — the lifecycle this verifies
- [[haikai-orchestrator]] — the older v1 chain (no verification)
- [[ast-vs-llm-split]] — the judgment/mechanism philosophy this extends
- [[../decisions/verification-is-agentic-not-runtime]] — the load-bearing decision
- [[agentic-discovery]] — how verifier commands are discovered (D8)
- [[job-queue]] — `jobs.db` is the shared state store

## Sources

- `haikai/specs/2026-05-20-async-verification-orchestration/spec.md` (D1–D10.3)
- [[../../raw/2026-05-31_async-verification-self-repair]]
