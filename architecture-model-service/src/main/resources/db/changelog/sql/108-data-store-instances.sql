-- ============================================================================
-- Infrastructure Domain: Data Store Instances Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Concrete data store instances (e.g. a Postgres DB, a Redis cache, a BigQuery
-- dataset, an object-storage bucket used as a data store). Distinct from the
-- logical/physical data entities in the Data domain -- this represents the
-- runtime hosting platform.
-- ============================================================================

CREATE TABLE data_store_instances (
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
  data_store_type      TEXT,
  engine               TEXT,
  engine_version       TEXT,
  provider             TEXT,
  host                 TEXT,
  port                 INTEGER,
  external_id          TEXT,
  encrypted            BOOLEAN,
  ha_enabled           BOOLEAN,
  backup_enabled       BOOLEAN,
  owner                TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_data_store_instances_model_file ON data_store_instances(model_file_id);
