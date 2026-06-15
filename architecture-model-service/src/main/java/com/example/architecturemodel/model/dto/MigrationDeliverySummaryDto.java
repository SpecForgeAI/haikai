package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * High-level counts roll-up across the entire generated book of work.
 *
 * <p>One of the five sibling {@code *Summary} DTOs surfaced on
 * {@link MigrationDeliveryDashboardDto}. This summary is the umbrella roll-up
 * (counts spanning all initiatives / epics / features / stories);
 * the four sibling {@code *Summary} DTOs (spec-generation, backlog-save,
 * implementation, evidence) decompose specific concerns.</p>
 *
 * <p>All counts are boxed {@link Long} so that any future PATCH/merge code
 * paths cannot silently wipe a count to {@code 0} per
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 3, AC 17. Task Group 2.</p>
 *
 * @param totalInitiativeCount Total number of initiative nodes in the hierarchy.
 * @param totalEpicCount       Total number of epic nodes in the hierarchy.
 * @param totalFeatureCount    Total number of feature nodes in the hierarchy.
 * @param totalStoryCount      Total number of story nodes. The frontend uses
 *                             this to drive the {@code >500} soft warning
 *                             banner (Q-2 / AC 17); the service also appends
 *                             a {@code warnings[]} entry when this exceeds
 *                             the threshold.
 * @param needsAttentionCount  Count of rows surfaced in the needs-attention
 *                             panel after priority-order suppression.
 */
public record MigrationDeliverySummaryDto(
    @JsonProperty("total_initiative_count")
    Long totalInitiativeCount,

    @JsonProperty("total_epic_count")
    Long totalEpicCount,

    @JsonProperty("total_feature_count")
    Long totalFeatureCount,

    @JsonProperty("total_story_count")
    Long totalStoryCount,

    @JsonProperty("needs_attention_count")
    Long needsAttentionCount
) {}
