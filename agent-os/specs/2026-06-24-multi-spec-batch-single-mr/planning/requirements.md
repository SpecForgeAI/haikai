# Requirements — Multi-Spec Batch → Single MR

## Input contract
The orchestration request (`OrchestrationRequest`, `src/haikai_models.py`) gains:

| Field | Type | Rule |
|---|---|---|
| `spec_intents` | ordered list of `{spec_name, session_id?}` | length 1 = single-spec (today's behaviour, unchanged); length >1 = **batch mode**. List order **is** execution order. |
| `batch_name` | `str` (optional) | **Required** when `len(spec_intents) > 1`. Used as `feature/<batch_name>` and the single PR title. Must be a non-empty, branch-safe slug. |

Single-spec requests with no `batch_name` behave exactly as today.

## Execution rules (batch mode)
1. **Order:** specs orchestrate strictly in `spec_intents` order, one fully before the next.
2. **One branch:** `feature/<batch_name>` is created once off the default branch; every spec
   commits onto it (one commit per spec). No per-spec branch, no reset-to-default between specs.
3. **Per-spec repair (Option C):** after a spec is implemented, run `/haikai:debug` →
   `/haikai:fix` for it via the executor — model on `run_bug_investigation` (`tasks.py:1065`).
   `/haikai:fix` runs the repo's own tests, applies an atomic fix, and **auto-reverts on red**,
   so the fix step is itself test-gated. Outer cap **≥10** is a loop counter in
   `run_orchestration` (`BATCH_REPAIR_CAP`), NOT `recorder.py`'s `ATTEMPT_CAP`; no
   `repair-engine`/cells/`jobs.db`. Healed → continue; un-healable in ≤10 → **stop the batch**,
   record the failing `spec_name`, open **no** MR.
4. **The gate = the fix step's outcome, not the report:** pass/fail comes from the outcome of
   `/haikai:fix` (ended green, corroborated by git actually changing — reuse the
   `_git_changed_files` check). Do NOT parse `final-verification.md`; do NOT gate on file-exists.
   (`haikai:learn` 2026-06-25: that report is self-graded LLM prose, unreliable.)
5. **One MR:** when **every** spec ended green, push the branch and open exactly **one** PR
   (body lists the component specs in order). Gated by `GIT_AUTO_PR`. Any un-healed spec → no PR.

## Non-goals
- No gateway/frontend changes (the `batch_name` surface there is a later concern).
- No cross-repo (polyrepo) single-MR — git can't span repos.
- **No deterministic verifier (Option B) and no wiring of the independent `verify-task-group`/CI/D5
  gate** — the gate is the agentic `/haikai:fix` outcome (Option C). A deterministic pinned-test
  gate (D8 discovery) is future hardening.

## Status
- **Phase 1 (batch commits → one MR): DONE** — `_git_one_spec` batch mode + `_finalize_batch_git`
  + the deploy fix; real-remote PR and real haibox deploy verified.
- **Phase 2 (gate + repair): Option C** — per-spec `/haikai:debug`+`/haikai:fix` loop, gate on
  the fix outcome (rules 3-5 above).
