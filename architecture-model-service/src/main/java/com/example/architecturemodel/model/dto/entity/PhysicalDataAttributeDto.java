package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO for a {@code physical_data_attributes} row.
 *
 * <p>AMS speaks {@code snake_case} at the wire by default (the global
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE} in
 * {@code application.yml}). The explicit {@code @JsonProperty} declarations are
 * belt-and-braces and consistent with the surrounding DTOs. There is
 * intentionally NO {@code @CamelCaseWire} annotation -- the discovery-service
 * AMS client and the frontend's snake_case-typed API modules consume this in
 * {@code snake_case} (per CLAUDE.md).</p>
 *
 * <p>The structural-fidelity fields ({@code source_type} / {@code scale} /
 * {@code precision} / {@code column_default} / {@code ordinal} /
 * {@code is_identity}) are captured verbatim by the discovery DB scan with NO
 * type normalization. The numerics are boxed {@link Integer} and the identity
 * flag is a boxed {@link Boolean} so a PATCH carrying no value preserves the
 * existing value rather than wiping to 0 / false (per
 * {@code project_primitive_double_dto_overwrite.md}). {@code default} is a SQL
 * reserved word, so the field/column is named {@code column_default}
 * consistently. A null/absent value round-trips cleanly.</p>
 *
 * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
 */
public record PhysicalDataAttributeDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("physical_entity_id")
    String physicalEntityId,

    @JsonProperty("data_type")
    String dataType,

    @JsonProperty("is_primary_key")
    Boolean isPrimaryKey,

    @JsonProperty("is_nullable")
    Boolean isNullable,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("source_type")
    String sourceType,

    @JsonProperty("scale")
    Integer scale,

    @JsonProperty("precision")
    Integer precision,

    @JsonProperty("column_default")
    String columnDefault,

    @JsonProperty("ordinal")
    Integer ordinal,

    @JsonProperty("is_identity")
    Boolean isIdentity
) {}
