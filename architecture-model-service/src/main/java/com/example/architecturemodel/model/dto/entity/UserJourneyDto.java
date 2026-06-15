package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record UserJourneyDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("primary_business_user_id")
    String primaryBusinessUserId,

    @JsonProperty("parent_business_process_id")
    String parentBusinessProcessId
) {}
