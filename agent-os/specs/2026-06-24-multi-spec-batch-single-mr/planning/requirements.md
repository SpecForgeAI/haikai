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
3. **Fail-stop with repair:** a spec whose required steps or verification fail enters the
   `repair-engine` loop (`haikai:debug`/`haikai:fix`, **≥10** attempts). Healed → continue to the
   next spec; exhausted → **stop the batch**, record the failing `spec_name`, open **no** MR.
4. **Self-verification (reused, not new):** each spec already ends with the mandatory
   `implement-tasks` Phase-3 self-verification (runs the tests, writes
   `verifications/final-verification.md`). The batch relies on this as-is; no new verification
   wiring. The MR gate is simply "the batch was not fail-stopped and the last spec's
   self-verification finished."
5. **One MR:** after the last spec's self-verification finishes (and no fail-stop), push the
   branch and open exactly **one** PR (body lists the component specs in order). Gated by
   `GIT_AUTO_PR`. A fail-stopped batch → no PR.

## Non-goals
- No gateway/frontend changes (the `batch_name` surface there is a later concern).
- No cross-repo (polyrepo) single-MR — git can't span repos.
- **No new verification engine and no wiring of the independent `verify-task-group`/CI/D5 gate
  onto the MR** — the existing per-spec self-verification is the gate. (A stronger independent
  gate is a later spec if wanted.)

## The actual focus
N specs land as N **commits on one branch** instead of a branch per spec. The Python change is
in `_git_one_spec`/`on_spec_complete` (one branch, no reset) + moving the single PR to after the
run. Verification and repair are existing mechanisms, reused.
</content>
