package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Top-level envelope DTO for the User Journey diagram contract v1.
 * Contains the complete diagram representation including journey metadata,
 * lanes, steps, edges, and render hints.
 */
public record UserJourneyDiagramDto(
    @JsonProperty("diagram_type")
    String diagramType,

    @JsonProperty("version")
    String version,

    @JsonProperty("journey")
    UserJourneyDiagramJourneyDto journey,

    @JsonProperty("lanes")
    List<UserJourneyDiagramLaneDto> lanes,

    @JsonProperty("steps")
    List<UserJourneyDiagramStepDto> steps,

    @JsonProperty("edges")
    List<UserJourneyDiagramEdgeDto> edges,

    @JsonProperty("render_hints")
    UserJourneyDiagramRenderHintsDto renderHints
) {}
