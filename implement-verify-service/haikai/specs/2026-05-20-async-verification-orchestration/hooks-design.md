# Hooks Design — Orchestration Hook Surface (`[B]`)

> Sibling to [`spec.md`](./spec.md). Rewritten 2026-05-31 for **D10 / D10.1**.
> Hooks are **fired by the `verification-loop` agent**, not a runtime, and
> are **side-effect extensions only** — none gate, route, or block. The
> earlier model (the `orchestrate` runtime fires events; an in-process
> Python `@hook` registry in `events.py`; `blocking`/`advisory` handlers;
> `reopen-gate` / `cap-override` / `route-repair` directives;
> `HookBlocked` / `AbortEvent` / `AbortOrchestration`) is **removed** — see
> *What is NOT a hook* and *Removed* below.

## Model

The `verification-loop` agent passes through named **transition points**
while it verifies a task group (see `commands/verify-task-group/`,
Phase 3). At each one it reads `hooks.yaml`, walks the listed handlers in
order, invokes each, and records the result via `record_hook` — all as
agent instructions (D10). Handlers add behaviour (audit, dashboards,
notify, custom routing telemetry); they **never** gate the group, mutate
gate state, or stop the run. The only stop in the system is the D5 gate
not passing, which is the loop's own logic (D10.1).

This is the *orchestration boundary* `[B]`, distinct from `[A]` (the
developer-workstation git hook) and from the *invocation* surfaces `[X]`
(operator CLI) and `[Y]` (agent slash commands).

> **Hooks ≠ the live view.** Progress is the always-on SSE stream
> (`GET /api/v2/orchestrations/{job_id}/stream`, spec D6), a projection of
> the state store that emits a frame on every transition whether or not a
> hook is installed. Use a hook to *act* (notify, route telemetry); use
> the stream to *watch*.

## Transition points

The `verification-loop` fires handlers at these points during a task
group run (polyrepo baseline — per-`(group, repo)` cells are the unit):

| Transition         | Cardinality                              | When (loop is here)                                      | Example handler use                          |
|--------------------|------------------------------------------|----------------------------------------------------------|----------------------------------------------|
| `spec-frozen`      | once per spec                            | `/shape-spec` output committed                           | scaffold per-repo branches; seed `tasks/`    |
| `post-implement`   | once per group                           | all `touched_repos` commits landed (SHAs visible)        | label per-repo PRs; post a build update      |
| `pre-verify`       | once per group                           | just before the verifier cells fan out                   | warm caches; snapshot baseline metrics       |
| `verdict-landed`   | once per `(group, repo, verifier)` cell  | the loop records a cell verdict                          | stream per-cell dots to a dashboard          |
| `gate-evaluated`   | once per gate evaluation                 | after the loop folds the D5 gate (Phase 4)               | gate-result alerting / telemetry             |
| `pre-repair`       | once per failing cell                    | before the loop opens a repair for a cell                | snapshot the tree; cost-tracking notify      |
| `post-repair`      | once per repair attempt                  | after a repair attempt commits                           | diff vs last attempt; post to reviewer       |
| `task-group-done`  | once per group                           | the loop calls `advance()` (gate passed)                 | write status to spec; notify watchers        |
| `observer-drift`   | once per flipped cell                    | a late async verdict flips a cell after the group moved on | drift telemetry; alerting                  |

The loop reaches `gate-evaluated`/`task-group-done` by its own logic;
firing the handler is for *observers*, it does not decide the branch.

## Handler-ref grammar

A handler is referenced by `kind:name`. The loop invokes it by kind:

- `builtin:<name>` — an in-process helper shipped with the profile.
- `tool:<name>` — a tool the loop calls.
- `agent:<name>` — a subagent the loop dispatches via Task.

All three are invoked the same way and their return is recorded verbatim
via `record_hook`. The return has **no control effect** (D10.1): a
handler cannot gate, reroute, cap, or abort. Anything that must hold a
group back is modelled as a **verdict cell**, not a hook.

## `hooks.yaml` — declaration

The workspace declares which handlers run at which transition, in order:

```yaml
# <workspace>/.standards-extractor/hooks.yaml
pre_verify:
  - tool:secret-scan-telemetry          # records to a dashboard; does NOT gate
  - agent:metrics-baseline
gate_evaluated:
  - tool:gate-alert
post_repair:
  - agent:reviewer-notify
```

- Order within a transition is list order.
- A transition with no entry fires nothing.
- This is the whole contract: handler ref + order. There is no `mode`,
  no `timeout`, no decorator — those belonged to the removed runtime
  model. (A handler that does slow I/O should be quick or fire-and-forget
  on its own; the loop records its return and moves on.)

## What a handler receives

The loop passes the cell/group context for the transition: `run_id`,
`task_group`, `touched_repos`, and for cell-level transitions `repo`,
`verifier`, `attempt`, `commit_sha`, `connector_kind`. The
correlation key is the spec-D1 triple plus verifier+attempt —
`<run_id>:<task_group>:<repo>:<verifier>:<attempt>` — tying verdicts,
hook firings, state-store rows, and CI webhooks together. A handler reads
this run's state through the read side of `jobs.db`; it does not write
verdicts or gate state.

## What is NOT a hook

| Concern                                   | Where it lives                                                    |
|-------------------------------------------|-------------------------------------------------------------------|
| Gating a group (e.g. secret-scan must pass) | a **verdict cell** in the D5 gate — the gate is the only stop      |
| Control flow (advance, repair, attempt cap) | **loop instructions** (`verify-task-group` Phases 4–6)            |
| CI dispatch / async verdict ingest        | the implementer triggers CI (D9); the **inbound-gateway** ingests (D9.1)  |
| Per-repo verification enable/disable      | static config (spec **D7**), not a hook                           |
| Progress / live view                      | the **SSE stream** (D6), always on                                |

## Removed (and why)

Per D10/D10.1, none of the following exist:

- **"The runtime fires events."** The `verification-loop` agent fires hooks.
- **In-process Python `@hook` registry / `events.py` dispatch / `emit()` chokepoint.** Verification is agent-followed instructions, not a Python engine.
- **`blocking` / `advisory` split.** No hook blocks; all are side-effect handlers.
- **Directives (`reopen-gate`, `cap-override`, `route-repair`, `skip-group`).** A handler return has no control effect. Scoped drift-reopen and per-repo repair routing are things the **loop does** (instructions), not things a handler returns for a runtime to apply.
- **`HookBlocked` / `AbortEvent` / `AbortOrchestration`.** No hook can abort or block the run; a gating check is a verdict cell, not a hook. (Distinct from the recorder *tools* — `advance` / `open_repair` ARE guarded writes per D10.1, but that is the I/O layer enforcing mechanical invariants over recorded state, not a hook vetoing the run.)

---

*See also: [`spec.md`](./spec.md) (D10, D10.1, the AND gate, self-repair),
the `verify-task-group` command (`haikai-profiles/default/commands/verify-task-group/`),
and the `verification-loop` agent.*
