package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryEvidenceDto;
import com.example.architecturemodel.service.DiscoveryEvidenceService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * REST Controller for Discovery Evidence endpoints.
 *
 * Provides bulk insert, query (with optional type filter), and count access
 * to Phase 1a discovery evidence atoms for a discovery run.
 *
 * Spec: Phase 1a Universal Evidence Extraction (Increment 6)
 * Task Group 2: Evidence Entity, DTO, Repository, Service, and Controller
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: All Discovery* endpoints adopt the {architectureId} path
 * segment. Evidence rows live on a child table (no architecture_id column);
 * filtering is applied via JOIN to the parent discovery_run row. Operations
 * 404 when the run exists but is bound to a different architecture or project.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryEvidenceController {

    private final DiscoveryEvidenceService discoveryEvidenceService;

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence
     *
     * Bulk insert evidence atoms for a discovery run. The run MUST exist and be
     * bound to the architecture from the URL path -- otherwise 404.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (must match the run's bound id)
     * @param runId the discovery run UUID
     * @param atoms list of evidence atom DTOs to persist
     * @return list of persisted evidence atom DTOs
     */
    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryEvidenceDto> atoms) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/evidence - {} atoms",
            projectId, architectureId, runId, atoms.size());

        try {
            List<DiscoveryEvidenceDto> result = discoveryEvidenceService.bulkCreateInArchitecture(
                runId, projectId, architectureId, atoms);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for evidence insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting evidence for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence
     *
     * List evidence atoms for a discovery run with optional type filter. Returns
     * 404 if the run does not exist in the requested architecture.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param runId the discovery run UUID
     * @param type optional evidence atom type filter (file_structure, symbol, string_pattern)
     * @return list of matching evidence atom DTOs
     */
    @GetMapping
    public ResponseEntity<?> listEvidence(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String type) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/evidence?type={}",
            projectId, architectureId, runId, type);

        try {
            List<DiscoveryEvidenceDto> evidence = discoveryEvidenceService.getByRunIdInArchitecture(
                runId, projectId, architectureId, type);
            return ResponseEntity.ok(evidence);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for evidence list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/evidence/count
     *
     * Get the count of evidence atoms for a discovery run.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param runId the discovery run UUID
     * @return the atom count
     */
    @GetMapping("/count")
    public ResponseEntity<?> countEvidence(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/evidence/count",
            projectId, architectureId, runId);

        try {
            long count = discoveryEvidenceService.countByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("count", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for evidence count: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }
}
