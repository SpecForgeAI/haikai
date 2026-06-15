package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SequenceParticipantDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("ref_kind")
    String refKind,

    @JsonProperty("ref_id")
    String refId,

    @JsonProperty("order_index")
    Integer orderIndex
) {}
