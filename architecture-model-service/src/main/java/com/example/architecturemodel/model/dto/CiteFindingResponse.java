package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Response body for the {@code items/{bookItemId}/cite-finding} endpoint.
 * Snake_case wire per AMS convention.
 */
public record CiteFindingResponse(

    /** The blob item the finding was cited onto. */
    @JsonProperty("book_item_id")
    String bookItemId,

    /** The cited finding id. */
    @JsonProperty("finding_id")
    String findingId,

    /** True when the finding was ALREADY cited (idempotent no-op). */
    @JsonProperty("already_cited")
    Boolean alreadyCited,

    @JsonProperty("message")
    String message
) {}
