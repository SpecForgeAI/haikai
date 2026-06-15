package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for structured relationship selection in implement context.
 *
 * Represents a single relationship selection with its type, ID, and label.
 * Simpler than EntitySelection - no bundle_type or depth needed for relationships.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency
 * and JSONB storage.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
public record RelationshipSelection(
    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("relationship_id")
    String relationshipId,

    @JsonProperty("label")
    String label
) {}
