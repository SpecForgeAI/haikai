package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for {@link GeneratedMigrationBookOfWorkEntity}.
 *
 * <p>Mirrors the structural pattern of {@link DiscoveryRunRepository}: standard
 * CRUD via {@link JpaRepository} plus the small handful of focused finders the
 * service / controller layer needs.</p>
 *
 * <p>Composite index {@code idx_gmbw_project_arch_status} on
 * {@code (project_id, current_architecture_id, target_architecture_id, status)}
 * (Liquibase changeset 139) backs both
 * {@link #findActiveDraftForTuple(UUID, UUID, UUID)} and
 * {@link #findByProjectIdAndStatusIn(UUID, Collection)}.</p>
 *
 * <p>Spec: Product Manager Migration Delivery Plan (2026-05-17) -- Task Group 1.</p>
 */
@Repository
public interface GeneratedMigrationBookOfWorkRepository
    extends JpaRepository<GeneratedMigrationBookOfWorkEntity, UUID> {

    /**
     * Find all generated migration books of work for a project, ordered by
     * creation time descending. Used by the list endpoint when
     * {@code includeArchived=true} (or when callers filter status themselves).
     *
     * @param projectId the project UUID
     * @return list of entities, newest first
     */
    List<GeneratedMigrationBookOfWorkEntity> findByProjectIdOrderByCreatedAtDesc(UUID projectId);

    /**
     * Find all generated migration books of work for a project. Convenience
     * alias used by simpler test fixtures and the default list endpoint.
     *
     * @param projectId the project UUID
     * @return list of entities (order undefined)
     */
    List<GeneratedMigrationBookOfWorkEntity> findByProjectId(UUID projectId);

    /**
     * Find generated migration books of work for a project whose status is in
     * the given set. Powers the default list endpoint
     * ({@code includeArchived=false} -> pass {@code ACTIVE} from
     * {@link com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkStatus#ACTIVE})
     * and any other status-filtered list view.
     *
     * @param projectId the project UUID
     * @param statuses the statuses to admit
     * @return list of entities, newest first
     */
    List<GeneratedMigrationBookOfWorkEntity> findByProjectIdAndStatusInOrderByCreatedAtDesc(
        UUID projectId, Collection<String> statuses);

    /**
     * Find generated migration books of work for a project whose status is in
     * the given set (no ordering guarantee). Convenience alias used by tests.
     *
     * @param projectId the project UUID
     * @param statuses the statuses to admit
     * @return list of matching entities
     */
    List<GeneratedMigrationBookOfWorkEntity> findByProjectIdAndStatusIn(
        UUID projectId, Collection<String> statuses);

    /**
     * Find the active draft (status not in {@code 'archived'}) for a given
     * {@code (projectId, currentArchitectureId, targetArchitectureId)} tuple.
     * Used by the Q-6 regenerate-on-same-tuple flow: when a new draft is
     * created the prior active row is auto-transitioned to
     * {@code status='archived'} before the new row is inserted.
     *
     * <p>By construction at most one active row should exist per tuple, but
     * the return type is {@link Optional} rather than the entity directly so
     * the caller can short-circuit cleanly when no prior draft exists. Should
     * the invariant ever drift (race / direct DB write), the caller picks the
     * most recently updated row.</p>
     *
     * <p>Backed by composite index {@code idx_gmbw_project_arch_status}.</p>
     *
     * @param projectId the project UUID
     * @param currentArchitectureId the current-state architecture UUID
     * @param targetArchitectureId the target-state architecture UUID
     * @return the active draft for the tuple, or empty if none exists
     */
    @Query("SELECT g FROM GeneratedMigrationBookOfWorkEntity g "
        + "WHERE g.projectId = :projectId "
        + "AND g.currentArchitectureId = :currentArchitectureId "
        + "AND g.targetArchitectureId = :targetArchitectureId "
        + "AND g.status <> 'archived' "
        + "ORDER BY g.updatedAt DESC")
    List<GeneratedMigrationBookOfWorkEntity> findActiveForTuple(
        @Param("projectId") UUID projectId,
        @Param("currentArchitectureId") UUID currentArchitectureId,
        @Param("targetArchitectureId") UUID targetArchitectureId);

    /**
     * Convenience wrapper around {@link #findActiveForTuple(UUID, UUID, UUID)}
     * that returns the single active draft (or empty). When the invariant has
     * not been violated, this method always returns the at-most-one active
     * row for the tuple.
     *
     * @param projectId the project UUID
     * @param currentArchitectureId the current-state architecture UUID
     * @param targetArchitectureId the target-state architecture UUID
     * @return the active draft for the tuple, or empty if none exists
     */
    default Optional<GeneratedMigrationBookOfWorkEntity> findActiveDraftForTuple(
        UUID projectId, UUID currentArchitectureId, UUID targetArchitectureId) {
        List<GeneratedMigrationBookOfWorkEntity> rows =
            findActiveForTuple(projectId, currentArchitectureId, targetArchitectureId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * Single-row fetch with a pessimistic WRITE lock ({@code SELECT ... FOR
     * UPDATE}). Used by the phase-2 {@code items/append} server-side merge so
     * concurrent per-epic appends during "Expand all" serialise on the row
     * and can never lose each other's {@code book_of_work_json} writes
     * (read-merge-write inside one transaction, no client read-modify-write).
     *
     * <p>Spec: Two-Phase Migration Delivery Plan Generation (2026-06-11) --
     * Task Group 2. No schema change -- this is purely a row lock.</p>
     *
     * @param id the draft UUID
     * @return the locked entity, or empty if it does not exist
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT g FROM GeneratedMigrationBookOfWorkEntity g WHERE g.id = :id")
    Optional<GeneratedMigrationBookOfWorkEntity> findWithLockById(@Param("id") UUID id);
}
