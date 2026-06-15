package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * Data Transfer Object for a resolved relationship between entities.
 *
 * Contains information about a relationship discovered during context bundle expansion,
 * including the relationship type, endpoints, and additional metadata in summaryFields.
 *
 * Relationship types supported:
 * - "fk": Foreign key relationship (data entities)
 * - "association": General association between data entities
 * - "many_to_many": Many-to-many relationship (data entities)
 * - "uses": Usage relationship (service uses data entity)
 * - "exposes": Exposure relationship (service exposes interface)
 * - "schema_ref": Schema reference (interface references data entity)
 * - "contains": Containment relationship (app contains component, component contains service)
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Auto-Include Relationships - Task Group 1
 */
public record ResolvedRelationshipDto(
    /**
     * Unique identifier for this relationship.
     */
    @JsonProperty("id")
    String id,

    /**
     * The type of relationship.
     * Valid values: fk, association, many_to_many, uses, exposes, schema_ref, contains
     */
    @JsonProperty("type")
    String type,

    /**
     * The 'from' endpoint of the relationship (source entity).
     */
    @JsonProperty("from")
    RelationshipEndpoint from,

    /**
     * The 'to' endpoint of the relationship (target entity).
     */
    @JsonProperty("to")
    RelationshipEndpoint to,

    /**
     * Human-readable label describing the relationship.
     * Examples: "places", "belongs_to", "references", "exposes"
     */
    @JsonProperty("label")
    String label,

    /**
     * Additional metadata about the relationship.
     * May include:
     * - cardinality: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
     * - relationship_type: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
     * - description: Optional description text
     */
    @JsonProperty("summary_fields")
    Map<String, Object> summaryFields
) {}
