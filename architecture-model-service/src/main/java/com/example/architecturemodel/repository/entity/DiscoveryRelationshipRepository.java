package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryRelationshipEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryRelationshipEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery relationships.
 * Supports queries by run ID and optional relationship type filtering.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 2: Relationship JPA Stack (1b)
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Orphan detection and cleanup queries
 */
@Repository
public interface DiscoveryRelationshipRepository extends JpaRepository<DiscoveryRelationshipEntity, UUID> {

    /**
     * Find all relationships for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of relationship entities for the run
     */
    List<DiscoveryRelationshipEntity> findByRunId(UUID runId);

    /**
     * Find relationships for a discovery run filtered by relationship type.
     *
     * @param runId the discovery run UUID
     * @param relationshipType the relationship type (imports, calls, extends, etc.)
     * @return list of matching relationship entities
     */
    List<DiscoveryRelationshipEntity> findByRunIdAndRelationshipType(UUID runId, String relationshipType);

    /**
     * Count relationships for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of relationships for the run
     */
    long countByRunId(UUID runId);

    /**
     * Count orphaned relationship records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return count of all orphaned relationship records
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_relationship rel " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = rel.run_id)",
           nativeQuery = true)
    long countAllOrphaned();

    /**
     * Delete orphaned relationship records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return number of deleted records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_relationship rel " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = rel.run_id)",
           nativeQuery = true)
    int deleteAllOrphaned();
}
