package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing render hints in the User Journey diagram contract v1.
 * Contains static layout hints for downstream consumers.
 */
public record UserJourneyDiagramRenderHintsDto(
    @JsonProperty("lane_axis")
    String laneAxis,

    @JsonProperty("flow_direction")
    String flowDirection,

    @JsonProperty("show_title")
    boolean showTitle
) {}
