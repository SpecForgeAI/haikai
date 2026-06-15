-- Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
-- Task Group 5: Liquibase Migration and JPA Entity Stack
--
-- Creates the discovery_decision_task table for storing DecisionTask records
-- produced during Phase 1b relationship inference triage. DecisionTasks are
-- created when deterministic linker rules produce ambiguous or competing
-- candidate relationships that require LLM resolution.
--
-- Columns:
-- - id: UUID primary key
-- - run_id: UUID FK to discovery_run.id (ON DELETE CASCADE, NOT NULL)
-- - task_type: Task type (confirm_relationship, resolve_competing_relationships)
-- - status: Lifecycle status (pending, resolved, failed)
-- - input_data: JSONB payload with source/target atom data and candidate context
-- - output_data: JSONB payload with LLM decision and reasoning (nullable)
-- - created_at: Timestamp of task creation
-- - resolved_at: Timestamp of resolution (nullable)
--
-- Indexes:
-- - Non-unique index on run_id (retrieve all tasks for a run)
-- - Composite index on (run_id, status) (filtered queries by status)
-- - Composite index on (run_id, task_type) (filtered queries by task type)

CREATE TABLE IF NOT EXISTS discovery_decision_task (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input_data JSONB NOT NULL,
    output_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT fk_discovery_decision_task_run FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE
);

-- Non-unique index on run_id for efficient retrieval of all decision tasks for a run
CREATE INDEX IF NOT EXISTS idx_discovery_decision_task_run_id
    ON discovery_decision_task (run_id);

-- Composite index on (run_id, status) for filtered queries by status
CREATE INDEX IF NOT EXISTS idx_discovery_decision_task_run_id_status
    ON discovery_decision_task (run_id, status);

-- Composite index on (run_id, task_type) for filtered queries by task type
CREATE INDEX IF NOT EXISTS idx_discovery_decision_task_run_id_task_type
    ON discovery_decision_task (run_id, task_type);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_decision_task IS 'Stores DecisionTask records produced during Phase 1b relationship inference triage. DecisionTasks are created when deterministic linker rules produce ambiguous or competing candidate relationships that require LLM resolution. Spec: Phase 1b Linker and DecisionTask Engine (Increment 8).';
COMMENT ON COLUMN discovery_decision_task.run_id IS 'FK to discovery_run.id. ON DELETE CASCADE ensures decision tasks are removed when the parent run is deleted.';
COMMENT ON COLUMN discovery_decision_task.task_type IS 'Task type. Valid values: confirm_relationship (single ambiguous candidate), resolve_competing_relationships (multiple competing candidates for same source).';
COMMENT ON COLUMN discovery_decision_task.status IS 'Lifecycle status. Valid values: pending (awaiting LLM resolution), resolved (LLM decision received), failed (LLM call failed). Defaults to pending.';
COMMENT ON COLUMN discovery_decision_task.input_data IS 'JSONB payload with full source/target atom data and candidate context for LLM resolution. Shape depends on task_type.';
COMMENT ON COLUMN discovery_decision_task.output_data IS 'JSONB payload with LLM decision and reasoning. Nullable; populated when status transitions to resolved or failed.';
COMMENT ON COLUMN discovery_decision_task.created_at IS 'Timestamp of when this decision task was created.';
COMMENT ON COLUMN discovery_decision_task.resolved_at IS 'Timestamp of when this decision task was resolved or failed. Nullable; set when status transitions from pending.';
