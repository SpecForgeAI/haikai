-- 148-missing-input-resolutions.sql
-- Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1
--
-- Introduces `missing_input_resolutions` -- the new AMS-side persistence table
-- recording the user-supplied resolution payload for each missing-input key
-- surfaced by a story's spec generation result. One active row per
-- (project_id, missing_input_key); soft-delete preserves audit history.
--
-- Scoping:
--   * project_id          -> NOT NULL. Anchors every resolution to the owning
--                            project. The cross-story matcher uses this column
--                            in tandem with `missing_input_keys_json` to find
--                            every spec affected by a resolution (or by its
--                            soft-delete cascade).
--   * missing_input_key   -> NOT NULL, varchar(16). Stable key produced by
--                            `MissingInputKeyHasher` =
--                            truncate(SHA-256(input_type + '|' + canonical_descriptor), 16 hex).
--                            Case-insensitive + trimmed canonical descriptor
--                            so emit-time and upload-time hashes line up.
--   * missing_input_type  -> NOT NULL, varchar(32). One of `api_contract`,
--                            `mapping`, `target_element`. CHECK constraint
--                            `chk_mir_type` is the source of truth. Out-of-v1
--                            types (decisions / baselines / etc.) NEVER enter
--                            this table -- they surface read-only in the
--                            resolver panel under the `out_of_v1` group.
--
-- Payload (per type):
--   * api_contract  -> { contractBlobId, filename, format: 'oas'|'wsdl', operationsCount }
--   * mapping       -> { sourceElementId, targetElementId, mappingRefId }   -- mappingRefId FK to ArchitectureElementMapping
--   * target_element-> { targetElementId }                                  -- FK to the element created in the target-arch workspace
-- Stored as JSONB so the shape can flex per type without table churn.
--
-- Audit + soft-delete:
--   * resolved_at + resolved_by stamped on insert.
--   * soft_deleted (BOOLEAN NOT NULL DEFAULT FALSE) + soft_deleted_at /
--     soft_deleted_by stamped on Reset; the row is NEVER hard-deleted so the
--     audit trail survives.
--   * Composite unique index `ux_mir_project_key_active` is a partial unique
--     constraint -- it covers ONLY rows where soft_deleted = FALSE -- so a
--     project can have exactly one active resolution per key while still
--     retaining all prior soft-deleted rows.
--   * Cross-story matcher uses the secondary index
--     `idx_mir_project_key_soft_deleted` for the (project_id, missing_input_key,
--     soft_deleted) lookup path; the dashboard list endpoint uses the per-
--     project index `idx_mir_project_soft_deleted`.
--
-- Boxed types on the entity (Boolean, UUID, Instant, String) per
-- project_primitive_double_dto_overwrite.md.
--
-- Per feedback_liquibase_immutable_changesets.md: applied changesets are
-- immutable. This is a NEW changeset only; changesets <= 147 are not edited.

CREATE TABLE missing_input_resolutions (
  id                       UUID PRIMARY KEY,
  project_id               UUID NOT NULL,
  missing_input_key        VARCHAR(16) NOT NULL,
  missing_input_type       VARCHAR(32) NOT NULL,
  resolution_payload_json  JSONB NULL,
  resolved_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_by              VARCHAR(128) NOT NULL,
  soft_deleted             BOOLEAN NOT NULL DEFAULT FALSE,
  soft_deleted_at          TIMESTAMP WITH TIME ZONE NULL,
  soft_deleted_by          VARCHAR(128) NULL,
  created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mir_type
    CHECK (missing_input_type IN ('api_contract', 'mapping', 'target_element'))
);

-- Partial unique index: only one ACTIVE (soft_deleted=false) resolution per
-- (project_id, missing_input_key). Soft-deleted rows are excluded so resets
-- and re-resolutions are unrestricted.
CREATE UNIQUE INDEX ux_mir_project_key_active
  ON missing_input_resolutions (project_id, missing_input_key)
  WHERE soft_deleted = FALSE;

-- Lookup index for cross-story matcher (find every active resolution for a
-- project + key tuple, regardless of soft-delete state for audit reads).
CREATE INDEX idx_mir_project_key_soft_deleted
  ON missing_input_resolutions (project_id, missing_input_key, soft_deleted);

-- Lookup index for the dashboard list endpoint (active resolutions per
-- project; filterable by type and key downstream).
CREATE INDEX idx_mir_project_soft_deleted
  ON missing_input_resolutions (project_id, soft_deleted);

COMMENT ON TABLE missing_input_resolutions IS
  'User-supplied resolutions for missing-input keys surfaced by migration_story_spec_generations rows. One active row per (project_id, missing_input_key) enforced by ux_mir_project_key_active (partial unique on soft_deleted=false). Soft-delete preserves audit history; the cross-story matcher walks missing_input_keys_json on migration_story_spec_generations to find every affected spec. Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 1.';

COMMENT ON COLUMN missing_input_resolutions.missing_input_key IS
  'Stable 16-hex-char key produced by MissingInputKeyHasher = truncate(SHA-256(input_type + ''|'' + canonical_descriptor), 16). Canonical descriptors are lowercased + trimmed before hashing so emit-time and upload-time hashes line up. Out-of-v1 missing-input types never produce a key and never enter this table.';

COMMENT ON COLUMN missing_input_resolutions.missing_input_type IS
  'Allowed values: api_contract, mapping, target_element. CHECK constraint chk_mir_type is source of truth. Out-of-v1 types (decisions, baselines, etc.) are filtered out at hash time and never reach this table.';

COMMENT ON COLUMN missing_input_resolutions.resolution_payload_json IS
  'Type-specific JSONB payload. api_contract: { contractBlobId, filename, format, operationsCount }. mapping: { sourceElementId, targetElementId, mappingRefId } (FK by id to ArchitectureElementMapping). target_element: { targetElementId } (FK to the element created via target-arch authoring workspace).';

COMMENT ON COLUMN missing_input_resolutions.soft_deleted IS
  'TRUE when the resolution has been Reset by the user. Soft-deleted rows are excluded from the active partial unique index but are retained for audit history. Soft-delete triggers the cross-story cascade that flips dependent specs back to insufficient_context with stale_reason=resolution_reset.';
