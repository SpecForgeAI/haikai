-- ============================================================================
-- Migration 048: Fix project_artifact.project_id — TEXT (name) → UUID (FK to project)
--
-- The project_artifact.project_id column was TEXT storing the project NAME instead of
-- a proper UUID foreign key to project(id). This migration:
--   1. Resolves existing project names to UUIDs (case-insensitive)
--   2. Deletes orphaned rows whose name doesn't match any project
--   3. Drops the unique constraint that includes project_id
--   4. Converts the column from TEXT to UUID
--   5. Re-creates the unique constraint
--   6. Adds a proper FK constraint with ON DELETE CASCADE
-- ============================================================================

-- Step 1: Resolve project names to UUIDs (case-insensitive match)
UPDATE project_artifact pa
SET project_id = p.id::text
FROM project p
WHERE LOWER(pa.project_id) = LOWER(p.name);

-- Step 2: Delete orphaned artifacts whose project_id doesn't match any project UUID
DELETE FROM project_artifact
WHERE project_id NOT IN (SELECT id::text FROM project);

-- Step 3: Drop unique constraint that includes project_id
ALTER TABLE project_artifact DROP CONSTRAINT IF EXISTS uq_artifact_project_type_revision;

-- Step 4: Alter column type from TEXT to UUID
ALTER TABLE project_artifact
ALTER COLUMN project_id TYPE UUID USING project_id::uuid;

-- Step 5: Re-create unique constraint with UUID column
ALTER TABLE project_artifact
ADD CONSTRAINT uq_artifact_project_type_revision UNIQUE (project_id, artifact_type, revision);

-- Step 6: Add FK constraint to project table with cascade delete
ALTER TABLE project_artifact
ADD CONSTRAINT fk_project_artifact_project
FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
