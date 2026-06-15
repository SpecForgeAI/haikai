package com.example.architecturemodel.model.dto.export;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.entity.UIScreenDto;
import com.example.architecturemodel.model.dto.entity.UIWorkflowTransitionDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for exporting UI workflow context.
 * Contains the project identifier, UI screens, UI workflow transitions, and filtered/canonicalized diagrams.
 * Used by Agent OS to generate UI architecture artifacts.
 */
public record ProjectUIWorkflowContextPackageDto(
    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("ui_screens")
    List<UIScreenDto> uiScreens,

    @JsonProperty("ui_workflow_transitions")
    List<UIWorkflowTransitionDto> uiWorkflowTransitions,

    @JsonProperty("diagrams")
    List<DiagramDto> diagrams
) {}
