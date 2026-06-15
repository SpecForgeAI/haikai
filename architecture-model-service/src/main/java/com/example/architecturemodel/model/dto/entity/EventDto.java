package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record EventDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("source_ref_kind")
    String sourceRefKind,

    @JsonProperty("source_ref_id")
    String sourceRefId,

    @JsonProperty("payload_ref_kind")
    String payloadRefKind,

    @JsonProperty("payload_ref_id")
    String payloadRefId,

    @JsonProperty("payload_primitive_type")
    String payloadPrimitiveType,

    @JsonProperty("tags")
    String tags
) {}
