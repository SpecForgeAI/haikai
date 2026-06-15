package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record LogicalDataAttributeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("logical_entity_id")
    String logicalEntityId,

    @JsonProperty("data_type")
    String dataType,

    @JsonProperty("is_primary_key")
    Boolean isPrimaryKey,

    @JsonProperty("is_nullable")
    Boolean isNullable,

    @JsonProperty("tags")
    String tags,

    /**
     * SOAP/WSDL message-field metadata blob (cardinality + value-domain
     * restrictions + the XSD source-type), surfaced ON the attribute. snake_case
     * wire (global default); boxed {@link Map} so a PATCH omitting it preserves
     * the existing value. Spec: SOAP/WSDL Message-Field Depth (2026-05-30) -- TG1.
     */
    @JsonProperty("field_metadata")
    Map<String, Object> fieldMetadata
) {}
