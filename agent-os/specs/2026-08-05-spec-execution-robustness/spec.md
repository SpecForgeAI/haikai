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
