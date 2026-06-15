package com.example.architecturemodel.controller.discovery;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.discovery.BulkCreateDiscoveryCapabilitiesRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryCapabilityRequest;
import com.example.architecturemodel.service.discovery.DiscoveryCapabilityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller for {@code discovery_capability} + its polymorphic members
 * (Liquibase changeset 184).
 *
 * <p>Path prefix mirrors the existing discovery findings surface:
 * {@code /api/model/projects/{projectId}/architectures/{architectureId}/discovery/...}.
 * The synthesised CAPABILITY is a cross-cutting current-state aggregation that
 * turns scattered per-file operational findings into ONE migration story.</p>
 *
 * <p>Endpoints:</p>
 * <ul>
 *   <li>{@code GET   .../discovery/runs/{runId}/capabilities} -- a run's
 *       capabilities (members embedded), for the synthesis read + the findings
 *       Capabilities section.</li>
 *   <li>{@code GET   .../discovery/capabilities} -- all capabilities for the
 *       project + architecture (members embedded; no run filter).</li>
 *   <li>{@code GET   .../discovery/capabilities/{capabilityId}} -- a single
 *       capability with its members.</li>
 *   <li>{@code POST  .../discovery/runs/{runId}/capabilities} -- create one
 *       capability + its members atomically.</li>
 *   <li>{@code POST  .../discovery/runs/{runId}/capabilities/bulk} -- bulk-create
 *       a batch of capabilities + their members in one transaction.</li>
 *   <li>{@code PATCH .../discovery/capabilities/{capabilityId}/review} -- the
 *       patch-review (transition review_status, recording previous_review_status).
 *       KEPT despite the read-only D2 UI -- forward-needed by the D4-gate spec.</li>
 * </ul>
 *
 * <p>snake_case wire (the global AMS default). Modeled on the
 * {@code DiscoveryFindingController} endpoint conventions.</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCapabilityController {

    private final DiscoveryCapabilityService service;

    @GetMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/capabilities")
    public ResponseEntity<List<DiscoveryCapabilityDto>> listByRun(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /capabilities runId={} projectId={} architectureId={}",
            runId, projectId, architectureId);
        return ResponseEntity.ok(service.listByRun(projectId, architectureId, runId));
    }

    @GetMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/capabilities")
    public ResponseEntity<List<DiscoveryCapabilityDto>> listByProjectAndArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        return ResponseEntity.ok(
            service.listByProjectAndArchitecture(projectId, architectureId));
    }

    @GetMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/capabilities/{capabilityId}")
    public ResponseEntity<?> get(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID capabilityId) {
        try {
            return ResponseEntity.ok(service.get(capabilityId));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/capabilities")
    public ResponseEntity<?> create(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody CreateDiscoveryCapabilityRequest request) {
        try {
            DiscoveryCapabilityDto created = service.create(projectId, architectureId, runId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] discovery_capability create_bad_request runId={} reason={}",
                runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/capabilities/bulk")
    public ResponseEntity<?> bulkCreate(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody BulkCreateDiscoveryCapabilitiesRequest request) {
        try {
            List<DiscoveryCapabilityDto> created =
                service.bulkCreate(projectId, architectureId, runId, request);
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException e) {
            log.warn("[diag-ams] discovery_capability bulk_create_bad_request runId={} reason={}",
                runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PatchMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/capabilities/{capabilityId}/review")
    public ResponseEntity<?> review(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID capabilityId,
            @RequestBody ReviewDiscoveryCapabilityRequest request) {
        try {
            return ResponseEntity.ok(service.review(capabilityId, request));
        } catch (ResourceNotFoundException e) {
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
