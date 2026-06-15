-- ============================================================================
-- Migration 018: Package Set Standards Import
-- Adds support for importing package set standards from JSON files
-- and resolving "Default (Auto)" for Services based on matching rules
--
-- Spec: Package Set Standards Import (Iteration 6)
-- ============================================================================

-- ============================================================================
-- 1. ADD COLUMNS TO package_sets TABLE
-- standard_key: Unique key for imported sets (e.g., "JavaCrud")
-- standard_source: Source of import ("COMPANY" | "PROJECT"), NULL for user-created
-- ============================================================================

ALTER TABLE package_sets ADD COLUMN standard_key TEXT;
ALTER TABLE package_sets ADD COLUMN standard_source VARCHAR(16);

-- Partial unique constraint: only enforced when standard_source IS NOT NULL
-- This allows deterministic upsert for imported sets without affecting user-created sets
CREATE UNIQUE INDEX uq_package_sets_standard ON package_sets(model_file_id, standard_source, standard_key)
    WHERE standard_source IS NOT NULL;

-- ============================================================================
-- 2. ADD COLUMNS TO packages TABLE
-- standard_source: Source of import ("COMPANY" | "PROJECT"), NULL for user-created
-- standard_key: Optional compound key (e.g., "JavaCrud:controller")
-- ============================================================================

ALTER TABLE packages ADD COLUMN standard_source VARCHAR(16);
ALTER TABLE packages ADD COLUMN standard_key TEXT;

-- Unique constraint on packages: prevents duplicate package names within a set
-- This existing constraint may already cover this - we add model_file_id for consistency
CREATE UNIQUE INDEX uq_packages_model_set_name ON packages(model_file_id, package_set_id, name);

-- ============================================================================
-- 3. CREATE package_set_default_rules TABLE
-- Stores matching rules for resolving "Default (Auto)" package set selections
-- ============================================================================

CREATE TABLE package_set_default_rules (
    id                     TEXT PRIMARY KEY,
    model_file_id          TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
    standard_source        VARCHAR(16) NOT NULL,
    package_set_id         TEXT NOT NULL REFERENCES package_sets(id) ON DELETE CASCADE,
    core_tech_includes     TEXT NOT NULL DEFAULT '[]',
    service_type_includes  TEXT NOT NULL DEFAULT '[]',
    priority               INTEGER NOT NULL DEFAULT 0,
    created_at             TIMESTAMP,
    updated_at             TIMESTAMP
);

-- Indexes for efficient queries
CREATE INDEX idx_package_set_default_rules_model_file ON package_set_default_rules(model_file_id);
CREATE INDEX idx_package_set_default_rules_package_set ON package_set_default_rules(package_set_id);
CREATE INDEX idx_package_set_default_rules_source ON package_set_default_rules(standard_source);

-- ============================================================================
-- 4. CREATE package_set_standards_import_status TABLE
-- Tracks import history and counts for audit and display purposes
-- ============================================================================

CREATE TABLE package_set_standards_import_status (
    id                   TEXT PRIMARY KEY,
    model_file_id        TEXT NOT NULL REFERENCES model_files(id) ON DELETE CASCADE,
    imported_at          TIMESTAMP NOT NULL,
    company_file_path    TEXT,
    project_file_path    TEXT,
    company_revision     TEXT,
    project_revision     TEXT,
    inserted_sets        INTEGER DEFAULT 0,
    updated_sets         INTEGER DEFAULT 0,
    inserted_packages    INTEGER DEFAULT 0,
    updated_packages     INTEGER DEFAULT 0,
    inserted_rules       INTEGER DEFAULT 0,
    updated_rules        INTEGER DEFAULT 0
);

-- Index for efficient lookup of last import status
CREATE INDEX idx_package_set_standards_import_status_model_file ON package_set_standards_import_status(model_file_id);
