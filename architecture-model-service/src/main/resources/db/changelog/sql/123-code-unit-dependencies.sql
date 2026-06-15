-- ============================================================================
-- Library Backend Foundation: code_unit_dependencies relationship
-- Spec: 2026-05-05-library-backend-foundation
--
-- Polymorphic-source / library-target dependency edge. Reuses the existing
-- application_points polymorphic supertype; both endpoints are FKs to
-- application_points(id) (NO ACTION). Doc-only constraints (test-enforced):
--   - target_application_point_id MUST reference an ApplicationPoint with
--     target_type = 'LIBRARY'.
--   - source_application_point_id MUST reference an ApplicationPoint with
--     target_type IN ('SERVICE','LIBRARY').
-- These are enforced at the spec/test layer, NOT the DB (no triggers, no
-- denorm columns, no extra CHECKs). See changeset 124 for the relaxed
-- application_points.target_type CHECK that admits the new LIBRARY value.
-- ============================================================================

CREATE TABLE code_unit_dependencies (
  id                            TEXT PRIMARY KEY,
  model_file_id                 TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,

  -- Polymorphic endpoints via existing ApplicationPoint supertype.
  source_application_point_id   TEXT NOT NULL REFERENCES application_points(id),  -- NO ACTION
  target_application_point_id   TEXT NOT NULL REFERENCES application_points(id),  -- NO ACTION

  -- Declared coordinates (manifest-language-specific)
  declared_name                 TEXT NULL,
  declared_version              TEXT NULL,
  declared_version_range        TEXT NULL,

  -- Scope (manifest-language-specific values stored verbatim; no DB CHECK)
  scope                         TEXT NULL,

  -- Manifest provenance
  manifest_path                 TEXT NULL,
  manifest_line                 INTEGER NULL,

  -- Edge metadata
  evidence_source               TEXT NULL,
  confidence                    DECIMAL(4,3) NULL,  -- range 0.0-1.0 doc-only; no DB CHECK

  -- Standard envelope tail (description and tags both nullable per codebase
  -- convention; overrides raw idea's NOT NULL).
  description                   TEXT NULL,
  tags                          TEXT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_code_unit_dependencies_model_file ON code_unit_dependencies(model_file_id);
