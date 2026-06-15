package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Per-workstream roll-up of story counts by lifecycle phase.
 *
 * <p>One row per distinct {@code workstream} value across the book's story
 * items. The frontend workstream-progress strip renders one row per entry.</p>
 *
 * <p>All counts are boxed {@link Long} so any future PATCH/merge code path
 * cannot silently wipe a count to {@code 0}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 6. Task Group 2.</p>
 *
 * @param workstream            Workstream label (free-text from book item metadata).
 * @param totalStoryCount       Total stories in this workstream.
 * @param savedToBacklogCount   Stories with {@code backlogStatus='saved'}.
 * @param specGeneratedCount    Stories whose latest spec-generation is in {@code generated} or {@code generated_with_warnings}.
 * @param implementationActiveCount  Stories whose implementation workspace shows activity past {@code not_started}.
 * @param evidenceCoveredCount  Stories with at least one populated evidence/discovery/baseline/mapping/architecture ref.
 * @param needsAttentionCount   Stories from this workstream surfaced in the needs-attention panel.
 */
public record MigrationDeliveryWorkstreamSummaryDto(
    @JsonProperty("workstream")
    String workstream,

    @JsonProperty("total_story_count")
    Long totalStoryCount,

    @JsonProperty("saved_to_backlog_count")
    Long savedToBacklogCount,

    @JsonProperty("spec_generated_count")
    Long specGeneratedCount,

    @JsonProperty("implementation_active_count")
    Long implementationActiveCount,

    @JsonProperty("evidence_covered_count")
    Long evidenceCoveredCount,

    @JsonProperty("needs_attention_count")
    Long needsAttentionCount
) {}
