package com.example.architecturemodel.model.dto.discovery;

import java.util.Map;

/**
 * Response body for {@code POST .../findings/bulk-review}.
 *
 * <p>{@code deltaByFromStatus} is server-computed via a pre-mutation
 * {@code entity.getReviewStatus()} accumulator inside the bulk service loop
 * (accepted Q1) so the frontend optimistic-delta is exact rather than
 * approximate. Keys are the stored disposition strings:
 * {@code pending_review}, {@code approved}, {@code rejected},
 * {@code deferred} (candidate-parity vocabulary; renamed by Spec F).</p>
 *
 * <p>{@code skippedByReason} breaks {@code skippedCount} down into rows whose
 * current disposition already equals the requested disposition
 * ({@code alreadyInTarget}). The {@code transitionNotAllowed} field is
 * RETAINED for response-shape stability but is now ALWAYS {@code 0}:
 * transitions are unrestricted (any-&gt;any) under Spec F, so no row is ever
 * skipped for a forbidden transition.</p>
 *
 * <p>Wire format is snake_case (global Jackson SNAKE_CASE strategy);
 * {@code deltaByFromStatus} -&gt; {@code delta_by_from_status},
 * {@code skippedByReason} -&gt; {@code skipped_by_reason},
 * {@code transitionNotAllowed} -&gt; {@code transition_not_allowed}.</p>
 *
 * <p>Spec: Bulk Findings Actions (2026-05-28); normalized by Normalize
 * Findings Review Actions (Spec F, 2026-06-02).</p>
 */
public record BulkReviewDiscoveryFindingsResponse(
    int updatedCount,
    int skippedCount,
    SkippedByReason skippedByReason,
    Map<String, Integer> deltaByFromStatus
) {

    /**
     * Breakdown of {@code skippedCount}.
     *
     * <p>{@code alreadyInTarget} counts rows whose current
     * {@code review_status} already equals the requested disposition.
     * {@code transitionNotAllowed} is RETAINED for response-shape stability
     * (the frontend reads it) but is ALWAYS {@code 0} under Spec F --
     * transitions are unrestricted, so no row is skipped for a forbidden
     * transition.</p>
     */
    public record SkippedByReason(
        int alreadyInTarget,
        int transitionNotAllowed
    ) {}
}
