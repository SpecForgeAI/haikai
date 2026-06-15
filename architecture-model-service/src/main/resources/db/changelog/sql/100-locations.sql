-- ============================================================================
-- Infrastructure Domain: Locations Table
-- Spec: 2026-05-04-infrastructure-domain-backend-foundation
-- Locations represent physical or logical geographic placement: cloud regions,
-- cloud zones, data centres, offices, edge sites, etc.
-- ============================================================================

CREATE TABLE locations (
  id                       TEXT PRIMARY KEY,
  model_file_id            TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  description              TEXT,
  tags                     TEXT,
  valid_from               TEXT,
  valid_to                 TEXT,
  environment_id           TEXT NOT NULL REFERENCES environments(id),       -- NO ACTION (cross-entity FK)
  cloud_account_id         TEXT REFERENCES cloud_accounts(id),              -- NO ACTION (cross-entity FK)
  location_type            TEXT,
  provider                 TEXT,
  provider_region_code     TEXT,
  provider_zone_code       TEXT,
  country                  TEXT,
  city                     TEXT,
  address                  TEXT
);

-- ============================================================================
-- PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX idx_locations_model_file ON locations(model_file_id);
