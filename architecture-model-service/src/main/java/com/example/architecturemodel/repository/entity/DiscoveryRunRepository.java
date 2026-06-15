package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.DiscoveryRunEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for DiscoveryRunEntity.
 *
 * Provides CRUD operations and custom finder methods for discovery runs.
 * Supports multiple historical runs per project with various query methods.
 *
 * Spec: Discovery Run Model and Orchestration (Increment 5)
 * - Task Group 2: Entity, DTO, Repository, Service, Controller
 *
 * Extended: Discovery Refinement (Increment 16)
 * - Task Group 4: Stale run detection and cleanup queries
 *
 * Extended: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * - Adds (project_id, architecture_id)-scoped finder for the URL-filtered run
 *   list (safety property (c)). Backed by the composite index added in
 *   changeset 095.
 */
@Repository
public interface DiscoveryRunRepository extends JpaRepository<DiscoveryRunEntity, UUID> {

    /**
     * Find all discovery runs for a project.
     *
     * @param projectId the project UUID
     * @return list of discovery run entities for the project
     */
    List<DiscoveryRunEntity> findByProjectId(UUID projectId);

    /**
     * Find discovery runs for a project with any of the given statuses.
     * Used to check for active runs (PENDING or RUNNING).
     *
     * @param projectId the project UUID
     * @param statuses the collection of statuses to match
     * @return list of matching discovery run entities
     */
    List<DiscoveryRunEntity> findByProjectIdAndStatusIn(UUID projectId, Collection<String> statuses);

    /**
     * Find all discovery runs for a project, ordered by creation time descending.
     *
     * @param projectId the project UUID
     * @return list of discovery run entities ordered by createdAt descending
     */
    List<DiscoveryRunEntity> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /**
     * Find all discovery runs for a (project, architecture) pair, ordered by
     * creation time descending. Implements the URL-filtered run list pattern
     * from spec #4: cross-architecture runs are excluded.
     *
     * Backed by the composite index {@code idx_discovery_run_project_arch}
     * added in changeset 095.
     *
     * Spec: Discovery Service architectureId Integration (Spec #4)
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID to filter by
     * @return list of discovery run entities for the pair, newest first
     */
    List<DiscoveryRunEntity> findByProjectIdAndArchitectureIdOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId);

    /**
     * Find all discovery runs for a (project, architecture) pair filtered by
     * the run's source kind ('code' | 'database' | 'combined'), ordered by
     * creation time descending. Used by the unified Discovery Runs list when
     * the UI filters by kind via the GET ?discovery_kind=... query parameter.
     *
     * Spec: Database Discovery Packs (Sybase + PostgreSQL) (2026-05-16) --
     * Task Group 1.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID to filter by
     * @param discoveryKind the run kind to filter by ('code' | 'database' | 'combined')
     * @return list of discovery run entities matching all three filters, newest first
     */
    List<DiscoveryRunEntity> findByProjectIdAndArchitectureIdAndDiscoveryKindOrderByCreatedAtDesc(
        UUID projectId, UUID architectureId, String discoveryKind);

    /**
     * Find a discovery run by its ID.
     * (Inherited from JpaRepository but declared explicitly for clarity.)
     *
     * @param id the run UUID
     * @return the discovery run entity if found, empty Optional otherwise
     */
    Optional<DiscoveryRunEntity> findById(UUID id);

    /**
     * Count stale FAILED or CANCELLED runs for a project that were last updated
     * before the given cutoff timestamp.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @param projectId the project UUID
     * @param statuses the statuses to consider stale (FAILED, CANCELLED)
     * @param cutoff the timestamp before which runs are considered stale
     * @return count of stale runs
     */
    long countByProjectIdAndStatusInAndUpdatedAtBefore(UUID projectId, Collection<String> statuses, Instant cutoff);

    /**
     * Find stale FAILED or CANCELLED runs for a project that were last updated
     * before the given cutoff timestamp.
     *
     * Spec: Discovery Refinement (Increment 16) - Task Group 4
     *
     * @param projectId the project UUID
     * @param statuses the statuses to consider stale (FAILED, CANCELLED)
     * @param cutoff the timestamp before which runs are considered stale
     * @return list of stale run entities
     */
    List<DiscoveryRunEntity> findByProjectIdAndStatusInAndUpdatedAtBefore(
        UUID projectId, Collection<String> statuses, Instant cutoff);

    /**
     * Find (runId, serviceId) snapshot for every run whose {@code service_id}
     * is in the given set. Used by {@code ModelService.saveModelInternal} to
     * capture the pre-delete service-FK pairs so they can be restored after
     * the services delete-and-re-insert cycle (which otherwise nulls them via
     * the {@code ON DELETE SET NULL} action from changeset 126).
     *
     * Hotfix companion to changeset 126.
     *
     * @param serviceIds the candidate service identifiers to match against
     * @return one Object[]{runId(UUID), serviceId(String)} per matching run
     */
    @Query("SELECT dr.id, dr.serviceId FROM DiscoveryRunEntity dr "
        + "WHERE dr.serviceId IN :serviceIds")
    List<Object[]> findIdAndServiceIdByServiceIdIn(
        @Param("serviceIds") Collection<String> serviceIds);

    /**
     * Restore {@code discovery_run.service_id} after the services
     * delete-and-re-insert cycle in {@code ModelService.saveModelInternal}.
     *
     * The companion FK constraint is {@code DEFERRABLE INITIALLY DEFERRED}
     * (changeset 082, retained by changeset 126) so the integrity check fires
     * only at commit time -- callers MUST guarantee the target service still
     * exists in {@code services} by then (typically by checking against the
     * inbound model DTO's service IDs before issuing the update).
     *
     * Uses {@code flushAutomatically = true} so any pending DML on
     * {@code DiscoveryRunEntity} (entity-state changes done elsewhere in the
     * same transaction) is flushed before this bulk UPDATE bypasses the
     * persistence context.
     *
     * @param runId the run UUID whose service binding to restore
     * @param serviceId the original service identifier captured pre-delete
     * @return number of rows updated (0 or 1)
     */
    @Modifying(flushAutomatically = true)
    @Query("UPDATE DiscoveryRunEntity dr SET dr.serviceId = :serviceId "
        + "WHERE dr.id = :runId")
    int restoreServiceId(@Param("runId") UUID runId,
                         @Param("serviceId") String serviceId);
}
