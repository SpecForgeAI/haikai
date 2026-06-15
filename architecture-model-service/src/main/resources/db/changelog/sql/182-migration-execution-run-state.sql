-- 182-migration-execution-run-state.sql
-- Spec: Migrate Button + Migration Execution Driver + External Shape-Spec
--       Auto-Answerer (2026-06-14, Spec 3 of 4) -- Task Group 1
--
-- The durable spine the gateway-hosted Migration Execution Driver advances
-- over. The Driver is EVENT-DRIVEN over this run-state (each build-results
-- callback steps it forward), so it survives a gateway restart. Two new tables
-- plus one new column on work_item:
--
--   migration_execution_run (NEW table): one run over one book of work.
--     - id                          UUID PK
--     - project_id                  UUID NOT NULL (workspace scope key)
--     - book_of_work_id             UUID NOT NULL (the generated_migration_books_of_work
--                                   row this run executes; soft reference, no FK
--                                   -- the run outlives a book edit/regenerate)
--     - status                      TEXT NOT NULL -- started | dispatching |
--                                   halted | deployed | failed (service-layer
--                                   validated; matches the AMS status-as-TEXT
--                                   convention, no DB enum)
--     - current_sequence_position   INTEGER NULL -- the run-item sequence
--                                   position currently in flight (advances on
--                                   each callback). Boxed Integer on the Java
--                                   side per project_primitive_double_dto_overwrite.md.
--     - pinned_current_baseline_id  UUID NULL -- the active kind='current'
--                                   ApiBehaviourBaseline id pinned at Migrate
--                                   kick-off (CD-7 baseline pinning). Spec 4
--                                   reconciles against EXACTLY this baseline so
--                                   the oracle does not drift mid-run. Soft
--                                   reference (no FK) -- a baseline is a durable
--                                   artefact that outlives its capture session.
--     - target_base_url             TEXT NULL -- the deployed product URL,
--                                   returned on the final spec's deployed
--                                   build-results callback.
--     - decision_log_json           JSONB NULL -- run-level decision / event
--                                   log (CD-4): an append-only list of
--                                   { question, answer, rationale } and lifecycle
--                                   events. NULL is the valid empty state.
--     - created_at / updated_at     TIMESTAMPTZ NOT NULL
--
--   migration_execution_run_item (NEW table): one row per dispatched spec.
--     - id                          UUID PK
--     - run_id                      UUID NOT NULL FK -> migration_execution_run(id)
--                                   ON DELETE CASCADE
--     - sequence_position           INTEGER NOT NULL -- (depth, sequenceOrder)
--                                   walk position from book_of_work_json (CD-5)
--     - work_item_id                UUID NULL -- the story / TEST work item this
--                                   spec implements (soft reference)
--     - spec_generation_id          UUID NULL -- the migration_story_spec_generations
--                                   row whose generated_spec_text was dispatched
--                                   (soft reference)
--     - spec_name                   TEXT NULL -- the spec folder name (the
--                                   shape-spec `folder` event), used as the
--                                   orchestration SpecIntent.spec_name
--     - status                      TEXT NOT NULL -- pending | answering |
--                                   submitting | submitted | implemented |
--                                   deployed | failed | rejected (service-layer
--                                   validated)
--     - dispatched                  BOOLEAN NOT NULL DEFAULT false -- TRUE once
--                                   the orchestration submit has been issued.
--                                   Boxed Boolean on the Java side.
--     - job_id                      TEXT NULL -- the orchestration job_id
--                                   correlated from the submit response; the
--                                   build-results callback lookup key.
--     - branch                      TEXT NULL -- feature branch (human traceability)
--     - pr_url                      TEXT NULL -- pull request URL (human traceability)
--     - outcome                     TEXT NULL -- implemented | deployed | failed
--                                   | rejected (the terminal build-results outcome)
--     - deploy_on_complete          BOOLEAN NOT NULL DEFAULT false -- TRUE only
--                                   on the FINAL run-item (big-bang: deploy once
--                                   everything is implemented). Boxed Boolean.
--     - target_base_url             TEXT NULL -- per-item deployed URL echo
--                                   (set on the final item's deployed callback)
--     - error_detail                TEXT NULL -- failure detail recorded on a
--                                   failed / rejected outcome
--     - auto_answer_decision_log_json JSONB NULL -- INLINE per-spec auto-answerer
--                                   decision log (CD-4): the list of
--                                   { question, answer, rationale } the headless
--                                   shape-spec auto-answerer produced for THIS
--                                   spec. NOT a separate table. NULL is the valid
--                                   empty state.
--     - created_at / updated_at     TIMESTAMPTZ NOT NULL
--
--   work_item (1 new column): the defer flag (CD-7).
--     - deferred                    BOOLEAN NOT NULL DEFAULT false -- a deliberate,
--                                   visible per-story state that EXCLUDES the
--                                   story from THIS Migrate dispatch set only
--                                   (implementation-exclusion ONLY). A deferred
--                                   story drops out of the in-scope hard-block
--                                   set and is NOT sent for implementation; it is
--                                   NEVER removed from reconciliation scope
--                                   (Spec 4 reconciles the full pinned baseline,
--                                   so a deferred story correctly surfaces there
--                                   as a break). Boxed Boolean on the Java side
--                                   per project_primitive_double_dto_overwrite.md
--                                   so a PATCH that omits the field never flips
--                                   the column. The readiness predicate + the
--                                   run-sequence builder both read this column.
--
-- All new nullable columns are boxed reference types on the Java side; the two
-- NOT NULL boolean flags carry a DB DEFAULT so existing/omitting writes are
-- stable. No backfill: existing work items read back deferred=false.
--
-- NEW changeset only -- never edit applied changesets (<= 181) per
-- feedback_liquibase_immutable_changesets.md.

CREATE TABLE migration_execution_run (
  id                          UUID PRIMARY KEY,
  project_id                  UUID NOT NULL,
  book_of_work_id             UUID NOT NULL,
  status                      TEXT NOT NULL,
  current_sequence_position   INTEGER NULL,
  pinned_current_baseline_id  UUID NULL,
  target_base_url             TEXT NULL,
  decision_log_json           JSONB NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_mer_project_id ON migration_execution_run(project_id);
CREATE INDEX idx_mer_book_of_work_id ON migration_execution_run(book_of_work_id);
CREATE INDEX idx_mer_status ON migration_execution_run(status);

CREATE TABLE migration_execution_run_item (
  id                              UUID PRIMARY KEY,
  run_id                          UUID NOT NULL,
  sequence_position               INTEGER NOT NULL,
  work_item_id                    UUID NULL,
  spec_generation_id              UUID NULL,
  spec_name                       TEXT NULL,
  status                          TEXT NOT NULL,
  dispatched                      BOOLEAN NOT NULL DEFAULT false,
  job_id                          TEXT NULL,
  branch                          TEXT NULL,
  pr_url                          TEXT NULL,
  outcome                         TEXT NULL,
  deploy_on_complete              BOOLEAN NOT NULL DEFAULT false,
  target_base_url                 TEXT NULL,
  error_detail                    TEXT NULL,
  auto_answer_decision_log_json   JSONB NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_meri_run
    FOREIGN KEY (run_id) REFERENCES migration_execution_run(id) ON DELETE CASCADE
);

CREATE INDEX idx_meri_run_id ON migration_execution_run_item(run_id);
CREATE INDEX idx_meri_job_id ON migration_execution_run_item(job_id);
CREATE INDEX idx_meri_run_sequence ON migration_execution_run_item(run_id, sequence_position);

ALTER TABLE work_item ADD COLUMN deferred BOOLEAN NOT NULL DEFAULT false;

COMMENT ON TABLE migration_execution_run IS
  'One Migration Execution Driver run over one book of work. The Driver is event-driven over this durable run-state so it survives a gateway restart. Pins the active kind=current ApiBehaviourBaseline id at kick-off (CD-7) so Spec 4 reconciles against exactly that oracle. Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3 of 4).';

COMMENT ON COLUMN migration_execution_run.pinned_current_baseline_id IS
  'The active kind=current ApiBehaviourBaseline id pinned at Migrate kick-off (CD-7 baseline pinning). Spec 4 reconciles against EXACTLY this baseline so the behavioural oracle does not drift mid-run. Soft reference (no FK).';

COMMENT ON COLUMN migration_execution_run.target_base_url IS
  'The deployed product base URL, returned on the final spec deployed build-results callback. NULL until the run reaches the deployed outcome.';

COMMENT ON COLUMN migration_execution_run.decision_log_json IS
  'Run-level decision / event log (CD-4): append-only list of { question, answer, rationale } and lifecycle events. NULL is the valid empty state. JSONB via Hibernate JsonType.';

COMMENT ON TABLE migration_execution_run_item IS
  'One row per dispatched spec in a Migration Execution Driver run. Ordered by sequence_position from the (depth, sequenceOrder) book_of_work_json walk (CD-5). The build-results callback correlates on job_id. Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3 of 4).';

COMMENT ON COLUMN migration_execution_run_item.deploy_on_complete IS
  'TRUE only on the FINAL run-item (big-bang: the external service integrates all specs and deploys once everything is implemented). All other items FALSE. Boxed Boolean on the Java side.';

COMMENT ON COLUMN migration_execution_run_item.job_id IS
  'The orchestration job_id correlated from the submit response. The inbound build-results callback lookup key (idx_meri_job_id). NULL until the orchestration submit returns.';

COMMENT ON COLUMN migration_execution_run_item.auto_answer_decision_log_json IS
  'INLINE per-spec headless-shape-spec auto-answerer decision log (CD-4): list of { question, answer, rationale } for THIS spec. NOT a separate table. Surfaced in the run-progress view. NULL is the valid empty state. JSONB via Hibernate JsonType.';

COMMENT ON COLUMN work_item.deferred IS
  'Deliberate, visible per-story defer state (CD-7): EXCLUDES the story from THIS Migrate dispatch set only (implementation-exclusion ONLY). A deferred story drops out of the in-scope hard-block set and is NOT sent for implementation, but is NEVER removed from reconciliation scope (Spec 4 reconciles the full pinned baseline, so a deferred story correctly surfaces there as a break -- the truthful signal, not a false break). Read by the readiness predicate + the run-sequence builder. Boxed Boolean on the Java side; DB DEFAULT false so existing rows read back not-deferred. Spec: Migrate Button + Migration Execution Driver (2026-06-14, Spec 3 of 4).';
