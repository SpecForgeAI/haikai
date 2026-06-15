package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryOrphanSummaryDto;
import com.example.architecturemodel.service.DiscoveryRunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

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
}
