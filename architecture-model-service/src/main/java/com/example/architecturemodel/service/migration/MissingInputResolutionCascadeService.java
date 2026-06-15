package com.example.architecturemodel.service.migration;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.MissingInputResolutionDto;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Coordinator service composing the audit-preserving soft-delete from
 * {@link MissingInputResolutionService} with the cross-story cascade from
 * {@link MissingInputCrossStoryMatcherService}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 3.</p>
 *
 * <h2>Why a separate coordinator (vs extending {@code MissingInputResolutionService})</h2>
 * Keeping {@link MissingInputResolutionService#softDelete(UUID, UUID, String)}
 * narrow preserves a composable boundary so future cross-cutting flows (e.g.
 * project-level "reset all resolutions" in a Wave-2 follow-up) can re-use the
 * audit-preserving primitive without re-importing the cascade machinery.
 * Mirrors the AMS pattern where the audit-only write lives at the lower layer
 * and the cross-aggregate side-effects live at a coordinator above.
 *
 * <h2>Cascade contract</h2>
 * In a single transaction (the {@code @Transactional} on
 * {@link #softDeleteWithCascade(UUID, UUID, String)}):
 * <ol>
 *   <li>Load the resolution row to observe its prior {@code soft_deleted}
 *       state. If the row is ALREADY soft-deleted, short-circuit: the cascade
 *       must NOT re-flip dependent specs (idempotency rule from spec.md). The
 *       audit channels on the resolution itself are still refreshed by the
 *       primitive {@link MissingInputResolutionService#softDelete} per its
 *       own idempotency contract.</li>
 *   <li>Delegate to {@link MissingInputResolutionService#softDelete(UUID, UUID, String)}
 *       to flip {@code soft_deleted=true} and stamp the audit channels on the
 *       resolution row.</li>
 *   <li>Capture the resolution's {@code missing_input_key} from the returned
 *       DTO.</li>
 *   <li>Walk every spec in the project whose {@code missing_input_keys_json}
 *       contains that key (via
 *       {@link MissingInputCrossStoryMatcherService#findAffectedSpecs(UUID, String)}).</li>
 *   <li>For each affected spec:
 *     <ul>
 *       <li>If status is {@code generated} or {@code generated_with_warnings},
 *           flip to {@code insufficient_context}.</li>
 *       <li>Always set {@code stale=true},
 *           {@code stale_reason='resolution_reset'},
 *           {@code stale_marked_at=now()} (the audit-trail rule from spec.md
 *           line 42: even an already-{@code insufficient_context} row gets the
 *           stale fields stamped on the FIRST cascade pass).</li>
 *     </ul>
 *   </li>
 *   <li>Return the count of affected specs and their ids so the controller can
 *       surface the cascade impact to the user without a follow-up fetch.</li>
 * </ol>
 *
 * <h2>Idempotency</h2>
 * Calling cascade twice for an already-soft-deleted resolution returns
 * {@code affectedSpecCount=0} (the prior-state probe in step 1 short-circuits
 * the spec-side mutations). The audit channels on the resolution itself are
 * still refreshed by the underlying primitive.
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class MissingInputResolutionCascadeService {

    /**
     * Stale-reason vocabulary value applied by this cascade. Mirrors the DB
     * CHECK constraint {@code chk_msg_stale_reason} on
     * {@code migration_story_spec_generations} (changeset 150). The other
     * value, {@code target_architecture_changed}, is owned by the target-
     * architecture authoring flow.
     */
    public static final String STALE_REASON_RESOLUTION_RESET = "resolution_reset";

    private final MissingInputResolutionService resolutionService;
    private final MissingInputResolutionRepository resolutionRepository;
    private final MissingInputCrossStoryMatcherService matcherService;
    private final MigrationStorySpecGenerationRepository specRepository;

    /**
     * Soft-delete the supplied resolution AND cascade the staleness to every
     * spec in the project whose {@code missing_input_keys_json} contains the
     * resolution's key.
     *
     * <p>One transaction; idempotent on repeat calls per the class-level
     * contract: the second call returns
     * {@code affectedSpecCount=0} because the prior-state probe sees the row
     * already soft-deleted and short-circuits the spec-side mutations.</p>
     *
     * @param projectId      owning project UUID
     * @param resolutionId   id of the resolution to soft-delete
     * @param deletedBy      audit channel: user/principal performing the reset
     * @return               summary carrying the soft-deleted resolution DTO,
     *                       count of cascaded specs, and affected spec ids
     * @throws ResourceNotFoundException  if the resolution does not exist or
     *                                    belongs to a different project
     */
    @Transactional
    public CascadeResult softDeleteWithCascade(
            UUID projectId, UUID resolutionId, String deletedBy) {
        // Step 1: probe prior state for idempotency. If the row already exists
        // with soft_deleted=true, we still let the primitive refresh the audit
        // channels (latest-reset-wins) but we skip the cross-story cascade so
        // dependent specs are not re-stamped.
        boolean wasAlreadySoftDeleted = false;
        if (resolutionId != null) {
            Optional<MissingInputResolutionEntity> existing =
                resolutionRepository.findById(resolutionId);
            if (existing.isPresent() && projectId != null
                    && projectId.equals(existing.get().getProjectId())) {
                wasAlreadySoftDeleted = Boolean.TRUE.equals(existing.get().getSoftDeleted());
            }
        }

        // Step 2: flip the resolution (delegate). Project-scope enforcement,
        // audit-stamp, idempotency at the resolution layer all live in the
        // primitive. Throws 404 on cross-project / missing row.
        MissingInputResolutionDto softDeleted =
            resolutionService.softDelete(projectId, resolutionId, deletedBy);
        String key = softDeleted.missingInputKey();

        // Step 3: if the resolution was already soft-deleted BEFORE this call,
        // the cross-story cascade is a no-op (idempotency rule). The audit
        // channels were still refreshed by the primitive above.
        if (wasAlreadySoftDeleted) {
            log.info(
                "[diag-ams] missing_input_resolution cascade_idempotent_noop"
                    + " resolutionId={} projectId={} key={}",
                resolutionId, shortPrefix(projectId), key);
            return new CascadeResult(softDeleted, 0, List.of());
        }

        // Step 4: discover dependent specs in the project.
        List<MigrationStorySpecGenerationEntity> affected =
            matcherService.findAffectedSpecs(projectId, key);

        if (affected == null || affected.isEmpty()) {
            log.info(
                "[diag-ams] missing_input_resolution cascade_no_affected_specs"
                    + " resolutionId={} projectId={} key={}",
                resolutionId, shortPrefix(projectId), key);
            return new CascadeResult(softDeleted, 0, List.of());
        }

        // Step 5: stamp stale fields + flip status when applicable.
        Instant now = Instant.now();
        List<UUID> affectedSpecIds = new ArrayList<>(affected.size());
        int flipped = 0;
        for (MigrationStorySpecGenerationEntity spec : affected) {
            if (spec == null) continue;
            boolean wasSuccessful =
                MigrationStorySpecGenerationStatus.GENERATED.equals(spec.getStatus())
                    || MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS
                        .equals(spec.getStatus());
            if (wasSuccessful) {
                spec.setStatus(MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT);
                flipped++;
            }
            // Always stamp the stale fields (audit-trail rule: an already-
            // insufficient_context row still gets the stamp on the first
            // cascade pass).
            spec.setStale(Boolean.TRUE);
            spec.setStaleReason(STALE_REASON_RESOLUTION_RESET);
            spec.setStaleMarkedAt(now);
            spec.setUpdatedAt(now);
            MigrationStorySpecGenerationEntity saved = specRepository.save(spec);
            if (saved.getId() != null) {
                affectedSpecIds.add(saved.getId());
            }
        }

        log.info(
            "[diag-ams] missing_input_resolution cascade_completed resolutionId={}"
                + " projectId={} key={} affected={} statusFlipped={}",
            resolutionId, shortPrefix(projectId), key, affected.size(), flipped);

        return new CascadeResult(softDeleted, affectedSpecIds.size(), affectedSpecIds);
    }

    // -----------------------------------------------------------------------
    // Response shape
    // -----------------------------------------------------------------------

    /**
     * Carrier for the cascade outcome: the audited resolution DTO, the count
     * of cascaded specs, and the affected spec ids. The controller layer
     * (Task Group 4) flattens this into the DELETE endpoint's response body.
     *
     * @param resolution         the soft-deleted resolution DTO (audit snapshot)
     * @param affectedSpecCount  count of spec rows that received the stale
     *                           stamp (== {@code affectedSpecIds.size()})
     * @param affectedSpecIds    spec-generation row ids that were cascaded
     */
    public record CascadeResult(
        MissingInputResolutionDto resolution,
        Integer affectedSpecCount,
        List<UUID> affectedSpecIds
    ) {}

    /**
     * Reference to the underlying matcher service so callers that need both
     * the cascade and a separate readiness check can avoid double-wiring.
     * Test fixtures and Task Group 4 controllers use this for read-only paths.
     */
    public MissingInputCrossStoryMatcherService getMatcherService() {
        return matcherService;
    }

    private static String shortPrefix(UUID id) {
        if (id == null) return "00000000";
        String s = id.toString();
        return s.substring(0, Math.min(8, s.length()));
    }
}
