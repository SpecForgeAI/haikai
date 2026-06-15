package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for logical data attribute information within a logical entity schema.
 */
public record LogicalAttributeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("dataType")
    String dataType,            // nullable

    @JsonProperty("isPrimaryKey")
    Boolean isPrimaryKey,       // nullable

    @JsonProperty("isNullable")
    Boolean isNullable,         // nullable

    @JsonProperty("tags")
    String tags                 // nullable
) {}
