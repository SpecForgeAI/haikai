package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UIScreenDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("route")
    String route,

    @JsonProperty("description")
    String description,

    @JsonProperty("application_point_id")
    String applicationPointId
) {}
