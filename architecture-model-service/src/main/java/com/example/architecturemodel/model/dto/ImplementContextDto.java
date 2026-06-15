package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Data Transfer Object for work item implement context.
 *
 * Uses Java record with @JsonProperty annotations for snake_case JSON serialization.
 * Represents the selected architecture entities and diagrams for a work item's Implement context.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 * - Added selectedEntitySelections and selectedDiagramSelections for structured selections
 *   with bundle_type and depth.
 * - Maintains backward compatibility with existing selectedEntityIds and selectedDiagramIds.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added selectedRelationshipIds and selectedRelationshipSelections for relationship persistence.
 * - Relationships are simpler than entities (no bundle_type or depth).
 */
public record ImplementContextDto(
    @JsonProperty("project_id")
    UUID projectId,

    @JsonProperty("work_item_id")
    UUID workItemId,

    /**
     * Legacy field: List of selected entity IDs (backward compatibility).
     */
    @JsonProperty("selected_entity_ids")
    List<String> selectedEntityIds,

    /**
     * Legacy field: List of selected diagram IDs (backward compatibility).
     */
    @JsonProperty("selected_diagram_ids")
    List<String> selectedDiagramIds,

    /**
     * Structured entity selections with bundle_type and optional depth.
     * When present, these take precedence over legacy selectedEntityIds for bundle expansion.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     */
    @JsonProperty("selected_entity_selections")
    List<EntitySelection> selectedEntitySelections,

    /**
     * Structured diagram selections with bundle_type.
     * When present, these take precedence over legacy selectedDiagramIds for bundle expansion.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     */
    @JsonProperty("selected_diagram_selections")
    List<DiagramSelection> selectedDiagramSelections,

    /**
     * Legacy field: List of selected relationship IDs.
     * Format: "relationshipType::relationshipId"
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_ids")
    List<String> selectedRelationshipIds,

    /**
     * Structured relationship selections with relationship_type, relationship_id, and label.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_selections")
    List<RelationshipSelection> selectedRelationshipSelections
) {
    /**
     * Backward-compatible constructor that defaults structured selections to null.
     * Used by legacy clients that only have entity and diagram IDs.
     */
    public ImplementContextDto(
            UUID projectId,
            UUID workItemId,
            List<String> selectedEntityIds,
            List<String> selectedDiagramIds) {
        this(projectId, workItemId, selectedEntityIds, selectedDiagramIds, null, null, new ArrayList<>(), new ArrayList<>());
    }

    /**
     * Backward-compatible constructor for entity/diagram selections without relationships.
     * Defaults relationship fields to empty lists.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    public ImplementContextDto(
            UUID projectId,
            UUID workItemId,
            List<String> selectedEntityIds,
            List<String> selectedDiagramIds,
            List<EntitySelection> selectedEntitySelections,
            List<DiagramSelection> selectedDiagramSelections) {
        this(projectId, workItemId, selectedEntityIds, selectedDiagramIds,
             selectedEntitySelections, selectedDiagramSelections,
             new ArrayList<>(), new ArrayList<>());
    }
}
