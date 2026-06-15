package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LogicalDataAttributePhysicalDataAttributeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("logical_attribute_id")
    String logicalAttributeId,

    @JsonProperty("physical_attribute_id")
    String physicalAttributeId,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
