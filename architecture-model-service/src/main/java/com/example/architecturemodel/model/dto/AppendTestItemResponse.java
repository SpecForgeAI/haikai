package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-test-item}.
 *
 * <p>Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4).
 * Returns the created {@code TEST} {@code WorkItem} UUID and the new
 * {@code book_of_work_json} blob-item id so the gateway can key the TEST item's
 * {@code migration_story_spec_generations} row + {@code implement-state.json}
 * on the {@code workItemId} (the dashboard join is exclusively by stored
 * {@code workItemId}; title-matching is forbidden).</p>
 *
 * <p>Snake_case wire shape per AMS convention.</p>
 */
public record AppendTestItemResponse(

    /** The created TEST {@code WorkItem} UUID. */
    @JsonProperty("work_item_id")
    UUID workItemId,

    /** The id of the newly-appended {@code book_of_work_json} blob item. */
    @JsonProperty("book_item_id")
    String bookItemId,

    @JsonProperty("message")
    String message
) {}
