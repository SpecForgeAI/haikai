package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Per-status counts roll-up of backlog-save state across the book's story items.
 *
 * <p>Driven by Addition B (AC 14): each item's backlog state is determined
 * strictly by whether its stored {@code book_of_work_json.items[].workItemId}
 * resolves to a matching WorkItem row. Title-matching is forbidden.</p>
 *
 * <p>Orphan stored ids (id present, no matching WorkItem) are counted under
 * {@link #notSavedToBacklogCount()} AND additionally surface as a
 * {@code warnings[]} entry per Q-5 (AC 15).</p>
 *
 * <p>All counts are boxed {@link Long} so any future PATCH/merge code path
 * cannot silently wipe a count to {@code 0}.</p>
 *
 * <p>Note: tasks.md Group 2 lists seven sibling summary DTOs but references a
 * {@code backlogSaveSummary} field on the dashboard DTO. This record fills
 * that field cleanly and avoids overloading
 * {@link MigrationDeliverySummaryDto} (the umbrella summary) with two
 * semantic uses.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * Addition B, AC 3, AC 14, AC 15. Task Group 2.</p>
 *
 * @param savedCount             Stories whose stored {@code workItemId} resolved to a WorkItem.
 * @param notSavedToBacklogCount Stories whose item carried no stored {@code workItemId}
 *                               OR carried an orphan id with no matching WorkItem.
 */
public record MigrationDeliveryBacklogSaveSummaryDto(
    @JsonProperty("saved_count")
    Long savedCount,

    @JsonProperty("not_saved_to_backlog_count")
    Long notSavedToBacklogCount
) {}
