package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * Data Transfer Object for Diagram entities.
 *
 * The typedContent field stores type-specific content for non-General diagrams.
 * For Sequence, ER, Activity, and State diagrams, this contains an envelope structure:
 * {
 *   "type": "Sequence" | "ER" | "Activity" | "State",
 *   "version": 1,
 *   "content": { ...type-specific content... }
 * }
 *
 * For General diagrams, typedContent is null.
 */
public record DiagramDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("diagram_type")
    @JsonAlias({ "type", "diagramType" })
    String diagramType,

    @JsonProperty("settings")
    Map<String, Object> settings,

    @JsonProperty("view_quarter")
    String viewQuarter,

    @JsonProperty("diagram_nodes")
    List<DiagramNodeDto> diagramNodes,

    @JsonProperty("diagram_edges")
    List<DiagramEdgeDto> diagramEdges,

    @JsonProperty("decorations")
    List<DecorationDto> decorations,

    @JsonProperty("interaction_edges")
    List<DiagramInteractionEdgeDto> interactionEdges,

    /**
     * Type-specific content for typed diagrams (Sequence, ER, Activity, State).
     * NULL for General diagrams which have no typed content.
     *
     * Envelope structure:
     * {
     *   "type": "Sequence" | "ER" | "Activity" | "State",
     *   "version": 1,
     *   "content": { ...type-specific content... }
     * }
     */
    @JsonProperty("typed_content")
    Map<String, Object> typedContent
) {}
