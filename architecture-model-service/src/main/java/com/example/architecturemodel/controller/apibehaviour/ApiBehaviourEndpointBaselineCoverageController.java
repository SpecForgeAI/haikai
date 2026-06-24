package com.example.architecturemodel.controller.apibehaviour;

import com.example.architecturemodel.model.dto.apibehaviour.EndpointBaselineCoverageDto;
import com.example.architecturemodel.service.apibehaviour.ApiBehaviourEndpointBaselineCoverageService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Read endpoint exposing the canonical architecture endpoint→baseline coverage
 * map (which endpoint elements are covered by an ACTIVE API Behaviour
 * Baseline, and which baseline covers each).
 *
 * <p>Architecture-scoped on its own base path (NOT under the
 * {@code /api-behaviour/baselines/{baselineId}} tree) so the literal segment
 * cannot be misread as a {@code {baselineId}} UUID path variable.</p>
 *
 * <p>Consumed by the gateway's phase-2 Migration Delivery Plan expansion to
 * resolve each endpoint's baseline — replacing the old baseline-NAME substring
 * match that never matched a descriptively-named baseline. Spec: Migration
 * Delivery Plan expansion — endpoint↔baseline coverage (2026-06-24 fix).</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/api-behaviour")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ApiBehaviourEndpointBaselineCoverageController {

    private final ApiBehaviourEndpointBaselineCoverageService service;

    /**
     * Returns the list of architecture endpoint elements covered by an active
     * baseline. Endpoints with no active-baseline coverage are absent from the
     * list (the consumer treats absence as "no baseline").
     */
    @GetMapping("/endpoint-baseline-coverage")
    public ResponseEntity<List<EndpointBaselineCoverageDto>> endpointBaselineCoverage(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return ResponseEntity.ok(service.computeCoverage(projectId, architectureId));
    }
}
