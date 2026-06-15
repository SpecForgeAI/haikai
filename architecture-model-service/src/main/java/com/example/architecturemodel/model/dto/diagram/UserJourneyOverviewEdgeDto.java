package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing an edge in the User Journey Overview diagram contract v1.
 * Each edge corresponds to a USER_JOURNEY_LINK relationship between two
 * User Journey nodes within the overview.
 */
public record UserJourneyOverviewEdgeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("source_node_id")
    String sourceNodeId,

    @JsonProperty("target_node_id")
    String targetNodeId,

    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("label")
    String label,

    @JsonProperty("description")
    String description
) {}
