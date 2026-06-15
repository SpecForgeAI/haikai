package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for entity bundle selection in expand-resolve requests.
 *
 * Represents a single entity selection with its associated bundle type, which
 * determines how much related context should be expanded (e.g., interface_only,
 * interface_with_endpoints, interface_with_endpoints_and_schemas).
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Backend Expansion
 * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 5
 *   - Added depth field for relationship expansion control
 */
public record EntityBundleSelection(
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
     *
     * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 5
     */
    @JsonProperty("depth")
    Integer depth
) {
    /**
     * Returns the effective depth, defaulting to 1 if depth is null.
     * This is a convenience method for services that need the actual depth value.
     *
     * Spec 2026-01-17: Fix Context Bundle + Depth Wiring End-to-End - Task Group 5
     *
     * @return the depth value, or 1 if null
     */
    public int effectiveDepth() {
        return depth != null ? depth : 1;
    }
}
