-- ============================================================================
-- Migration 046: Add external_url to work_item and partial unique constraint
-- Spec: RM Increment 4 -- Jira Import for Roadmap Skeleton (Initiatives + Epics)
--
-- Adds an optional external_url column to the work_item table for storing
-- Jira browse URLs (e.g., https://jira.example.com/browse/PROJ-123).
-- Also adds a partial unique index on (project_id, external_system, external_key)
-- WHERE external_key IS NOT NULL to enforce uniqueness for externally-sourced items.
-- ============================================================================

-- Add nullable external_url column
ALTER TABLE work_item ADD COLUMN external_url TEXT NULL;

-- Partial unique index: ensures no duplicate external references within a project
CREATE UNIQUE INDEX idx_work_item_external_ref ON work_item(project_id, external_system, external_key) WHERE external_key IS NOT NULL;
