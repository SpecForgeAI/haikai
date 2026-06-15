package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for structured entity selection in implement context.
 *
 * Represents a single entity selection with its bundle type and optional depth,
 * enabling bundle-based context expansion to be persisted per work item.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency
 * and JSONB storage.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 */
public record EntitySelection(
    @JsonProperty("entity_type")
    String entityType,

    @JsonProperty("entity_id")
    String entityId,

    @JsonProperty("bundle_type")
    String bundleType,

    /**
     * Optional depth for relationship expansion (only for entity bundles).
     * - 1 (default when null): Include direct relationships only
     * - 2: Include relationships up to 2 hops (may significantly increase context size)
     *
     * When null, the expansion service treats it as depth=1 for backward compatibility.
     */
    @JsonProperty("depth")
    Integer depth
) {
    /**
     * Returns the effective depth, defaulting to 1 if depth is null.
     *
     * @return the depth value, or 1 if null
     */
    public int effectiveDepth() {
        return depth != null ? depth : 1;
    }
}
