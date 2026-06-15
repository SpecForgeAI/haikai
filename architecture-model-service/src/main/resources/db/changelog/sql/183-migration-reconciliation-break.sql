-- 183-migration-reconciliation-break.sql
-- Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4) -- Task Group 1
--
-- The run-scoped break <-> bug lifecycle + disposition store the gateway loop
-- (Groups 2/3/4) reads and mutates after the final-spec deploy. One row per
-- behavioural BREAK -- a drifting api_behaviour_diff_item: the target response
-- diverged from the pinned current-state oracle for the same request.
--
--   migration_reconciliation_break (NEW table): one row per break for a run.
--     - id                          UUID PK
--     - run_id                      UUID NOT NULL FK -> migration_execution_run(id)
--                                   ON DELETE CASCADE (run-scoped; a break only
--                                   exists in the context of its reconcile run).
--     - pinned_baseline_id          UUID NULL -- the kind='current' ApiBehaviour-
--                                   Baseline this break was reconciled against
--                                   (echoes migration_execution_run.pinned_current_baseline_id,
--                                   the CD-1 oracle anchor). Soft reference (no FK).
--     - source_baseline_item_id     UUID NULL -- the resolution / scope key: the
--                                   replayable source baseline_item behind this
--                                   break (from api_behaviour_diff_item.source_baseline_item_id).
--                                   The CD-6 scoped-re-reconcile key -- re-replay
--                                   ONLY these items on a bug-fix redeploy. Soft
--                                   reference (no FK -- the diff_item outlives item edits).
--     - diff_item_id                UUID NULL -- the api_behaviour_diff_item this
--                                   break references (the existing break data;
--                                   NO duplication of the break payload). Soft
--                                   reference (no FK -- diff_items CASCADE from
--                                   baseline-deletion on their own side).
--     - detail_json                 JSONB NULL -- the break detail (method, path,
--                                   summary, source/target status, structured
--                                   diff) carried inline so the review surface +
--                                   the bug-report BreakEvidence can render without
--                                   a diff_item join. Matches how api_behaviour_diff_item
--                                   carries break info; NULL is the valid empty state.
--     - disposition_status          TEXT NOT NULL -- the lifecycle / disposition
--                                   (service-layer validated; no DB enum, the AMS
--                                   status-as-TEXT convention):
--                                     machine: open | sent_as_bug | fixed_confirmed
--                                              | still_broken | circuit_broken_escalated
--                                     human:   accepted | wont_report | intentional_deviation
--                                   (the human dispositions are TERMINAL and are how
--                                   intentional/deferred deviations are recorded WITHOUT
--                                   changing the oracle -- CD-A).
--     - bug_id                      TEXT NULL -- set when the break is sent in a
--                                   bug report; the callback correlation key
--                                   (idx_mrb_bug_id). Boxed on the Java side.
--     - attempt_count               INTEGER NOT NULL DEFAULT 0 -- the circuit-
--                                   breaker round / attempt counter (incremented
--                                   per re-run round). Boxed Integer on the Java
--                                   side per project_primitive_double_dto_overwrite.md
--                                   so a PATCH that omits it never resets it.
--     - circuit_broken              BOOLEAN NOT NULL DEFAULT false -- TRUE once the
--                                   bounded re-run round tripped the max-attempts
--                                   threshold; gates any further auto-loop. Boxed
--                                   Boolean on the Java side.
--     - needs_human                 BOOLEAN NOT NULL DEFAULT false -- TRUE once the
--                                   break is escalated for human review (circuit
--                                   broken, or a failed/rejected bug outcome).
--                                   Boxed Boolean on the Java side.
--     - error_detail                TEXT NULL -- failure / escalation detail
--                                   (e.g. the still-broken reason, the bug
--                                   failed/rejected message).
--     - created_at / updated_at     TIMESTAMPTZ NOT NULL
--
-- All new nullable columns are boxed reference types on the Java side; the three
-- NOT NULL columns (disposition_status, attempt_count, circuit_broken, needs_human)
-- carry a DB DEFAULT so existing/omitting writes are stable. No backfill.
--
-- Indexes: run_id (read breaks for a run), bug_id (the callback correlation key),
-- source_baseline_item_id (the scoped-re-reconcile resolution key).
--
-- NEW changeset only -- never edit applied changesets (<= 182) per
-- feedback_liquibase_immutable_changesets.md. 182 is the highest on disk;
-- this registers AFTER it in db.changelog-master.yaml.

