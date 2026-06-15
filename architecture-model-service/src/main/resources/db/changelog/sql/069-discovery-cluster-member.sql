-- Spec: Phase 1 Evidence Schema Backbone (Increment 7)
-- Task Group 1: Liquibase Migration
--
-- Creates the discovery_cluster_member join table for tracking cluster
-- membership during Phase 1c cluster formation. Each member entry links a
-- cluster to either an atom (discovery_evidence) or a relationship
-- (discovery_relationship) via a polymorphic reference pattern.
--
-- Columns:
-- - id: UUID primary key
-- - cluster_id: UUID FK to discovery_cluster.id (ON DELETE CASCADE, NOT NULL)
-- - member_type: Discriminator for the target table ('atom' or 'relationship')
-- - member_id: UUID reference to the member entity (NOT NULL, no FK constraint)
--
-- Note: No FK constraint on member_id because the target table varies by
-- member_type (discovery_evidence when 'atom', discovery_relationship when
-- 'relationship'). Referential integrity for member_id is enforced at the
-- application layer.
--
-- Constraints:
-- - Unique constraint on (cluster_id, member_type, member_id) to prevent duplicates
--
-- Indexes:
-- - Non-unique index on cluster_id (retrieve all members for a cluster)
-- - Composite index on (cluster_id, member_type) (filtered queries by member type)
-- - Non-unique index on member_id (find all clusters containing a given member)

CREATE TABLE IF NOT EXISTS discovery_cluster_member (
    id UUID PRIMARY KEY,
    cluster_id UUID NOT NULL,
    member_type TEXT NOT NULL,
    member_id UUID NOT NULL,
    CONSTRAINT fk_discovery_cluster_member_cluster FOREIGN KEY (cluster_id) REFERENCES discovery_cluster(id) ON DELETE CASCADE,
    CONSTRAINT uq_discovery_cluster_member UNIQUE (cluster_id, member_type, member_id)
);

-- Non-unique index on cluster_id for efficient retrieval of all members for a cluster
CREATE INDEX IF NOT EXISTS idx_discovery_cluster_member_cluster_id
    ON discovery_cluster_member (cluster_id);

-- Composite index on (cluster_id, member_type) for filtered queries by member type
CREATE INDEX IF NOT EXISTS idx_discovery_cluster_member_cluster_id_type
    ON discovery_cluster_member (cluster_id, member_type);

-- Non-unique index on member_id for finding all clusters containing a given member
CREATE INDEX IF NOT EXISTS idx_discovery_cluster_member_member_id
    ON discovery_cluster_member (member_id);

-- Comment on table and columns for documentation
COMMENT ON TABLE discovery_cluster_member IS 'Join table for cluster membership during Phase 1c cluster formation. Links clusters to atoms or relationships via a polymorphic reference pattern. Referential integrity for member_id is enforced at the application layer. Spec: Phase 1 Evidence Schema Backbone (Increment 7).';
COMMENT ON COLUMN discovery_cluster_member.cluster_id IS 'FK to discovery_cluster.id. ON DELETE CASCADE ensures members are removed when the parent cluster is deleted.';
COMMENT ON COLUMN discovery_cluster_member.member_type IS 'Discriminator for the target table. Valid values: atom (references discovery_evidence.id), relationship (references discovery_relationship.id).';
COMMENT ON COLUMN discovery_cluster_member.member_id IS 'UUID reference to the member entity. No FK constraint because the target table varies by member_type. Referential integrity is enforced at the application layer.';
