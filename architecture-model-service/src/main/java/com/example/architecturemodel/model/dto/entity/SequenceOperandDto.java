package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SequenceOperandDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("fragment_id")
    String fragmentId,

    @JsonProperty("guard_expression")
    String guardExpression,

    @JsonProperty("operand_index")
    Integer operandIndex
) {}