CREATE TABLE migration_reconciliation_break (
  id                          UUID PRIMARY KEY,
  run_id                      UUID NOT NULL,
  pinned_baseline_id          UUID NULL,
  source_baseline_item_id     UUID NULL,
  diff_item_id                UUID NULL,
  detail_json                 JSONB NULL,
  disposition_status          TEXT NOT NULL DEFAULT 'open',
  bug_id                      TEXT NULL,
  attempt_count               INTEGER NOT NULL DEFAULT 0,
  circuit_broken              BOOLEAN NOT NULL DEFAULT false,
  needs_human                 BOOLEAN NOT NULL DEFAULT false,
  error_detail                TEXT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mrb_run
    FOREIGN KEY (run_id) REFERENCES migration_execution_run(id) ON DELETE CASCADE
);

CREATE INDEX idx_mrb_run_id ON migration_reconciliation_break(run_id);
CREATE INDEX idx_mrb_bug_id ON migration_reconciliation_break(bug_id);
CREATE INDEX idx_mrb_source_baseline_item_id ON migration_reconciliation_break(source_baseline_item_id);

COMMENT ON TABLE migration_reconciliation_break IS
  'One behavioural BREAK per row (a drifting api_behaviour_diff_item: the target response diverged from the pinned current-state oracle for the same request) for one Migration Execution reconcile run. The run-scoped break <-> bug lifecycle + disposition store the gateway loop (Groups 2/3/4) reads and mutates after the final-spec deploy. Spec: Migration Reconciliation + Bug Loop (2026-06-14, Spec 4 of 4).';

COMMENT ON COLUMN migration_reconciliation_break.pinned_baseline_id IS
  'The kind=current ApiBehaviourBaseline this break was reconciled against (echoes migration_execution_run.pinned_current_baseline_id -- the CD-1 oracle anchor). The oracle is ALWAYS the pinned baseline; intentional/deferred deviations are handled by disposition (CD-A), never by changing this. Soft reference (no FK).';

COMMENT ON COLUMN migration_reconciliation_break.source_baseline_item_id IS
  'The replayable source baseline_item behind this break (from api_behaviour_diff_item.source_baseline_item_id) -- the CD-6 scoped-re-reconcile resolution key. On a bug-fix redeploy, re-replay ONLY the items behind that bug''s breaks, resolved via this column. Soft reference (no FK).';

COMMENT ON COLUMN migration_reconciliation_break.diff_item_id IS
  'The api_behaviour_diff_item this break references (the existing break data; NO duplication of the break payload). Soft reference (no FK -- diff_items CASCADE from baseline-deletion on their own side).';

COMMENT ON COLUMN migration_reconciliation_break.detail_json IS
  'The break detail (method, path, summary, source/target status, structured diff) carried inline so the review surface + the bug-report BreakEvidence render without a diff_item join. NULL is the valid empty state. JSONB via Hibernate JsonType.';

COMMENT ON COLUMN migration_reconciliation_break.disposition_status IS
  'The break lifecycle / disposition (service-layer validated; no DB enum). Machine: open | sent_as_bug | fixed_confirmed | still_broken | circuit_broken_escalated. Human (terminal, never re-run): accepted | wont_report | intentional_deviation -- how intentional/deferred deviations are recorded WITHOUT changing the oracle (CD-A). DB DEFAULT open.';

COMMENT ON COLUMN migration_reconciliation_break.bug_id IS
  'Set when the break is sent in a bug report; the bug-fix build-results callback correlation key (idx_mrb_bug_id). NULL until sent. Boxed (String) on the Java side.';

COMMENT ON COLUMN migration_reconciliation_break.attempt_count IS
  'The circuit-breaker round / attempt counter (incremented per re-run round). Boxed Integer on the Java side per project_primitive_double_dto_overwrite.md so a PATCH that omits it never resets it. DB DEFAULT 0.';

COMMENT ON COLUMN migration_reconciliation_break.circuit_broken IS
  'TRUE once the bounded re-run round tripped the max-attempts threshold; gates any further auto-loop (CD-6: the single re-run round, then human review -- no infinite loop). Boxed Boolean on the Java side. DB DEFAULT false.';

COMMENT ON COLUMN migration_reconciliation_break.needs_human IS
  'TRUE once the break is escalated for human review (circuit broken, or a failed/rejected bug outcome). Boxed Boolean on the Java side. DB DEFAULT false.';
