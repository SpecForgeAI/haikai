package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.model.dto.DiagramSelection;
import com.example.architecturemodel.model.dto.EntitySelection;
import com.example.architecturemodel.model.dto.RelationshipSelection;
import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * JPA Entity for work item implement context.
 *
 * Stores the selected architecture entities and diagrams for each work item's
 * Implement context, enabling persistence across browser sessions and devices.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 * - Added selectedEntitySelections and selectedDiagramSelections JSONB columns
 *   for storing structured selections with bundle_type and depth.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added selectedRelationshipIds and selectedRelationshipSelections JSONB columns
 *   for storing relationship selections.
 */
@Entity
@Table(name = "work_item_implement_context")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WorkItemImplementContextEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", nullable = false)
    private UUID projectId;

    @Column(name = "work_item_id", nullable = false)
    private UUID workItemId;

    /**
     * List of selected entity IDs stored as JSONB array.
     * Legacy field for backward compatibility.
     */
    @Type(JsonType.class)
    @Column(name = "selected_entity_ids", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> selectedEntityIds = new ArrayList<>();

    /**
     * List of selected diagram IDs stored as JSONB array.
     * Legacy field for backward compatibility.
     */
    @Type(JsonType.class)
    @Column(name = "selected_diagram_ids", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> selectedDiagramIds = new ArrayList<>();

    /**
     * List of structured entity selections with bundle_type and depth.
     * Stored as JSONB array of EntitySelection objects.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     */
    @Type(JsonType.class)
    @Column(name = "selected_entity_selections", columnDefinition = "jsonb")
    @Builder.Default
    private List<EntitySelection> selectedEntitySelections = new ArrayList<>();

    /**
     * List of structured diagram selections with bundle_type.
     * Stored as JSONB array of DiagramSelection objects.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     */
    @Type(JsonType.class)
    @Column(name = "selected_diagram_selections", columnDefinition = "jsonb")
    @Builder.Default
    private List<DiagramSelection> selectedDiagramSelections = new ArrayList<>();

    /**
     * List of selected relationship IDs stored as JSONB array.
     * Format: "relationshipType::relationshipId"
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @Type(JsonType.class)
    @Column(name = "selected_relationship_ids", columnDefinition = "jsonb")
    @Builder.Default
    private List<String> selectedRelationshipIds = new ArrayList<>();

    /**
     * List of structured relationship selections.
     * Stored as JSONB array of RelationshipSelection objects.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @Type(JsonType.class)
    @Column(name = "selected_relationship_selections", columnDefinition = "jsonb")
    @Builder.Default
    private List<RelationshipSelection> selectedRelationshipSelections = new ArrayList<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
}
