package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ProcessActivityDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("business_process_id")
    String businessProcessId,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("sequence_order")
    Integer sequenceOrder,

    @JsonProperty("frequency")
    String frequency,

    @JsonProperty("actor_hint")
    String actorHint,

    @JsonProperty("user_interaction_level")
    String userInteractionLevel,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
