package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * DTO for logical entity schema including its attributes.
 * Used within the OAS context bundle to provide data model information.
 */
public record LogicalEntitySchemaDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("tags")
    String tags,                // nullable

    @JsonProperty("validFrom")
    String validFrom,           // nullable

    @JsonProperty("validTo")
    String validTo,             // nullable

    @JsonProperty("attributes")
    List<LogicalAttributeDto> attributes
) {}
