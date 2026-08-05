# Spec-execution robustness R1+R2 (2026-08-05)

Options doc: `agent-os/planning/2026-08-05-spec-execution-robustness-options.md`
User amendments locked in:
- Model fallback: >3 transient failures on the pinned model in ONE run →
  swap to `KIRO_CHAT_MODEL_ALTERNATIVE` (default claude-opus-4.8), beside
  `KIRO_CHAT_MODEL` in model_pinning.py.
- Driver-level spec retry: max 3 tries, short gaps.
- Halted mid-stage UI: TWO buttons — "Re-start Stage N" (spec 1 of X) and
  "Resume Stage N" (from the failed spec) — never a bare confusing
  "Start Stage N".
- O2c (continue-past-failure) deferred.

## R1 — IVS (BUILT)

- `src/chat/transient_failure.py`: signature classifier
  (`transient_upstream` vs `real`; reads error events AND the output tail —
  the silent-lie shape prints the trouble banner to stdout with exit 0),
  retry knobs (STEP_RETRY_MAX_RETRIES default 2 ⇒ 3 tries;
  STEP_RETRY_BACKOFF_SECONDS default 30,120), ModelFallbackTracker
  (KIRO_MODEL_FALLBACK_THRESHOLD default 3; one-way per run).
- model_pinning.py: `KIRO_CHAT_MODEL_ALTERNATIVE` (default claude-opus-4.8)
  + `kiro_alternative_model()`.
- haikai_orchestrator.py: `_execute_step_with_retry` wraps every step (both
  loops); transient-only retry, same session on retry; `_apply_model_fallback`
  swaps kiro executors onto the alternative once the tracker activates (the
  one sanctioned post-construction model mutation). Real failures
  (questions-in-non-interactive, unticked tasks, non-transient silent-lie)
  never retry.
- Wire: StepResult.failure_class/attempts; OrchestrationResponse
  .failure_class/.failed_step (first fatal step);
  `_emit_orchestration_callback` payload carries `failure_class` +
  `failed_step`.
- Tests: tests/chat/test_transient_failure.py (15) — incident signatures,
  silent-lie tail classification, retry/exhaustion/cool-off, fallback
  threshold + kiro-only swap.

## R2 — gateway + FE (agent-built; contract)

- Door parses `failure_class`/`failed_step` → BuildResultAdvanceInput.
- Driver: transient + attempts<3 → schedule re-dispatch (persisted
  attempt_count/next_attempt_at; boot-recovery re-arms) instead of halt;
  exhaustion/real → halt as today.
- Resume-from-failure: POST .../migration-execution-runs/:runId/resume-failed
  (run HALTED guard) → same run, reset non-implemented items, re-dispatch
  from the failed item.
- FE rail: halted mid-stage → "Re-start Stage N" + "Resume Stage N";
  retrying item → "retrying (attempt X/3)" chip.

### R2 backend AS BUILT (2026-08-05)

- Policy: `gateway/src/services/migrationSpecRetryPolicy.ts` — transient iff
  callback `failure_class='transient_upstream'`, or class ABSENT and the
  local TRANSIENT_SIGNATURES scan (hand-mirrored from IVS
  `transient_failure.py`) matches summary/errors; `'real'` never retries.
  Knobs: MIGRATION_SPEC_RETRY_MAX_ATTEMPTS (default 3 total tries),
  MIGRATION_SPEC_RETRY_BACKOFF_SECONDS (default "60,180", last repeats).
- Persistence: AMS columns (changeset 217) on
  `migration_execution_run_item`: `retry_attempt_count` (int, default 0),
  `retry_next_attempt_at` (timestamptz), `failure_class` (text). Chose
  columns over riding `auto_answer_decision_log_json` (UI-surfaced log,
  whole-list-replace PATCH race) — and AMS had to be touched anyway for the
  NEW explicit-clear sentinel: the item mapper now treats an EMPTY STRING on
  `job_id`/`outcome`/`error_detail`/`failure_class`/`retry_next_attempt_at`
  as "clear to NULL" (omitted still = no-op), because resume-from-failure
  must un-set a stale terminal `outcome` (else the re-run's callback dies at
  the CD-6 idempotency guard).
- Retry parks the item back to `pending` (NO outcome written) with counters +
  next-attempt time; armed-retry predicate = pending + counter>0 +
  next_attempt_at (boot sweep re-arms exactly that shape — ordinary pending
  items have counter 0 and are never swept). Re-dispatch reuses
  runSpecSegment with `retryAttempt` opts: precheck inverts (only a parked
  `pending` item may dispatch) and the spec folder/branch gains `-r<attempt>`
  so the IVS active-job dedup (spec_name-set keyed) can't return the dying
  prior job and the old worktree branch lock can't kill the retry.
- Batch + resume share ONE primitive (`dispatchRemainingRunItems`): batch
  shape = ≥2 remaining items sharing a job_id (or explicit batchName);
  re-submits ONLY not-implemented items on a fresh
  `feature/retry-…`/`feature/resume-…` branch.
- Route: POST /api/v1/projects/:projectId/migration-execution-runs/:runId/
  resume-failed → 200 {resumed, itemsReset} | 409 {allowed:false, reason} |
  404. Timer seam: deps.scheduleRetryTimer (setTimeout+unref default).
- Tests: gateway/src/__tests__/migrationExecutionDriverRetry.test.ts (20) +
  all existing driver/advance/receiver suites green; AMS
  MigrationExecutionRunStatePersistenceTest +
  ...ControllerByJobSentinelTest green with the widened DTO.
