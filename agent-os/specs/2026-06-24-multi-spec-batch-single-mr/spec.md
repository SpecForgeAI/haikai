# Specification: Multi-Spec Batch → Single Merge Request

## Goal
Run **N tightly-coupled specs** (component slices of one feature — UI + service +
database + permissions) as an ordered batch so they land as **N commits on ONE
shared feature branch** (not a branch per spec). After the last spec's existing
**self-verification** finishes, open **one** merge request for the whole feature.

## The focus (keep this front of mind)
**The work is: get N specs in as commits on one branch, not new branches.** Everything
else is small or already exists. In particular, **verification is NOT new work** — the
implement flow already ends each spec with a mandatory self-verification (Phase 3 of
`implement-tasks`: runs the tests + writes `verifications/final-verification.md`). The MR
simply opens **after** that finishes for the batch; we do **not** wire in the separate
independent (`verify-task-group`/CI/D5) system.

## Scope
- **implement-verify-service, Python.** A multi-spec **mode on the existing
  `run_orchestration` path** — not a new command.
- **No gateway, no frontend.** (`batch_name` is added to the Python request model only.)
- Reuse: the existing per-spec **self-verification** (implement-tasks Phase 3) and the
  existing **repair-engine** (`haikai:debug`/`haikai:fix`).

## What actually changes (small)
The git step is per-spec today: `_git_one_spec` (`src/job_queue/tasks.py`) builds
`feature/<spec>`, commits, **`checkout_back_to_default`** between specs, and
`apply_git_workflow` (`src/api/git_workflow.py`) opens a PR **per spec**. Batch mode
inverts that: **one branch, accumulate commits, one PR at the end.** That's the change.

## Design (batch mode on run_orchestration)
1. **Input:** ordered `spec_intents` + `batch_name`. Length 1 = today's behaviour (unchanged).
2. **One branch:** create `feature/<batch_name>` once off default; each spec **commits onto it**
   (one commit per spec). No per-spec branch; no reset-to-default between specs.
3. **Per spec:** run the existing orchestration (write-spec → create-tasks → implement-tasks,
   whose Phase 3 self-verification runs the tests + writes the verification report) — unchanged.
4. **On failure:** `repair-engine` (`haikai:debug`/`haikai:fix`, ≥10) → heal = continue,
   exhausted = fail-stop (no MR).
5. **One MR at the end:** after the last spec's self-verification completes (and the batch
   wasn't fail-stopped), push the branch and open **one** PR (body lists the component specs in
   order). No per-spec PRs.

## Specific Requirements

**1. Batch input (`src/haikai_models.py`)**
- Add `batch_name?: str` to `OrchestrationRequest`; require it when `len(spec_intents) > 1`.
  List order = execution order.

**2. One accumulating branch — THE core change (`src/job_queue/tasks.py`)**
- Batch mode in `run_orchestration`/`on_spec_complete`/`_git_one_spec`: create
  `feature/<batch_name>` once; commit each spec onto it; **drop `checkout_back_to_default`**
  between specs. Single-spec mode unchanged.

**3. One deferred MR (`src/job_queue/tasks.py` + `src/api/git_workflow.py`)**
- Move PR creation OUT of the per-spec loop. Batch mode: push + open exactly one PR **after**
  the run, once the last spec's self-verification has finished and the batch passed. Body lists
  the component specs in order. Honour `GIT_AUTO_PR`.

**4. Repair ≥10, then fail-stop (`src/verification/recorder.py`)**
- `ATTEMPT_CAP = 3` is hardcoded; raise/parameterize to **≥10** (env-read preferred). Repair via
  `haikai:debug`/`haikai:fix` + `repair-engine`. Exhausted → fail-stop, no MR, record failing spec.

**5. Verification = the existing self-verification (no new wiring)**
- The MR gate is simply "the batch wasn't fail-stopped and the last spec's self-verification
  finished/passed." Reuse the existing `implement-tasks` Phase-3 report; do **not** add the
  independent `verify-task-group`/CI gate. (If a stronger gate is wanted, it's a later spec.)

**6. Terminology**
- No `batch`/`cell` identifiers (taken by the pipeline / verification). Use `batch_name` field +
  "coupled specs". Disambiguate git-branch from verification control-flow "branch".

## Resolved Decisions
- **Shape:** multi-spec **mode on the existing path**, not a new command.
- **Focus:** N specs → N commits on **one branch** (not new branches).
- **MR gate:** open **after** the existing **self-verification** finishes — no new verification wiring.
- **Repair:** ≥10 via `haikai:debug`/`haikai:fix`; exhausted → fail-stop.

## Delivery
Scope with `haikai:plan`, execute `haikai:ship`-style, repair with `haikai:debug`+`haikai:fix`.

## Out of Scope
- Gateway / frontend surfaces (later).
- The independent `verify-task-group`/CI/D5 gate on the MR (a later spec if wanted).
- Cross-repo (polyrepo) single-MR — git can't span repos.
- Generating the component specs (upstream planner split).
</content>
