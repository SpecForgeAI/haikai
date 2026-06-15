-- ============================================================================
-- Migration 051: Add project_id UUID column to model_files
--
-- Adds a nullable UUID project_id column to model_files to link model files
-- to projects. This enables looking up model files by project UUID instead
-- of relying on filename matching.
--
-- project_id is NULLABLE (model files can exist without a project in file-mode).
-- ON DELETE SET NULL (don't destroy model data when project is deleted).
-- ============================================================================

-- Step 1: Add nullable project_id column
ALTER TABLE model_files ADD COLUMN project_id UUID;

-- Step 2: Backfill from project table (case-insensitive filename match)
UPDATE model_files mf
SET project_id = p.id
FROM project p
WHERE LOWER(mf.filename) = LOWER(p.name);

-- Step 3: Add FK constraint with ON DELETE SET NULL
ALTER TABLE model_files
ADD CONSTRAINT fk_model_files_project
FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE SET NULL;

-- Step 4: Add index for efficient lookup by project_id
CREATE INDEX idx_model_files_project_id ON model_files(project_id);
