-- 217-migration-run-item-retry-columns.sql
-- Robustness R2: driver-level spec auto-retry (2026-08-05)
--
-- Adds the durable retry state the gateway Migration Execution Driver needs so
-- a scheduled re-dispatch SURVIVES a gateway restart (the in-process timer is
-- lost on restart; the boot-recovery sweep re-arms overdue retries from these
-- columns):
--
--   * retry_attempt_count   -> dispatch attempts already used for this item
--                              (the original dispatch counts as attempt 1 the
--                              first time it FAILS transiently). NOT NULL
--                              DEFAULT 0 so every pre-existing row reads as
--                              "no retries yet".
--   * retry_next_attempt_at -> when the next automatic re-dispatch is due.
--                              Set (with status back to 'pending') when the
--                              driver absorbs a transient failure; the
--                              status='pending' + non-null combination is the
--                              boot sweep's "armed retry" predicate.
--   * failure_class         -> the last failure classification for the item
--                              ('transient_upstream' | 'real'), from the IVS
--                              R1 classifier (or the gateway's local signature
--                              scan when the callback carried no class).
--                              Traceability + the FE "retrying" chip.
--
-- Persistence choice (documented per the R2 spec): the run-item's only JSON
-- column (auto_answer_decision_log_json) is a user-surfaced auto-answerer
-- decision log whose PATCH semantics are whole-list replace — riding it for
-- retry state would pollute a UI-visible log AND race the read-modify-write
-- against callbacks. Typed columns are the minimal CORRECT option, and AMS
-- was being touched anyway (the resume-from-failure reset needs the mapper's
-- explicit-clear sentinel).
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 216 are not edited.

ALTER TABLE migration_execution_run_item
  ADD COLUMN retry_attempt_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE migration_execution_run_item
  ADD COLUMN retry_next_attempt_at TIMESTAMP WITH TIME ZONE NULL;

ALTER TABLE migration_execution_run_item
  ADD COLUMN failure_class TEXT NULL;

COMMENT ON COLUMN migration_execution_run_item.retry_attempt_count IS
  'Dispatch attempts already used for this item (Robustness R2 driver-level auto-retry). 0 = never retried. The gateway increments it when a transient build-results failure is absorbed instead of halting.';

COMMENT ON COLUMN migration_execution_run_item.retry_next_attempt_at IS
  'When the next automatic re-dispatch is due (Robustness R2). status=pending + non-null here + retry_attempt_count>0 is the boot-recovery sweep''s armed-retry predicate; survives gateway restarts.';

COMMENT ON COLUMN migration_execution_run_item.failure_class IS
  'Last failure classification for the item: transient_upstream | real (from the IVS R1 classifier, or the gateway''s local signature scan). Traceability + run-progress display.';
