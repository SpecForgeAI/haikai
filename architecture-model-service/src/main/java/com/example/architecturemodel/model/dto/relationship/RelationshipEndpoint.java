package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for a relationship endpoint.
 *
 * Represents one end of a relationship (either 'from' or 'to'),
 * containing the entity type, entity ID, and human-readable name.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Auto-Include Relationships - Task Group 1
 */
public record RelationshipEndpoint(
    /**
     * The entity type of this endpoint.
     * Examples: "logicalDataEntities", "physicalDataEntities", "interfaces", "services"
     */
    @JsonProperty("entity_type")
    String entityType,

    /**
     * The unique identifier of the entity at this endpoint.
     */
    @JsonProperty("entity_id")
    String entityId,

    /**
     * The human-readable name of the entity at this endpoint.
     */
    @JsonProperty("name")
    String name
) {}
