-- 140-migration-story-spec-generations.sql
-- Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- Task Group 1
--
-- Introduces the `migration_story_spec_generations` table -- the AMS-side
-- persistence target for the new `product-manager--migration-shape-spec-generation`
-- task. Each row represents one shape-spec-generation attempt for a single
-- saved-story WorkItem (originating from a generated migration Book of Work).
--
-- Path B chosen per R-1 (see agent-os/specs/2026-05-19-pm-migration-shape-spec-batch-generation/
-- planning/group-1-persistence-decision.txt): existing WorkItemImplementWorkspace
-- entity is an opaque JSONB workspace-state snapshot for Implement-tab rehydration --
-- conflating shape-spec-generation results onto it would muddle two unrelated
-- concerns. This new table is structurally a peer of
-- `generated_migration_books_of_work` (Spec 1, changeset 139).
--
-- Scoping:
--   * project_id     -> NOT NULL. Anchors every row to the owning project.
--   * work_item_id   -> NOT NULL. Source of truth for WorkItem linkage (R-9);
--                       NO new field is added on the WorkItem entity itself.
--   * book_of_work_id-> Nullable so legacy / ad-hoc single-story regen flows
--                       remain representable; the canonical batch flow always
--                       sets it.
--   * book_item_id   -> Nullable VARCHAR (book-of-work hierarchy item id from
--                       the book_of_work_json blob in Spec 1's row).
--
-- Status vocabulary (per spec.md "Status + confidence sentinels"):
--   generated | generated_with_warnings | insufficient_context | failed | skipped_blocked
-- `not_attempted` is LAZY (A-6) -- no row is written until first attempt;
-- "not attempted" counts are computed in-memory by the summary endpoint as
-- `book_of_work_json.stories - rows-in-this-table`.
-- Stored as VARCHAR(32) with a CHECK constraint. Renaming or adding values
-- requires a NEW changeset (per feedback_liquibase_immutable_changesets.md).
--
-- Confidence vocabulary:
--   high | medium | low
-- Stored as VARCHAR(16) with a CHECK constraint. The LLM self-rates;
-- the gateway validates and may downgrade (R-7).
--
-- Four sibling JSONB blobs (all nullable so partial / failed-only rows are
-- representable):
--   * warnings_json                  -- structured warnings (incl. CONFIDENCE_DOWNGRADED)
--   * missing_inputs_json            -- non-empty when status='insufficient_context'
--   * focused_context_refs_json      -- refs used to assemble the LLM payload
--   * evidence_refs_json             -- refs cited by the generated spec
-- All four are mapped on the entity with hypersistence's JsonType (mirrors
-- DiscoveryRunEntity's config_snapshot/steps_payload precedent per
-- fix-hibernate-jsonb-mapping).
--
-- Generated spec text:
--   * generated_spec_text TEXT NULL -- literal `/agent-os:shape-spec ...` body
--                                    when status in (generated, generated_with_warnings);
--                                    null otherwise.
--
-- Predicted-vs-actual comparison (R-10):
--   * predicted_readiness VARCHAR(32) NULL -- snapshot of the per-story
--     readiness signal from Spec 1's BoW JSONB blob, copied here at generation
--     time so the side-by-side comparison survives BoW re-edits.
--
-- Manual-edit protection (acceptance signal 17):
--   * created_by_task VARCHAR(128) -- defaults to
--     'product-manager--migration-shape-spec-generation'; if the value drifts
--     from the generator's task id OR an explicit manual-edit timestamp is
--     present, the AMS service rejects overwrite without confirmOverwrite=true.
--
-- Attempt tracking (R-8):
--   * generation_attempt_number INTEGER NOT NULL DEFAULT 0 -- bumped on
--     explicit "Regenerate all (including generated)" runs.
--
-- Audit columns:
--   * created_at / updated_at -- TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   * generated_at            -- nullable; set when LLM call completed
--                                successfully (status in
--                                generated|generated_with_warnings).
--   * error_message           -- populated on failed rows / persistence errors.
--
-- Indexes:
--   * idx_msg_project_id          -- per-column for project-scoped list view.
--   * idx_msg_work_item_id        -- per-column for WorkItem Implement-tab
--                                    chip lookup (R-9). NOT unique -- future
--                                    regeneration history may insert multiple
--                                    rows per WorkItem; the lazy single-row
--                                    model is enforced at the service layer.
--   * idx_msg_book_of_work_id     -- per-column for list-per-book endpoint.
--   * idx_msg_status              -- per-column for status filtering.
--   * idx_msg_book_status         -- composite (book_of_work_id, status) for
--                                    the summary endpoint counts.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 139 are not edited.

