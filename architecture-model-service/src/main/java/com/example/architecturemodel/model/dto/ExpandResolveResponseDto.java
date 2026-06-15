package com.example.architecturemodel.model.dto;

import com.example.architecturemodel.model.dto.diagram.ResolvedDiagramSummary;
import com.example.architecturemodel.model.dto.entity.ResolvedEntitySummary;
import com.example.architecturemodel.model.dto.relationship.ResolvedRelationshipDto;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for expand-resolve response.
 *
 * Contains the expanded entity/diagram IDs (in canonical format) and their
 * resolved human-readable summaries, along with truncation metadata and
 * automatically discovered relationships between expanded entities.
 *
 * The expanded IDs use canonical format: {@code <entityType>::<entityId>}
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Context Bundles Backend Expansion
 * Spec: Context Bundles Auto-Include Relationships - Task Group 1
 */
public record ExpandResolveResponseDto(
    @JsonProperty("expanded_entity_ids")
    List<String> expandedEntityIds,

    @JsonProperty("expanded_diagram_ids")
    List<String> expandedDiagramIds,

    @JsonProperty("resolved_entities")
    List<ResolvedEntitySummary> resolvedEntities,

    @JsonProperty("resolved_diagrams")
    List<ResolvedDiagramSummary> resolvedDiagrams,

    @JsonProperty("truncated")
    boolean truncated,

    @JsonProperty("truncation_reason")
    String truncationReason,

    /**
     * Automatically discovered relationships between expanded entities.
     * Includes data entity relationships (fk, association, many_to_many),
     * interface-schema references (schema_ref), and service structure links
     * (contains, exposes).
     *
     * Returns empty list when no relationships exist (backward compatible).
     *
     * Spec: Context Bundles Auto-Include Relationships
     */
    @JsonProperty("resolved_relationships")
    List<ResolvedRelationshipDto> resolvedRelationships
) {}
