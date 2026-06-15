-- ============================================================================
-- Infrastructure Domain: Environments Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Adds the first of 12 Infrastructure entity tables. An environment scopes
-- cloud accounts, locations, networks, etc. into DEV / TEST / STAGING / PROD /
-- DR / CURRENT_STATE / TARGET_STATE / OTHER groupings.
-- ============================================================================

CREATE TABLE environments (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT,
  environment_type     TEXT,
  lifecycle_state      TEXT,
  is_current_state     BOOLEAN,
  is_target_state      BOOLEAN,
  owner                TEXT,
  criticality          TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_environments_model_file ON environments(model_file_id);
