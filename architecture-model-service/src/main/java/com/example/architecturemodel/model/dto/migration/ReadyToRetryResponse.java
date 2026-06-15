package com.example.architecturemodel.model.dto.migration;

import java.util.List;
import java.util.UUID;

/**
 * Response shape for
 * {@code GET /api/projects/{projectId}/spec-generations/ready-to-retry}.
 *
 * <p>Spec: Missing Input Resolver Flow (2026-05-20) -- Task Group 4.</p>
 *
 * <p>Carries the integer count, the list of spec-generation ids, and one
 * {@link ReadyToRetrySpec} per ready story. A spec is "ready" only when every
 * entry in its {@code missing_input_keys_json} has an active (non-soft-deleted)
 * resolution -- the rule is owned by {@code MissingInputCrossStoryMatcherService}.</p>
 *
 * <p>The {@code title} field on {@link ReadyToRetrySpec} is intentionally
 * nullable: AMS does not join to {@code work_items} to populate it; the
 * dashboard hydrates the label client-side from its cached WorkItem map. The
 * field is reserved for future controller-layer enrichment.</p>
 *
 * <p>All fields are boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 */
public record ReadyToRetryResponse(
    Integer count,
    List<UUID> specGenerationIds,
    List<ReadyToRetrySpec> specs
) {

    /**
     * One ready story row. {@code totalKeys} equals {@code resolvedKeys} for
     * every entry in {@link ReadyToRetryResponse#specs()} -- the matcher service
     * only surfaces rows where the readiness invariant holds.
     *
     * @param specGenerationId      spec-generation row UUID
     * @param workItemId            owning WorkItem UUID
     * @param title                 optional display title (may be null;
     *                              dashboard hydrates client-side)
     * @param totalKeys             count of keys in
     *                              {@code missing_input_keys_json}
     * @param missingInputKeyCount  duplicate of {@code totalKeys} surfaced
     *                              under the spec name documented in tasks.md
     *                              ("missingInputKeyCount") for frontend parity
     * @param resolvedKeys          count of resolved keys (== totalKeys here)
     */
    public record ReadyToRetrySpec(
        UUID specGenerationId,
        UUID workItemId,
        String title,
        Integer totalKeys,
        Integer missingInputKeyCount,
        Integer resolvedKeys
    ) {}
}
