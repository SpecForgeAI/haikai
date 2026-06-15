-- ============================================================================
-- Infrastructure Domain: Compute Clusters Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Compute clusters group compute resources (e.g. GKE / Kubernetes / Cloud Run /
-- VMware / OpenShift / server farm). Deployment units may attach at cluster
-- level (without a specific resource) per the polymorphic R2 relationship.
-- ============================================================================

CREATE TABLE compute_clusters (
  id                   TEXT PRIMARY KEY,
  model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT,
  tags                 TEXT,
  valid_from           TEXT,
  valid_to             TEXT,
  environment_id       TEXT NOT NULL REFERENCES environments(id),       -- NO ACTION (cross-entity FK)
  cloud_account_id     TEXT REFERENCES cloud_accounts(id),              -- NO ACTION (cross-entity FK)
  location_id          TEXT REFERENCES locations(id),                   -- NO ACTION (cross-entity FK)
  network_id           TEXT REFERENCES networks(id),                    -- NO ACTION (cross-entity FK)
  platform_type        TEXT,
  provider             TEXT,
  version              TEXT,
  external_id          TEXT,
  owner                TEXT,
  operating_model      TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_compute_clusters_model_file ON compute_clusters(model_file_id);
