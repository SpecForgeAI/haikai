-- ============================================================================
-- Migration 029: Organisations Table and Project FK
-- Spec: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
--
-- Introduces a new Organisation entity with unique name constraint and
-- establishes a 1:M relationship (Organisation to Project) via a foreign key
-- on the Project table.
--
-- Existing projects will have NULL organisation_id until manually backfilled.
-- Future iteration will enforce NOT NULL after data migration is complete.
-- ============================================================================

-- ============================================================================
-- ORGANISATIONS TABLE
-- Stores organisation metadata including unique name and optional description.
-- ============================================================================

CREATE TABLE organisations (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT
);

-- Unique index on name column to enforce organisation uniqueness at DB level
CREATE UNIQUE INDEX idx_organisations_name ON organisations(name);

-- ============================================================================
-- PROJECT TABLE MODIFICATION
-- Add nullable organisation_id FK column for safe migration.
-- ============================================================================

-- Add organisation_id column (nullable for safe migration)
ALTER TABLE project ADD COLUMN organisation_id UUID;

-- Add FK constraint with ON DELETE RESTRICT to prevent deleting organisations
-- while projects still reference them
ALTER TABLE project
  ADD CONSTRAINT fk_project_organisation
  FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE RESTRICT;

-- Index for efficient lookups by organisation
CREATE INDEX idx_project_organisation_id ON project(organisation_id);
