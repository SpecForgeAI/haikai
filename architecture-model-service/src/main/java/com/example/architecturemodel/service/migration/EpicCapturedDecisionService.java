package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.CreateEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.migration.EpicCapturedDecisionDto;
import com.example.architecturemodel.model.dto.migration.EpicCapturedDecisionsCountByEpicDto;
import com.example.architecturemodel.model.dto.migration.UpdateEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.entity.EpicCapturedDecisionEntity;
import com.example.architecturemodel.repository.ProjectRepository;
import com.example.architecturemodel.repository.entity.EpicCapturedDecisionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Service layer for {@code epic_captured_decisions}: CRUD plus the source-flag
 * transitions required by the cross-story-context spec.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.</p>
 *
 * <h2>Source-flag transitions</h2>
 * <ul>
 *   <li>Auto-seeded inserts (via {@link #upsertAutoExtracted}) carry
 *       {@code source = auto_extracted} and a non-null
 *       {@code sourceSpecGenerationId}.</li>
 *   <li>Any user POST creates a row with {@code source = user_added}.</li>
 *   <li>Any user PATCH on an {@code auto_extracted} row flips
 *       {@code source = user_edited} and PINS the row against further
 *       auto-overwrite by re-runs of pass 1. {@code user_edited} and
 *       {@code user_added} rows never revert to {@code auto_extracted}.</li>
 *   <li>{@link #upsertAutoExtracted} explicitly skips rows whose source is
 *       {@code user_edited} or {@code user_added} (the pinned set), preserving
 *       human-curated content across re-runs.</li>
 * </ul>
 *
 * <h2>PATCH posture</h2>
 * Every editable field on {@link UpdateEpicCapturedDecisionRequest} is a boxed
 * reference type; this service null-guards every one of them per
 * {@code project_primitive_double_dto_overwrite.md}.
 *
 * <h2>Status feed contract (cross-checked at the resolver boundary)</h2>
 * Only rows with {@code status IN (draft, confirmed)} are exposed via the
 * resolver's pass-2 {@code parent_rollup.epic.capturedDecisions[]} feed; the
 * resolver itself enforces this filter through
 * {@code EpicCapturedDecisionRepository#findByProjectIdAndEpicWorkItemIdAndStatusIn(...)}.
 * The constant {@link #PARENT_ROLLUP_FEED_STATUSES} mirrors that contract for
 * test cross-checks.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class EpicCapturedDecisionService {

    /** Canonical {@code source} vocabulary -- mirrors DB CHECK chk_ecd_source. */
    public static final String SOURCE_AUTO_EXTRACTED = "auto_extracted";
    public static final String SOURCE_USER_EDITED = "user_edited";
    public static final String SOURCE_USER_ADDED = "user_added";

    /** Canonical {@code status} vocabulary -- mirrors DB CHECK chk_ecd_status. */
    public static final String STATUS_DRAFT = "draft";
    public static final String STATUS_CONFIRMED = "confirmed";
    public static final String STATUS_SUPERSEDED = "superseded";

    /**
     * Rows in these source states are pinned against auto-overwrite by
     * {@link #upsertAutoExtracted}.
     */
    public static final Set<String> PINNED_SOURCES = Set.of(
        SOURCE_USER_EDITED, SOURCE_USER_ADDED);

    /**
     * Statuses exposed via the resolver's parent_rollup feed. Cross-checked
     * against the resolver constant by the controller tests.
     */
    public static final Set<String> PARENT_ROLLUP_FEED_STATUSES = Set.of(
        STATUS_DRAFT, STATUS_CONFIRMED);

    private final EpicCapturedDecisionRepository repository;
    private final ProjectRepository projectRepository;

    /**
     * GET list: returns all decision rows for {@code (projectId, epicWorkItemId)}
     * regardless of status / source. The frontend panel applies its own status
     * filter; the resolver applies the parent_rollup feed filter.
     */
    @Transactional(readOnly = true)
    public List<EpicCapturedDecisionDto> list(UUID projectId, UUID epicWorkItemId) {
        requireProject(projectId);
        List<EpicCapturedDecisionEntity> rows =
            repository.findByProjectIdAndEpicWorkItemId(projectId, epicWorkItemId);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        List<EpicCapturedDecisionDto> out = new ArrayList<>(rows.size());
        for (EpicCapturedDecisionEntity row : rows) {
            out.add(toDto(row));
        }
        return out;
    }

    /**
     * POST create: a user-added row. {@code source} is always
     * {@code user_added}; {@code sourceSpecGenerationId} is always null on this
     * path. Status defaults to {@code draft} when omitted.
     */
    @Transactional
    public EpicCapturedDecisionDto create(
            UUID projectId,
            UUID epicWorkItemId,
            CreateEpicCapturedDecisionRequest request) {
        requireProject(projectId);
        if (request == null) {
            throw new IllegalArgumentException("Request body required");
        }
        if (request.decisionKey() == null || request.decisionKey().isBlank()) {
            throw new IllegalArgumentException("decisionKey is required");
        }
        if (request.decisionText() == null || request.decisionText().isBlank()) {
            throw new IllegalArgumentException("decisionText is required");
        }
        String status = request.status();
        if (status == null) {
            status = STATUS_DRAFT;
        }
        validateStatus(status);

        Instant now = Instant.now();
        EpicCapturedDecisionEntity entity = EpicCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .epicWorkItemId(epicWorkItemId)
            .decisionKey(request.decisionKey().trim())
            .decisionText(request.decisionText())
            .source(SOURCE_USER_ADDED)
            .sourceSpecGenerationId(null)
            .status(status)
            .lastEditedBy(request.lastEditedBy())
            .createdAt(now)
            .updatedAt(now)
            .build();

        EpicCapturedDecisionEntity saved = repository.save(entity);
        log.info(
            "[diag-ams] epic_captured_decision created id={} projectId={} epicWorkItemId={} source={} status={}",
            saved.getId(), shortPrefix(projectId), shortPrefix(epicWorkItemId),
            saved.getSource(), saved.getStatus());
        return toDto(saved);
    }

    /**
     * PATCH: null-guards every editable field. On any non-null edit applied to
     * an {@code auto_extracted} row, the source flips to {@code user_edited}
     * (pinning the row against further auto-overwrite). {@code user_edited}
     * and {@code user_added} rows do not change source. {@code lastEditedBy}
     * is always written and the audited {@code updatedAt} is refreshed by the
     * entity's {@code @PreUpdate} callback.
     */
    @Transactional
    public EpicCapturedDecisionDto update(
            UUID projectId,
            UUID epicWorkItemId,
            UUID id,
            UpdateEpicCapturedDecisionRequest request) {
        requireProject(projectId);
        EpicCapturedDecisionEntity row = loadScoped(projectId, epicWorkItemId, id);
        if (request == null) {
            // No-op PATCH; still return current state.
            return toDto(row);
        }

        boolean structuralEdit = false;

        if (request.decisionKey() != null) {
            row.setDecisionKey(request.decisionKey().trim());
            structuralEdit = true;
        }
        if (request.decisionText() != null) {
            row.setDecisionText(request.decisionText());
            structuralEdit = true;
        }
        if (request.status() != null) {
            validateStatus(request.status());
            row.setStatus(request.status());
            structuralEdit = true;
        }
        if (request.lastEditedBy() != null) {
            row.setLastEditedBy(request.lastEditedBy());
            // A pure lastEditedBy touch should not flip source -- the field
            // can be set without expressing user-curated intent (e.g.
            // automated audit pings). Source-flip is gated by structural
            // edits.
        }

        // Source pinning: any structural edit on an auto_extracted row flips
        // it to user_edited and pins it against future auto-overwrite. Pinned
        // rows (user_edited / user_added) stay pinned.
        if (structuralEdit && SOURCE_AUTO_EXTRACTED.equals(row.getSource())) {
            row.setSource(SOURCE_USER_EDITED);
            log.info(
                "[diag-ams] epic_captured_decision pinned id={} -> source={} (auto_extracted -> user_edited)",
                row.getId(), SOURCE_USER_EDITED);
        }

        // Bump updatedAt explicitly when only lastEditedBy was touched, so the
        // audit channel reflects the change even if @PreUpdate does not fire
        // because no JPA-tracked structural column changed.
        row.setUpdatedAt(Instant.now());

        EpicCapturedDecisionEntity saved = repository.save(row);
        return toDto(saved);
    }

    /**
     * DELETE: hard-delete. The {@code updated_at} / {@code last_edited_by}
     * audit is captured on the {@link EpicCapturedDecisionDto} returned to the
     * caller (we update the row in-place before delete so the response carries
     * the final audit state). This matches the discovery-finding pattern.
     */
    @Transactional
    public EpicCapturedDecisionDto delete(
            UUID projectId,
            UUID epicWorkItemId,
            UUID id,
            String lastEditedBy) {
        requireProject(projectId);
        EpicCapturedDecisionEntity row = loadScoped(projectId, epicWorkItemId, id);

        // Audit the deletion: stamp who and when before removing.
        if (lastEditedBy != null) {
            row.setLastEditedBy(lastEditedBy);
        }
        row.setUpdatedAt(Instant.now());
        EpicCapturedDecisionDto auditedSnapshot = toDto(row);

        repository.delete(row);
        log.info(
            "[diag-ams] epic_captured_decision deleted id={} projectId={} epicWorkItemId={} lastEditedBy={}",
            id, shortPrefix(projectId), shortPrefix(epicWorkItemId), lastEditedBy);
        return auditedSnapshot;
    }

    /**
     * Bulk per-epic count summary for the project. Returns one row per epic
     * that has at least one captured-decision; epics with no rows are omitted
     * so the dashboard does not render entries for epics the user has not yet
     * engaged with.
     *
     * <p>Spec: Cross-Story Context Injection (2026-05-20) Follow-up #3 --
     * replaces the dashboard's O(epic-count) per-epic GETs with one
     * project-scoped call.</p>
     */
    @Transactional(readOnly = true)
    public List<EpicCapturedDecisionsCountByEpicDto> summaryByEpic(UUID projectId) {
        requireProject(projectId);
        List<EpicCapturedDecisionEntity> rows = repository.findByProjectId(projectId);
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, int[]> counts = new HashMap<>();
        for (EpicCapturedDecisionEntity row : rows) {
            UUID epicId = row.getEpicWorkItemId();
            if (epicId == null) continue;
            int[] c = counts.computeIfAbsent(epicId, k -> new int[3]);
            String status = row.getStatus();
            if (STATUS_DRAFT.equals(status)) {
                c[0] += 1;
            } else if (STATUS_CONFIRMED.equals(status)) {
                c[1] += 1;
            } else if (STATUS_SUPERSEDED.equals(status)) {
                c[2] += 1;
            }
        }
        List<EpicCapturedDecisionsCountByEpicDto> out = new ArrayList<>(counts.size());
        for (Map.Entry<UUID, int[]> e : counts.entrySet()) {
            int[] c = e.getValue();
            out.add(new EpicCapturedDecisionsCountByEpicDto(
                e.getKey(), c[0], c[1], c[2]));
        }
        return out;
    }

    /**
     * Auto-seed upsert used by the gateway's pass-1 captured-decisions
     * pipeline (Task Group 5). Rows whose source is in {@link #PINNED_SOURCES}
     * are SKIPPED -- they have been touched by a user and must not be
     * auto-overwritten. Returns the (possibly already-existing) DTO.
     *
     * <p>When an existing {@code auto_extracted} row matches by
     * {@code (project, epic, decisionKey)}, its {@code decisionText} is
     * refreshed and the originating spec-generation id is rebound. When no
     * row matches, a fresh {@code auto_extracted} row is inserted with
     * {@code status = draft}.</p>
     */
    @Transactional
    public Optional<EpicCapturedDecisionDto> upsertAutoExtracted(
            UUID projectId,
            UUID epicWorkItemId,
            String decisionKey,
            String decisionText,
            UUID sourceSpecGenerationId) {
        requireProject(projectId);
        if (decisionKey == null || decisionKey.isBlank()) {
            throw new IllegalArgumentException("decisionKey is required for auto-seed");
        }
        if (decisionText == null) {
            throw new IllegalArgumentException("decisionText is required for auto-seed");
        }

        Optional<EpicCapturedDecisionEntity> existing = repository
            .findByProjectIdAndEpicWorkItemIdAndDecisionKey(
                projectId, epicWorkItemId, decisionKey.trim());

        if (existing.isPresent()) {
            EpicCapturedDecisionEntity row = existing.get();
            if (row.getSource() != null && PINNED_SOURCES.contains(row.getSource())) {
                log.info(
                    "[diag-ams] epic_captured_decision auto_seed_skip_pinned id={} source={} decisionKey={}",
                    row.getId(), row.getSource(), decisionKey);
                return Optional.of(toDto(row));
            }
            // Refresh the auto_extracted payload from the latest pass-1 row.
            row.setDecisionText(decisionText);
            row.setSourceSpecGenerationId(sourceSpecGenerationId);
            row.setSource(SOURCE_AUTO_EXTRACTED);
            row.setUpdatedAt(Instant.now());
            return Optional.of(toDto(repository.save(row)));
        }

        Instant now = Instant.now();
        EpicCapturedDecisionEntity entity = EpicCapturedDecisionEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .epicWorkItemId(epicWorkItemId)
            .decisionKey(decisionKey.trim())
            .decisionText(decisionText)
            .source(SOURCE_AUTO_EXTRACTED)
            .sourceSpecGenerationId(sourceSpecGenerationId)
            .status(STATUS_DRAFT)
            .createdAt(now)
            .updatedAt(now)
            .build();
        return Optional.of(toDto(repository.save(entity)));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private EpicCapturedDecisionEntity loadScoped(
            UUID projectId, UUID epicWorkItemId, UUID id) {
        EpicCapturedDecisionEntity row = repository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Epic captured decision " + id + " not found"));
        if (!projectId.equals(row.getProjectId())
                || !epicWorkItemId.equals(row.getEpicWorkItemId())) {
            // Out-of-scope access masquerades as 404 -- matches the
            // discovery-child convention.
            throw new ResourceNotFoundException(
                "Epic captured decision " + id
                    + " not found for project " + shortPrefix(projectId)
                    + " / epic " + shortPrefix(epicWorkItemId));
        }
        return row;
    }

    private void requireProject(UUID projectId) {
        if (projectId == null) {
            throw new IllegalArgumentException("projectId is required");
        }
        if (!projectRepository.existsById(projectId)) {
            throw new ResourceNotFoundException("Project " + projectId + " not found");
        }
    }

    private void validateStatus(String status) {
        if (status == null) return;
        if (!STATUS_DRAFT.equals(status)
                && !STATUS_CONFIRMED.equals(status)
                && !STATUS_SUPERSEDED.equals(status)) {
            throw new IllegalArgumentException(
                "status must be one of draft, confirmed, superseded; got '" + status + "'");
        }
    }

    private EpicCapturedDecisionDto toDto(EpicCapturedDecisionEntity row) {
        return new EpicCapturedDecisionDto(
            row.getId(),
            row.getProjectId(),
            row.getEpicWorkItemId(),
            row.getDecisionKey(),
            row.getDecisionText(),
            row.getSource(),
            row.getSourceSpecGenerationId(),
            row.getStatus(),
            row.getLastEditedBy(),
            row.getCreatedAt(),
            row.getUpdatedAt()
        );
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }
}
