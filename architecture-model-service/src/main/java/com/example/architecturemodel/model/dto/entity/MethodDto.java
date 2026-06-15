package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MethodDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("class_id")
    String classId,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("parameters_json")
    String parametersJson,

    @JsonProperty("returns_json")
    String returnsJson,

    @JsonProperty("throws_json")
    String throwsJson
) {}
