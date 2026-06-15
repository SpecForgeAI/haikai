package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.UUID;

/**
 * Response body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/add-item}.
 *
 * <p>Spec: D5 — Net-new backlog items + provenance (2026-06-14, Spec 5 of 6).
 * Returns the created {@code STORY} {@code WorkItem} UUID and the new
 * {@code book_of_work_json} blob-item id so the gateway can trigger
 * description-grounded spec-gen for that one {@code workItemId} (the dashboard
 * join is exclusively by stored {@code workItemId}; title-matching is forbidden),
 * plus the {@code provenance} + {@code kind} echoed back for caller convenience /
 * provenance assertions.</p>
 *
 * <p>Snake_case wire shape per AMS convention. Mirrors
 * {@link AppendCapabilityStoryResponse}.</p>
 */
public record AddWorkItemResponse(

    /** The created {@code STORY} {@code WorkItem} UUID. */
    @JsonProperty("work_item_id")
    UUID workItemId,

    /** The id of the newly-appended {@code book_of_work_json} blob item. */
    @JsonProperty("book_item_id")
    String bookItemId,

    /**
     * The provenance stamped on BOTH the {@code work_item.provenance} COLUMN and
     * the blob item ({@code carry_over} | {@code net_new}).
     */
    @JsonProperty("provenance")
    String provenance,

    /** The prompt flavour echoed back ({@code api} | {@code operational}). */
    @JsonProperty("kind")
    String kind,

    @JsonProperty("message")
    String message
) {}
