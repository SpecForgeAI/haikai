-- ============================================================================
-- Infrastructure Domain: Infrastructure Resources Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Catch-all bucket for cloud-managed resources that are not compute, storage,
-- or networking primitives: object buckets, message topics/queues, caches,
-- secret stores, schedulers, event buses, CDNs, registries, etc.
-- ============================================================================

CREATE TABLE infrastructure_resources (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT,
  environment_id           TEXT NOT NULL REFERENCES environments(id),       -- NO ACTION (cross-entity FK)
  cloud_account_id         TEXT REFERENCES cloud_accounts(id),              -- NO ACTION (cross-entity FK)
  location_id              TEXT REFERENCES locations(id),                   -- NO ACTION (cross-entity FK)
  resource_type            TEXT,
  provider                 TEXT,
  provider_resource_type   TEXT,
  endpoint                 TEXT,
  external_id              TEXT,
  criticality              TEXT,
  owner                    TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_infrastructure_resources_model_file ON infrastructure_resources(model_file_id);
