package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryCandidateEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryCandidateEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery candidates.
 * Supports queries by run ID with optional candidate type and/or status filtering.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * - Task Group 4: Candidate JPA Stack (1d)
 *
 * Extended: Phase 1d Candidate Generation (Increment 10)
 * - Task Group 6: deleteByRunId derived query method
 *
 * Extended: Discovery Results Visibility (Increment 12)
 * - Task Group 1: countByRunIdAndStatus for per-status aggregation
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Orphan detection and cleanup queries
 *
 * Extended: Discovery Summary Performance (N+1 elimination)
 * - countByRunIdGroupByStatus aggregate query to replace per-status loop
 *
 * Extended: Cascade-aware Bulk Review + Reject Suppression (Spec 2 -- 2026-06-02)
 * - Task Group 2: findByRunIdAndReviewStatusNot review_status-excluding finder
 *   so the candidate summary in MigrationDiscoveryContextService drops rejected
 *   candidates (NO schema change; keyed on the live review_status column).
 */
@Repository
public interface DiscoveryCandidateRepository extends JpaRepository<DiscoveryCandidateEntity, UUID> {

    /**
     * Find all candidates for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return list of candidate entities for the run
     */
    List<DiscoveryCandidateEntity> findByRunId(UUID runId);

    /**
     * Find candidates for a discovery run EXCLUDING a given
     * {@code review_status} value.
     *
     * <p><b>Load-bearing reject-suppression finder</b> (Spec 2, Task Group 2).
     * The variant of {@link #findByRunId} that
     * {@code MigrationDiscoveryContextService.buildCandidateSummary} calls so a
     * {@code rejected} candidate is GENUINELY ABSENT from the candidate-summary
     * counts. NOTE: the summary then tallies by candidate {@code status}
     * ({@code proposed}/{@code committed}) -- a DIFFERENT field; this finder
     * applies the reject SUPPRESSION on {@code review_status} at the load,
     * leaving the by-{@code status} tally semantics for the surviving
     * (non-rejected) rows unchanged. Keyed on the LIVE {@code review_status}
     * column -- NO schema change, NO IR mutation. {@code deferred} stays visible
     * by NOT being excluded.</p>
     *
     * @param runId        the discovery run UUID
     * @param reviewStatus the review_status value to exclude (e.g. "rejected")
     * @return non-excluded candidate entities for the run
     */
    List<DiscoveryCandidateEntity> findByRunIdAndReviewStatusNot(UUID runId, String reviewStatus);

    /**
     * Find candidates for a discovery run filtered by candidate type.
     *
     * @param runId the discovery run UUID
     * @param candidateType the candidate type (application, app_component, service, etc.)
     * @return list of matching candidate entities
     */
    List<DiscoveryCandidateEntity> findByRunIdAndCandidateType(UUID runId, String candidateType);

    /**
     * Find candidates for a discovery run filtered by status.
     *
     * @param runId the discovery run UUID
     * @param status the candidate status (proposed, accepted, rejected, merged)
     * @return list of matching candidate entities
     */
    List<DiscoveryCandidateEntity> findByRunIdAndStatus(UUID runId, String status);

    /**
     * Find candidates for a discovery run filtered by both candidate type and status.
     *
     * @param runId the discovery run UUID
     * @param candidateType the candidate type
     * @param status the candidate status
     * @return list of matching candidate entities
     */
    List<DiscoveryCandidateEntity> findByRunIdAndCandidateTypeAndStatus(UUID runId, String candidateType, String status);

    /**
     * Count candidates for a discovery run.
     *
     * @param runId the discovery run UUID
     * @return the number of candidates for the run
     */
    long countByRunId(UUID runId);

    /**
     * Count candidates for a discovery run filtered by status.
     *
     * Enables per-status candidate count aggregation for the discovery
     * summary endpoint. Spring Data JPA derives the COUNT query
     * automatically from the method name.
     *
     * Spec: Discovery Results Visibility (Increment 12)
     * Task Group 1: Per-status candidate counts for summary
     *
     * @param runId the discovery run UUID
     * @param status the candidate status (proposed, accepted, rejected, merged)
     * @return the number of candidates with the given status for the run
     */
    long countByRunIdAndStatus(UUID runId, String status);

    /**
     * Count candidates for a discovery run grouped by status in a single query.
     *
     * Returns one row per status value present in the run. Each row is an
     * {@code Object[]} of {@code [status (String), count (Long)]}. Used by
     * the discovery summary endpoint to avoid four separate count queries
     * (one per known status).
     *
     * Callers are responsible for filtering out unexpected status values.
     *
     * Spec: Discovery Summary Performance (N+1 elimination)
     *
     * @param runId the discovery run UUID
     * @return list of [status, count] rows
     */
    @Query("SELECT c.status, COUNT(c) FROM DiscoveryCandidateEntity c " +
           "WHERE c.runId = :runId GROUP BY c.status")
    List<Object[]> countByRunIdGroupByStatus(@Param("runId") UUID runId);

    /**
     * Delete all candidates for a discovery run using a native bulk DELETE.
     *
     * Uses a native SQL query to avoid Hibernate's entity-by-entity deletion.
     * The parent_candidate_id self-referencing FK uses ON DELETE SET NULL,
     * so the DB handles parent-child ordering automatically.
     *
     * Spec: Phase 1d Candidate Generation (Increment 10)
     * - Task Group 6: deleteByRunId for Candidate JPA Stack
     *
     * @param runId the discovery run UUID
     * @return number of deleted candidate records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_candidate WHERE run_id = :runId", nativeQuery = true)
    int deleteByRunIdNative(UUID runId);

    /**
     * Count orphaned candidate records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return count of all orphaned candidate records
     */
    @Query(value = "SELECT COUNT(*) FROM discovery_candidate c " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = c.run_id)",
           nativeQuery = true)
    long countAllOrphaned();

    /**
     * Delete orphaned candidate records whose run_id does not exist in discovery_run.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @return number of deleted records
     */
    @Modifying
    @Query(value = "DELETE FROM discovery_candidate c " +
           "WHERE NOT EXISTS (SELECT 1 FROM discovery_run r WHERE r.id = c.run_id)",
           nativeQuery = true)
    int deleteAllOrphaned();
}
