-- ============================================================================
-- Infrastructure Domain: Networks Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Networks (VPC, VNet, on-prem network, LAN, WAN) provide the routable IP
-- envelope inside which subnets, compute, and load balancers operate.
-- ============================================================================

CREATE TABLE networks (
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
  network_type         TEXT,
  provider             TEXT,
  cidr                 TEXT,
  external_id          TEXT,
  is_shared            BOOLEAN,
  routing_mode         TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_networks_model_file ON networks(model_file_id);
