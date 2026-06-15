package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Detail DTO for interface information within the OAS context bundle.
 */
public record InterfaceDetailDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("interfaceType")
    String interfaceType,       // nullable

    @JsonProperty("specLink")
    String specLink,            // nullable

    @JsonProperty("tags")
    String tags,                // nullable

    @JsonProperty("validFrom")
    String validFrom,           // nullable

    @JsonProperty("validTo")
    String validTo              // nullable
) {}
