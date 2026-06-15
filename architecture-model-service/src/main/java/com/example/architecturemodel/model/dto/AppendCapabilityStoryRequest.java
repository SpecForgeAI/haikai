package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for
 * {@code POST /api/projects/{projectId}/migration-books-of-work/{bookId}/items/append-capability-story}.
 *
 * <p>Spec: D3 — Internal-behaviour implementation-ready spec generation
 * (2026-06-14, Spec 3 of 6). The gateway's explicit per-capability trigger calls
 * this endpoint once per approved {@code discovery_capability} to mint a
 * first-class {@code STORY} work item that the already-built migration spec
 * generator then picks up UNCHANGED:</p>
 * <ul>
 *   <li>creates the {@code work_item} row ({@code type='STORY'},
 *       {@code status='PLANNED'}, {@code sortOrder = sequence_order}), reusing the
 *       same per-item create collaborator as save-to-backlog
 *       ({@code persistOne}); AND</li>
 *   <li>appends a {@code book_of_work_json.items[]} blob item
 *       ({@code type:"story"}, {@code sequenceOrder = sequence_order}) with the
 *       created {@code workItemId} + {@code saveState="saved"} +
 *       {@code source_capability_id} stamped on it — all in ONE transaction
 *       (mirrors {@code append-test-item} / the save-to-backlog write-back).</li>
 * </ul>
 *
 * <p>Modelled EXACTLY on {@link AppendTestItemRequest}, with two differences:
 * (1) the blob {@code type} is the lowercase {@code "story"} so the gateway's
 * {@code selectEligibleStories} ({@code it.type === 'story'}) consumes it; and
 * (2) {@link #parentBookItemId} is OPTIONAL — a capability story is a top-level
 * story, not a sibling under a feature/epic — whereas {@code append-test-item}
 * requires a parent blob node. The {@link #sourceCapabilityId} provenance rides
 * the blob (NO DDL — changesets 181 + 184 already exist; no new changeset).</p>
 *
 * <p>Snake_case wire shape per AMS convention (the gateway client serialises
 * snake_case).</p>
 */
public record AppendCapabilityStoryRequest(

    /**
     * The originating {@code discovery_capability} UUID (string). Stamped onto
     * the created blob item as {@code source_capability_id} (provenance link, no
     * DDL). REQUIRED.
     */
    @JsonProperty("source_capability_id")
    String sourceCapabilityId,

    /** The story title (the capability label / modernisation headline). REQUIRED. */
    @JsonProperty("title")
    String title,

    /** The story description. */
    @JsonProperty("description")
    String description,

    /**
     * OPTIONAL parent blob-item id. A capability story is normally a top-level
     * story (no parent), so this is usually null; when supplied (and resolvable)
     * the created {@code STORY} work item parents to it, mirroring
     * {@code append-test-item}'s loose, existence-only parent validation.
     */
    @JsonProperty("parent_book_item_id")
    String parentBookItemId,

    /**
     * The display order: used for BOTH the blob {@code sequenceOrder} and the
     * {@code work_item.sortOrder}. Defaults to 0 when null.
     */
    @JsonProperty("sequence_order")
    Integer sequenceOrder
) {}