CREATE TABLE migration_story_spec_generations (
  id                              UUID PRIMARY KEY,
  project_id                      UUID NOT NULL,
  work_item_id                    UUID NOT NULL,
  book_of_work_id                 UUID NULL,
  book_item_id                    VARCHAR(128) NULL,
  status                          VARCHAR(32) NOT NULL,
  confidence                      VARCHAR(16) NULL,
  predicted_readiness             VARCHAR(32) NULL,
  generated_spec_text             TEXT NULL,
  warnings_json                   JSONB NULL,
  missing_inputs_json             JSONB NULL,
  focused_context_refs_json       JSONB NULL,
  evidence_refs_json              JSONB NULL,
  generated_at                    TIMESTAMP WITH TIME ZONE NULL,
  error_message                   TEXT NULL,
  generation_attempt_number       INTEGER NOT NULL DEFAULT 0,
  created_by_task                 VARCHAR(128) NULL DEFAULT 'product-manager--migration-shape-spec-generation',
  created_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_msg_status
    CHECK (status IN ('generated','generated_with_warnings','insufficient_context','failed','skipped_blocked')),
  CONSTRAINT chk_msg_confidence
    CHECK (confidence IS NULL OR confidence IN ('high','medium','low'))
);

CREATE INDEX idx_msg_project_id
  ON migration_story_spec_generations (project_id);
CREATE INDEX idx_msg_work_item_id
  ON migration_story_spec_generations (work_item_id);
CREATE INDEX idx_msg_book_of_work_id
  ON migration_story_spec_generations (book_of_work_id);
CREATE INDEX idx_msg_status
  ON migration_story_spec_generations (status);
CREATE INDEX idx_msg_book_status
  ON migration_story_spec_generations (book_of_work_id, status);

COMMENT ON TABLE migration_story_spec_generations IS
  'Persistence target for the product-manager--migration-shape-spec-generation task. Each row is one shape-spec-generation attempt for a single saved-story WorkItem. Gateway is the sole orchestrator; AMS persists only. WorkItem FK is the source of truth (R-9); no field is added on the WorkItem entity itself. `not_attempted` is LAZY (A-6) -- no row exists until first attempt. Spec: PM Migration Shape-Spec Batch Generation (2026-05-19) -- TG1.';

COMMENT ON COLUMN migration_story_spec_generations.status IS
  'Lifecycle status. Allowed values: generated | generated_with_warnings | insufficient_context | failed | skipped_blocked. Enforced by chk_msg_status. `not_attempted` is NEVER persisted -- it is computed lazily by the summary endpoint.';

COMMENT ON COLUMN migration_story_spec_generations.confidence IS
  'LLM self-rated confidence (high|medium|low), validated and possibly downgraded by the gateway per R-7. Enforced by chk_msg_confidence.';

COMMENT ON COLUMN migration_story_spec_generations.predicted_readiness IS
  'Snapshot of per-story readiness signal from Spec 1''s BoW JSONB blob, copied here at generation time so the predicted-vs-actual side-by-side comparison (R-10) survives BoW edits.';

COMMENT ON COLUMN migration_story_spec_generations.generated_spec_text IS
  'Literal `/agent-os:shape-spec [spec details]` body when status in (generated, generated_with_warnings); null otherwise. The validator enforces the prefix at gateway level (A-4).';

COMMENT ON COLUMN migration_story_spec_generations.warnings_json IS
  'Structured warnings array. Includes the CONFIDENCE_DOWNGRADED entry appended by the gateway when downgrade rules fire (R-7).';

COMMENT ON COLUMN migration_story_spec_generations.missing_inputs_json IS
  'Non-empty when status=''insufficient_context''. Items shape: { kind, id, reason }.';

COMMENT ON COLUMN migration_story_spec_generations.focused_context_refs_json IS
  'Refs used to assemble the LLM payload (architecture refs, mappings, baselines, contracts, evidence IDs). Bounded by the gateway focused-context client per A-5 / R-5.';

COMMENT ON COLUMN migration_story_spec_generations.evidence_refs_json IS
  'Evidence references cited by the generated spec. Acceptance signal 11: generated specs include evidence/traceability refs.';

COMMENT ON COLUMN migration_story_spec_generations.generation_attempt_number IS
  'Bumped by the gateway on explicit "Regenerate all (including generated)" runs (R-8). Default 0 for first attempt.';

COMMENT ON COLUMN migration_story_spec_generations.created_by_task IS
  'Producer task id. Defaults to ''product-manager--migration-shape-spec-generation''. Manual-edit protection (acceptance signal 17): if the value drifts from the generator''s task id, the service rejects overwrite without confirmOverwrite=true.';
