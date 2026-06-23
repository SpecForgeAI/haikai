package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryOrphanSummaryDto;
import com.example.architecturemodel.model.dto.DiscoveryCandidateDto;
import com.example.architecturemodel.model.dto.StageImportedCandidateRequest;
import com.example.architecturemodel.service.DiscoveryRunService;
import com.example.architecturemodel.service.PostmanImportCandidateStagingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for Discovery Orphan Detection and Cleanup endpoints.
 *
 * Spec: Discovery Refinement, Consolidation, and System Hardening (Increment 16)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: URL adopts the {architectureId} path segment for consistency.
 * Orphan detection is data-cleanup tooling and remains project-scoped at the
 * service layer (orphans are by definition rows whose run no longer exists).
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryOrphanController {

    private final DiscoveryRunService discoveryRunService;
    private final PostmanImportCandidateStagingService postmanImportCandidateStagingService;

    @GetMapping("/orphans")
    public ResponseEntity<DiscoveryOrphanSummaryDto> findOrphans(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "staleDays", defaultValue = "30") int staleDays) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/orphans?staleDays={}",
            projectId, architectureId, staleDays);

        try {
            DiscoveryOrphanSummaryDto summary = discoveryRunService.findOrphanedData(projectId, staleDays);
            return ResponseEntity.ok(summary);
        } catch (Exception e) {
            log.error("Error detecting orphaned data for project {}: {}", projectId, e.getMessage());
            return ResponseEntity.internalServerError().build();
        }
    }

    @PostMapping("/cleanup")
    public ResponseEntity<DiscoveryOrphanSummaryDto> cleanup(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(name = "staleDays", defaultValue = "30") int staleDays) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/cleanup?staleDays={}",
            projectId, architectureId, staleDays);

        try {
            DiscoveryOrphanSummaryDto summary = discoveryRunService.cleanupOrphanedData(projectId, staleDays);
            return ResponseEntity.ok(summary);
        } catch (Exception e) {
            log.error("Error cleaning up orphaned data for project {}: {}", projectId, e.getMessage());
            return ResponseEntity.internalServerError().build();
        }
    }
    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/stage-imported-candidate
     *
     * Stage ONE imported (Postman) endpoint as an un-approved discovery candidate
     * scoped to the (project, architecture) pair -- the AMS side of "Add to
     * architecture" for the Postman import flow.
     *
     * <p>Spec: 2026-06-23 Import a Postman Collection into Capture, R5 / A4 -- Task
     * Group 5. The candidate is staged un-approved
     * ({@code review_status='pending_review'}, {@code status='proposed'}) and
     * parented by a find-or-create synthetic "imported" run (because
     * {@code discovery_candidate.run_id} is NOT NULL). It is NEVER a
     * committed-architecture write.</p>
     *
     * <p>Body + response are snake_case (R8). Returns 200 with the staged
     * {@link DiscoveryCandidateDto}; 400 when {@code method} or {@code path} is
     * missing/blank.</p>
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID the candidate is scoped to
     * @param request the imported endpoint (method + path required)
     * @return the staged un-approved candidate DTO
     */
    @PostMapping("/stage-imported-candidate")
    public ResponseEntity<?> stageImportedCandidate(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody StageImportedCandidateRequest request) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/stage-imported-candidate method={} path={}",
            projectId, architectureId,
            request == null ? null : request.method(),
            request == null ? null : request.path());

        try {
            DiscoveryCandidateDto staged = postmanImportCandidateStagingService
                .stageImportedCandidate(projectId, architectureId, request);
            return ResponseEntity.ok(staged);
        } catch (IllegalArgumentException e) {
            log.warn("Bad request staging imported candidate for project {} architecture {}: {}",
                projectId, architectureId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
