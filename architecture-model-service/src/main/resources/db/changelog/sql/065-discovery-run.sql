-- Spec: Discovery Run Model and Orchestration (Increment 5)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_run table for tracking Phase 1 execution runs.
-- Multiple historical runs per project are supported; only one active run
-- (PENDING or RUNNING) at a time, enforced at the service layer.
--
-- Columns:
-- - id: UUID primary key (server-generated)
-- - project_id: Project UUID (FK to project, NOT NULL, ON DELETE CASCADE)
-- - status: Run lifecycle status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED)
-- - current_step: The step currently being executed (e.g. 1a, 1b, 1c, 1d)
-- - config_snapshot: Immutable snapshot of Phase 0 discovery config at run creation
-- - steps_payload: Per-step status tracking as JSONB
-- - error_message: Error details if the run failed
-- - created_at: Timestamp of creation (immutable)
-- - updated_at: Timestamp of last update
--
-- Indexes:
-- - Non-unique index on project_id (multiple historical runs per project)

CREATE TABLE IF NOT EXISTS discovery_run (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    current_step TEXT,
    config_snapshot JSONB NOT NULL,
    steps_payload JSONB NOT NULL DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_run_project FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

-- Non-unique index on project_id for query performance (multiple historical runs per project)
CREATE INDEX IF NOT EXISTS idx_discovery_run_project_id
    ON discovery_run (project_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_run IS 'Tracks Phase 1 discovery execution runs with per-step status tracking. Multiple historical runs per project supported; active-run constraint (one PENDING/RUNNING at a time) enforced at service layer. Spec: Discovery Run Model and Orchestration (Increment 5).';
COMMENT ON COLUMN discovery_run.config_snapshot IS 'Immutable snapshot of the Phase 0 discovery config JSON captured at run creation time for reproducibility.';
COMMENT ON COLUMN discovery_run.steps_payload IS 'Per-step status tracking as JSONB. Structure: { "1a": { "status": "pending" }, "1b": { "status": "pending" }, "1c": { "status": "pending" }, "1d": { "status": "pending" } }.';
COMMENT ON COLUMN discovery_run.status IS 'Run lifecycle status. Valid values: PENDING (created, not started), RUNNING (actively executing), COMPLETED (all steps done), FAILED (a step failed), CANCELLED (aborted).';
