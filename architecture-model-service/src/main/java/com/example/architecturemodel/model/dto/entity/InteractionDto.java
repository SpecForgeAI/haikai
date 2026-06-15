package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record InteractionDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("user_id")
    String userId,

    @JsonProperty("primary_app_business_point_id")
    String primaryAppBusinessPointId,

    @JsonProperty("secondary_app_business_point_id")
    String secondaryAppBusinessPointId
) {}
