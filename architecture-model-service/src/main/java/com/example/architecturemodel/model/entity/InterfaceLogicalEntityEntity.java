package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * InterfaceLogicalEntity Entity - Interface to Data Entity Relationship.
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Renamed from "Interface <-> Logical Entity" to "Interface <-> Entity"
 * - Added dataEntityPointId for unified Logical OR Physical entity selection
 * - Database column: data_entity_point_id
 *
 * The dataEntityPointId uses the same format as DataMovements:
 * - dep_log_<entityId> for logical entities
 * - dep_phy_<entityId> for physical entities
 */
@Entity
@Table(name = "interface_logical_entities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class InterfaceLogicalEntityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "interface_id", nullable = false)
    private String interfaceId;

    /**
     * Data Entity Point ID - unified picker field for Logical OR Physical entity selection.
     * Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities.
     *
     * Spec 2026-01-11: Interface Entity Relationship Refactor
     * Replaces legacy logical_entity_id column.
     */
    @Column(name = "data_entity_point_id", nullable = false)
    private String dataEntityPointId;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
