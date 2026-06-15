package com.example.architecturemodel.model.dto.interface_discovery;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Detail DTO for application information within the OAS context bundle.
 */
public record ApplicationDetailDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,         // nullable

    @JsonProperty("appType")
    String appType,             // nullable

    @JsonProperty("status")
    String status,              // nullable

    @JsonProperty("tags")
    String tags                 // nullable
) {}
