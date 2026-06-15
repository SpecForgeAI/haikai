package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for exporting a single diagram in canonical JSON format.
 * Provides deterministic, stable ordering for diffing and caching purposes.
 */
public record CanonicalDiagramExportDto(
    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("diagram_id")
    String diagramId,

    @JsonProperty("diagram_type")
    String diagramType,

    @JsonProperty("canonical")
    DiagramDto canonical
) {}
