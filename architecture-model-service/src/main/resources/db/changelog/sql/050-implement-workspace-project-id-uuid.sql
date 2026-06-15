-- ============================================================================
-- Migration 050: Fix work_item_implement_workspace.project_id — VARCHAR(255) (name) → UUID (FK to project)
--
-- The work_item_implement_workspace.project_id column was VARCHAR(255) storing the
-- project NAME instead of a proper UUID foreign key to project(id). This migration:
--   1. Resolves existing project names to UUIDs (case-insensitive)
--   2. Deletes orphaned rows whose name doesn't match any project
--   3. Drops the unique index that includes project_id
--   4. Converts the column from VARCHAR(255) to UUID
--   5. Re-creates the unique index
--   6. Adds a proper FK constraint with ON DELETE CASCADE
-- ============================================================================

-- Step 1: Resolve project names to UUIDs (case-insensitive match)
UPDATE work_item_implement_workspace ws
SET project_id = p.id::text
FROM project p
WHERE LOWER(ws.project_id) = LOWER(p.name);

-- Step 2: Delete orphaned workspaces whose project_id doesn't match any project UUID
DELETE FROM work_item_implement_workspace
WHERE project_id NOT IN (SELECT id::text FROM project);

-- Step 3: Drop unique index that includes project_id
DROP INDEX IF EXISTS idx_workspace_project_work_item;

-- Step 4: Alter column type from VARCHAR(255) to UUID
ALTER TABLE work_item_implement_workspace
ALTER COLUMN project_id TYPE UUID USING project_id::uuid;

-- Step 5: Re-create unique index with UUID column
CREATE UNIQUE INDEX idx_workspace_project_work_item ON work_item_implement_workspace(project_id, work_item_id);

-- Step 6: Add FK constraint to project table with cascade delete
ALTER TABLE work_item_implement_workspace
ADD CONSTRAINT fk_implement_workspace_project
FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
