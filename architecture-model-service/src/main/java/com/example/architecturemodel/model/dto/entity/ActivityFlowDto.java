package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ActivityFlowDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("from_activity_id")
    String fromActivityId,

    @JsonProperty("to_activity_id")
    String toActivityId,

    @JsonProperty("trigger_ref_kind")
    String triggerRefKind,

    @JsonProperty("trigger_ref_id")
    String triggerRefId,

    @JsonProperty("trigger_label_text")
    String triggerLabelText,

    @JsonProperty("condition_ref_kind")
    String conditionRefKind,

    @JsonProperty("condition_ref_id")
    String conditionRefId,

    @JsonProperty("condition_expression")
    String conditionExpression,

    @JsonProperty("flow_kind")
    String flowKind,

    @JsonProperty("order_index")
    Integer orderIndex,

    @JsonProperty("description")
    String description
) {}
