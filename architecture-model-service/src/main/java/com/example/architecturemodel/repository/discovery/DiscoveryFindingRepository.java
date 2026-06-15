package com.example.architecturemodel.repository.discovery;

import com.example.architecturemodel.model.entity.discovery.DiscoveryFindingEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Spring Data repository for {@link DiscoveryFindingEntity}.
 *
 * <p>Provides scoped finders for the canonical
 * {@code (project, architecture, run)} tuple plus a multi-field search that
 * powers the {@code GET .../findings} controller endpoint. Filter columns
 * mirror the indexed columns in changeset 135.</p>
 *
 * <p>Spec: Discovery Findings / Evidence as a First-Class Discovery Concept
 * (2026-05-16) -- Task Group 1; extended by API Test Harness — Findings
 * Integration (2026-05-25) Task Group 1 with two diff-origin finders +
 * a bulk delete query; normalized by Normalize Findings Review Actions
 * (Spec F, 2026-06-02) -- the {@code status} filter now matches the renamed
 * {@code reviewStatus} entity field ({@code review_status} column); extended by
 * Cascade-aware Bulk Review + Reject Suppression (Spec 2, 2026-06-02) Task
 * Group 2 with two {@code review_status}-EXCLUDING finders that keep
 * {@code rejected} IR out of the two migration-planning context builders (NO
 * schema change -- the filter keys on the live {@code review_status} column).</p>
 */
@Repository
public interface DiscoveryFindingRepository extends JpaRepository<DiscoveryFindingEntity, UUID> {

    /**
     * Scoped list for a run (with project + architecture redundantly enforced
     * for safety -- the run guard verifies these match, but the WHERE clause
     * keeps the query symmetrical with the path tuple).
     */
    List<DiscoveryFindingEntity> findByRunIdAndProjectIdAndArchitectureId(
        UUID runId, UUID projectId, UUID architectureId);

    /**
     * Run-scoped list EXCLUDING a given {@code review_status} value.
     *
     * <p><b>Load-bearing reject-suppression finder</b> (Spec 2, Task Group 2).
     * The variant of {@link #findByRunIdAndProjectIdAndArchitectureId} that the
     * book-of-work / migration-delivery-plan context builder
     * ({@code MigrationDiscoveryContextService.loadFindingsForRuns}) calls so a
     * {@code rejected} finding is GENUINELY ABSENT from BOTH the
     * {@code highPriorityFindings} LLM payload AND the
     * {@code buildFindingsSummary} counts (one filter at the load excludes it
     * from both). Keyed on the LIVE {@code review_status} column -- NO schema
     * change, NO IR mutation, a plain derived read query. Callers pass
     * {@code "rejected"} to suppress only the bright-line reject; {@code
     * deferred} stays visible by NOT being excluded.</p>
     */
    List<DiscoveryFindingEntity> findByRunIdAndProjectIdAndArchitectureIdAndReviewStatusNot(
        UUID runId, UUID projectId, UUID architectureId, String reviewStatus);

    /**
     * Project + architecture scoped list (no run filter). Used historically by
     * resolvers that want a bounded slice across all runs for the
     * architecture, BEFORE the addition of diff-sourced findings.
     *
     * <p><b>WARNING:</b> this finder returns findings of BOTH origins
     * (run-sourced AND diff-sourced) post-2026-05-25. Callers that expect
     * run-sourced findings only MUST use
     * {@link #findByProjectIdAndArchitectureIdAndRunIdNotNull(UUID, UUID)}
     * instead -- e.g. {@code MigrationSpecContextResolver.loadFindings}
     * (which reads {@code f.getRunId()} directly and would NPE on
     * diff-sourced rows).</p>
     */
    List<DiscoveryFindingEntity> findByProjectIdAndArchitectureId(
        UUID projectId, UUID architectureId);

    /**
     * Project + architecture scoped list filtered to RUN-SOURCED findings
     * only ({@code run_id IS NOT NULL}, i.e. excludes diff-sourced rows).
     *
     * <p><b>Load-bearing</b> for {@code MigrationSpecContextResolver.loadFindings}
     * per accepted Q7: the resolver reads {@code f.getRunId()} directly into
     * {@code MigrationDiscoveryContextDto.FindingHighlight.runId} and would
     * NPE downstream (or render "Run: -" garbage) on diff-sourced rows.
     * Filtering them out at the query layer preserves the existing
     * migration-spec semantics. Revisit in v2 if migration specs want
     * API-drift findings as context.</p>
     */
    List<DiscoveryFindingEntity> findByProjectIdAndArchitectureIdAndRunIdNotNull(
        UUID projectId, UUID architectureId);

