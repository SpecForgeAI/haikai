package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.targetmanifest.PersistTargetManifestArtifactsRequest;
import com.example.architecturemodel.model.dto.targetmanifest.TargetManifestArtifactDto;
import com.example.architecturemodel.service.targetmanifest.TargetManifestArtifactService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for the confirmed target manifest store (Spec 5 Phase 2, Task
 * Group 1).
 *
 * <p>Mirrors {@code VulnerabilityController}: {@code @ConditionalOnProperty}
 * feature gate, project/architecture-scoped {@code @RequestMapping}, snake_case
 * JSON throughout (no {@code @CamelCaseWire} -- the gateway client expects
 * snake_case).</p>
 *
 * <p>Base path:
 * {@code /api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts}.</p>
 *
 * <h2>Endpoints</h2>
 * <ul>
 *   <li>{@code POST .../} (the base) -- persist the confirmed manifest artifacts
 *       (one per tag) for the target architecture. Replaces the latest per
 *       {@code (project_id, target_architecture_id, tag)} and keeps history
 *       (append-only). Returns the persisted latest artifacts (one per tag).</li>
 *   <li>{@code GET .../} (the base) -- read the latest artifacts (one per tag)
 *       for the target architecture; the verbatim bytes the producer emits.</li>
 * </ul>
 *
 * <p>The deterministic replace-latest / keep-history lifecycle runs in
 * {@link TargetManifestArtifactService}. The scoping ids
 * ({@code projectId}, {@code targetArchitectureId}) are taken from the path; the
 * write body carries only the per-tag artifacts.</p>
 *
 * <p>Spec: Confirmed Manifest Producer Wiring (2026-06-25, Spec 5 Phase 2) --
 * Task Group 1. This spec OWNS the contract.</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/target-architectures/{targetArchitectureId}/manifest-artifacts")
@RequiredArgsConstructor
@Slf4j
public class TargetManifestArtifactController {

    private final TargetManifestArtifactService service;

    /**
     * Persist the confirmed manifest artifacts for a target architecture
     * (replace latest per tag, keep history). Returns the persisted latest
     * artifacts so the caller can confirm the round-trip without a second
     * request.
     */
    @PostMapping
    public ResponseEntity<List<TargetManifestArtifactDto>> persist(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId,
            @RequestBody PersistTargetManifestArtifactsRequest request) {
        int count = request != null && request.artifacts() != null
            ? request.artifacts().size() : 0;
        log.debug("POST .../manifest-artifacts project={} targetArchitecture={} artifacts={}",
            projectId, targetArchitectureId, count);
        List<TargetManifestArtifactDto> latest = service.persistLatest(
            projectId, targetArchitectureId,
            request == null ? List.of() : request.artifacts());
        return ResponseEntity.status(HttpStatus.CREATED).body(latest);
    }

    /**
     * Read the latest manifest artifacts (one per tag) for a target
     * architecture.
     */
    @GetMapping
    public ResponseEntity<List<TargetManifestArtifactDto>> listLatest(
            @PathVariable UUID projectId,
            @PathVariable UUID targetArchitectureId) {
        return ResponseEntity.ok(service.findLatest(projectId, targetArchitectureId));
    }
}
