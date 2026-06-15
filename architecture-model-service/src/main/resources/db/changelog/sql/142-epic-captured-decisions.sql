-- 142-epic-captured-decisions.sql
-- Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
--       (2026-05-20) -- Task Group 1
--
-- Introduces `epic_captured_decisions` -- the new first-class artifact that
-- carries epic-level captured decisions feeding pass-2 parent_rollup. Auto-
-- seeded from pass-1 spec parser output (decisions[]), then curatable by the
-- architect via the dedicated edit panel on the epic detail page (Task Group 8).
--
-- Scoping:
--   * project_id        -> NOT NULL. Anchors every row to the owning project.
--   * epic_work_item_id -> NOT NULL. UUID of the epic WorkItem this decision
--                          belongs to. NO new field is added on the WorkItem
--                          entity itself -- the FK is the source of truth.
--
-- Vocabularies (stored as VARCHAR with CHECK constraints, mirroring the family
-- pattern from changeset 140):
--   * source enum:  auto_extracted | user_edited | user_added
--       - auto_extracted: seeded by the pass-1 captured-decisions auto-seed
--         pipeline; carries a non-null source_spec_generation_id back to the
--         row that produced it.
--       - user_edited:    flipped from auto_extracted by any user PATCH;
--         pinned against further auto-overwrite.
--       - user_added:     freshly inserted by the user via the "Add decision"
--         affordance on the panel.
--   * status enum:  draft | confirmed | superseded
--       - draft (default on auto-seed) and confirmed feed pass-2 parent_rollup;
--         superseded rows are retained for audit but excluded from generation.
--
-- source_spec_generation_id is a nullable FK to migration_story_spec_generations.id
-- with ON DELETE SET NULL so deletes of the originating row do not cascade-
-- destroy the captured-decision history. Per project_pg_deferrable_set_null_action:
-- in PostgreSQL, ON DELETE SET NULL fires the action IMMEDIATELY (not at
-- commit), so any service-layer DELETE + re-INSERT cycle on the parent table
-- must capture-and-restore source_spec_generation_id values around the
-- transaction. The FK is NOT declared DEFERRABLE here because the SET NULL
-- action is what runs immediately -- only the integrity check defers, and we
-- want the action timing to be predictable for the auto-seed pipeline.
--
-- Indexes:
--   * idx_ecd_project_epic       -- composite (project_id, epic_work_item_id)
--                                   for the canonical list-per-epic endpoint
--                                   (GET .../epics/{epicId}/captured-decisions).
--   * idx_ecd_status             -- per-column for the resolver's status-IN
--                                   (draft, confirmed) filter when feeding
--                                   pass-2 parent_rollup.
--   * idx_ecd_source_spec        -- per-column for findBySourceSpecGenerationId,
--                                   used during pass-1 re-runs to locate rows
--                                   that originated from a specific source row.
--
-- Unique constraint:
--   * ux_ecd_project_epic_key    -- (project_id, epic_work_item_id, decision_key)
--                                   ensures each decision_key is unique within
--                                   the scope of an epic. The auto-seed pipeline
--                                   uses this for upsert semantics: a re-run of
--                                   pass-1 that re-extracts the same decision
--                                   key must NOT create a duplicate row.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 141 are not edited.

CREATE TABLE epic_captured_decisions (
  id                          UUID PRIMARY KEY,
  project_id                  UUID NOT NULL,
  epic_work_item_id           UUID NOT NULL,
  decision_key                VARCHAR(255) NOT NULL,
  decision_text               TEXT NOT NULL,
  source                      VARCHAR(32) NOT NULL,
  source_spec_generation_id   UUID NULL,
  status                      VARCHAR(32) NOT NULL DEFAULT 'draft',
  last_edited_by              VARCHAR(255) NULL,
  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ecd_source
    CHECK (source IN ('auto_extracted', 'user_edited', 'user_added')),
  CONSTRAINT chk_ecd_status
    CHECK (status IN ('draft', 'confirmed', 'superseded')),
  CONSTRAINT fk_ecd_source_spec_generation
    FOREIGN KEY (source_spec_generation_id)
    REFERENCES migration_story_spec_generations (id)
    ON DELETE SET NULL
);

CREATE UNIQUE INDEX ux_ecd_project_epic_key
  ON epic_captured_decisions (project_id, epic_work_item_id, decision_key);

CREATE INDEX idx_ecd_project_epic
  ON epic_captured_decisions (project_id, epic_work_item_id);

CREATE INDEX idx_ecd_status
  ON epic_captured_decisions (status);

CREATE INDEX idx_ecd_source_spec
  ON epic_captured_decisions (source_spec_generation_id);

COMMENT ON TABLE epic_captured_decisions IS
  'Epic-level captured decisions feeding pass-2 parent_rollup.epic.capturedDecisions[]. Auto-seeded from pass-1 spec parser output, curatable by the architect via the epic detail panel. Source enum {auto_extracted, user_edited, user_added} pins user-curated rows against auto-overwrite. Status enum {draft, confirmed, superseded} where only draft and confirmed feed generation. Spec: Cross-Story Context Injection (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN epic_captured_decisions.source IS
  'Provenance flag. auto_extracted = seeded by the pass-1 captured-decisions pipeline (carries non-null source_spec_generation_id); user_edited = flipped by any user PATCH (pinned against auto-overwrite); user_added = freshly inserted via the "Add decision" affordance. Enforced by chk_ecd_source.';

COMMENT ON COLUMN epic_captured_decisions.status IS
  'Lifecycle status. draft (default on auto-seed) and confirmed feed pass-2 parent_rollup; superseded rows are retained for audit but excluded from generation. Enforced by chk_ecd_status.';

COMMENT ON COLUMN epic_captured_decisions.source_spec_generation_id IS
  'Optional FK to migration_story_spec_generations.id that originated this auto-extracted row. ON DELETE SET NULL so deletes of the originating row do not cascade-destroy decision history. Per project_pg_deferrable_set_null_action: SET NULL fires immediately on the parent DELETE; any DELETE+re-INSERT cycle must capture-and-restore.';

COMMENT ON COLUMN epic_captured_decisions.decision_key IS
  'Stable key for upsert semantics across pass-1 re-runs. Unique within (project_id, epic_work_item_id) via ux_ecd_project_epic_key.';

COMMENT ON COLUMN epic_captured_decisions.last_edited_by IS
  'Audit channel: user/principal identifier of the last editor. Populated on user PATCH/POST.';
