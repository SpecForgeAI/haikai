package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO representing a Data Entity Point.
 *
 * Data Entity Points act as polymorphic reference wrappers for Logical and Physical
 * Data Entities, enabling future relationship tables to point to either entity type
 * through a single foreign key.
 *
 * Spec: Data Entity Point Superclass
 */
public record DataEntityPointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("point_kind")
    String pointKind,

    @JsonProperty("logical_entity_id")
    String logicalEntityId,

    @JsonProperty("physical_entity_id")
    String physicalEntityId,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
