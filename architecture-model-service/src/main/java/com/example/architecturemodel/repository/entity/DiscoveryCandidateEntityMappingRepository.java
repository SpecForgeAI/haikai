package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryCandidateEntityMappingEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryCandidateEntityMappingEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery candidate
 * entity mappings (provenance tracking). Supports queries by run ID for
 * listing all mappings created during a save-back operation, and cross-run
 * queries for project-level provenance lookups.
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Task Group 2: JPA Entity, DTO, Repository, Service, and Controller
 *
 * Extended: Discovery Results Visibility (Increment 12)
 * Task Group 1: findByRunIdIn for cross-project entity origin queries
 *
 * Extended: Discovery Summary Performance (N+1 elimination)
 * Aggregate count queries to avoid materializing mapping rows in-memory.
 */
@Repository
public interface DiscoveryCandidateEntityMappingRepository
        extends JpaRepository<DiscoveryCandidateEntityMappingEntity, UUID> {

    /**
     * Find all mappings for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of mapping entities for the run
     */
    List<DiscoveryCandidateEntityMappingEntity> findByRunId(UUID runId);

    /**
     * Count mappings for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of mappings for the run
     */
    long countByRunId(UUID runId);

    /**
     * Find all mappings across multiple discovery runs.
     *
     * Enables fetching all entity mappings for a project in one query by
     * providing all run IDs for that project. Used for the project-scoped
     * discovery summary and entity-origins endpoints.
     *
     * Spec: Discovery Results Visibility (Increment 12)
     * Task Group 1: Cross-project entity mapping query
     *
     * @param runIds collection of discovery run UUIDs
     * @return list of mapping entities across the specified runs
     */
    List<DiscoveryCandidateEntityMappingEntity> findByRunIdIn(Collection<UUID> runIds);

    /**
     * Count mappings across multiple discovery runs in a single aggregate query.
     *
     * Replaces in-memory materialization of all mapping rows just to take
     * {@code .size()}. Callers must pre-check that {@code runIds} is non-empty
     * to avoid provider-specific IN-clause behavior on empty collections.
     *
     * Spec: Discovery Summary Performance (N+1 elimination)
     *
     * @param runIds collection of discovery run UUIDs (must be non-empty)
     * @return total mapping count across the supplied runs
     */
    @Query("SELECT COUNT(m) FROM DiscoveryCandidateEntityMappingEntity m " +
           "WHERE m.runId IN :runIds")
    long countByRunIds(@Param("runIds") Collection<UUID> runIds);

    /**
     * Count distinct entity types across multiple discovery runs.
     *
     * Replaces in-memory stream/distinct counting for entity type coverage.
     * Callers must pre-check that {@code runIds} is non-empty.
     *
     * Spec: Discovery Summary Performance (N+1 elimination)
     *
     * @param runIds collection of discovery run UUIDs (must be non-empty)
     * @return number of distinct {@code entityType} values across the supplied runs
     */
    @Query("SELECT COUNT(DISTINCT m.entityType) FROM DiscoveryCandidateEntityMappingEntity m " +
           "WHERE m.runId IN :runIds")
    long countDistinctEntityTypesByRunIds(@Param("runIds") Collection<UUID> runIds);
}
