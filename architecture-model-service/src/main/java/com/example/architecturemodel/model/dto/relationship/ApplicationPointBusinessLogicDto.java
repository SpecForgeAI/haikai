package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ApplicationPointBusinessLogicDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("application_point_id")
    String applicationPointId,

    @JsonProperty("business_logic_id")
    String businessLogicId,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
