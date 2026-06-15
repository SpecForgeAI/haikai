package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Top-level envelope DTO for the User Journey Overview diagram contract v1.
 * Contains the complete overview representation including an overview header,
 * lanes (Business Processes), nodes (User Journeys), edges (User Journey Links),
 * and render hints.
 */
public record UserJourneyOverviewDiagramDto(
    @JsonProperty("diagram_type")
    String diagramType,

    @JsonProperty("version")
    String version,

    @JsonProperty("overview")
    UserJourneyOverviewHeaderDto overview,

    @JsonProperty("lanes")
    List<UserJourneyOverviewLaneDto> lanes,

    @JsonProperty("nodes")
    List<UserJourneyOverviewNodeDto> nodes,

    @JsonProperty("edges")
    List<UserJourneyOverviewEdgeDto> edges,

    @JsonProperty("render_hints")
    UserJourneyOverviewRenderHintsDto renderHints
) {}
