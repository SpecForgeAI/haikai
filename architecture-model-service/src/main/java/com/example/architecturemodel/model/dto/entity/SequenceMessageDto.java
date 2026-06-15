package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record SequenceMessageDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("exchange_id")
    String exchangeId,

    @JsonProperty("exchange_role")
    String exchangeRole,

    @JsonProperty("from_participant_id")
    String fromParticipantId,

    @JsonProperty("to_participant_id")
    String toParticipantId,

    @JsonProperty("ref_kind")
    String refKind,

    @JsonProperty("ref_id")
    String refId,

    @JsonProperty("label_text")
    String labelText,

    @JsonProperty("is_collection")
    Boolean isCollection,

    @JsonProperty("show_endpoint_name")
    Boolean showEndpointName,

    @JsonProperty("show_endpoint_verb_path")
    Boolean showEndpointVerbPath,

    @JsonProperty("show_endpoint_req_res_data")
    Boolean showEndpointReqResData,

    @JsonProperty("response_mode")
    String responseMode
) {}
