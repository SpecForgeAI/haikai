package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SequenceFragmentDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("fragment_kind")
    String fragmentKind,

    @JsonProperty("label_text")
    String labelText
) {}
