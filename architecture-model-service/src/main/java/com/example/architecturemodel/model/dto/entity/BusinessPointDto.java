package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record BusinessPointDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("kind")
    String kind,

    @JsonProperty("business_process_id")
    String businessProcessId,

    @JsonProperty("process_activity_id")
    String processActivityId,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo
) {}
