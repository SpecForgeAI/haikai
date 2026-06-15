package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ImplementWorkspaceDto;
import com.example.architecturemodel.service.WorkItemImplementWorkspaceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for Work Item Implement Workspace endpoints.
 *
 * Provides GET and PUT access to the implement workspace (full workspace state)
 * for a work item.
 *
 * Spec 2026-01-23: Persist + Rehydrate Implement Workspace
 * Task Group 3: Backend Controller Layer
 *
 * Base path: /api/projects/{projectId}/work-items/{workItemId}/implement-workspace
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/work-items/{workItemId}/implement-workspace")
@RequiredArgsConstructor
@Slf4j
public class WorkItemImplementWorkspaceController {

    private final WorkItemImplementWorkspaceService workspaceService;

    /**
     * GET /api/projects/{projectId}/work-items/{workItemId}/implement-workspace
     *
     * Get the implement workspace for a work item.
     * Returns empty default DTO if no workspace exists (not 404).
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @return the implement workspace DTO
     */
    @GetMapping
    public ResponseEntity<ImplementWorkspaceDto> getWorkspace(
            @PathVariable UUID projectId,
            @PathVariable UUID workItemId) {
        log.debug("GET /api/projects/{}/work-items/{}/implement-workspace", projectId, workItemId);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (workItemId == null) {
            throw new IllegalArgumentException("Work item ID cannot be null");
        }

        ImplementWorkspaceDto workspace = workspaceService.getWorkspace(projectId, workItemId);
        return ResponseEntity.ok(workspace);
    }

    /**
     * PUT /api/projects/{projectId}/work-items/{workItemId}/implement-workspace
     *
     * Save the implement workspace for a work item.
     * Creates new workspace if none exists, or updates existing workspace (upsert).
     *
     * @param projectId the project ID
     * @param workItemId the work item ID
     * @param request the request body with workspace state
     * @return the saved implement workspace DTO
     */
    @PutMapping
    public ResponseEntity<ImplementWorkspaceDto> saveWorkspace(
            @PathVariable UUID projectId,
            @PathVariable UUID workItemId,
            @RequestBody SaveWorkspaceRequest request) {
        log.debug("PUT /api/projects/{}/work-items/{}/implement-workspace", projectId, workItemId);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (workItemId == null) {
            throw new IllegalArgumentException("Work item ID cannot be null");
        }
        if (request == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        ImplementWorkspaceDto saved = workspaceService.saveWorkspace(
            projectId,
            workItemId,
            request.workspaceState()
        );
        return ResponseEntity.ok(saved);
    }

    /**
     * Request body for saving implement workspace.
     *
     * @param workspaceState the full workspace state as a Map
     */
    public record SaveWorkspaceRequest(
        @com.fasterxml.jackson.annotation.JsonProperty("workspace_state")
        Map<String, Object> workspaceState
    ) {}
}
