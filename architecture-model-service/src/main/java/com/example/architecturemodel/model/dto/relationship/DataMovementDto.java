package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO record for DataMovement.
 *
 * Represents data flow between application points, tracking what data entity
 * or interface schema is being moved and the movement type.
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * - dataEntityPointId is now optional (XOR with interfaceWithSchemaId)
 * - Added interfaceWithSchemaId field (XOR with dataEntityPointId)
 * - Added biDirectional flag
 *
 * XOR Constraint: Exactly one of dataEntityPointId OR interfaceWithSchemaId must be set.
 * This is validated at the frontend level with non-blocking validation.
 */
public record DataMovementDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("source_application_point_id")
    String sourceApplicationPointId,

    @JsonProperty("target_application_point_id")
    String targetApplicationPointId,

    /**
     * FK field referencing data_entity_points.id for the data entity being moved.
     * Optional field - XOR with interfaceWithSchemaId (exactly one must be set).
     * ID format: "dep_log_" + entityId (data movements reference logical entities).
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     */
    @JsonProperty("dataEntityPointId")
    String dataEntityPointId,

    /**
     * FK field referencing interfaces.id for the interface (with schema) being used.
     * Optional field - XOR with dataEntityPointId (exactly one must be set).
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     */
    @JsonProperty("interfaceWithSchemaId")
    String interfaceWithSchemaId,

    /**
     * Flag indicating if the data movement is bi-directional.
     * When true, data flows in both directions between source and target.
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     */
    @JsonProperty("biDirectional")
    Boolean biDirectional,

    @JsonProperty("movement_type")
    String movementType,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
