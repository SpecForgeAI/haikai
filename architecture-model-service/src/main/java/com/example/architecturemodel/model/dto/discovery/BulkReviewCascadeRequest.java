package com.example.architecturemodel.model.dto.discovery;

import java.util.List;
import java.util.UUID;

/**
 * Request body for {@code POST .../candidates/bulk-review-cascade}.
 *
 * <p>The ATOMIC cascade-aware bulk reviewer-action entry point added by Spec 2
 * (Cascade-aware Bulk Review + Reject Suppression, 2026-06-02). It applies ONE
 * review disposition ({@code approved} / {@code rejected} / {@code deferred})
 * across an EXPLICIT, CURATED set spanning BOTH discovery candidates AND
 * discovery findings in a SINGLE transaction. The curated id sets are resolved
 * client-side from the Spec 1 blast-radius preview (the user may deselect any
 * cascaded dependent before applying), so the server takes the ids verbatim and
 * does NOT re-derive the cascade.</p>
 *
 * <p>Unlike {@link BulkReviewDiscoveryFindingsRequest} (which supports an
 * {@code ids}-OR-{@code filter} resolution over a single entity kind), this
 * request carries TWO explicit id lists -- {@code candidateIds} and
 * {@code findingIds} -- because the cascade set is always an explicit
 * client-curated selection, never a server-side filter. Either list may be
 * empty (e.g. a candidate with no linked findings sends an empty
 * {@code findingIds}); a request with both empty is a no-op.</p>
 *
 * <p>{@code reviewStatus} must be a reviewer-valid disposition:
 * {@code approved}, {@code rejected}, or {@code deferred} (candidate-parity
 * vocabulary shared with {@code DiscoveryCandidateService.reviewCandidate} and
 * {@code DiscoveryFindingService.bulkReview}). Transitions are unrestricted
 * (any-&gt;any); same-disposition rows are counted as already-in-target.</p>
 *
 * <p>Wire format is snake_case (global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}); no {@code @JsonNaming} / {@code @CamelCaseWire}
 * annotation needed. {@code candidateIds} -&gt; {@code candidate_ids},
 * {@code findingIds} -&gt; {@code finding_ids}, {@code reviewStatus} -&gt;
 * {@code review_status}, {@code reviewerNotes} -&gt; {@code reviewer_notes}.</p>
 *
 * <p>Spec: Cascade-aware Bulk Review + Reject Suppression (Spec 2,
 * 2026-06-02) -- Task Group 1; modelled on
 * {@link BulkReviewDiscoveryFindingsRequest}.</p>
 */
public record BulkReviewCascadeRequest(
    List<UUID> candidateIds,
    List<UUID> findingIds,
    String reviewStatus,
    String reviewerNotes
) {}
