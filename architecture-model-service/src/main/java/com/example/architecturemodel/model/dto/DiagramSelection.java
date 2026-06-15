package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for structured diagram selection in implement context.
 *
 * Represents a single diagram selection with its bundle type,
 * enabling bundle-based context expansion to be persisted per work item.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency
 * and JSONB storage.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 */
public record DiagramSelection(
    @JsonProperty("diagram_id")
    String diagramId,

    @JsonProperty("bundle_type")
    String bundleType
) {}
