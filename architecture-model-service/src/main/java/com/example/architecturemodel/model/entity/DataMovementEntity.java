package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA Entity for data_movements table.
 *
 * Represents data flow between application points, tracking what data entity
 * or interface schema is being moved and the movement type.
 *
 * Spec 2026-01-11: Data Movement Interface Schema Extension
 * - dataEntityPointId is now nullable (XOR with interfaceWithSchemaId)
 * - Added interfaceWithSchemaId column (XOR with dataEntityPointId)
 * - Added biDirectional column
 *
 * XOR Constraint: Exactly one of dataEntityPointId OR interfaceWithSchemaId must be set.
 */
@Entity
@Table(name = "data_movements")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DataMovementEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "source_application_point_id", nullable = false)
    private String sourceApplicationPointId;

    @Column(name = "target_application_point_id", nullable = false)
    private String targetApplicationPointId;

    /**
     * FK column referencing data_entity_points.id for the data entity being moved.
     * ID format: "dep_log_" + entityId (data movements reference logical entities).
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     * This field is now nullable (XOR with interfaceWithSchemaId).
     * Exactly one of dataEntityPointId or interfaceWithSchemaId must be set.
     */
    @Column(name = "data_entity_point_id", nullable = true)
    private String dataEntityPointId;

    /**
     * FK column referencing interfaces.id for the interface (with schema) being used.
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     * This field is nullable (XOR with dataEntityPointId).
     * Exactly one of dataEntityPointId or interfaceWithSchemaId must be set.
     */
    @Column(name = "interface_with_schema_id", nullable = true)
    private String interfaceWithSchemaId;

    /**
     * Flag indicating if the data movement is bi-directional.
     * When true, data flows in both directions between source and target.
     *
     * Spec 2026-01-11: Data Movement Interface Schema Extension
     */
    @Column(name = "bi_directional", nullable = true)
    private Boolean biDirectional;

    @Column(name = "movement_type")
    private String movementType;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
