package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UIContractDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("contract_type")
    String contractType,

    @JsonProperty("operation_ref")
    String operationRef,

    @JsonProperty("request_schema_ref")
    String requestSchemaRef,

    @JsonProperty("response_schema_ref")
    String responseSchemaRef,

    @JsonProperty("bindings_json")
    String bindingsJson
) {}
