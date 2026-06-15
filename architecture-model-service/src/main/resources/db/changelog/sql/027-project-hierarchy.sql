-- ============================================================================
-- Migration 027: Add project_hierarchy column to project table
-- Spec: Project Hierarchy Grouping
--
-- Adds a project_hierarchy VARCHAR(255) column to the project table for
-- logical one-level grouping of projects in Open/Save As/Delete modals.
-- Existing projects will have NULL hierarchy, displayed as "(No hierarchy)".
-- ============================================================================

-- Add project_hierarchy column (nullable VARCHAR 255)
ALTER TABLE project ADD COLUMN project_hierarchy VARCHAR(255);

-- Create index for efficient grouping queries
CREATE INDEX idx_project_hierarchy ON project(project_hierarchy);
