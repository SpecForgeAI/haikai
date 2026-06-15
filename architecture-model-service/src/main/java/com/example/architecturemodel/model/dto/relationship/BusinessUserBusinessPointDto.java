package com.example.architecturemodel.model.dto.relationship;

import com.fasterxml.jackson.annotation.JsonProperty;

public record BusinessUserBusinessPointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("business_user_id")
    String businessUserId,

    @JsonProperty("business_point_id")
    String businessPointId,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
