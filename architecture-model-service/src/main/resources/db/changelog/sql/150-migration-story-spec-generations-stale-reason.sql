-- 150-migration-story-spec-generations-stale-reason.sql
-- Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1
--
-- Extends `migration_story_spec_generations` with a discriminator column
-- `stale_reason` (varchar(32), nullable) that pairs with the existing
-- `stale` boolean (changeset 146 from the target-architecture-authoring spec)
-- to explain WHY a spec is stale.
--
-- Vocabulary (CHECK constraint chk_msg_stale_reason):
--   * target_architecture_changed -- set by the target-arch authoring flow's
--                                     mark-stale handler when an architecture
--                                     element change debounces through.
--   * resolution_reset            -- set by THIS spec's soft-delete cascade
--                                     when a user Resets a missing-input
--                                     resolution and dependent specs are
--                                     flipped back to insufficient_context.
--
-- Both reasons can apply to the same row over its lifetime, but only ONE
-- reason is stored at any given moment. When a soft-delete cascade fires on
-- a row that is already stale for `target_architecture_changed`, the reason
-- is overwritten to `resolution_reset` (the most recent triggering event).
-- Both stale and stale_reason are cleared together on successful regeneration.
--
-- Why a separate `stale_reason` column rather than a parallel flag:
--   * Keeps the dashboard count query on `idx_msg_project_stale` (changeset
--     146) fast -- the index covers the boolean filter; the reason is read
--     only when the chip / tooltip is rendered.
--   * A single boolean + reason code is cheaper than a parallel flag plus a
--     second index.
--
-- Nullability: `stale_reason` is NULL when `stale` is NULL/FALSE (never set
-- in isolation). Service-layer mark-stale flows set them together; service-
-- layer clear-stale flows null them together.
--
-- Boxed entity-side mapping: String per
-- project_primitive_double_dto_overwrite.md.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 149 are not edited.

ALTER TABLE migration_story_spec_generations
  ADD COLUMN stale_reason VARCHAR(32) NULL;

ALTER TABLE migration_story_spec_generations
  ADD CONSTRAINT chk_msg_stale_reason
    CHECK (stale_reason IS NULL OR stale_reason IN ('target_architecture_changed', 'resolution_reset'));

COMMENT ON COLUMN migration_story_spec_generations.stale_reason IS
  'Discriminator for the existing `stale` flag (changeset 146). Allowed values: target_architecture_changed (set by mark-stale from the target-arch authoring flow) or resolution_reset (set by the soft-delete cascade in the missing-input resolver flow). NULL when stale is NULL/FALSE. Both fields are cleared together on successful regeneration. CHECK constraint chk_msg_stale_reason is source of truth. Spec: Missing Input Resolver Flow (2026-05-20).';
