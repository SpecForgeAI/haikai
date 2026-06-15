package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.entity.*;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * DTO for the project UI screen context package.
 *
 * Contains all UI screen-related entities and diagrams for Agent OS consumption.
 */
public record ProjectUIScreenContextPackageDto(
    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("ui_screens")
    List<UIScreenDto> uiScreens,

    @JsonProperty("ui_components")
    List<UIComponentDto> uiComponents,

    @JsonProperty("ui_actions")
    List<UIActionDto> uiActions,

    @JsonProperty("ui_contracts")
    List<UIContractDto> uiContracts,

    @JsonProperty("diagrams")
    List<DiagramDto> diagrams
) {}
