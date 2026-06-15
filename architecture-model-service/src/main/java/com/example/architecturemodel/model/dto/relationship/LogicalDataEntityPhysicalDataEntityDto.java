package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LogicalDataEntityPhysicalDataEntityDto(
    @JsonProperty("id")
    String id,

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
