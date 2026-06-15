-- Spec 2026-01-23: Persist + Rehydrate Implement Workspace
-- Task Group 1: Database Entity and Repository
--
-- Creates the work_item_implement_workspace table for storing full workspace state
-- as an atomic JSONB snapshot per work item.
--
-- Columns:
-- - id: UUID primary key
-- - project_id: Project identifier (not null)
-- - work_item_id: Work item UUID (not null)
-- - workspace_state: JSONB column for atomic workspace snapshot
-- - created_at: Timestamp of creation (immutable)
-- - updated_at: Timestamp of last update
--
-- Indexes:
-- - Unique composite index on (project_id, work_item_id) for upsert support
-- - Index on project_id for query performance

CREATE TABLE IF NOT EXISTS work_item_implement_workspace (
    id UUID PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL,
    work_item_id UUID NOT NULL,
    workspace_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique composite index for upsert by project_id + work_item_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_project_work_item
    ON work_item_implement_workspace (project_id, work_item_id);

-- Index on project_id for efficient project-level queries
CREATE INDEX IF NOT EXISTS idx_workspace_project_id
    ON work_item_implement_workspace (project_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE work_item_implement_workspace IS 'Stores atomic JSONB snapshots of implement workspace state per work item. Spec 2026-01-23: Persist + Rehydrate Implement Workspace.';
COMMENT ON COLUMN work_item_implement_workspace.workspace_state IS 'Full workspace state including schemaVersion, implementationMode, plannerPayload, activeIncrementId, questions, executionArtifactsByIncrement, teamChatTranscript.';
