package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.diagram.UserJourneySyncStatusResponse;
import com.example.architecturemodel.service.UserJourneySyncService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for User Journey diagram sync endpoints.
 *
 * Spec: User Journey One-Way Sync from Meta-Model
 * Task Group 2: Sync Controller Endpoints
 *
 * Provides sync-status detection and refresh-from-model endpoints
 * for saved USER_JOURNEY diagrams. Follows the same @ConditionalOnProperty
 * pattern as UserJourneyDiagramController.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 *   Added {architectureId} path variable. Forgetting it produces a 404
 *   at the route layer (no controller-side default-resolution).
 *
 * Base path: /api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}")
@RequiredArgsConstructor
@Slf4j
public class UserJourneySyncController {

    private final UserJourneySyncService syncService;

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/user-journey-sync-status
     *
     * Checks the sync status of a saved USER_JOURNEY diagram against the meta-model.
     * Returns IN_SYNC, STALE, BROKEN_SOURCE, or UNLINKED. Returns 404 if the
     * diagram is not found.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param diagramId the diagram ID
     * @return sync status response
     */
    @GetMapping("/user-journey-sync-status")
    public ResponseEntity<UserJourneySyncStatusResponse> getSyncStatus(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String diagramId) {
        log.debug("GET /api/projects/{}/architectures/{}/diagrams/{}/user-journey-sync-status",
            projectId, architectureId, diagramId);

        UserJourneySyncStatusResponse response = syncService.checkSyncStatus(
            projectId, architectureId, diagramId);
        return ResponseEntity.ok(response);
    }

    /**
     * POST /api/projects/{projectId}/architectures/{architectureId}/diagrams/{diagramId}/refresh-user-journey-from-model
     *
     * Refreshes a saved USER_JOURNEY diagram from the meta-model.
     * Re-projects the diagram, updates typed_content_json with fresh content
     * and updated sync metadata, saves the entity. Returns the updated DiagramDto
     * so the frontend can reload. Returns 404 if diagram not found or source is broken.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param diagramId the diagram ID
     * @return updated diagram DTO
     */
    @PostMapping("/refresh-user-journey-from-model")
    public ResponseEntity<DiagramDto> refreshFromModel(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String diagramId) {
        log.debug("POST /api/projects/{}/architectures/{}/diagrams/{}/refresh-user-journey-from-model",
            projectId, architectureId, diagramId);

        DiagramDto updatedDiagram = syncService.refreshFromModel(
            projectId, architectureId, diagramId);
        return ResponseEntity.ok(updatedDiagram);
    }
}
