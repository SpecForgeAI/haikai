package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.MissingInputResolutionEntity;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.MissingInputResolutionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Cross-story matcher for the Missing Input Resolver Flow.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.</p>
 *
 * <h2>Responsibilities</h2>
 * <ol>
 *   <li>{@link #findReadyToRetry(UUID)} -- project-wide query returning every
 *       spec-generation row whose status is {@code insufficient_context} AND
 *       whose {@code missing_input_keys_json} is non-empty AND every entry of
 *       which has an active (non-soft-deleted) resolution in
 *       {@link MissingInputResolutionRepository}. Powers the dashboard
 *       "Ready to retry: N" card and the story-drawer retry button enablement.</li>
 *   <li>{@link #findAffectedSpecs(UUID, String)} -- given a missing-input key,
 *       return every spec-generation row in the project whose
 *       {@code missing_input_keys_json} contains that key. Powers the
 *       soft-delete cascade in {@link MissingInputResolutionService}.</li>
 * </ol>
 *
 * <h2>Implementation strategy: pull-and-intersect in Java</h2>
 * Two repository calls per {@link #findReadyToRetry(UUID)} invocation:
 * <ul>
 *   <li>One {@code findByProjectId(...)} pulling every spec-generation row for
 *       the project (the dashboard renders these anyway, so the result is
 *       commonly already warm in the JPA L2 / DB cache).</li>
 *   <li>One {@code findByProjectIdAndSoftDeletedFalse(...)} pulling every
 *       active resolution for the project (small set, typically bounded by the
 *       user's resolver throughput).</li>
 * </ul>
 * Intersection is computed in Java because JSONB membership predicates are
 * Postgres-specific and the H2 test DB does not understand them; the existing
 * {@link MigrationStorySpecGenerationRepository#findByProjectIdAndStaleTrue}
 * + in-memory filter pattern is the established AMS convention for project-
 * wide dashboard queries.
 *
 * <h2>Conditional-on-feature</h2>
 * Wired behind {@code app.features.include-database} (default TRUE), mirroring
 * the standing pattern (see {@link MissingInputResolutionService}). Test-only
 * "no DB" profiles can disable this without breaking the bean graph.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MissingInputCrossStoryMatcherService {

    private final MigrationStorySpecGenerationRepository specRepository;
    private final MissingInputResolutionRepository resolutionRepository;

    /**
     * Project-wide ready-to-retry computation. A spec is "ready" when:
     * <ul>
     *   <li>its {@code status} equals
     *       {@code insufficient_context}; AND</li>
     *   <li>{@code missing_input_keys_json} is non-null and non-empty; AND</li>
     *   <li>every entry in {@code missing_input_keys_json} has an active
     *       (non-soft-deleted) resolution in
     *       {@code missing_input_resolutions} for the same project.</li>
     * </ul>
     *
     * <p>Out-of-v1 missing-input types never appear in
     * {@code missing_input_keys_json} (they are filtered at emit time -- see
     * {@link MigrationStorySpecGenerationService#populateMissingInputKeys}),
     * so they never block readiness.</p>
     *
     * @param projectId  owning project UUID
     * @return           summary carrying the count + per-spec readiness rows
     *                   (never null; empty when no specs are ready)
     */
    @Transactional(readOnly = true)
    public ReadyToRetrySummary findReadyToRetry(UUID projectId) {
        if (projectId == null) {
            return new ReadyToRetrySummary(0, List.of(), List.of());
        }

        List<MigrationStorySpecGenerationEntity> projectSpecs =
            specRepository.findByProjectId(projectId);
        if (projectSpecs == null || projectSpecs.isEmpty()) {
            return new ReadyToRetrySummary(0, List.of(), List.of());
        }

        // Filter to insufficient_context rows with a non-empty keys list.
        List<MigrationStorySpecGenerationEntity> candidates = new ArrayList<>();
        for (MigrationStorySpecGenerationEntity spec : projectSpecs) {
            if (spec == null) continue;
            if (!MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT.equals(spec.getStatus())) {
                continue;
            }
            List<String> keys = spec.getMissingInputKeysJson();
            if (keys == null || keys.isEmpty()) continue;
            candidates.add(spec);
        }
        if (candidates.isEmpty()) {
            return new ReadyToRetrySummary(0, List.of(), List.of());
        }

        // Collect every key referenced by every candidate; pull the active
        // resolution rows for those keys in a single repository call.
        Set<String> allCandidateKeys = new LinkedHashSet<>();
        for (MigrationStorySpecGenerationEntity spec : candidates) {
            List<String> keys = spec.getMissingInputKeysJson();
            if (keys == null) continue;
            for (String k : keys) {
                if (k != null && !k.isBlank()) allCandidateKeys.add(k);
            }
        }
        if (allCandidateKeys.isEmpty()) {
            return new ReadyToRetrySummary(0, List.of(), List.of());
        }

        List<MissingInputResolutionEntity> activeResolutions = resolutionRepository
            .findByProjectIdAndMissingInputKeyInAndSoftDeletedFalse(
                projectId, allCandidateKeys);
        Set<String> activeKeys = new HashSet<>();
        if (activeResolutions != null) {
            for (MissingInputResolutionEntity res : activeResolutions) {
                if (res != null && res.getMissingInputKey() != null) {
                    activeKeys.add(res.getMissingInputKey());
                }
            }
        }

        // A spec is ready iff EVERY one of its keys is present in activeKeys.
        List<ReadyToRetryStoryRow> readyRows = new ArrayList<>();
        List<UUID> readySpecIds = new ArrayList<>();
        for (MigrationStorySpecGenerationEntity spec : candidates) {
            List<String> keys = spec.getMissingInputKeysJson();
            int totalKeys = keys == null ? 0 : keys.size();
            int resolvedKeys = 0;
            if (keys != null) {
                for (String k : keys) {
                    if (k != null && activeKeys.contains(k)) {
                        resolvedKeys++;
                    }
                }
            }
            if (totalKeys > 0 && resolvedKeys == totalKeys) {
                readyRows.add(new ReadyToRetryStoryRow(
                    spec.getId(),
                    spec.getWorkItemId(),
                    /* title -- WorkItem title would require a separate join.
                       The dashboard already has the title cached client-side
                       per workItemId; AMS returns the ids and the frontend
                       hydrates the label. Title kept on the DTO as a hint
                       channel and populated by the controller layer in
                       Task Group 4 if/when convenient. */
                    null,
                    totalKeys,
                    resolvedKeys));
                if (spec.getId() != null) {
                    readySpecIds.add(spec.getId());
                }
            }
        }

        log.debug(
            "[diag-ams] missing_input cross_story_matcher ready_to_retry projectId={}"
                + " totalCandidates={} ready={}",
            shortPrefix(projectId), candidates.size(), readyRows.size());

        return new ReadyToRetrySummary(readyRows.size(), readySpecIds, readyRows);
    }

    /**
     * Return every spec-generation row in the project whose
     * {@code missing_input_keys_json} contains the supplied missing-input key.
     * The cross-story cascade in
     * {@link MissingInputResolutionService#softDeleteWithCascade(UUID, UUID, String)}
     * uses this to discover which specs to flip back to
     * {@code insufficient_context} when a resolution is reset.
     *
     * @param projectId        owning project UUID
     * @param missingInputKey  the key (already canonical 16-hex-char)
     * @return                 zero-or-more matching spec-generation entities
     *                         (never null)
     */
    @Transactional(readOnly = true)
    public List<MigrationStorySpecGenerationEntity> findAffectedSpecs(
            UUID projectId, String missingInputKey) {
        if (projectId == null || missingInputKey == null || missingInputKey.isBlank()) {
            return List.of();
        }
        List<MigrationStorySpecGenerationEntity> projectSpecs =
            specRepository.findByProjectId(projectId);
        if (projectSpecs == null || projectSpecs.isEmpty()) {
            return List.of();
        }
        List<MigrationStorySpecGenerationEntity> out = new ArrayList<>();
        for (MigrationStorySpecGenerationEntity spec : projectSpecs) {
            if (spec == null) continue;
            List<String> keys = spec.getMissingInputKeysJson();
            if (keys == null || keys.isEmpty()) continue;
            if (keys.contains(missingInputKey)) {
                out.add(spec);
            }
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Response shapes
    // -----------------------------------------------------------------------

    /**
     * Summary returned by {@link #findReadyToRetry(UUID)}: count, list of
     * spec-generation ids, and per-spec readiness rows. The dashboard surfaces
     * the count + spec ids; the story drawer renders one row per entry.
     */
    public record ReadyToRetrySummary(
        int count,
        List<UUID> specGenerationIds,
        List<ReadyToRetryStoryRow> stories
    ) {}

    /**
     * Per-spec readiness row. {@code totalKeys} == {@code resolvedKeys} is the
     * "ready" invariant; lower {@code resolvedKeys} means this row will not
     * appear in the response from {@link #findReadyToRetry(UUID)}.
     *
     * @param specGenerationId  spec-generation row UUID
     * @param workItemId        owning WorkItem UUID
     * @param title             optional title (controller-populated; may be null)
     * @param totalKeys         number of keys in {@code missing_input_keys_json}
     * @param resolvedKeys      number of keys with an active resolution
     */
    public record ReadyToRetryStoryRow(
        UUID specGenerationId,
        UUID workItemId,
        String title,
        Integer totalKeys,
        Integer resolvedKeys
    ) {}

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }
}
