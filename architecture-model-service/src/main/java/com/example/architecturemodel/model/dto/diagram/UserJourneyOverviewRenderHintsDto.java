package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing render hints in the User Journey Overview diagram contract v1.
 * Contains static layout hints for downstream consumers / renderers.
 */
public record UserJourneyOverviewRenderHintsDto(
    @JsonProperty("lane_axis")
    String laneAxis,

    @JsonProperty("flow_direction")
    String flowDirection,

    @JsonProperty("show_title")
    boolean showTitle,

    @JsonProperty("show_lane_headers")
    boolean showLaneHeaders,

    @JsonProperty("show_node_description")
    boolean showNodeDescription,

    @JsonProperty("show_relationship_labels")
    boolean showRelationshipLabels
) {}
