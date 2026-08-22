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
    Map<String, Object> constraintsMetadata,

    /**
     * Migration scope (Foundations Spec 1, 2026-08-22): 'in_scope' |
     * 'excluded' | 'volatile' | 'data_only'. NULL means in_scope (safe
     * default). Exclusion is a TAG — the entity stays in current state.
     */
    @JsonProperty("migration_scope")
    String migrationScope,

    /** Foundation decision key ('F-1') that set the scope — the receipt. */
    @JsonProperty("scope_decision_ref")
    String scopeDecisionRef
) {}
