-- 139-generated-migration-books-of-work.sql
-- Spec: Product Manager Migration Delivery Plan + Draft Book-of-Work Generation
--       (2026-05-17) -- Task Group 1
--
-- Introduces the `generated_migration_books_of_work` table -- the AMS-side
-- persistence target for the new `product-manager--migration-delivery-plan`
-- task. Each row represents one generated draft book-of-work for a given
-- (project, currentArchitecture, targetArchitecture) tuple.
--
-- Scoping:
--   * project_id              -> NOT NULL. Anchors every draft to the owning
--                                 project so the standard project-scoped list
--                                 / filter APIs continue to work uniformly.
--   * current_architecture_id -> Nullable in this changeset to keep partial
--                                 / recovery drafts representable (Q-14); the
--                                 service layer enforces presence at create-
--                                 time for the canonical flow.
--   * target_architecture_id  -> Same nullability rationale as above.
--
-- Status vocabulary (Q-6, spec section "AMS entity + table"):
--   draft | reviewed | partially_saved | saved | archived | failed
-- Stored as VARCHAR(32) with a CHECK constraint -- mirrors the pack-friendly
-- TEXT pattern used by `discovery_findings.status` but bounded to a fixed
-- six-value set so renames require a NEW changeset (per
-- feedback_liquibase_immutable_changesets.md).
--
-- The four sibling JSONB columns are all nullable so partial drafts and
-- recovery scenarios are representable (Q-14):
--   * generation_inputs_json     -- snapshot of inputs used by the generator
--   * generation_summary_json    -- counts + coverage stats from the LLM
--   * quality_assessment_json    -- per-level rubric scores + rationale
--   * book_of_work_json          -- the hierarchy + per-item metadata
-- All four are mapped on the entity with hypersistence's JsonType (mirrors
-- DiscoveryRunEntity's config_snapshot/steps_payload precedent per
-- fix-hibernate-jsonb-mapping).
--
-- Audit columns:
--   * created_at / updated_at -- TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   * created_by_task         -- defaults to 'product-manager--migration-
--                                delivery-plan' so the row is self-describing
--                                even without joining task config.
--   * saved_to_backlog_at     -- set only when save-to-backlog has been run
--                                at least once (nullable).
--   * error_message           -- populated on failed runs / per-batch errors.
--
-- Composite + per-column indexes:
--   * idx_gmbw_project_arch_status -- composite (project_id,
--       current_architecture_id, target_architecture_id, status) for the
--       Q-6 regenerate-on-same-tuple archive lookup.
--   * idx_gmbw_project_id          -- per-column for the list endpoint.
--   * idx_gmbw_current_arch        -- per-column for arch-scoped filtering.
--   * idx_gmbw_target_arch         -- per-column for arch-scoped filtering.
--   * idx_gmbw_status              -- per-column for status filtering.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 138 are not edited.

CREATE TABLE generated_migration_books_of_work (
  id                          UUID PRIMARY KEY,
  project_id                  UUID NOT NULL,
  current_architecture_id     UUID NULL,
  target_architecture_id      UUID NULL,
  status                      VARCHAR(32) NOT NULL,
  title                       TEXT NULL,
  summary                     TEXT NULL,
  generation_inputs_json      JSONB NULL,
  generation_summary_json     JSONB NULL,
  quality_assessment_json     JSONB NULL,
  book_of_work_json           JSONB NULL,
  created_by_task             VARCHAR(128) NULL DEFAULT 'product-manager--migration-delivery-plan',
  saved_to_backlog_at         TIMESTAMP WITH TIME ZONE NULL,
  error_message               TEXT NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_gmbw_status
    CHECK (status IN ('draft','reviewed','partially_saved','saved','archived','failed'))
);

CREATE INDEX idx_gmbw_project_id
  ON generated_migration_books_of_work (project_id);
CREATE INDEX idx_gmbw_current_arch
  ON generated_migration_books_of_work (current_architecture_id);
CREATE INDEX idx_gmbw_target_arch
  ON generated_migration_books_of_work (target_architecture_id);
CREATE INDEX idx_gmbw_status
  ON generated_migration_books_of_work (status);
CREATE INDEX idx_gmbw_project_arch_status
  ON generated_migration_books_of_work
     (project_id, current_architecture_id, target_architecture_id, status);

COMMENT ON TABLE generated_migration_books_of_work IS
  'Persistence target for the product-manager--migration-delivery-plan task. Each row is one generated draft book-of-work (Initiatives -> Epics -> Features -> Stories) for a given (projectId, currentArchitectureId, targetArchitectureId) tuple. Gateway is the sole orchestrator; AMS persists only. Spec: PM Migration Delivery Plan (2026-05-17) -- TG1.';

COMMENT ON COLUMN generated_migration_books_of_work.status IS
  'Lifecycle status. Allowed values: draft | reviewed | partially_saved | saved | archived | failed. Enforced by chk_gmbw_status. Stored as VARCHAR(32). Renaming or adding values requires a NEW changeset.';

COMMENT ON COLUMN generated_migration_books_of_work.generation_inputs_json IS
  'Snapshot of inputs used by the generator (Product Definition refs, architecture refs, mapping refs, finding refs, options). Nullable so partial drafts are representable (Q-14).';

COMMENT ON COLUMN generated_migration_books_of_work.generation_summary_json IS
  'Counts + coverage stats produced by the LLM/generator. Nullable so partial drafts are representable (Q-14).';

COMMENT ON COLUMN generated_migration_books_of_work.quality_assessment_json IS
  'Whole-book + per-level rubric scores + rationale. Nullable so partial drafts are representable (Q-14).';

COMMENT ON COLUMN generated_migration_books_of_work.book_of_work_json IS
  'The full hierarchy (Initiatives -> Epics -> Features -> Stories) with per-item metadata, confidence, readiness, workstream, traceability. Nullable so partial drafts are representable (Q-14). saveState lives in frontend state during review and is written back here only on explicit Save Draft or save-to-backlog (Q-16).';

COMMENT ON COLUMN generated_migration_books_of_work.created_by_task IS
  'Producer task id. Defaults to ''product-manager--migration-delivery-plan'' so the row is self-describing without joining task config.';

COMMENT ON COLUMN generated_migration_books_of_work.saved_to_backlog_at IS
  'Timestamp of the most recent save-to-backlog call for this draft. Null if save-to-backlog has never been invoked. Q-5 / Q-8.';
