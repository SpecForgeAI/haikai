-- Spec: Phase 1 Evidence Schema Backbone (Increment 7)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_candidate table for storing synthesized discovery
-- candidates during Phase 1d candidate synthesis. Each candidate maps to a
-- meta-model element type and references the source clusters that contributed
-- to its synthesis.
--
-- Columns:
-- - id: UUID primary key
-- - run_id: UUID FK to discovery_run.id (ON DELETE CASCADE, NOT NULL)
-- - candidate_type: Meta-model element type (application, app_component, service, etc.)
-- - name: Proposed name for the meta-model element (NOT NULL)
-- - confidence: Confidence score (0.0 to 1.0)
-- - status: Lifecycle status for review workflow (proposed, accepted, rejected, merged)
-- - source_cluster_ids: JSONB array of UUID strings referencing discovery_cluster.id entries
-- - data: JSONB payload with proposed properties
-- - synthesized_at: Timestamp of synthesis
--
-- Indexes:
-- - Non-unique index on run_id (retrieve all candidates for a run)
-- - Composite index on (run_id, candidate_type) (filtered queries by type)
-- - Composite index on (run_id, status) (filtered queries by status)

CREATE TABLE IF NOT EXISTS discovery_candidate (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    candidate_type TEXT NOT NULL,
    name TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    source_cluster_ids JSONB NOT NULL,
    data JSONB NOT NULL,
    synthesized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_candidate_run FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE
);

-- Non-unique index on run_id for efficient retrieval of all candidates for a run
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_id
    ON discovery_candidate (run_id);

-- Composite index on (run_id, candidate_type) for filtered queries by candidate type
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_id_type
    ON discovery_candidate (run_id, candidate_type);

-- Composite index on (run_id, status) for filtered queries by status
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_run_id_status
    ON discovery_candidate (run_id, status);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_candidate IS 'Stores synthesized discovery candidates during Phase 1d candidate synthesis. Each candidate maps to a meta-model element type and references the source clusters that contributed to its synthesis. Spec: Phase 1 Evidence Schema Backbone (Increment 7).';
COMMENT ON COLUMN discovery_candidate.run_id IS 'FK to discovery_run.id. ON DELETE CASCADE ensures candidates are removed when the parent run is deleted.';
COMMENT ON COLUMN discovery_candidate.candidate_type IS 'Meta-model element type. Known values include: application, app_component, service, logical_entity, physical_entity, interface, business_process, data_entity. Extensible for future candidate types.';
COMMENT ON COLUMN discovery_candidate.name IS 'Proposed name for the meta-model element.';
COMMENT ON COLUMN discovery_candidate.confidence IS 'Confidence score for the synthesized candidate, ranging from 0.0 (low confidence) to 1.0 (high confidence).';
COMMENT ON COLUMN discovery_candidate.status IS 'Lifecycle status for review workflow. Valid values: proposed (initial state), accepted (confirmed by reviewer), rejected (dismissed by reviewer), merged (combined with another candidate). Defaults to proposed.';
COMMENT ON COLUMN discovery_candidate.source_cluster_ids IS 'JSONB array of UUID strings referencing discovery_cluster.id entries that contributed to this candidate''s synthesis.';
COMMENT ON COLUMN discovery_candidate.data IS 'JSONB payload with proposed properties: description, tech stack indicators, relationships to other candidates, evidence summary, and other candidate-specific metadata.';
COMMENT ON COLUMN discovery_candidate.synthesized_at IS 'Timestamp of when this candidate was synthesized.';
