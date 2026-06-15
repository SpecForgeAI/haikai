package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for expand-resolve request.
 *
 * Contains lists of entity and diagram bundle selections that should be expanded
 * into their related entities/diagrams and then resolved into human-readable summaries.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Backend Expansion
 */
public record ExpandResolveRequestDto(
    @JsonProperty("selected_entities")
    List<EntityBundleSelection> selectedEntities,

    @JsonProperty("selected_diagrams")
    List<DiagramBundleSelection> selectedDiagrams
) {}
