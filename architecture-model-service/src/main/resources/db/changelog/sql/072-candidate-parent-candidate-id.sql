-- Spec: Phase 1d Candidate Generation (Increment 10)
-- Task Group 6: Liquibase Migration, JPA Entity/DTO Update, and deleteByRunId
--
-- Adds parent_candidate_id column to discovery_candidate table for self-referencing
-- parent-child hierarchy between candidates. This enables candidates to declare
-- a parent candidate (e.g., a service candidate parented under an application candidate)
-- during Phase 1d candidate generation.
--
-- The column is nullable (top-level candidates have no parent) and uses
-- ON DELETE SET NULL so that deleting a parent candidate does not cascade-delete
-- its children but instead orphans them.
--
-- Also adds a composite index on (run_id, parent_candidate_id) for efficient
-- retrieval of candidates by run with parent filtering.

-- Add nullable parent_candidate_id column
ALTER TABLE discovery_candidate ADD COLUMN IF NOT EXISTS parent_candidate_id UUID;

-- Add self-referencing FK with ON DELETE SET NULL
ALTER TABLE discovery_candidate
    ADD CONSTRAINT fk_discovery_candidate_parent
    FOREIGN KEY (parent_candidate_id) REFERENCES discovery_candidate(id) ON DELETE SET NULL;

-- Composite index on (run_id, parent_candidate_id) for efficient queries
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_parent
    ON discovery_candidate (run_id, parent_candidate_id);

-- Column documentation
COMMENT ON COLUMN discovery_candidate.parent_candidate_id IS 'Optional self-referencing FK to discovery_candidate(id). Enables parent-child hierarchy between candidates (e.g., service under application). ON DELETE SET NULL orphans children when parent is deleted. Nullable for top-level candidates.';
