package com.example.architecturemodel.model.dto.discovery;

import java.util.List;
import java.util.UUID;

/**
 * Request body for {@code POST .../findings/bulk-review}.
 *
 * <p>Bulk reviewer disposition-transition entry point. Either {@code ids} OR
 * {@code filter} may be supplied (mutually exclusive). When neither is
 * supplied, the request implicitly targets every finding in the run.</p>
 *
 * <p>{@code review_status} must be a reviewer-valid disposition:
 * {@code approved}, {@code rejected}, or {@code deferred} (candidate-parity
 * vocabulary). Transitions are unrestricted (any-&gt;any); same-disposition
 * rows are counted as already-in-target.</p>
 *
 * <p>The nested {@link Filter} record is the FIRST findings-side Java filter
 * DTO. Field names mirror the 12 {@code @RequestParam}s of the GET list
 * endpoint on {@code DiscoveryFindingController} so the structured nested
 * object is interchangeable with the query-string envelope used by the
 * single-row list path.</p>
 *
 * <p>Wire format is snake_case (global Jackson
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}); no {@code @JsonNaming} annotation needed.
 * {@code reviewStatus} -&gt; {@code review_status}.</p>
 *
 * <p>Spec: Bulk Findings Actions (2026-05-28); normalized by Normalize
 * Findings Review Actions (Spec F, 2026-06-02).</p>
 */
public record BulkReviewDiscoveryFindingsRequest(
    List<UUID> ids,
    Filter filter,
    String reviewStatus,
    String reviewerNotes
) {

    /**
     * Nested filter record mirroring the 12 {@code @RequestParam}s of the
     * GET list endpoint on {@code DiscoveryFindingController}. All fields are
     * nullable; a null/blank field disables that filter. {@code reviewStatus}
     * filters on the renamed {@code review_status} column.
     */
    public record Filter(
        String category,
        String findingType,
        String severity,
        String reviewStatus,
        String source,
        String createdByStage,
        String linkedTargetType,
        String linkedTargetId,
        String text
    ) {}
}
