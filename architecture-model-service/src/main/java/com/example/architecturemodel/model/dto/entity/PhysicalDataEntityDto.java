package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * DTO for a {@code physical_data_entities} row.
 *
 * <p>AMS speaks {@code snake_case} at the wire by default (the global
 * {@code spring.jackson.property-naming-strategy: SNAKE_CASE}). There is
 * intentionally NO {@code @CamelCaseWire} -- the discovery-service AMS client
 * and the frontend's snake_case-typed API modules consume this in
 * {@code snake_case} (per CLAUDE.md).</p>
 *
 * <p>{@code constraints_metadata} is a passthrough JSON object ({@link Map})
 * carrying the table's structural constraint/index truth (primary key, unique
 * constraints, check constraints, indexes) as METADATA ON the entity -- NOT a
 * separate entity type. A null/absent block round-trips cleanly.</p>
 *
 * <p>Spec: DB Structural Fidelity for Discovery (2026-05-29) -- Task Group 1.</p>
 */
public record PhysicalDataEntityDto(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("description")
    String description,

    @JsonProperty("physical_type")
    String physicalType,

    @JsonProperty("database")
    String database,

    @JsonProperty("tags")
    String tags,

    @JsonProperty("valid_from")
    String validFrom,

    @JsonProperty("valid_to")
    String validTo,

    /**
     * Structured constraint/index metadata (passthrough JSON object). Shape:
     * {@code { primary_key:{name,columns[]}, unique_constraints:[{name,columns[]}],
     * check_constraints:[{name,expression}], indexes:[{name,columns[],is_unique}] }}.
     * snake_case wire key {@code "constraints_metadata"}.
     */
    @JsonProperty("constraints_metadata")
    Map<String, Object> constraintsMetadata
) {}
