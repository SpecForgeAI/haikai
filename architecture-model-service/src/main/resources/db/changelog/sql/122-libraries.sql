-- ============================================================================
-- Library Backend Foundation: libraries table
-- Spec: 2026-05-05-library-backend-foundation
--
-- Creates the libraries entity table -- parallel to the services table. Mirrors
-- ServiceEntity columns for the shared envelope, repo + tech, package_set FK
-- and the 5 tech-hints columns; appends the 6 Infrastructure spec-7 provenance
-- columns. There is intentionally NO DB UNIQUE on (name, ecosystem); resolver
-- layer (Spec 3) is responsible for dedup.
-- ============================================================================

CREATE TABLE libraries (
  -- Standard envelope
  id                                  TEXT PRIMARY KEY,
  model_file_id                       TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                                TEXT NOT NULL,
  description                         TEXT NULL,
  tags                                TEXT NULL,
  valid_from                          TEXT NULL,
  valid_to                            TEXT NULL,

  -- Library-specific fields (no DB CHECK on ecosystem; allowed values are doc-only)
  ecosystem                           TEXT NULL,
  repo_location                       TEXT NULL,
  repo_subfolder                      TEXT NULL,
  core_tech                           TEXT NULL,

  -- Tech-hints columns (mirror services verbatim)
  core_tech_resolved                  JSONB NULL,
  core_tech_language_pack             VARCHAR(100) NULL,
  core_tech_framework_packs           JSONB NULL,
  core_tech_resolution_confidence     VARCHAR(20) NULL,
  core_tech_resolved_at               TIMESTAMP WITH TIME ZONE NULL,

  -- Provenance columns (mirror Infrastructure spec-7 verbatim; column is
  -- last_verified_at, NOT last_scanned_at)
  source_origin                       TEXT NULL,
  source_system                       TEXT NULL,
  source_reference                    TEXT NULL,
  generation_status                   TEXT NULL,
  generation_notes                    TEXT NULL,
  last_verified_at                    TEXT NULL,

  -- Package set FK (mirrors services.package_set_id)
  package_set_id                      TEXT NULL REFERENCES package_sets(id) ON DELETE SET NULL,

  CONSTRAINT libraries_core_tech_resolution_confidence_check
    CHECK (core_tech_resolution_confidence IS NULL
           OR core_tech_resolution_confidence IN ('high','low','none','tech-only','manual-override'))
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_libraries_model_file ON libraries(model_file_id);
