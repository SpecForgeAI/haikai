package com.example.architecturemodel.model.dto.diagram;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LinePointDto(
    @JsonProperty("x")
    Double x,

    @JsonProperty("y")
    Double y
) {}
