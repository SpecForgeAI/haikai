package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing a lane in the User Journey Overview diagram contract v1.
 * Each lane corresponds to a unique Business Process that groups User Journeys.
 */
public record UserJourneyOverviewLaneDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("order")
    int order
) {}
