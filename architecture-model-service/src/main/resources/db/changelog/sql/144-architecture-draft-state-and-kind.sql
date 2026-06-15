-- 144-architecture-draft-state-and-kind.sql
-- Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 1
--
-- Adds two new discriminator columns to `architecture` so the same table can
-- carry both the existing current-state architecture rows (default) and the
-- new target-state architecture rows (active + drafts) introduced by this
-- spec.
--
--   * draft_state -- VARCHAR(32), NOT NULL DEFAULT 'active',
--                    CHECK IN ('active', 'draft').
--                    Drafts of a target architecture carry 'draft'; the single
--                    promoted target carries 'active'. Current-state rows also
--                    carry 'active' (no draft concept on the current side in
--                    v1). Existing rows backfill to 'active' via the DEFAULT
--                    clause; the defensive UPDATE below is a no-op in practice
--                    but documents the intent.
--
--   * kind        -- VARCHAR(32), NOT NULL DEFAULT 'current',
--                    CHECK IN ('current', 'target').
--                    Discriminates current-state vs target-state architecture
--                    rows. Existing rows backfill to 'current'; the idempotent
--                    backfill below stamps any architecture row tagged
--                    'imported-target' (via the existing architecture_tag
--                    table) as kind='target' so the prior import-only target
--                    surfaces cleanly in the new authoring workspace.
--
-- All entity-side mappings use boxed reference types (String) per
-- project_primitive_double_dto_overwrite so a PATCH omitting these fields
-- preserves whatever the row already had.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 143 are not edited.

ALTER TABLE architecture
  ADD COLUMN draft_state VARCHAR(32) NOT NULL DEFAULT 'active';

ALTER TABLE architecture
  ADD COLUMN kind VARCHAR(32) NOT NULL DEFAULT 'current';

-- Defensive backfill: the DEFAULT clauses above already populate every
-- existing row, but the explicit UPDATEs document the intent and protect
-- against any pre-existing row that somehow ended up with NULL before the
-- NOT NULL constraint applied.
UPDATE architecture SET draft_state = 'active' WHERE draft_state IS NULL;
UPDATE architecture SET kind        = 'current' WHERE kind        IS NULL;

-- Idempotent backfill: flip any architecture row tagged 'imported-target' to
-- kind='target' so the existing import-only target surfaces in the new
-- authoring workspace. Re-runs are no-ops because the WHERE clause excludes
-- already-flipped rows.
UPDATE architecture
  SET kind = 'target'
  WHERE kind = 'current'
    AND id IN (
      SELECT architecture_id FROM architecture_tag
      WHERE tag_value IN ('imported-target', 'target', 'target-baseline')
    );

ALTER TABLE architecture
  ADD CONSTRAINT chk_architecture_draft_state
  CHECK (draft_state IN ('active', 'draft'));

ALTER TABLE architecture
  ADD CONSTRAINT chk_architecture_kind
  CHECK (kind IN ('current', 'target'));

COMMENT ON COLUMN architecture.draft_state IS
  'Draft lifecycle position. Allowed values active | draft. Drafts of a target architecture carry draft; the single promoted target carries active. Current-state rows always carry active in v1. Enforced by chk_architecture_draft_state. Spec: Target Architecture Authoring Flow (2026-05-20).';

COMMENT ON COLUMN architecture.kind IS
  'Architecture kind discriminator. Allowed values current | target. Current-state rows carry current; target-state rows (active or draft) carry target. Existing rows backfill to current; imported-target tagged rows are migrated to target by an idempotent backfill in this changeset. Enforced by chk_architecture_kind. Spec: Target Architecture Authoring Flow (2026-05-20).';
