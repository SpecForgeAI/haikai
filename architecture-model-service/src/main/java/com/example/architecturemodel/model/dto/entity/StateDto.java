package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record StateDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("state_kind")
    String stateKind,

    @JsonProperty("owner_ref_kind")
    String ownerRefKind,

    @JsonProperty("owner_ref_id")
    String ownerRefId
) {}
