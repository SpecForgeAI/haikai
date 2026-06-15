package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-test-item}.
 *
 * <p>Spec 2026-06-14 Holistic Integration/E2E TEST Work Items (Spec 2 of 4).
 * The gateway's headless holistic-review handler calls this endpoint once per
 * generated integration/E2E test to create a first-class {@code TEST} work item
 * placed as a SIBLING of the feature's stories (or the epic's features):</p>
 * <ul>
 *   <li>creates the {@code work_item} row ({@code type='TEST'},
 *       {@code parentId = parent_work_item_id}, {@code status='PLANNED'},
 *       {@code sortOrder = sequence_order}), reusing the same per-item create
 *       collaborator as save-to-backlog ({@code persistOne}); AND</li>
 *   <li>appends a {@code book_of_work_json.items[]} blob item
 *       ({@code type:"TEST"}, {@code parentId = parent_book_item_id},
 *       {@code sequenceOrder = sequence_order}) with the created
 *       {@code workItemId} + {@code saveState="saved"} stamped on it -- all in
 *       ONE transaction (mirrors the save-to-backlog write-back).</li>
 * </ul>
 *
 * <p>Unlike {@code items/append} (the discovery epic-expansion path, DRAFT-only
 * + epic/feature-parent + expansion-state stamping), this endpoint targets a
 * SAVED book and appends a single non-epic/feature TEST sibling. No new
 * Liquibase changeset is required ({@code TEST} is already an allowed
 * {@code WorkItem} type; {@code book_of_work_json} is JSONB).</p>
 *
 * <p>Snake_case wire shape per AMS convention (the gateway client serialises
 * snake_case).</p>
 */
public record AppendTestItemRequest(

    /** The blob-item id of the parent FEATURE/EPIC node (the TEST item's blob parentId). */
    @JsonProperty("parent_book_item_id")
    String parentBookItemId,

    /**
     * The parent FEATURE/EPIC {@code WorkItem} UUID (the created TEST item's
     * {@code parentId}). MAY be null when the parent was never saved to backlog
     * -- the TEST WorkItem is then created without a parent link.
     */
    @JsonProperty("parent_work_item_id")
    String parentWorkItemId,

    /** The TEST item title (the integration/E2E test title). */
    @JsonProperty("title")
    String title,

    /** The TEST item description. */
    @JsonProperty("description")
    String description,

    /**
     * The sibling display order: {@code max(child sequenceOrder/sortOrder) + 1}
     * computed gateway-side (D4). Used for BOTH the blob {@code sequenceOrder}
     * and the {@code work_item.sortOrder}.
     */
    @JsonProperty("sequence_order")
    Integer sequenceOrder
) {}
