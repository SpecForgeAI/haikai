package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Summary DTO for interface listing, used when returning a list of interfaces
 * for a stored model file.
 */
public record InterfaceSummaryDto(
    @JsonProperty("interfaceId")
    String interfaceId,

    @JsonProperty("interfaceName")
    String interfaceName,

    @JsonProperty("interfaceType")
    String interfaceType,

    @JsonProperty("serviceId")
    String serviceId,           // nullable

    @JsonProperty("serviceName")
    String serviceName,         // nullable

    @JsonProperty("applicationId")
    String applicationId,       // nullable

    @JsonProperty("applicationName")
    String applicationName,     // nullable

    @JsonProperty("endpointCount")
    int endpointCount
) {}