    /**
     * Project + architecture scoped, run-sourced ({@code run_id IS NOT NULL}),
     * EXCLUDING a given {@code review_status} value.
     *
     * <p><b>Load-bearing reject-suppression finder</b> (Spec 2, Task Group 2).
     * The variant of {@link #findByProjectIdAndArchitectureIdAndRunIdNotNull}
     * that the per-story shape-spec context resolver
     * ({@code MigrationSpecContextResolver.loadFindings}) calls so a
     * {@code rejected} finding never reaches any per-story block builder
     * ({@code buildServiceBlock} / {@code buildApiBlock} / {@code buildSoapBlock}
     * / {@code buildDataBlock} / {@code buildTestPackBlock} via
     * {@code boundedFindings}). Keyed on the LIVE {@code review_status} column
     * -- NO schema change, NO IR mutation. {@code deferred} stays visible by NOT
     * being excluded.</p>
     */
    List<DiscoveryFindingEntity> findByProjectIdAndArchitectureIdAndRunIdNotNullAndReviewStatusNot(
        UUID projectId, UUID architectureId, String reviewStatus);

    /**
     * Diff-scoped list, ordered ascending by {@code created_at}. Primary
     * read path for the new diff-scoped controller surface:
     * {@code GET /api/projects/{projectId}/api-behaviour/diffs/{diffId}/findings}.
     */
    List<DiscoveryFindingEntity> findByApiBehaviourDiffIdOrderByCreatedAtAsc(
        UUID apiBehaviourDiffId);

    /**
     * Capture-session-scoped list, ordered ascending by {@code created_at}.
     * Read path for reconciliation-sourced findings (third origin, changeset
     * 179 -- Spec: Model-Seeded Capture Inventory, 2026-06-11) and the
     * load-bearing delete-before-emit cleanup in
     * {@code DiscoveryFindingService.deleteFindingsByCaptureSessionId}.
     */
    List<DiscoveryFindingEntity> findByApiBehaviourCaptureSessionIdOrderByCreatedAtAsc(
        UUID apiBehaviourCaptureSessionId);

    /**
     * Bulk delete of all findings linked to the given diff via
     * {@code api_behaviour_diff_id}. Load-bearing for diff recompute
     * (accepted Q6): the ON DELETE CASCADE on
     * {@code api_behaviour_diff_id} only fires when the diff ROW is
     * deleted; recompute keeps the diff row alive while replacing
     * diff_items, so an explicit bulk delete BEFORE re-emit is the
     * only correct way to avoid accumulating duplicates across
     * recomputes (2x, 3x, ...).
     *
     * <p>Returns the number of rows deleted (for diagnostics / logging).</p>
     */
    @Modifying
    @Query("DELETE FROM DiscoveryFindingEntity f WHERE f.apiBehaviourDiffId = :diffId")
    int deleteByApiBehaviourDiffId(@Param("diffId") UUID diffId);

    /**
     * Multi-field search. All filter parameters are nullable; a null parameter
     * disables that filter. {@code text} (case-insensitive LIKE on
     * title+summary) is applied when supplied.
     *
     * <p>The {@code status} parameter filters on the renamed
     * {@code reviewStatus} entity field ({@code review_status} column,
     * Spec F). The query-param / method-parameter name is kept as
     * {@code status} for caller stability; only the JPQL field reference
     * moved to {@code f.reviewStatus}.</p>
     *
     * <p>{@code linkedTargetType}/{@code linkedTargetId} together restrict to
     * findings that have a {@code discovery_finding_links} row matching the
     * pair. Either both are supplied or neither; service-layer guards this.</p>
     */
    @Query("""
        SELECT f FROM DiscoveryFindingEntity f
        WHERE f.runId = :runId
          AND f.projectId = :projectId
          AND f.architectureId = :architectureId
          AND (:category IS NULL OR f.category = :category)
          AND (:findingType IS NULL OR f.findingType = :findingType)
          AND (:severity IS NULL OR f.severity = :severity)
          AND (:status IS NULL OR f.reviewStatus = :status)
          AND (:source IS NULL OR f.source = :source)
          AND (:createdByStage IS NULL OR f.createdByStage = :createdByStage)
          AND (
            :text IS NULL
            OR LOWER(f.title) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
            OR LOWER(COALESCE(f.summary, '')) LIKE LOWER(CONCAT('%', CAST(:text AS STRING), '%'))
          )
          AND (
            :linkedTargetType IS NULL
            OR EXISTS (
              SELECT 1 FROM DiscoveryFindingLinkEntity l
              WHERE l.findingId = f.id
                AND l.targetType = :linkedTargetType
                AND (:linkedTargetId IS NULL OR l.targetId = :linkedTargetId)
            )
          )
        """)
    Page<DiscoveryFindingEntity> search(
        @Param("runId") UUID runId,
        @Param("projectId") UUID projectId,
        @Param("architectureId") UUID architectureId,
        @Param("category") String category,
        @Param("findingType") String findingType,
        @Param("severity") String severity,
        @Param("status") String status,
        @Param("source") String source,
        @Param("createdByStage") String createdByStage,
        @Param("text") String text,
        @Param("linkedTargetType") String linkedTargetType,
        @Param("linkedTargetId") String linkedTargetId,
        Pageable pageable);
}
