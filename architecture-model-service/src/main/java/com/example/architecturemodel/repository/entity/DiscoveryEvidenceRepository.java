package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryEvidenceEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryEvidenceEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery evidence atoms.
 * Supports queries by run ID and optional type filtering.
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * - Task Group 1: Discovery Evidence Table and Liquibase Migration
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Orphan detection and cleanup queries
 */
@Repository
public interface DiscoveryEvidenceRepository extends JpaRepository<DiscoveryEvidenceEntity, UUID> {

    /**
     * Find all evidence atoms for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of evidence entities for the run
     */
    List<DiscoveryEvidenceEntity> findByRunId(UUID runId);

    /**
     * Find evidence atoms for a discovery run filtered by type.
     *
     * @param runId the discovery run UUID
     * @param type the evidence atom type (file_structure, symbol, string_pattern)
     * @return list of matching evidence entities
     */
    List<DiscoveryEvidenceEntity> findByRunIdAndType(UUID runId, String type);

    /**
     * Count evidence atoms for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of evidence atoms for the run
     */
    long countByRunId(UUID runId);

    /**
     * Count orphaned evidence records for a project whose run_id does not exist
     * in the discovery_run table.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @param projectId the project UUID (used to scope via run_id -> discovery_run.project_id)
     * @return count of orphaned evidence records
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_evidence e " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = e.run_id) " +
           "AND e.run_id IN (SELECT dr.id FROM discovery_run dr WHERE dr.project_id = :projectId " +
           "UNION SELECT e2.run_id FROM discovery_evidence e2 " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r2 WHERE r2.id = e2.run_id))",
           nativeQuery = true)
    long countOrphaned(@Param("projectId") UUID projectId);

    /**
     * Count orphaned evidence records whose run_id does not exist in discovery_run,
     * scoped to a project by joining through the run table for non-orphaned runs
     * or by any evidence whose run does not exist at all.
     *
     * Simplified: counts all evidence whose run_id has no matching discovery_run row.
     *
     * @return count of all orphaned evidence records (project-independent)
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_evidence e " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = e.run_id)",
           nativeQuery = true)
    long countAllOrphaned();

    /**
     * Delete orphaned evidence records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return number of deleted records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_evidence e " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = e.run_id)",
           nativeQuery = true)
    int deleteAllOrphaned();
}
