package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record DiagramInteractionEdgeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("interaction_id")
    String interactionId,

    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("source_node_id")
    String sourceNodeId,

    @JsonProperty("target_node_id")
    String targetNodeId,

    @JsonProperty("edge_points")
    List<EdgePointDto> edgePoints,

    @JsonProperty("label_text")
    String labelText,

    @JsonProperty("label_pos_x")
    Double labelPosX,

    @JsonProperty("label_pos_y")
    Double labelPosY,

    @JsonProperty("user_node_id")
    String userNodeId,

    @JsonProperty("user_link_edge_points")
    List<EdgePointDto> userLinkEdgePoints,

    @JsonProperty("line_style")
    String lineStyle
) {}
