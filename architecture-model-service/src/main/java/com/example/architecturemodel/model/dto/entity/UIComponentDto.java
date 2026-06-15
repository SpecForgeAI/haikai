package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UIComponentDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("component_type")
    String componentType,

    @JsonProperty("description")
    String description,

    @JsonProperty("domain")
    String domain,

    @JsonProperty("props_schema_json")
    String propsSchemaJson
) {}
