-- ============================================================================
-- Migration 013: Project Table
-- First-class Project entity for managing multiple projects with active project
-- semantics. Enables roadmap import to resolve files from the active project's
-- configured parent folder path.
-- ============================================================================

-- ============================================================================
-- PROJECT TABLE
-- Stores project metadata including name, parent folder path, and active status.
-- Only one project can be active at a time, enforced by partial unique index.
-- ============================================================================

CREATE TABLE project (
  id                     UUID PRIMARY KEY,
  name                   TEXT NOT NULL,
  project_parent_folder  TEXT NOT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index on is_active column for efficient active project lookup
CREATE INDEX idx_project_is_active ON project(is_active);

-- Partial unique index to enforce single active project at DB level
-- This allows at most one row where is_active = true
CREATE UNIQUE INDEX project_single_active_idx ON project((is_active)) WHERE is_active = true;
