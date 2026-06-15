-- ============================================================================
-- Migration 095: Enforce NOT NULL + FK + Composite Index on discovery_run.architecture_id
-- Spec: Discovery Service architectureId Integration (Spec #4)
--
-- After the backfill in changeset 094, every existing discovery_run row has
-- a non-null architecture_id pointing at the project's `Default` architecture.
-- This changeset:
--   1. Sets NOT NULL on architecture_id.
--   2. Adds the FK constraint architecture_id -> architecture(id).
--   3. Adds a composite (project_id, architecture_id) index to support the
--      architecture-scoped run-list query pattern introduced by Task Group 2
--      (`WHERE project_id = ? AND architecture_id = ?`).
--
-- Failure mode: if pre-existing data has orphans (a discovery_run row whose
-- architecture_id remained NULL after 094), the SET NOT NULL will fail with
-- a clear error. The operator must resolve the orphan before re-running.
-- The 094 precondition is the primary safety net for this; 095 is the final
-- enforcement step.
-- ============================================================================

-- STEP 1: Enforce NOT NULL.
ALTER TABLE discovery_run ALTER COLUMN architecture_id SET NOT NULL;

-- STEP 2: Add FK to architecture(id).
ALTER TABLE discovery_run
    ADD CONSTRAINT fk_discovery_run_architecture
    FOREIGN KEY (architecture_id) REFERENCES architecture(id);

-- STEP 3: Composite (project_id, architecture_id) index for the run-list
-- query pattern: SELECT * FROM discovery_run WHERE project_id = ? AND architecture_id = ?
CREATE INDEX idx_discovery_run_project_arch
    ON discovery_run (project_id, architecture_id);
