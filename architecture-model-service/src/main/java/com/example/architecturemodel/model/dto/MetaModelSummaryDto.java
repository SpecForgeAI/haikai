package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Data Transfer Object for meta-model summary.
 *
 * Contains a comprehensive summary of the architecture meta-model for a project,
 * including services, data entities, interfaces, and their relationships.
 *
 * All entities are resolved to human-readable names (not raw IDs) and scoped
 * to the active project.
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 */
public record MetaModelSummaryDto(
    @JsonProperty("applications")
    List<EntitySummary> applications,

    @JsonProperty("services")
    List<EntitySummary> services,

    @JsonProperty("data_entities")
    List<EntitySummary> dataEntities,

    @JsonProperty("interfaces")
    List<EntitySummary> interfaces,

    @JsonProperty("relationships")
    List<RelationshipSummary> relationships,

    @JsonProperty("business_users")
    List<EntitySummary> businessUsers,

    @JsonProperty("process_activities")
    List<EntitySummary> processActivities,

    @JsonProperty("ui_screens")
    List<EntitySummary> uiScreens,

    /**
     * User Journeys - summary of user journey entities for LLM context.
     *
     * Spec: User Journey Meta-Model Foundation
     */
    @JsonProperty("user_journeys")
    List<EntitySummary> userJourneys,

    @JsonProperty("data_store_count")
    int dataStoreCount
) {
    /**
     * Summary of an architecture entity.
     * Contains minimal information for LLM context.
     */
    public record EntitySummary(
        @JsonProperty("id")
        String id,

        @JsonProperty("name")
        String name,

        @JsonProperty("entity_type")
        String entityType
    ) {}

    /**
     * Summary of a relationship between entities.
     * Uses human-readable entity names (not IDs).
     */
    public record RelationshipSummary(
        @JsonProperty("source_entity")
        String sourceEntity,

        @JsonProperty("target_entity")
        String targetEntity,

        @JsonProperty("relationship_type")
        String relationshipType
    ) {}
}
