package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record ArchitectureModelDto(
    @JsonProperty("metaModel")
    MetaModelDto metaModel,

    @JsonProperty("diagrams")
    List<DiagramDto> diagrams
) {}
