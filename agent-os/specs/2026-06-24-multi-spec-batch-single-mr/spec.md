# Specification: Multi-Spec Batch → Single Merge Request

## Goal
Run N tightly-coupled specs as an ordered batch: they land as **N commits on one
shared branch**, and **one** MR opens **only when every spec passes** — repairing a
failing spec first.

## Scope
implement-verify-service, Python. A batch **mode on `run_orchestration`** (not a new
command). No gateway/frontend.

## Phase 1 — batch commits → one MR  (DONE: `4d4cd70`, `d232c6b`)
- **1.** `batch_name?: str` on `OrchestrationRequest`; set ⇒ batch mode; order = execution order.
- **2.** `_git_one_spec(..., batch_name)`: one `feature/<batch_name>` branch, commit each spec (`commit_only`), no reset. Single-spec unchanged.
- **3.** `_finalize_batch_git`: push + one PR after the run, inside the per-project lock. Honour `GIT_AUTO_PR`.
- **4.** `_deploy_completed_run` consolidates the single batch branch (not per-spec names).

## Phase 2 — verification gate + repair  (to build)
- **5. Per-spec repair loop.** After a spec is implemented, run `/haikai:debug`→`/haikai:fix` via the executor (model on `run_bug_investigation`, `tasks.py:1065`); `/haikai:fix` runs the repo's tests and auto-reverts on red. Cap **≥10** = a loop counter in `run_orchestration` (env `BATCH_REPAIR_CAP`). Heal → next spec; un-healable → fail-stop, no MR.
- **6. Gate = the fix outcome.** Pass/fail = `/haikai:fix` ended green, corroborated by git changing (`_git_changed_files`). Open the one MR only when every spec is green.

## Decisions
- Mode on the existing path, not a new command.
- Repair = per-spec `/haikai:debug`+`/haikai:fix` loop (NOT `repair-engine`/`recorder.py` `ATTEMPT_CAP` — those are coupled to the verify-task-group/`jobs.db` world).
- Gate = fix outcome (NOT the self-verification report — `haikai:learn` 2026-06-25: self-graded, unreliable; NOT file-exists).

## Out of Scope
- Option B — deterministic pinned-test gate + D8 discovery (future hardening).
- Gateway/frontend; the independent verify-task-group/D5 gate; cross-repo single-MR; generating the specs.

## Terminology
No `batch`/`cell` identifiers (taken by pipeline/verification). Disambiguate git-branch from verification "branch".
