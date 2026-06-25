# Tasks: Multi-Spec Batch → Single Merge Request

**Focus:** N specs → N commits on ONE branch (not new branches). One MR at the end,
after the existing per-spec self-verification finishes. No new verification wiring.
**Scope:** implement-verify-service, Python — a multi-spec mode on `run_orchestration`.
**Delivery:** `haikai:plan` scope, `haikai:ship`-style execute, `haikai:debug`+`haikai:fix` repair.
**Tests:** no-mock real-git (`tests/_realgit.py`); negative-control each.

## TG1 — Batch input
- [ ] 1.1 `OrchestrationRequest` (`src/haikai_models.py`): add `batch_name?: str`; require when `len(spec_intents) > 1`. Order = execution order.
- [ ] 1.2 Test: accepts ordered batch + batch_name; rejects >1 without batch_name; single-spec unchanged.

## TG2 — One accumulating branch (THE core change)
- [ ] 2.1 Batch mode in `run_orchestration`/`on_spec_complete`/`_git_one_spec`: create `feature/<batch_name>` once; commit each spec onto it; **drop `checkout_back_to_default`** between specs. Single-spec mode unchanged.
- [ ] 2.2 Real-git test: 2-spec batch → BOTH specs as 2 commits on ONE branch. Negative-control: reintroduce per-spec reset → must go red.
- [ ] 2.3 Retire/replace `tests/job_queue/test_orchestration_multispec_b2.py` (it asserts the superseded per-spec-isolated branches).

## TG3 — One deferred MR after self-verification
- [ ] 3.1 Move PR creation OUT of the per-spec `_git_one_spec` loop. Batch mode: push + open exactly ONE PR **after** the run, once the last spec's self-verification finished and the batch wasn't fail-stopped. Body lists component specs in order. Honour `GIT_AUTO_PR`.
- [ ] 3.2 Confirm the existing implement-tasks Phase-3 self-verification still runs per spec unchanged (the gate reuses it — no new verification code).
- [ ] 3.3 Real-git test: completed batch → one branch pushed, one PR (or `auto_pr=false` → push only); fail-stopped batch → no PR.

## TG4 — Repair ≥10 + fail-stop (D1)
- [ ] 4.1 `ATTEMPT_CAP = 3` (`src/verification/recorder.py:30`) → raise/parameterize to ≥10 (env-read preferred). Repair = `haikai:debug`/`haikai:fix` via `repair-engine`.
- [ ] 4.2 Test: ≥10 attempts honoured by guarded `open_repair`; exhausted → fail-stop, no MR, failing spec recorded.

## TG5 — Terminology + docs
- [ ] 5.1 No `batch`/`cell` identifiers; disambiguate git-branch vs verification "branch".
- [ ] 5.2 Supersede note: batch mode replaces per-spec-isolated branches/MRs for coupled slices (single-spec unchanged).

## Verification
Every Python change has a no-mock real-git test + negative control. TG2 (one branch)
is the core; prove the per-spec reset is gone and a fail-stopped batch opens no MR.
</content>
