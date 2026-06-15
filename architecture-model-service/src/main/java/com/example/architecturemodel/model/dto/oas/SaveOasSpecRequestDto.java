package com.example.architecturemodel.model.dto.oas;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request DTO for saving an OpenAPI specification.
 * Contains the format (yaml/json), content, and optional metadata.
 */
public record SaveOasSpecRequestDto(
    @JsonProperty("format")
    String format,

    @JsonProperty("contents")
    String contents,

    @JsonProperty("title")
    String title,

    @JsonProperty("version")
    String version
) {}
