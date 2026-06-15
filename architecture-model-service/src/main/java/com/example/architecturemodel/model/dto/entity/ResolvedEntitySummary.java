package com.example.architecturemodel.model.dto.entity;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

/**
 * Data Transfer Object for a resolved entity summary.
 *
 * Contains compact summary information about an architecture entity,
 * suitable for inclusion in LLM context for implementation planning.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 */
public record ResolvedEntitySummary(
    @JsonProperty("id")
    String id,

    @JsonProperty("name")
    String name,

    @JsonProperty("entity_type")
    String entityType,

    @JsonProperty("category")
    String category,

    @JsonProperty("relevant_fields")
    Map<String, Object> relevantFields
) {}
