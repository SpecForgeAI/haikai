package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SequenceNodeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("node_kind")
    String nodeKind,

    @JsonProperty("message_id")
    String messageId,

    @JsonProperty("fragment_id")
    String fragmentId,

    @JsonProperty("order_index")
    Integer orderIndex,

    @JsonProperty("parent_node_id")
    String parentNodeId,

    @JsonProperty("parent_operand_id")
    String parentOperandId
) {}
