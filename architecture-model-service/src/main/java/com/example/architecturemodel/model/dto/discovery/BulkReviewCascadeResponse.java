package com.example.architecturemodel.model.dto.discovery;

import java.util.Map;

/**
 * Response body for {@code POST .../candidates/bulk-review-cascade}.
 *
 * <p>Returns PER-KIND sub-counts -- one {@link KindResult} block for the
 * candidate arm and one for the finding arm -- so the caller can render exact
 * per-entity-kind feedback after the atomic apply. Both blocks share the same
 * shape as {@link BulkReviewDiscoveryFindingsResponse} (the single-kind
 * finding bulk-review response) so the frontend can reuse its existing
 * optimistic-delta rendering for each block.</p>
 *
 * <p>{@code deltaByFromStatus} on each block is server-computed via a
 * pre-mutation {@code getReviewStatus()} accumulator inside the cascade service
 * loop so the frontend optimistic-delta is exact rather than approximate. Keys
 * are the stored disposition strings: {@code pending_review}, {@code approved},
 * {@code rejected}, {@code deferred} (candidate-parity vocabulary).</p>
 *
 * <p>{@code skippedByReason} breaks {@code skippedCount} down. For BOTH kinds,
 * {@code alreadyInTarget} counts rows whose current disposition already equals
 * the requested disposition (a no-op, not rewritten). For the CANDIDATE block,
 * {@code transitionNotAllowed} additionally counts {@code committed} candidates
 * (candidate {@code status == 'committed'}) that were SKIPPED rather than
 * transitioned -- a committed row is already persisted into the architecture
 * model and must not be re-dispositioned by a bulk action (mirrors the gateway
 * fan-out's {@code review_status !== 'committed'} skip and the grid's committed
 * exclusion). For the FINDING block, {@code transitionNotAllowed} is retained
 * for shape symmetry but is always {@code 0} (findings have no committed gate;
 * transitions are unrestricted under Spec F).</p>
 *
 * <p>Wire format is snake_case (global Jackson SNAKE_CASE strategy); no
 * {@code @CamelCaseWire} needed. {@code deltaByFromStatus} -&gt;
 * {@code delta_by_from_status}, {@code skippedByReason} -&gt;
 * {@code skipped_by_reason}, {@code transitionNotAllowed} -&gt;
 * {@code transition_not_allowed}, {@code updatedCount} -&gt;
 * {@code updated_count}, {@code skippedCount} -&gt; {@code skipped_count}.</p>
 *
 * <p>Spec: Cascade-aware Bulk Review + Reject Suppression (Spec 2,
 * 2026-06-02) -- Task Group 1; modelled on
 * {@link BulkReviewDiscoveryFindingsResponse}.</p>
 */
public record BulkReviewCascadeResponse(
    KindResult candidates,
    KindResult findings
) {

    /**
     * Per-entity-kind sub-counts. Mirrors the top-level shape of
     * {@link BulkReviewDiscoveryFindingsResponse} so each block renders with
     * the same client logic.
     */
    public record KindResult(
        int updatedCount,
        int skippedCount,
        SkippedByReason skippedByReason,
        Map<String, Integer> deltaByFromStatus
    ) {}

    /**
     * Breakdown of {@code skippedCount}.
     *
     * <p>{@code alreadyInTarget} counts rows whose current
     * {@code review_status} already equals the requested disposition.
     * {@code transitionNotAllowed} counts CANDIDATE rows skipped because they
     * are {@code committed} (candidate {@code status == 'committed'}); for the
     * finding block it is always {@code 0}.</p>
     */
    public record SkippedByReason(
        int alreadyInTarget,
        int transitionNotAllowed
    ) {}
}
