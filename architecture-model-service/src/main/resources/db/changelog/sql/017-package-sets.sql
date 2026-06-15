-- ============================================================================
-- Task Group 1: Add PackageSet and Package entities
-- PackageSets represent groups of packages for service design
-- Services can optionally reference a PackageSet
-- ============================================================================

-- ============================================================================
-- PACKAGE_SETS TABLE
-- ============================================================================

CREATE TABLE package_sets (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  created_at         TIMESTAMP,
  updated_at         TIMESTAMP
);

-- ============================================================================
-- PACKAGES TABLE
-- ============================================================================

CREATE TABLE packages (
  id                 TEXT PRIMARY KEY,
  model_file_id      TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
  package_set_id     TEXT NOT NULL REFERENCES package_sets(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  purpose            TEXT,
  sort_order         INTEGER,
  CONSTRAINT uq_package_set_name UNIQUE (package_set_id, name)
);

-- ============================================================================
-- ADD package_set_id TO SERVICES TABLE
-- ============================================================================

ALTER TABLE services ADD COLUMN package_set_id TEXT REFERENCES package_sets(id) ON DELETE SET NULL;

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX idx_package_sets_model_file ON package_sets(model_file_id);
CREATE INDEX idx_packages_model_file ON packages(model_file_id);
CREATE INDEX idx_packages_package_set ON packages(package_set_id);
