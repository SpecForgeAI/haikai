package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;

public record ModelFileSummaryDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("filename")
    String filename,

    @JsonProperty("description")
    String description,

    @JsonProperty("created_at")
    OffsetDateTime createdAt,

    @JsonProperty("updated_at")
    OffsetDateTime updatedAt,

    @JsonProperty("is_default")
    Boolean isDefault,

    @JsonProperty("tags")
    String tags
) {}
