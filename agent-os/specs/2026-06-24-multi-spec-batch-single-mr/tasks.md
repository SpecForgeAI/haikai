# Tasks: Multi-Spec Batch → Single Merge Request

**Scope:** implement-verify-service, Python — a multi-spec mode on `run_orchestration`.
**Delivery:** `haikai:plan` scope, `haikai:ship`-style execute, `haikai:debug`+`haikai:fix` repair.
**Tests:** no-mock real-git (`tests/_realgit.py`); negative-control each.

## Phase 1 — batch commits → one MR  (DONE)
- [x] 1.1 `batch_name?: str` on `OrchestrationRequest`; set ⇒ batch mode; order = execution order.
- [x] 1.2 `_git_one_spec(..., batch_name)`: one `feature/<batch_name>` branch, commit each spec (`commit_only`), no reset. Single-spec unchanged. Real-git test + negative control.
- [x] 1.3 `_finalize_batch_git`: push + one PR after the run, inside the per-project lock. Real-remote PR verified.
- [x] 1.4 Deploy fix: batch consolidates the single branch (`_deploy_completed_run`). Real haibox deploy of a batch branch verified.

## Phase 2 — verification gate + repair (Option C)

### TG5 — Per-spec repair loop (clone `run_bug_investigation`)
- [ ] 5.1 After a spec is implemented, run `/haikai:debug` → `/haikai:fix` for that spec via the executor — model the call on `run_bug_investigation` (`tasks.py:1065`): `/haikai:fix` runs the repo's own tests, fixes, auto-reverts on red.
- [ ] 5.2 Outer cap **≥10** as a loop counter in `run_orchestration` (env `BATCH_REPAIR_CAP`). NOT `recorder.py`'s `ATTEMPT_CAP`. No `repair-engine`, no cells, no `jobs.db`.
- [ ] 5.3 Heal → continue; un-healable in ≤10 → fail-stop (no MR), record failing spec.
- [ ] 5.4 Real test (executor stubbed — true external LLM, real git): a spec that "fixes green" → batch continues; a spec that never heals → fail-stop, no PR, failing spec recorded.

### TG6 — Gate the MR on the fix outcome
- [ ] 6.1 Pass/fail = the outcome of `/haikai:fix` (ended green, corroborated by git changing — reuse the `_git_changed_files` check). Do NOT parse `final-verification.md`; do NOT gate on file-exists.
- [ ] 6.2 `_finalize_batch_git` opens the one PR ONLY when every spec ended green; otherwise fail-stop, no PR.
- [ ] 6.3 Real-git test: all-green batch → one PR; any spec un-healed → no PR.

### TG7 — Trigger (cheap, optional)
- [ ] 7.1 Run the fix step per spec (`/haikai:fix` self-detects red, no-ops/reverts when green). Optionally skip when the self-verification report clearly shows green — but never treat that report as the authoritative gate.

## Out of Scope (this spec)
- **Option B** — deterministic pinned-test gate + D8 discovery/pinning layer (future hardening).
- Gateway/frontend; the independent verify-task-group/D5 gate; cross-repo single-MR.

## Verification
Phase 2 changes use the no-mock policy: real git, the LLM executor stubbed (true external),
each guarded by a negative control (a never-healing spec must produce NO PR).
