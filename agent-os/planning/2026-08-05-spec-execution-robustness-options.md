# Spec-execution robustness — deep analysis + options (2026-08-05)

Trigger: a 13.5s Kiro-backend blip (`InternalServerException`, kiro-cli's own
internal retries exhausted, exit 0, no spec.md) killed a 12-spec Stage run.
The user re-runs the WHOLE thing after any minor blip.

## Failure anatomy as-built (verified in code)

### Intra-spec (IVS, haikai_orchestrator.py)
- 4 sequential steps per spec; `_execute_step_with_session` judges success by
  (a) error events, (b) the silent-lie guard (expected output file missing),
  (c) step-3 tasks.md checkboxes.
- On step failure + `stop_on_error`: the SPEC stops, then `has_fatal_failure`
  stops ALL remaining specs in the request. NO retry anywhere in the loop.
- kiro_chat_executor has ZERO retry. claude_chat_executor's `max_retries=3`
  exists but only for the question/folder-recovery loops — not transient
  upstream failures. kiro-cli retries internally (Retry #2/#3) then exits 0
  with a banner — the silent-lie guard correctly fails the step, but the
  transient cause is discarded.
- `start_from_step` + per-step checkpointing (`on_step_complete`) EXIST —
  resume machinery is present but nothing calls it on failure.

### Multi-spec / Stage (gateway migrationExecutionDriver.ts)
- Any callback outcome ≠ implemented/deployed → `haltRunForItem` → item
  FAILED + run HALTED (batch path: `batch_halted_on_callback`). Pending
  items stay pending forever. No retry, no cool-off, no failure classes on
  the wire (`failure_class` doesn't exist in the callback).
- A new Start = a NEW run = re-dispatch of EVERY non-deferred story —
  including specs already implemented/merged in the failed run. This is the
  "re-run the WHOLE thing" pain. (Subset migrate exists but requires the
  operator to hand-pick the unfinished stories.)
- Precedents already in the codebase: `retryDbBuild` (targeted retry of the
  DB completion chain on a HALTED run, guard-checked), `resumeMigration`
  (plane-boundary approval), operator halt, dispatch idempotency + IVS
  submit dedup (WS1), and the Azure-429 shared cool-down + retry machinery
  in the gateway LLM path (transient classification + cool-off pattern).

### Failure classes (what a retry policy must distinguish)
1. TRANSIENT UPSTREAM — Kiro/Claude backend 5xx ("InternalServerException",
   "having trouble responding"), rate limits, timeouts. Signatures are now
   detectable (exit-code-first messages landed 2026-08-04). Retry + cool-off
   is correct; this incident was 13.5s of this class.
2. ENVIRONMENT — WSL cold start, reloader kill, git locks (each now has a
   targeted fix; retries also absorb stragglers).
3. REAL — incoherent spec, unticked tasks, failing tests. At most ONE retry
   (LLM nondeterminism) then escalate; endless retry would mask real bugs.
4. INFRA-DEAD — job dies with no callback (operator-halt exists; a watchdog
   is out of scope here).

## Options

### Layer 1 — intra-spec (IVS)
- O1a (recommended): TRANSIENT-CLASSIFIED STEP RETRY in the orchestrator.
  New `transient_failure.py` classifier (single source of signatures).
  On step failure where errors/output match a transient signature: cool-off
  (30s → 120s backoff), re-issue the SAME step in the SAME session, bounded
  (default 2 retries, env-tunable). The artifact guard stays the truth.
  NEVER retried: questions-in-non-interactive, unticked-tasks (class 3
  gets at most one retry via config; default 0). Would have absorbed this
  exact incident.
- O1b: executor-level spawn retry (mirror claude's max_retries in kiro
  executor). Simpler but blind to artifacts/step semantics and would
  double-retry under O1a. Rejected as the primary home; the executor's job
  stays honest classification, the orchestrator owns retry.
- O1c (recommended, small): on retry EXHAUSTION the spec fails as today,
  but the failure record carries `failed_step` + `failure_class` so Layer 2
  can resume at the failed step (`start_from_step` already exists).

### Layer 2 — multi-spec / Stage (gateway)
- O2a (recommended): FAILURE-CLASSIFIED AUTO-RETRY of the failed spec.
  IVS build-results callback gains `failure_class` (+ `failed_step`,
  attempt counts). Driver policy on transient: do NOT halt — patch the item
  `retry_scheduled` with persisted `attempt_count` / `next_attempt_at`
  (AMS columns; survives gateway restart via the boot-recovery sweep),
  re-dispatch after cool-off (2min then 10min; max 2 driver-level retries,
  env-tunable), reusing the idempotency keys with an attempt suffix. Only
  after exhaustion → halt as today. Real/unclassified failures halt
  immediately (no behaviour change).
- O2b (recommended): RESUME-FROM-FAILURE on a halted run — the structural
  end of "re-run the WHOLE thing". A halted run gets "Resume run": same
  run, re-dispatch ONLY items not implemented/deployed, starting from the
  failed item (at its `failed_step` when carried). Precedents:
  retryDbBuild's halted-run guard shape + resumeMigration's plane resume.
  Covers every path auto-retry can't (exhausted retries, real failure fixed
  by hand, operator halt).
- O2c (defer): CONTINUE-PAST-FAILURE (skip the failed spec, keep
  dispatching independents, end `completed_with_failures` + retry sweep).
  Maximum throughput but changes run semantics and interacts with batch
  assembly (a missing spec changes what assembly overlays) and DB-plane
  ordering. Opt-in later if O2a/O2b still leave pain.

## Recommendation

Build as two specs, in order:
- SPEC R1 (IVS): O1a + O1c — transient classifier, step retry w/ cool-off,
  `failure_class`/`failed_step` on the callback payload.
- SPEC R2 (gateway): O2a + O2b — driver auto-retry with persisted schedule
  + Resume-run on halted runs (FE rail: "retrying in Xs (attempt 2/3)" +
  Resume button).
Defer O2c until proven necessary.
