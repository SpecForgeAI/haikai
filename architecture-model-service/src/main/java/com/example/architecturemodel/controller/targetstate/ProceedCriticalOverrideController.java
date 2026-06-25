package com.example.architecturemodel.controller.targetstate;

import com.example.architecturemodel.model.dto.targetstate.ProceedCriticalOverrideDto;
import com.example.architecturemodel.model.dto.targetstate.UpsertProceedCriticalOverrideRequest;
import com.example.architecturemodel.service.ArchitectureService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * REST controller for the "proceed with remaining criticals" override audit
 * trio on a target architecture (Spec: Vulnerability Reduction + Steering,
 * 2026-06-24, Spec 4 of 6 -- Task Group 4).
 *
 * <p>The architect-conversation "proceed" step HARD-GATES on any remaining
 * CRITICAL CVE (Spec 4 steering). Overriding the gate records the audit trio
 * (justification + remaining-critical count at override time + timestamp) ONCE
 * PER TARGET ARCHITECTURE; a later read-only banner reads it back. This mirrors
 * the capture-session coverage-override seam (a focused PUT/GET pair, the
 * snake_case wire DTO, the service-layer null-guard + justification-required
 * rule), rather than bolting the trio onto the broad {@code ArchitectureDto}.</p>
 *
 * <pre>
 *   GET  /api/projects/{projectId}/architectures/{architectureId}/proceed-critical-override
 *   PUT  /api/projects/{projectId}/architectures/{architectureId}/proceed-critical-override
 * </pre>
 *
 * <p>Errors are mapped by the shared {@code GlobalExceptionHandler}:
 * {@code ArchitectureNotFoundException} -> 404, {@code IllegalArgumentException}
 * (a null/blank justification on PUT) -> 400. Persistence + the not-found guard
 * + the justification-required rule all live in {@link ArchitectureService}, so
 * the same rules apply to the gateway-injected payload and any future internal
 * callers.</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/proceed-critical-override")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ProceedCriticalOverrideController {

    private final ArchitectureService architectureService;

    public ProceedCriticalOverrideController(ArchitectureService architectureService) {
        this.architectureService = architectureService;
    }

    /**
     * GET the persisted proceed-critical override trio for the later read-only
     * banner. Returns 200 with a not-overridden default ({@code overridden=false},
     * audit fields null) when no override has been recorded.
     */
    @GetMapping
    public ResponseEntity<ProceedCriticalOverrideDto> getProceedCriticalOverride(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET proceed-critical-override for project {} architecture {}",
            projectId, architectureId);
        ProceedCriticalOverrideDto dto =
            architectureService.getProceedCriticalOverride(projectId, architectureId);
        return ResponseEntity.ok(dto);
    }

    /**
     * PUT (upsert) the proceed-critical override trio. The justification is
     * required (a null/blank justification is rejected 400 by the service so the
     * gate is never bypassed without a recorded reason); the timestamp defaults
     * to {@code now()} when omitted. Returns 200 with the persisted trio.
     */
    @PutMapping
    public ResponseEntity<ProceedCriticalOverrideDto> upsertProceedCriticalOverride(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody UpsertProceedCriticalOverrideRequest request) {
        log.info("PUT proceed-critical-override for project {} architecture {}",
            projectId, architectureId);
        ProceedCriticalOverrideDto dto =
            architectureService.upsertProceedCriticalOverride(projectId, architectureId, request);
        return ResponseEntity.ok(dto);
    }
}
