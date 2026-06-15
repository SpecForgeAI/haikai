-- ============================================================================
-- Migration 087: Architecture and Architecture Tag Tables
-- Spec: Multi-Architecture Plumbing (Spec #1)
--
-- Introduces the first-class `architecture` entity scoped under each project.
-- Every existing project will (in changeset 088) get one auto-created
-- `Default` architecture and every meta-model row will (in changesets
-- 089-091) be linked to it with zero data loss and zero behaviour change.
--
-- This changeset (087) only creates the two new tables and indexes.
--
-- Schema:
-- - architecture: one row per architecture; project-scoped; supports archive flag.
-- - architecture_tag: normalised tag storage (one row per tag value) for fast
--   filter-by-tag in spec #3. Unique on (architecture_id, tag_value).
--
-- Index rationale:
-- - idx_architecture_project supports the default-resolution query
--   `WHERE project_id = ? AND archived = false ORDER BY created_at ASC LIMIT 1`.
-- - idx_architecture_tag_value supports filter-by-tag (spec #3 prep).
-- ============================================================================

-- ============================================================================
-- ARCHITECTURE TABLE
-- ============================================================================

CREATE TABLE architecture (
  id           UUID PRIMARY KEY,
  project_id   UUID NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NULL,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK constraint: project_id references project(id) with cascade delete
ALTER TABLE architecture
  ADD CONSTRAINT fk_architecture_project
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;

-- Composite index supporting default-resolution (oldest non-archived per project).
CREATE INDEX idx_architecture_project_archived_created
  ON architecture(project_id, archived, created_at);

-- Plain project_id index for general lookups.
CREATE INDEX idx_architecture_project_id
  ON architecture(project_id);

-- ============================================================================
-- ARCHITECTURE_TAG TABLE
-- ============================================================================
-- Normalised storage for fast filter-by-tag queries. One row per (architecture, tag).

CREATE TABLE architecture_tag (
  architecture_id  UUID NOT NULL,
  tag_value        TEXT NOT NULL,
  CONSTRAINT pk_architecture_tag PRIMARY KEY (architecture_id, tag_value)
);

-- FK to architecture with cascade delete (tags follow their architecture)
ALTER TABLE architecture_tag
  ADD CONSTRAINT fk_architecture_tag_architecture
  FOREIGN KEY (architecture_id) REFERENCES architecture(id) ON DELETE CASCADE;

-- Index on tag_value for fast filter-by-tag (used in spec #3 UI)
CREATE INDEX idx_architecture_tag_value
  ON architecture_tag(tag_value);
