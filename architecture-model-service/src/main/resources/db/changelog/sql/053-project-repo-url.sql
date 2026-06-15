-- ============================================================================
-- Migration 053: Add repo_url column to project table
--
-- Adds a repo_url VARCHAR(500) column to the project table for storing
-- the Git repository URL associated with the project.
-- Existing projects will have NULL until backfilled.
-- ============================================================================

-- Add repo_url column (nullable VARCHAR 500 for long URLs)
ALTER TABLE project ADD COLUMN repo_url VARCHAR(500);
