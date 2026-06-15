package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing an edge in the User Journey diagram contract v1.
 * Edges connect sequential steps in the journey flow.
 */
public record UserJourneyDiagramEdgeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("from_step_id")
    String fromStepId,

    @JsonProperty("to_step_id")
    String toStepId,

    @JsonProperty("order")
    int order,

    @JsonProperty("is_cross_lane")
    boolean isCrossLane
) {}
