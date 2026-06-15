package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for diagram bundle selection in expand-resolve requests.
 *
 * Represents a single diagram selection with its associated bundle type, which
 * determines how much related context should be expanded (e.g., diagram_only).
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Backend Expansion
 */
public record DiagramBundleSelection(
    @JsonProperty("diagram_id")
    String diagramId,

    @JsonProperty("bundle_type")
    String bundleType
) {}
