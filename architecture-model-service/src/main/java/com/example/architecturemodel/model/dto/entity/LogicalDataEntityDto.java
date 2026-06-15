package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

public record LogicalDataEntityDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    /**
     * Source namespace / originating DTO class-name provenance for a minted SOAP
     * message entity. snake_case wire (global default); plain {@link String} so a
     * PATCH omitting it preserves the existing value. Spec: SOAP/WSDL Message-
     * Field Depth (2026-05-30) -- TG1.
     */
    @JsonProperty("source_provenance")
    String sourceProvenance
) {}
