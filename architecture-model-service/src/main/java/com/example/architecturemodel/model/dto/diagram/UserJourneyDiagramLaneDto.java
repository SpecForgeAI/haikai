package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing a lane in the User Journey diagram contract v1.
 * Each lane corresponds to a unique Application referenced by the journey's ActivitySteps.
 */
public record UserJourneyDiagramLaneDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("order")
    int order
) {}
