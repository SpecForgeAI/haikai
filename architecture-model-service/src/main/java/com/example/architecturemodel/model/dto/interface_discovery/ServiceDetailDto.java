package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Detail DTO for service information within the OAS context bundle.
 */
public record ServiceDetailDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("serviceType")
    String serviceType,         // nullable

    @JsonProperty("tags")
    String tags                 // nullable
) {}
