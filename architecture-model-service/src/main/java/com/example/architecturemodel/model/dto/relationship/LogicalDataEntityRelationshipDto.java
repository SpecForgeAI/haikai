package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * DTO record for LogicalDataEntityRelationship.
 *
 * Supports UML-style relationship semantics with:
 * - Cardinality: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY
 * - Relationship: GENERALIZATION, REALIZATION, COMPOSITION, AGGREGATION, ASSOCIATION, DEPENDENCY
 *
 * Uses Data Entity Point IDs for polymorphic endpoints:
 * - fromDataEntityPointId: references data_entity_points for the "from" side
 * - toDataEntityPointId: references data_entity_points for the "to" side
 *
 * ID format: "dep_log_" + entityId for logical, "dep_phy_" + entityId for physical.
 *
 * Parameters are ordered for logical grouping:
 * id, from point-id, to point-id, cardinality, relationship, description, tags, valid dates,
 * fk_columns
 *
 * Spec: Remove Legacy Data Entity Relationship Columns
 */
public record LogicalDataEntityRelationshipDto(
    @JsonProperty("id")
    String id,

    /**
     * FK field referencing data_entity_points.id for the "from" side.
     * Required field - must be set for all relationships.
     * ID format: "dep_log_" + entityId for logical, "dep_phy_" + entityId for physical.
     */
    @JsonProperty("fromDataEntityPointId")
    String fromDataEntityPointId,

    /**
     * FK field referencing data_entity_points.id for the "to" side.
     * Required field - must be set for all relationships.
     * ID format: "dep_log_" + entityId for logical, "dep_phy_" + entityId for physical.
     */
    @JsonProperty("toDataEntityPointId")
    String toDataEntityPointId,

    @JsonProperty("cardinality")
    String cardinality,

    @JsonProperty("relationship")
    String relationship,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    /**
     * FK column-level detail (passthrough JSON object): the join (referencing)
     * and referenced column lists on each side. Shape:
     * {@code { join_columns:[...], referenced_columns:[...] }}. METADATA on the
     * relationship, NOT a new entity type; the point-id endpoints are unchanged.
     * snake_case wire key {@code "fk_columns"}; a null/absent block round-trips
     * cleanly.
     *
     * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
     */
    @JsonProperty("fk_columns")
    Map<String, Object> fkColumns
) {}
