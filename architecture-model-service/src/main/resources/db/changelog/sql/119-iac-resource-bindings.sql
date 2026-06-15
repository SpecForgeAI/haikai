-- ============================================================================
-- Infrastructure Domain Relationship: IaC Resource Bindings
-- Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
-- N:N mapping between an IaC source and an Infrastructure entity (via
-- infrastructure_points polymorphic supertype). Confidence is nullable
-- DECIMAL(4,3) with NO DB CHECK -- producers are responsible for clamping.
-- start_line / end_line are nullable INTEGER. description and tags are
-- non-null. NO `name` column (relationship envelope).
-- ============================================================================

CREATE TABLE iac_resource_bindings (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  iac_source_id            TEXT NOT NULL REFERENCES iac_sources(id),                 -- NO ACTION (cross-entity FK)
  infrastructure_point_id  TEXT NOT NULL REFERENCES infrastructure_points(id),       -- NO ACTION (polymorphic target)
  environment_id           TEXT REFERENCES environments(id),                         -- NO ACTION (nullable)
  iac_address              TEXT,
  iac_resource_type        TEXT,
  iac_resource_name        TEXT,
  provider                 TEXT,
  file_path                TEXT,
  start_line               INTEGER,
  end_line                 INTEGER,
  state_resource_id        TEXT,
  external_id              TEXT,
  binding_status           TEXT,
  confidence               DECIMAL(4,3),                                             -- nullable, no DB CHECK
  last_seen_at             TEXT,
  description              TEXT NOT NULL,
  tags                     TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_iac_resource_bindings_model_file ON iac_resource_bindings(model_file_id);
