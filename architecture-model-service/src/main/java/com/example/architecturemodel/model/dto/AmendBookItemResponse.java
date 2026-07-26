package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response body for the {@code items/{bookItemId}/amend} endpoint.
 * Snake_case wire per AMS convention.
 */
public record AmendBookItemResponse(

    /** The amended blob item id. */
    @JsonProperty("book_item_id")
    String bookItemId,

    /** The linked {@code work_item} UUID (null when the story was never saved). */
    @JsonProperty("work_item_id")
    String workItemId,

    /** The finding cited by this amendment (null when none supplied). */
    @JsonProperty("finding_id")
    String findingId,

    /**
     * How many spec-generation rows were marked stale (0 when the story has no
     * generated spec yet — nothing to invalidate; the spec-readiness gate
     * already reads "no spec" as not-ready).
     */
    @JsonProperty("specs_marked_stale")
    Integer specsMarkedStale,

    @JsonProperty("message")
    String message
) {}
