package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

public record EdgePointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("sequence_order")
    Integer sequenceOrder,

    @JsonProperty("pos_x")
    Double posX,

    @JsonProperty("pos_y")
    Double posY
) {}
