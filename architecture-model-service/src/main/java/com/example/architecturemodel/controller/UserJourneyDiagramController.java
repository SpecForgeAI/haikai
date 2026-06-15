package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.diagram.UserJourneyDiagramDto;
import com.example.architecturemodel.service.UserJourneyDiagramProjectionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for User Journey Diagram projection endpoints.
 *
 * Provides stateless, read-only diagram contract generation by projecting
 * persisted USER_JOURNEY and ACTIVITY_STEP data into a stable v1 diagram contract,
 * scoped to a (project, architecture) pair.
 *
 * Spec: User Journey Temporary Diagram JSON Generation
 * Task Group 3: REST Controller and Controller Tests
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 *   Added {architectureId} path variable. Forgetting it produces a 404
 *   at the route layer (no controller-side default-resolution).
 *
 * Base path: /api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams")
@RequiredArgsConstructor
@Slf4j
public class UserJourneyDiagramController {

    private final UserJourneyDiagramProjectionService projectionService;

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/{userJourneyId}/temporary
     *
     * Returns the diagram contract for a single USER_JOURNEY. Always regenerates from DB.
     * Returns 404 if journey not found or does not belong to the requested architecture's
     * model file.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param userJourneyId the user journey ID
     * @return the diagram contract DTO
     */
    @GetMapping("/{userJourneyId}/temporary")
    public ResponseEntity<UserJourneyDiagramDto> getSingleJourneyDiagram(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String userJourneyId) {
        log.debug("GET /api/projects/{}/architectures/{}/user-journey-diagrams/{}/temporary",
            projectId, architectureId, userJourneyId);

        UserJourneyDiagramDto diagram = projectionService.projectSingleJourney(
            projectId, architectureId, userJourneyId);
        return ResponseEntity.ok(diagram);
    }

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/user-journey-diagrams/temporary
     *
     * Returns an array of diagram contracts for all USER_JOURNEYs in the requested
     * architecture's active model file. Always regenerates from DB.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return list of diagram contract DTOs (empty list if no journeys exist)
     */
    @GetMapping("/temporary")
    public ResponseEntity<List<UserJourneyDiagramDto>> getAllJourneyDiagrams(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/projects/{}/architectures/{}/user-journey-diagrams/temporary",
            projectId, architectureId);

        List<UserJourneyDiagramDto> diagrams = projectionService.projectAllJourneys(
            projectId, architectureId);
        return ResponseEntity.ok(diagrams);
    }
}
