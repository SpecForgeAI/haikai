-- Spec: Phase 1 Evidence Schema Backbone (Increment 7)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_relationship table for storing inferred relationships
-- between 1a evidence atoms during Phase 1b relationship inference. Each
-- relationship links a source atom to a target atom, is scoped to a discovery
-- run, and carries a confidence score and type-specific data payload.
--
-- Columns:
-- - id: UUID primary key
-- - run_id: UUID FK to discovery_run.id (ON DELETE CASCADE, NOT NULL)
-- - source_atom_id: UUID FK to discovery_evidence.id (ON DELETE CASCADE, NOT NULL)
-- - target_atom_id: UUID FK to discovery_evidence.id (ON DELETE CASCADE, NOT NULL)
-- - relationship_type: Relationship type (imports, calls, extends, contains, uses_data, defines, references)
-- - confidence: Confidence score (0.0 to 1.0)
-- - data: Type-specific JSONB payload
-- - inferred_at: Timestamp of inference
--
-- Indexes:
-- - Non-unique index on run_id (retrieve all relationships for a run)
-- - Composite index on (run_id, relationship_type) (filtered queries by type)
-- - Non-unique index on source_atom_id (find relationships from a given atom)
-- - Non-unique index on target_atom_id (find relationships to a given atom)

CREATE TABLE IF NOT EXISTS discovery_relationship (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    source_atom_id UUID NOT NULL,
    target_atom_id UUID NOT NULL,
    relationship_type TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL,
    data JSONB NOT NULL,
    inferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_relationship_run FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE,
    CONSTRAINT fk_discovery_relationship_source_atom FOREIGN KEY (source_atom_id) REFERENCES discovery_evidence(id) ON DELETE CASCADE,
    CONSTRAINT fk_discovery_relationship_target_atom FOREIGN KEY (target_atom_id) REFERENCES discovery_evidence(id) ON DELETE CASCADE
);

-- Non-unique index on run_id for efficient retrieval of all relationships for a run
CREATE INDEX IF NOT EXISTS idx_discovery_relationship_run_id
    ON discovery_relationship (run_id);

-- Composite index on (run_id, relationship_type) for filtered queries by type
CREATE INDEX IF NOT EXISTS idx_discovery_relationship_run_id_type
    ON discovery_relationship (run_id, relationship_type);

-- Non-unique index on source_atom_id for finding relationships from a given atom
CREATE INDEX IF NOT EXISTS idx_discovery_relationship_source_atom_id
    ON discovery_relationship (source_atom_id);

-- Non-unique index on target_atom_id for finding relationships to a given atom
CREATE INDEX IF NOT EXISTS idx_discovery_relationship_target_atom_id
    ON discovery_relationship (target_atom_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_relationship IS 'Stores inferred relationships between 1a evidence atoms during Phase 1b relationship inference. Each relationship links a source atom to a target atom within a discovery run. Spec: Phase 1 Evidence Schema Backbone (Increment 7).';
COMMENT ON COLUMN discovery_relationship.run_id IS 'FK to discovery_run.id. ON DELETE CASCADE ensures relationships are removed when the parent run is deleted.';
COMMENT ON COLUMN discovery_relationship.source_atom_id IS 'FK to discovery_evidence.id. The source atom of this relationship. ON DELETE CASCADE ensures cleanup when the source atom is deleted.';
COMMENT ON COLUMN discovery_relationship.target_atom_id IS 'FK to discovery_evidence.id. The target atom of this relationship. ON DELETE CASCADE ensures cleanup when the target atom is deleted.';
COMMENT ON COLUMN discovery_relationship.relationship_type IS 'Relationship type. Known values include: imports, calls, extends, contains, uses_data, defines, references. Extensible for future relationship types.';
COMMENT ON COLUMN discovery_relationship.confidence IS 'Confidence score for the inferred relationship, ranging from 0.0 (low confidence) to 1.0 (high confidence).';
COMMENT ON COLUMN discovery_relationship.data IS 'Type-specific JSONB payload. Shape depends on relationship type (e.g., line number of import, method signature, additional context).';
COMMENT ON COLUMN discovery_relationship.inferred_at IS 'Timestamp of when this relationship was inferred.';
