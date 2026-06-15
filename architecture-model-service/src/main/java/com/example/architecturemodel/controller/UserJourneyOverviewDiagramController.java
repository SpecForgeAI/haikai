package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.diagram.UserJourneyOverviewDiagramDto;
import com.example.architecturemodel.service.UserJourneyOverviewDiagramProjectionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for User Journey Overview Diagram projection endpoint.
 *
 * Provides stateless, read-only overview diagram generation by projecting
 * persisted USER_JOURNEY, USER_JOURNEY_LINK, BUSINESS_USER, BUSINESS_PROCESS,
 * and ACTIVITY_STEP data into a stable v1 overview diagram contract,
 * scoped to a (project, architecture) pair.
 *
 * Spec: User Journey Overview Parent Diagram Generation
 * Task Group 3: REST Controller
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 *   Added {architectureId} path variable. Forgetting it produces a 404
 *   at the route layer (no controller-side default-resolution).
 *
 * Base path: /api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams")
@RequiredArgsConstructor
@Slf4j
public class UserJourneyOverviewDiagramController {

    private final UserJourneyOverviewDiagramProjectionService projectionService;

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}
     *
     * Returns the overview diagram contract for a Business User role within the
     * requested architecture. Always regenerates from DB data. Returns a valid
     * (possibly empty) structure for business users with zero matching journeys.
     *
     * @param projectId      the project UUID
     * @param architectureId the architecture UUID
     * @param businessUserId the business user ID whose journeys to include
     * @return the overview diagram DTO
     */
    @GetMapping("/temporary")
    public ResponseEntity<UserJourneyOverviewDiagramDto> getTemporaryOverviewDiagram(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam String businessUserId) {
        log.debug("GET /api/projects/{}/architectures/{}/user-journey-overview-diagrams/temporary?businessUserId={}",
            projectId, architectureId, businessUserId);

        UserJourneyOverviewDiagramDto diagram = projectionService.projectOverview(
            projectId, architectureId, businessUserId);
        return ResponseEntity.ok(diagram);
    }
}
