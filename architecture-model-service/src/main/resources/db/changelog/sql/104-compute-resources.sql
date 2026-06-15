-- ============================================================================
-- Infrastructure Domain: Compute Resources Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Compute resources represent VMs, physical servers, container services,
-- Kubernetes workloads, serverless functions, Cloud Run services, batch jobs.
-- They optionally belong to a compute cluster.
-- ============================================================================

CREATE TABLE compute_resources (
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
  cluster_id           TEXT REFERENCES compute_clusters(id),            -- NO ACTION (cross-entity FK)
  compute_type         TEXT,
  provider             TEXT,
  hostname             TEXT,
  fqdn                 TEXT,
  private_ip           TEXT,
  public_ip            TEXT,
  os                   TEXT,
  runtime              TEXT,
  instance_size        TEXT,
  scaling_min          INTEGER,
  scaling_max          INTEGER,
  external_id          TEXT,
  lifecycle_state      TEXT,
  owner                TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_compute_resources_model_file ON compute_resources(model_file_id);
