-- ============================================================================
-- Infrastructure Domain: Deployment Units Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Deployment units are the deployable artefacts (container image, VM image,
-- function bundle, JAR, WAR, static bundle, package). The optional service_id
-- links a unit to the deployable service it implements (Q1: direct typed FK
-- to services -- NOT polymorphic via ApplicationPoint).
-- ============================================================================

CREATE TABLE deployment_units (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT,
  service_id           TEXT REFERENCES services(id),                    -- NO ACTION (cross-entity FK; Q1 direct typed FK)
  deployment_unit_type TEXT,
  version              TEXT,
  artifact_uri         TEXT,
  image_name           TEXT,
  image_tag            TEXT,
  source_repository    TEXT,
  source_commit        TEXT,
  build_pipeline       TEXT,
  owner                TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_deployment_units_model_file ON deployment_units(model_file_id);
