package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for endpoint information within the OAS context bundle.
 * Only id and name are required; all other fields are nullable.
 */
public record InterfaceEndpointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("endpointType")
    String endpointType,        // nullable

    @JsonProperty("pathOrAddress")
    String pathOrAddress,       // nullable

    @JsonProperty("protocol")
    String protocol,            // nullable

    @JsonProperty("operationVerb")
    String operationVerb,       // nullable

    @JsonProperty("direction")
    String direction,           // nullable

    @JsonProperty("validFrom")
    String validFrom,           // nullable

    @JsonProperty("validTo")
    String validTo,             // nullable

    @JsonProperty("requestDataEntityPointId")
    String requestDataEntityPointId,    // nullable

    @JsonProperty("responseDataEntityPointId")
    String responseDataEntityPointId    // nullable
) {}
