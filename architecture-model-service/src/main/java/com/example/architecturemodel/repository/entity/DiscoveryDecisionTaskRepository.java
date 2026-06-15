package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryDecisionTaskEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryDecisionTaskEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery decision tasks.
 * Supports queries by run ID with optional status and/or task type filtering.
 *
 * Spec: Phase 1b Linker and DecisionTask Engine (Increment 8)
 * - Task Group 5: Liquibase Migration and JPA Entity Stack
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Orphan detection and cleanup queries
 */
@Repository
public interface DiscoveryDecisionTaskRepository extends JpaRepository<DiscoveryDecisionTaskEntity, UUID> {

    /**
     * Find all decision tasks for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of decision task entities for the run
     */
    List<DiscoveryDecisionTaskEntity> findByRunId(UUID runId);

    /**
     * Find decision tasks for a discovery run filtered by status.
     *
     * @param runId the discovery run UUID
     * @param status the task status (pending, resolved, failed)
     * @return list of matching decision task entities
     */
    List<DiscoveryDecisionTaskEntity> findByRunIdAndStatus(UUID runId, String status);

    /**
     * Find decision tasks for a discovery run filtered by task type.
     *
     * @param runId the discovery run UUID
     * @param taskType the task type (confirm_relationship, resolve_competing_relationships)
     * @return list of matching decision task entities
     */
    List<DiscoveryDecisionTaskEntity> findByRunIdAndTaskType(UUID runId, String taskType);

    /**
     * Count decision tasks for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of decision tasks for the run
     */
    long countByRunId(UUID runId);

    /**
     * Count decision tasks for a discovery run filtered by status.
     *
     * @param runId the discovery run UUID
     * @param status the task status (pending, resolved, failed)
     * @return the number of matching decision tasks
     */
    long countByRunIdAndStatus(UUID runId, String status);

    /**
     * Count orphaned decision task records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return count of all orphaned decision task records
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_decision_task dt " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = dt.run_id)",
           nativeQuery = true)
    long countAllOrphaned();

    /**
     * Delete orphaned decision task records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return number of deleted records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_decision_task dt " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = dt.run_id)",
           nativeQuery = true)
    int deleteAllOrphaned();
}
