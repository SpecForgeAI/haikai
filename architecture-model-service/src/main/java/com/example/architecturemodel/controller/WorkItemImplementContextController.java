package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiagramSelection;
import com.example.architecturemodel.model.dto.EntitySelection;
import com.example.architecturemodel.model.dto.ImplementContextDto;
import com.example.architecturemodel.model.dto.RelationshipSelection;
import com.example.architecturemodel.service.WorkItemImplementContextService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for Work Item Implement Context endpoints.
 *
 * Provides GET and PUT access to the implement context (selected architecture
 * entities, diagrams, and relationships) for a work item.
 *
 * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
 * - Added support for structured entity/diagram selections with bundle_type and depth.
 * - Backward compatibility: infers defaults when loading legacy contexts.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 * - Added support for relationship selections.
 * - Controller now accepts and returns relationship fields alongside entities and diagrams.
 *
 * Base path: /api/projects/{projectId}/work-items/{workItemId}/implement-context
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/work-items/{workItemId}/implement-context")
@RequiredArgsConstructor
@Slf4j
public class WorkItemImplementContextController {

    private final WorkItemImplementContextService contextService;

    /**
     * GET /api/projects/{projectId}/work-items/{workItemId}/implement-context
     *
     * Get the implement context for a work item.
     * Returns empty arrays if no context exists.
     * Includes structured selections when available, or infers defaults for legacy contexts.
     * Includes relationship selections.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the implement context DTO
     */
    @GetMapping
    public ResponseEntity<ImplementContextDto> getContext(
            @PathVariable UUID projectId,
            @PathVariable UUID workItemId) {
        log.debug("GET /api/projects/{}/work-items/{}/implement-context", projectId, workItemId);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (workItemId == null) {
            throw new IllegalArgumentException("Work item ID cannot be null");
        }

        ImplementContextDto context = contextService.getContext(projectId, workItemId);
        return ResponseEntity.ok(context);
    }

    /**
     * PUT /api/projects/{projectId}/work-items/{workItemId}/implement-context
     *
     * Save the implement context for a work item.
     * Creates new context if none exists, or updates existing context.
     * Supports both legacy ID arrays and structured selections.
     * Includes relationship selection support.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param request the request body with selected entity, diagram, and relationship IDs/selections
     * @return the saved implement context DTO
     */
    @PutMapping
    public ResponseEntity<ImplementContextDto> saveContext(
            @PathVariable UUID projectId,
            @PathVariable UUID workItemId,
            @RequestBody SaveContextRequest request) {
        log.debug("PUT /api/projects/{}/work-items/{}/implement-context with relationships", projectId, workItemId);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (workItemId == null) {
            throw new IllegalArgumentException("Work item ID cannot be null");
        }
        if (request == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        // Spec: Implement Context Include Relationships and Propagate to Planner Payload
        // Pass all fields including relationships to service
        ImplementContextDto saved = contextService.saveContext(
            projectId,
            workItemId,
            request.selectedEntityIds(),
            request.selectedDiagramIds(),
            request.selectedEntitySelections(),
            request.selectedDiagramSelections(),
            request.selectedRelationshipIds(),
            request.selectedRelationshipSelections()
        );
        return ResponseEntity.ok(saved);
    }

    /**
     * Request body for saving implement context.
     *
     * Spec: Ensure Physical Data Entity Attributes Reach Planner LLM
     * - Added structured selections fields with bundle_type and depth.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     * - Added relationship selection fields.
     */
    public record SaveContextRequest(
        @com.fasterxml.jackson.annotation.JsonProperty("selected_entity_ids")
        List<String> selectedEntityIds,

        @com.fasterxml.jackson.annotation.JsonProperty("selected_diagram_ids")
        List<String> selectedDiagramIds,

        @com.fasterxml.jackson.annotation.JsonProperty("selected_entity_selections")
        List<EntitySelection> selectedEntitySelections,

        @com.fasterxml.jackson.annotation.JsonProperty("selected_diagram_selections")
        List<DiagramSelection> selectedDiagramSelections,

        @com.fasterxml.jackson.annotation.JsonProperty("selected_relationship_ids")
        List<String> selectedRelationshipIds,

        @com.fasterxml.jackson.annotation.JsonProperty("selected_relationship_selections")
        List<RelationshipSelection> selectedRelationshipSelections
    ) {}
}
