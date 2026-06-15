package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ActivityPartitionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("ref_kind")
    String refKind,

    @JsonProperty("ref_id")
    String refId,

    @JsonProperty("order_index")
    Integer orderIndex,

    @JsonProperty("description")
    String description
) {}
