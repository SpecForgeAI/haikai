package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;
import java.util.UUID;

/**
 * DTO for discovery relationships.
 *
 * Represents an inferred relationship between two Phase 1a evidence atoms
 * during Phase 1b relationship inference. Used for both request (bulk insert)
 * and response (query) payloads on the REST API.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 2: Relationship JPA Stack (1b)
 *
 * @param id Relationship UUID
 * @param runId Discovery run UUID this relationship belongs to
 * @param sourceAtomId UUID of the source evidence atom
 * @param targetAtomId UUID of the target evidence atom
 * @param relationshipType Relationship type (imports, calls, extends, contains, uses_data, defines, references)
 * @param confidence Confidence score (0.0 to 1.0)
 * @param data Type-specific JSONB payload
 * @param inferredAt ISO-8601 timestamp of inference
 */
public record DiscoveryRelationshipDto(
    @JsonProperty("id")
    UUID id,

    @JsonProperty("run_id")
    UUID runId,

    @JsonProperty("source_atom_id")
    UUID sourceAtomId,

    @JsonProperty("target_atom_id")
    UUID targetAtomId,

    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("confidence")
    double confidence,

    @JsonProperty("data")
    Map<String, Object> data,

    @JsonProperty("inferred_at")
    String inferredAt
) {}
