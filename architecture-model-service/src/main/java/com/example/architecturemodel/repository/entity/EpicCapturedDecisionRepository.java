package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.EpicCapturedDecisionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link EpicCapturedDecisionEntity}.
 *
 * <p>Provides scoped finders for the epic-decisions CRUD surface
 * ({@code GET .../epics/{epicWorkItemId}/captured-decisions}) and the resolver
 * feed that drives pass-2 {@code parent_rollup.epic.capturedDecisions[]}.</p>
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 1.</p>
 *
 * <p>Pattern: mirrors {@link com.example.architecturemodel.repository.discovery.DiscoveryFindingRepository}
 * for the scoped-finder shape -- thin JpaRepository surface plus a small set of
 * named queries derived from the canonical access tuples
 * {@code (project, epicWorkItem)} and {@code (project, epicWorkItem, statusIn)}.</p>
 */
@Repository
public interface EpicCapturedDecisionRepository
    extends JpaRepository<EpicCapturedDecisionEntity, UUID> {

    /**
     * Canonical list-per-epic accessor. Powers the
     * {@code GET .../epics/{epicWorkItemId}/captured-decisions} endpoint
     * (Task Group 4).
     *
     * @param projectId       owning project UUID
     * @param epicWorkItemId  the epic WorkItem UUID
     * @return all decision rows for this epic (any status, any source)
     */
    List<EpicCapturedDecisionEntity> findByProjectIdAndEpicWorkItemId(
        UUID projectId, UUID epicWorkItemId);

    /**
     * Status-filtered list-per-epic accessor. Used by the resolver feed
     * (Task Group 3) to surface only {@code draft} and {@code confirmed} rows
     * to pass-2 {@code parent_rollup.epic.capturedDecisions[]}.
     *
     * @param projectId       owning project UUID
     * @param epicWorkItemId  the epic WorkItem UUID
     * @param statuses        the statuses to admit (typically draft and confirmed)
     * @return matching decision rows
     */
    List<EpicCapturedDecisionEntity> findByProjectIdAndEpicWorkItemIdAndStatusIn(
        UUID projectId, UUID epicWorkItemId, Collection<String> statuses);

    /**
     * Find rows that originated from a specific spec-generation row. Used by
     * the auto-seed pipeline (Task Group 5) when re-running pass-1 to locate
     * existing auto-extracted rows for upsert decisions, and by capture-and-
     * restore flows that must remember the pre-DELETE FK values per
     * {@code project_pg_deferrable_set_null_action}.
     *
     * @param sourceSpecGenerationId the originating spec-generation row UUID
     * @return matching decision rows (may be empty)
     */
    List<EpicCapturedDecisionEntity> findBySourceSpecGenerationId(
        UUID sourceSpecGenerationId);

    /**
     * Upsert helper: look up an existing decision by the unique
     * {@code (projectId, epicWorkItemId, decisionKey)} tuple, mirroring the
     * {@code ux_ecd_project_epic_key} constraint on the table. Used by the
     * pass-1 auto-seed pipeline to avoid INSERT conflicts.
     *
     * @param projectId       owning project UUID
     * @param epicWorkItemId  the epic WorkItem UUID
     * @param decisionKey     the stable decision key
     * @return optional existing row
     */
    Optional<EpicCapturedDecisionEntity> findByProjectIdAndEpicWorkItemIdAndDecisionKey(
        UUID projectId, UUID epicWorkItemId, String decisionKey);

    /**
     * Project-wide accessor. Returns every captured-decision row for the
     * project, across all epics. Used by the bulk summary endpoint
     * ({@code GET .../captured-decisions/summary}) so the dashboard can render
     * per-epic counts without making O(epic-count) round-trips.
     *
     * @param projectId  owning project UUID
     * @return all decision rows in the project (any status, any source, any epic)
     */
    List<EpicCapturedDecisionEntity> findByProjectId(UUID projectId);
}
