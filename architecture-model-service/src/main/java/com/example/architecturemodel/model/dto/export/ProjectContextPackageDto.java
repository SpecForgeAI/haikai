package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for exporting project context.
 * Contains the project identifier, meta-model, and filtered/canonicalized diagrams.
 * Used by Agent OS to generate tech-stack.md and other planning documents.
 */
public record ProjectContextPackageDto(
    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("metaModel")
    MetaModelDto metaModel,

    @JsonProperty("diagrams")
    List<DiagramDto> diagrams
) {}
