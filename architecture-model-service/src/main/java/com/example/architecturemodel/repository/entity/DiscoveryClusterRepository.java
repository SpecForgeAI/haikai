package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryClusterEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryClusterEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery clusters.
 * Supports queries by run ID and optional cluster type filtering.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 3: Cluster + ClusterMember JPA Stack (1c)
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Orphan detection and cleanup queries
 */
@Repository
public interface DiscoveryClusterRepository extends JpaRepository<DiscoveryClusterEntity, UUID> {

    /**
     * Find all clusters for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of cluster entities for the run (each with members eagerly loaded)
     */
    List<DiscoveryClusterEntity> findByRunId(UUID runId);

    /**
     * Find clusters for a discovery run filtered by cluster type.
     *
     * @param runId the discovery run UUID
     * @param clusterType the cluster type (service_boundary, data_domain, shared_library, api_layer, ui_module)
     * @return list of matching cluster entities
     */
    List<DiscoveryClusterEntity> findByRunIdAndClusterType(UUID runId, String clusterType);

    /**
     * Count clusters for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of clusters for the run
     */
    long countByRunId(UUID runId);

    /**
     * Delete all clusters for a discovery run using a native bulk DELETE.
     *
     * Uses a native SQL query to avoid Hibernate's entity-by-entity cascade
     * deletion, which can fail with large datasets. The database FK constraint
     * (ON DELETE CASCADE) on discovery_cluster_member handles member cleanup.
     *
     * Spec: Phase 1c Clustering and Cluster Adjudication (Increment 9)
     * - Task Group 6: deleteByRunId for Cluster JPA Stack
     *
     * @param runId the discovery run UUID
     * @return number of deleted cluster records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_cluster WHERE run_id = :runId", nativeQuery = true)
    int deleteByRunIdNative(UUID runId);

    /**
     * Count orphaned cluster records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return count of all orphaned cluster records
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_cluster cl " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = cl.run_id)",
           nativeQuery = true)
    long countAllOrphaned();

    /**
     * Delete orphaned cluster records whose run_id does not exist in discovery_run.
     * Cascade delete of members is handled by the FK constraint at the DB level.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return number of deleted records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_cluster cl " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = cl.run_id)",
           nativeQuery = true)
    int deleteAllOrphaned();
}
