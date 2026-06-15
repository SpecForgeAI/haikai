package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UserJourneyLinkDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("source_user_journey_id")
    String sourceUserJourneyId,

    @JsonProperty("target_user_journey_id")
    String targetUserJourneyId,

    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("label")
    String label,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags
) {}
