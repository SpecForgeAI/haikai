-- ============================================================================
-- Infrastructure Domain: Cloud Accounts Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Cloud accounts (e.g. GCP project, AWS account, Azure subscription) live
-- inside an environment and own the locations, networks, and resources within.
-- ============================================================================

CREATE TABLE cloud_accounts (
  id                    TEXT PRIMARY KEY,
  model_file_id         TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  tags                  TEXT,
  valid_from            TEXT,
  valid_to              TEXT,
  environment_id        TEXT NOT NULL REFERENCES environments(id),       -- NO ACTION (cross-entity FK)
  provider              TEXT,
  external_account_id   TEXT,
  parent_org_id         TEXT,
  billing_owner         TEXT,
  technical_owner       TEXT,
  landing_zone_name     TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_cloud_accounts_model_file ON cloud_accounts(model_file_id);
