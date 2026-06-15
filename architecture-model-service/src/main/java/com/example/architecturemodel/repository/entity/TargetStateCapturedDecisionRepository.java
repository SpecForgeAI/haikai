package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link TargetStateCapturedDecisionEntity}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 1.</p>
 *
 * <p>Provides scoped finders for the captured-decisions REST surface
 * ({@code /api/projects/{projectId}/target-architectures/{targetArchitectureId}/captured-decisions})
 * and the gateway resolver feed that surfaces decisions as bounded
 * prompt-ready summary text.</p>
 *
 * <p><b>Supersession invariant:</b> at any consistent read at most one row
 * per {@code (project_id, target_architecture_id, decision_code, scope_kind,
 * scope_ref_id)} tuple has {@code superseded_by_id IS NULL}. The "latest
 * non-superseded" queries below all enforce that filter; the "all" query
 * does not (it returns the full audit trail including superseded rows).</p>
 *
 * <p><b>scope_ref_id IS NULL-safe lookup:</b> for architecture-scope rows
 * {@code scope_ref_id} is NULL. The tuple lookup at
 * {@link #findLatestNonSupersededByTuple} uses the pattern
 * {@code (scope_ref_id = :scopeRefId OR (:scopeRefId IS NULL AND scope_ref_id IS NULL))}
 * so a {@code null} parameter matches NULL column values (SQL's three-valued
 * logic does not match {@code NULL = NULL} on its own).</p>
 */
@Repository
public interface TargetStateCapturedDecisionRepository
    extends JpaRepository<TargetStateCapturedDecisionEntity, UUID> {

    /**
     * Returns the latest non-superseded row for the given
     * {@code (projectId, targetArchitectureId, decisionCode, scopeKind,
     * scopeRefId)} tuple. At most one such row exists per the supersession
     * invariant.
     *
     * <p>Drives the supersession lookup at create time
     * ({@code TargetStateCapturedDecisionService.createDecision}) and any
     * "what's the current value for this concern in this scope" read path.</p>
     *
     * <p>NULL-safe on {@code scopeRefId} so architecture-scope rows
     * ({@code scope_ref_id IS NULL}) are matched correctly when the caller
     * passes {@code null}.</p>
     */
    @Query(
        "SELECT d FROM TargetStateCapturedDecisionEntity d "
        + "WHERE d.projectId = :projectId "
        + "  AND d.targetArchitectureId = :targetArchitectureId "
        + "  AND d.decisionCode = :decisionCode "
        + "  AND d.scopeKind = :scopeKind "
        + "  AND ( "
        + "        d.scopeRefId = :scopeRefId "
        + "        OR (:scopeRefId IS NULL AND d.scopeRefId IS NULL) "
        + "      ) "
        + "  AND d.supersededById IS NULL"
    )
    Optional<TargetStateCapturedDecisionEntity> findLatestNonSupersededByTuple(
        @Param("projectId") UUID projectId,
        @Param("targetArchitectureId") UUID targetArchitectureId,
        @Param("decisionCode") String decisionCode,
        @Param("scopeKind") String scopeKind,
        @Param("scopeRefId") String scopeRefId);

    /**
     * Returns all latest (non-superseded) decisions for the given target
     * architecture. Default read path for the gateway resolver feed and the
     * {@code GET .../captured-decisions} endpoint (default behaviour without
     * {@code ?includeSuperseded=true}).
     */
    @Query(
        "SELECT d FROM TargetStateCapturedDecisionEntity d "
        + "WHERE d.projectId = :projectId "
        + "  AND d.targetArchitectureId = :targetArchitectureId "
        + "  AND d.supersededById IS NULL"
    )
    List<TargetStateCapturedDecisionEntity> findLatestNonSupersededForTarget(
        @Param("projectId") UUID projectId,
        @Param("targetArchitectureId") UUID targetArchitectureId);

    /**
     * Returns ALL decisions for the given target architecture, including
     * superseded rows. Drives the
     * {@code GET .../captured-decisions?includeSuperseded=true} audit path.
     */
    @Query(
        "SELECT d FROM TargetStateCapturedDecisionEntity d "
        + "WHERE d.projectId = :projectId "
        + "  AND d.targetArchitectureId = :targetArchitectureId"
    )
    List<TargetStateCapturedDecisionEntity> findAllForTarget(
        @Param("projectId") UUID projectId,
        @Param("targetArchitectureId") UUID targetArchitectureId);

    /**
     * Returns the latest (non-superseded) decisions for one specific
     * decision code across all scopes for the given target architecture.
     * Drives the {@code GET .../captured-decisions/by-code/{decisionCode}}
     * endpoint.
     */
    @Query(
        "SELECT d FROM TargetStateCapturedDecisionEntity d "
        + "WHERE d.projectId = :projectId "
        + "  AND d.targetArchitectureId = :targetArchitectureId "
        + "  AND d.decisionCode = :decisionCode "
        + "  AND d.supersededById IS NULL"
    )
    List<TargetStateCapturedDecisionEntity> findLatestNonSupersededByDecisionCode(
        @Param("projectId") UUID projectId,
        @Param("targetArchitectureId") UUID targetArchitectureId,
        @Param("decisionCode") String decisionCode);
}
