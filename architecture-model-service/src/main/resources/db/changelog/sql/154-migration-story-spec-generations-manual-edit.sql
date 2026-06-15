-- 154-migration-story-spec-generations-manual-edit.sql
-- Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` (introduced by changeset 140,
-- already extended by changesets 141, 146, 149, 150, 153) with the four
-- columns that drive the new in-product Markdown editor + audit trail +
-- single-slot prior-version history:
--
--   * manually_edited           -- BOOLEAN NOT NULL DEFAULT false. TRUE once
--                                  any user has saved a manual edit via the
--                                  drawer's `applyManualEdit` endpoint. Cleared
--                                  back to false on a successful LLM
--                                  regeneration with overwriteManuallyEdited=true
--                                  (the row is LLM-generated again, no longer
--                                  user-edited). The DEFAULT false satisfies
--                                  the NOT NULL constraint on existing rows
--                                  without backfill.
--   * last_manually_edited_at   -- TIMESTAMPTZ, nullable. Wall-clock time of
--                                  the most recent manual save. NULL until the
--                                  first manual edit. Drives the drawer-header
--                                  "Last edited by {user} on {date}" tooltip.
--   * last_manually_edited_by   -- VARCHAR(255), nullable. Identity of the
--                                  user who last manually saved (from the
--                                  `X-User-Id` request header on the
--                                  `applyManualEdit` endpoint). NULL until the
--                                  first manual edit.
--   * previous_spec_text        -- TEXT, nullable. Single-slot prior version
--                                  of `generated_spec_text` captured BEFORE
--                                  every manual save and BEFORE every
--                                  `overwriteManuallyEdited=true` regenerate.
--                                  Drives the drawer's "View previous version"
--                                  diff toggle. We keep ONE prior value only;
--                                  no full edit-history table.
--
-- `manually_edited` is NOT NULL DEFAULT false at the DB level (the safe choice
-- for a boolean flag with a clear "not yet edited" zero value). On the entity
-- side it is mapped as a BOXED Boolean (matching the existing `archived` /
-- `stale` pattern) per project_primitive_double_dto_overwrite.md: a primitive
-- boolean would silently default to false on a Jackson PATCH that omits the
-- field, and could wipe a previously-set true flag.
--
-- The other three columns are NULLABLE by design: rows that have never been
-- manually edited carry NULL audit fields (the absence of an edit, not a
-- ghost edit at epoch 0). `previous_spec_text` is similarly NULL until the
-- first save captures a prior version.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 153 are not edited.

ALTER TABLE migration_story_spec_generations
  ADD COLUMN manually_edited          BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN last_manually_edited_at  TIMESTAMPTZ  NULL,
  ADD COLUMN last_manually_edited_by  VARCHAR(255) NULL,
  ADD COLUMN previous_spec_text       TEXT         NULL;

COMMENT ON COLUMN migration_story_spec_generations.manually_edited IS
  'TRUE once a user has saved a manual edit through the drawer applyManualEdit endpoint; cleared back to false on a successful LLM regeneration with overwriteManuallyEdited=true. NOT NULL DEFAULT false. Boxed Boolean on the entity (matches the archived / stale pattern) per project_primitive_double_dto_overwrite.md. Drives the hierarchy "Edited" chip, the drawer-header indicator, and the overwrite-confirmation modals. Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.last_manually_edited_at IS
  'Wall-clock TIMESTAMPTZ of the most recent manual save. NULL until the first manual edit. Drives the drawer-header "Last edited by {user} on {date}" tooltip and the bulk-overwrite picker row labels. Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.last_manually_edited_by IS
  'Identity (VARCHAR 255) of the user who last manually saved this spec. Sourced from the X-User-Id request header on the applyManualEdit endpoint, NOT from the request body (the body is restricted to specText only). NULL until the first manual edit. Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN migration_story_spec_generations.previous_spec_text IS
  'Single-slot prior version of generated_spec_text captured BEFORE every manual save and BEFORE every overwriteManuallyEdited=true regenerate. Drives the drawer "View previous version" diff toggle. We keep ONE prior value only; no full edit-history table. NULL until the first save captures a prior version. Spec: In-Product Spec Editor + Confirm-Overwrite (2026-05-20) -- Task Group 1.';
