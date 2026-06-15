package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-capability-story}.
 *
 * <p>Spec: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14, Spec 3 of 6). Returns the created {@code STORY} {@code WorkItem}
 * UUID and the new {@code book_of_work_json} blob-item id so the gateway can key
 * the story's {@code migration_story_spec_generations} row +
 * {@code implement-state.json} on the {@code workItemId} (the dashboard join is
 * exclusively by stored {@code workItemId}; title-matching is forbidden).</p>
 *
 * <p>Snake_case wire shape per AMS convention. Mirrors
 * {@link AppendTestItemResponse}.</p>
 */
public record AppendCapabilityStoryResponse(

    /** The created {@code STORY} {@code WorkItem} UUID. */
    @JsonProperty("work_item_id")
    UUID workItemId,

    /** The id of the newly-appended {@code book_of_work_json} blob item. */
    @JsonProperty("book_item_id")
    String bookItemId,

    /**
     * The originating {@code discovery_capability} UUID stamped onto the blob
     * item (echoed back for caller convenience / provenance assertions).
     */
    @JsonProperty("source_capability_id")
    String sourceCapabilityId,

    @JsonProperty("message")
    String message
) {}
