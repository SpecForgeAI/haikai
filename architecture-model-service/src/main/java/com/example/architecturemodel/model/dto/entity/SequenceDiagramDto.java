package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

public record SequenceDiagramDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("model_file_id")
    String modelFileId,

    @JsonProperty("name")
    String name,

    @JsonProperty("type")
    String type,

    @JsonProperty("participants")
    List<SequenceParticipantDto> participants,

    @JsonProperty("messages")
    List<SequenceMessageDto> messages,

    @JsonProperty("fragments")
    List<SequenceFragmentDto> fragments,

    @JsonProperty("operands")
    List<SequenceOperandDto> operands,

    @JsonProperty("sequence_nodes")
    List<SequenceNodeDto> sequenceNodes
) {}
