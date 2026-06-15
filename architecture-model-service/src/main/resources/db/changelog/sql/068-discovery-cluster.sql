-- Spec: Phase 1 Evidence Schema Backbone (Increment 7)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_cluster table for storing formed clusters that group
-- atoms and relationships during Phase 1c cluster formation. Each cluster
-- represents a coherent grouping (e.g., service boundary, data domain) within
-- a discovery run.
--
-- Columns:
-- - id: UUID primary key
-- - run_id: UUID FK to discovery_run.id (ON DELETE CASCADE, NOT NULL)
-- - cluster_type: Cluster type (service_boundary, data_domain, shared_library, api_layer, ui_module)
-- - name: Optional human-readable label (nullable)
-- - confidence: Confidence score (0.0 to 1.0)
-- - data: Metadata JSONB payload
-- - formed_at: Timestamp of cluster formation
--
-- Indexes:
-- - Non-unique index on run_id (retrieve all clusters for a run)
-- - Composite index on (run_id, cluster_type) (filtered queries by type)

CREATE TABLE IF NOT EXISTS discovery_cluster (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL,
    cluster_type TEXT NOT NULL,
    name TEXT,
    confidence DOUBLE PRECISION NOT NULL,
    data JSONB NOT NULL,
    formed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_discovery_cluster_run FOREIGN KEY (run_id) REFERENCES discovery_run(id) ON DELETE CASCADE
);

-- Non-unique index on run_id for efficient retrieval of all clusters for a run
CREATE INDEX IF NOT EXISTS idx_discovery_cluster_run_id
    ON discovery_cluster (run_id);

-- Composite index on (run_id, cluster_type) for filtered queries by cluster type
CREATE INDEX IF NOT EXISTS idx_discovery_cluster_run_id_type
    ON discovery_cluster (run_id, cluster_type);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_cluster IS 'Stores formed clusters that group atoms and relationships during Phase 1c cluster formation. Each cluster represents a coherent grouping within a discovery run. Spec: Phase 1 Evidence Schema Backbone (Increment 7).';
COMMENT ON COLUMN discovery_cluster.run_id IS 'FK to discovery_run.id. ON DELETE CASCADE ensures clusters are removed when the parent run is deleted.';
COMMENT ON COLUMN discovery_cluster.cluster_type IS 'Cluster type. Known values include: service_boundary, data_domain, shared_library, api_layer, ui_module. Extensible for future cluster types.';
COMMENT ON COLUMN discovery_cluster.name IS 'Optional human-readable label for the cluster. May be null if no meaningful name has been assigned.';
COMMENT ON COLUMN discovery_cluster.confidence IS 'Confidence score for the formed cluster, ranging from 0.0 (low confidence) to 1.0 (high confidence).';
COMMENT ON COLUMN discovery_cluster.data IS 'Metadata JSONB payload. May include dominant language, directory root, member summary counts, and other cluster-specific properties.';
COMMENT ON COLUMN discovery_cluster.formed_at IS 'Timestamp of when this cluster was formed.';
