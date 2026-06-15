package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Full OAS-ready context bundle for an interface.
 * Contains all information needed to generate an OpenAPI Specification.
 *
 * Note: The interfaceInfo field is serialized as "interface" in JSON
 * using @JsonProperty annotation.
 */
public record InterfaceOasContextDto(
    @JsonProperty("interface")
    InterfaceDetailDto interfaceInfo,

    @JsonProperty("service")
    ServiceDetailDto service,               // nullable

    @JsonProperty("application")
    ApplicationDetailDto application,       // nullable

    @JsonProperty("endpoints")
    List<InterfaceEndpointDto> endpoints,

    @JsonProperty("logicalEntities")
    List<LogicalEntitySchemaDto> logicalEntities,

    @JsonProperty("notes")
    OasNotesDto notes                       // nullable - null for v1
) {}
