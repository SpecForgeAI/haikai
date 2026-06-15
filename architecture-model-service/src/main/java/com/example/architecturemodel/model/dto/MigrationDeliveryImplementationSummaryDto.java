package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Per-status counts roll-up of implementation-workspace state across the
 * book's story items.
 *
 * <p>Implementation status is derived strictly from existing
 * {@code WorkItemImplementWorkspace} JSONB fields; the service never invents
 * completion state.</p>
 *
 * <p>The {@link #activeCount()} field uses the 14-day staleness window from
 * Q-1 (a story counts as "active" if its {@code WorkItem.updatedAt} is within
 * the last 14 days at dashboard read time).</p>
 *
 * <p>All counts are boxed {@link Long} so any future PATCH/merge code path
 * cannot silently wipe a count to {@code 0}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * AC 3, Q-1. Task Group 2.</p>
 *
 * @param notStartedCount Stories with a workspace at {@code not_started} (or no workspace).
 * @param inProgressCount Stories whose workspace shows activity past {@code not_started}.
 * @param blockedCount    Stories with an explicitly blocked workspace status (Q-1: never inferred).
 * @param completedCount  Stories with a completed workspace status (taken from the workspace fields verbatim).
 * @param activeCount     Stories considered "active" under the 14-day staleness window (Q-1).
 */
public record MigrationDeliveryImplementationSummaryDto(
    @JsonProperty("not_started_count")
    Long notStartedCount,

    @JsonProperty("in_progress_count")
    Long inProgressCount,

    @JsonProperty("blocked_count")
    Long blockedCount,

    @JsonProperty("completed_count")
    Long completedCount,

    @JsonProperty("active_count")
    Long activeCount
) {}
