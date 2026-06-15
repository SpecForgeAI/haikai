-- ============================================================================
-- Infrastructure Domain: Load Balancers Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Load balancers (external/internal HTTP/TCP, ingress controller, F5, NGINX,
-- API gateway) front compute resources via listeners and routes (R3).
-- ============================================================================

CREATE TABLE load_balancers (
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
  load_balancer_type   TEXT,
  provider             TEXT,
  exposure             TEXT,
  scheme               TEXT,
  dns_name             TEXT,
  ip_address           TEXT,
  external_id          TEXT,
  owner                TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_load_balancers_model_file ON load_balancers(model_file_id);
