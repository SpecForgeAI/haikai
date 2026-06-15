-- ============================================================================
-- Infrastructure Domain: Subnets Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Subnets carve a network's CIDR into smaller blocks (PUBLIC / PRIVATE / APP /
-- DATA / MANAGEMENT / DMZ). Compute resources and load balancers attach via
-- the resource_subnet_hostings relationship (R1).
-- ============================================================================

CREATE TABLE subnets (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT,
  environment_id           TEXT NOT NULL REFERENCES environments(id),       -- NO ACTION (cross-entity FK)
  network_id               TEXT NOT NULL REFERENCES networks(id),           -- NO ACTION (cross-entity FK)
  location_id              TEXT REFERENCES locations(id),                   -- NO ACTION (cross-entity FK)
  cidr                     TEXT,
  subnet_type              TEXT,
  visibility               TEXT,
  provider_region_code     TEXT,
  provider_zone_code       TEXT,
  external_id              TEXT,
  gateway_address          TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_subnets_model_file ON subnets(model_file_id);
