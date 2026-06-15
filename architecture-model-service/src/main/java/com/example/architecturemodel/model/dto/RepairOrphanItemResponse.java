package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/{bookItemId}/repair-orphan}.
 *
 * <p>Returned when the dashboard's "Repair" button has cleared a stale
 * {@code workItemId} on {@code book_of_work_json.items[].workItemId} and
 * re-attempted save-to-backlog for that single item.</p>
 *
 * @param bookItemId       The stable id of the repaired item.
 * @param priorWorkItemId  The orphan id that was cleared (may be null when the
 *                         item had never been saved).
 * @param newWorkItemId    The id of the freshly-created WorkItem.
 * @param message          Short human-readable result blurb.
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19)
 * follow-up #2 -- orphan workItemId repair.</p>
 */
public record RepairOrphanItemResponse(
    @JsonProperty("book_item_id")
    String bookItemId,

    @JsonProperty("prior_work_item_id")
    UUID priorWorkItemId,

    @JsonProperty("new_work_item_id")
    UUID newWorkItemId,

    @JsonProperty("message")
    String message
) {}
