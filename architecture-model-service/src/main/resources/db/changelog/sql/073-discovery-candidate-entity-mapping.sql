-- Spec: Candidate Save-Back to Canonical Model (Increment 11)
-- Task Group 1: Liquibase Migration for discovery_candidate_entity_mapping
--
-- Creates the discovery_candidate_entity_mapping table for tracking provenance
-- between discovery candidates and the canonical meta-model entities they produce.
-- Each row records which candidate was mapped to which entity during a save-back
-- operation, whether the entity was newly created or reused (matched by name).
--
-- This enables richer querying and traceability of which discovery run and
-- candidate produced each entity in the canonical model.

-- Create the provenance mapping table
CREATE TABLE IF NOT EXISTS discovery_candidate_entity_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL,
    run_id UUID NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_candidate_entity_mapping_candidate
        FOREIGN KEY (candidate_id) REFERENCES discovery_candidate(id) ON DELETE CASCADE
);

-- Index on run_id for efficient queries by save-back run
CREATE INDEX IF NOT EXISTS idx_candidate_entity_mapping_run_id
    ON discovery_candidate_entity_mapping (run_id);

-- Index on candidate_id for efficient lookups by candidate
CREATE INDEX IF NOT EXISTS idx_candidate_entity_mapping_candidate_id
    ON discovery_candidate_entity_mapping (candidate_id);

-- Column documentation
COMMENT ON COLUMN discovery_candidate_entity_mapping.id IS 'Primary key UUID, auto-generated.';
COMMENT ON COLUMN discovery_candidate_entity_mapping.candidate_id IS 'FK to discovery_candidate(id). The candidate that produced or matched this entity. ON DELETE CASCADE removes mappings when the candidate is deleted.';
COMMENT ON COLUMN discovery_candidate_entity_mapping.run_id IS 'Discovery run UUID that this mapping was created during. Denormalized from the candidate for efficient querying by run.';
COMMENT ON COLUMN discovery_candidate_entity_mapping.entity_type IS 'The model array key for the target entity type (e.g., applications, services, app_components, interfaces, logical_data_entities, physical_data_entities, business_processes).';
COMMENT ON COLUMN discovery_candidate_entity_mapping.entity_id IS 'The generated or matched entity ID string in the canonical model (e.g., svc-mk8r1ccg-bd7tv).';
COMMENT ON COLUMN discovery_candidate_entity_mapping.action IS 'Whether the entity was newly created or reused (matched an existing entity by name). Values: created, reused.';
COMMENT ON COLUMN discovery_candidate_entity_mapping.created_at IS 'Timestamp when this mapping was recorded. Defaults to now().';
