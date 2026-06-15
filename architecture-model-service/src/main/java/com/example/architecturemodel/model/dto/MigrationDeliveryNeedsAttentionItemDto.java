package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.UUID;

/**
 * A single row in the needs-attention panel.
 *
 * <p>Rows surface in the priority order
 * {@code failed > insufficient_context > blocked > not_saved_to_backlog
 * > generated_with_warnings}; {@code generated_with_warnings} rows are
 * suppressed once the corresponding implementation activity is past
 * {@code not_started} (Q-1, AC 7).</p>
 *
 * <p><b>Addition C (AC 8).</b> For rows with {@code type='insufficient_context'},
 * the {@link #missingInputs()} field carries the entries from the
 * spec-generation row's {@code missing_inputs_json[]} verbatim. The list is
 * {@code null} (or empty) for rows of any other type so the field is purely
 * additive on the wire.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 7, AC 8. Task Group 2.</p>
 *
 * @param bookItemId           Stable id of the offending node from {@code book_of_work_json.items[].id}.
 * @param workItemId           Stored WorkItem UUID, when known (Addition B); nullable.
 * @param type                 The needs-attention category: one of
 *                             {@code failed | insufficient_context | blocked
 *                             | not_saved_to_backlog | generated_with_warnings}.
 * @param priorityRank         0-based priority slot (0 = highest). The list is also pre-ordered.
 * @param title                Display title from the book item.
 * @param workstream           Optional workstream label.
 * @param specGenerationStatus Latest spec-generation status (nullable for non-spec rows).
 * @param specGenerationConfidence Latest spec-generation confidence (nullable).
 * @param implementationStatus Implementation status (derived from the workspace; nullable).
 * @param reason               Short human-readable label explaining inclusion in this list.
 * @param missingInputs        Optional list of {@link MissingInputEntry} for
 *                             {@code type='insufficient_context'} rows (Addition C).
 *                             {@code null} or empty for any other type.
 */
public record MigrationDeliveryNeedsAttentionItemDto(
    @JsonProperty("book_item_id")
    String bookItemId,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("type")
    String type,

    @JsonProperty("priority_rank")
    Integer priorityRank,

    @JsonProperty("title")
    String title,

    @JsonProperty("workstream")
    String workstream,

    @JsonProperty("spec_generation_status")
    String specGenerationStatus,

    @JsonProperty("spec_generation_confidence")
    String specGenerationConfidence,

    @JsonProperty("implementation_status")
    String implementationStatus,

    @JsonProperty("reason")
    String reason,

    @JsonProperty("missing_inputs")
    List<MissingInputEntry> missingInputs
) {}
