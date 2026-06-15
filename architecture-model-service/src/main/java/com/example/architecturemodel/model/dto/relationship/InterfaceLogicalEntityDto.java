package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * InterfaceLogicalEntity DTO - Interface to Data Entity Relationship.
 *
 * Spec 2026-01-11: Interface Entity Relationship Refactor
 * - Renamed from "Interface <-> Logical Entity" to "Interface <-> Entity"
 * - Added dataEntityPointId for unified Logical OR Physical entity selection
 * - Maintains backward compatibility with legacy logical_entity_id field
 *
 * The dataEntityPointId uses the same format as DataMovements:
 * - dep_log_<entityId> for logical entities
 * - dep_phy_<entityId> for physical entities
 */
public record InterfaceLogicalEntityDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("interface_id")
    String interfaceId,

    /**
     * Data Entity Point ID - unified picker field for Logical OR Physical entity selection.
     * Format: dep_log_<entityId> for logical entities, dep_phy_<entityId> for physical entities.
     *
     * Spec 2026-01-11: Interface Entity Relationship Refactor
     */
    @JsonProperty("dataEntityPointId")
    String dataEntityPointId,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
