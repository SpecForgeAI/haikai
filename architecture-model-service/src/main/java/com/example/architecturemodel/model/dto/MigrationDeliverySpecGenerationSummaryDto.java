package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Per-status counts roll-up across the book's spec-generation rows. Counts are
 * computed against the latest {@code generation_attempt_number} per WorkItem
 * (only the most recent attempt counts, regardless of how many regenerate runs
 * preceded it).
 *
 * <p>All counts are boxed {@link Long} so any future PATCH/merge code path
 * cannot silently wipe a count to {@code 0}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 3. Task Group 2.</p>
 *
 * @param notAttemptedCount        Stories with no spec-generation row at all (lazy not_attempted).
 * @param generatedCount           Stories whose latest row is {@code generated}.
 * @param generatedWithWarningsCount Stories whose latest row is {@code generated_with_warnings}.
 * @param insufficientContextCount Stories whose latest row is {@code insufficient_context}.
 * @param failedCount              Stories whose latest row is {@code failed}.
 * @param skippedBlockedCount      Stories whose latest row is {@code skipped_blocked}.
 */
public record MigrationDeliverySpecGenerationSummaryDto(
    @JsonProperty("not_attempted_count")
    Long notAttemptedCount,

    @JsonProperty("generated_count")
    Long generatedCount,

    @JsonProperty("generated_with_warnings_count")
    Long generatedWithWarningsCount,

    @JsonProperty("insufficient_context_count")
    Long insufficientContextCount,

    @JsonProperty("failed_count")
    Long failedCount,

    @JsonProperty("skipped_blocked_count")
    Long skippedBlockedCount
) {}
