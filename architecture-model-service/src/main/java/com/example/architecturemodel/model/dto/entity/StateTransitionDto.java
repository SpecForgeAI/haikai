package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record StateTransitionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("from_state_id")
    String fromStateId,

    @JsonProperty("to_state_id")
    String toStateId,

    @JsonProperty("order_index")
    Integer orderIndex,

    @JsonProperty("description")
    String description,

    @JsonProperty("trigger_ref_kind")
    String triggerRefKind,

    @JsonProperty("trigger_ref_id")
    String triggerRefId,

    @JsonProperty("trigger_label_text")
    String triggerLabelText,

    @JsonProperty("guard_ref_kind")
    String guardRefKind,

    @JsonProperty("guard_ref_id")
    String guardRefId,

    @JsonProperty("guard_expression")
    String guardExpression,

    @JsonProperty("effect_ref_kind")
    String effectRefKind,

    @JsonProperty("effect_ref_id")
    String effectRefId,

    @JsonProperty("effect_label_text")
    String effectLabelText
) {}
