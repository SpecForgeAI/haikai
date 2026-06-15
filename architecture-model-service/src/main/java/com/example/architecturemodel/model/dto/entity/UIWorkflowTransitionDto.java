package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UIWorkflowTransitionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("source_screen_id")
    String sourceScreenId,

    @JsonProperty("target_screen_id")
    String targetScreenId,

    @JsonProperty("trigger")
    String trigger,

    @JsonProperty("guard")
    String guard
) {}
