-- ============================================================================
-- Infrastructure Domain: IaC Sources Table
-- Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
-- New entity-shaped concept recording IaC source-of-record (Terraform repo /
-- path / workspace / commit SHA / provider). Standard entity envelope plus
-- 13 source-specific fields. environment_id is nullable.
-- ============================================================================

CREATE TABLE iac_sources (
  id                      TEXT PRIMARY KEY,
  model_file_id           TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT NOT NULL,
  tags                    TEXT NOT NULL,
  valid_from              TEXT,
  valid_to                TEXT,
  environment_id          TEXT REFERENCES environments(id),                 -- NO ACTION (nullable cross-entity FK)
  source_type             TEXT,
  repository_url          TEXT,
  repository_provider     TEXT,
  branch                  TEXT,
  commit_sha              TEXT,
  path                    TEXT,
  workspace               TEXT,
  module_name             TEXT,
  module_path             TEXT,
  provider                TEXT,
  owner                   TEXT,
  last_scanned_at         TEXT,
  last_imported_at        TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_iac_sources_model_file ON iac_sources(model_file_id);
