package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record AppBusinessPointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("source_entity_id")
    String sourceEntityId
) {}
