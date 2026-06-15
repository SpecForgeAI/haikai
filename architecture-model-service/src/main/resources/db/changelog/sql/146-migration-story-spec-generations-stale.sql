-- 146-migration-story-spec-generations-stale.sql
-- Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` (introduced by changeset 140,
-- already extended by changesets 141 and 142 from the cross-story-context
-- spec) with two new columns supporting the target-architecture staleness
-- propagation pipeline:
--
--   * stale            -- BOOLEAN, NULLABLE.
--                         Flipped to TRUE by `POST /api/projects/{projectId}/specs/mark-stale`
--                         when any of the row's referenced architecture
--                         element ids (focused_context_refs_json.architecture_element_ids,
--                         possibly via mapping_refs) intersects the changed-
--                         element set on the active target. NULLABLE so the
--                         entity-side mapping uses boxed Boolean per
--                         project_primitive_double_dto_overwrite -- a PATCH
--                         that omits the field MUST NOT silently flip the
--                         column to false. The dashboard count query treats
--                         NULL as "not stale" semantically; the new index
--                         `(project_id, stale)` keeps that filter fast.
--
--   * stale_marked_at  -- TIMESTAMPTZ-equivalent (TIMESTAMP WITH TIME ZONE),
--                         NULLABLE. Stamped at the moment the row was marked
--                         stale; nulled (cleared) when the spec is
--                         successfully regenerated. Idempotency contract:
--                         a second mark-stale call on the same set is a no-op
--                         for already-stale rows but DOES bump stale_marked_at
--                         per AMS handler spec.
--
-- New index `idx_msg_project_stale` on `(project_id, stale)` so the migration
-- delivery dashboard's stale-count query has a fast covering path. Existing
-- tests on this table must NOT need changes -- this is additive only.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 145 are not edited.
-- This changeset is structurally a peer of 141 (also extending
-- migration_story_spec_generations).

ALTER TABLE migration_story_spec_generations
  ADD COLUMN stale BOOLEAN NULL;

ALTER TABLE migration_story_spec_generations
  ADD COLUMN stale_marked_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX idx_msg_project_stale
  ON migration_story_spec_generations (project_id, stale);

COMMENT ON COLUMN migration_story_spec_generations.stale IS
  'TRUE when the spec is stale because the active target architecture changed since the spec was generated. Flipped by POST /api/projects/{projectId}/specs/mark-stale. NULLABLE (boxed Boolean on the entity) so PATCH preserves null per project_primitive_double_dto_overwrite. The dashboard stale-count query is served by idx_msg_project_stale. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN migration_story_spec_generations.stale_marked_at IS
  'Timestamp at which the row was last marked stale. Nullable; cleared when the spec is successfully regenerated. Idempotency: a second mark-stale call bumps this value even when stale is already TRUE. Spec: Target Architecture Authoring Flow (2026-05-20).';
