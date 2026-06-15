-- ============================================================================
-- Migration 049: Fix work_item_implement_context.project_id — TEXT (name) → UUID (FK to project)
--
-- The work_item_implement_context.project_id column was TEXT storing the project NAME
-- instead of a proper UUID foreign key to project(id). This migration:
--   1. Resolves existing project names to UUIDs (case-insensitive)
--   2. Deletes orphaned rows whose name doesn't match any project
--   3. Drops the unique constraint that includes project_id
--   4. Converts the column from TEXT to UUID
--   5. Re-creates the unique constraint
--   6. Adds a proper FK constraint with ON DELETE CASCADE
-- ============================================================================

-- Step 1: Resolve project names to UUIDs (case-insensitive match)
UPDATE work_item_implement_context ctx
SET project_id = p.id::text
FROM project p
WHERE LOWER(ctx.project_id) = LOWER(p.name);

-- Step 2: Delete orphaned contexts whose project_id doesn't match any project UUID
DELETE FROM work_item_implement_context
WHERE project_id NOT IN (SELECT id::text FROM project);

-- Step 3: Drop unique constraint that includes project_id
ALTER TABLE work_item_implement_context DROP CONSTRAINT IF EXISTS uq_work_item_implement_context;

-- Step 4: Alter column type from TEXT to UUID
ALTER TABLE work_item_implement_context
ALTER COLUMN project_id TYPE UUID USING project_id::uuid;

-- Step 5: Re-create unique constraint with UUID column
ALTER TABLE work_item_implement_context
ADD CONSTRAINT uq_work_item_implement_context UNIQUE (project_id, work_item_id);

-- Step 6: Add FK constraint to project table with cascade delete
ALTER TABLE work_item_implement_context
ADD CONSTRAINT fk_implement_context_project
FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE;
