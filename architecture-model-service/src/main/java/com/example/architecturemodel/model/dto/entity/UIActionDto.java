package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UIActionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("trigger_type")
    String triggerType,

    @JsonProperty("owner_screen_id")
    String ownerScreenId,

    @JsonProperty("owner_component_id")
    String ownerComponentId,

    @JsonProperty("effect_type")
    String effectType,

    @JsonProperty("description")
    String description,

    @JsonProperty("contract_id")
    String contractId
) {}
