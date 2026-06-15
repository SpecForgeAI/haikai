package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for implement context resolution request.
 *
 * Contains lists of entity and diagram IDs to be resolved into full summaries.
 * Entity IDs are in format "entityType::entityId".
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 */
public record ImplementContextResolveRequestDto(
    @JsonProperty("selected_entity_ids")
    List<String> selectedEntityIds,

    @JsonProperty("selected_diagram_ids")
    List<String> selectedDiagramIds
) {}
