package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryConfigDto;
import com.example.architecturemodel.service.DiscoveryConfigService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for Discovery Config endpoints.
 *
 * Provides PUT (upsert) and GET (retrieve) access to Phase 0 discovery
 * configuration for a project.
 *
 * Spec: Phase 0 Persistence Contract (Increment 2)
 * Task Group 3: Service and Controller
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: URL adopts the {architectureId} path segment for consistency
 * with every other Discovery endpoint (hard cutover, no back-compat). The
 * underlying {@code discovery_config} table is one-per-project and does NOT
 * carry an {@code architecture_id} column -- per-project Phase 0 config
 * (repos, hints, exclusions) does not vary by architecture, so the path
 * segment is purely a routing-shape decision. The {@code architectureId} is
 * accepted by the controller but not used in the WHERE clause.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/config
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/config")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryConfigController {

    private static final String DEFAULT_STATUS = "DRAFT";

    private final DiscoveryConfigService discoveryConfigService;

    /**
     * PUT /api/model/projects/{projectId}/architectures/{architectureId}/discovery/config
     *
     * Save (upsert) a discovery config for a project.
     * Creates a new config if none exists for the given projectId,
     * or updates the existing config's payload and status.
     *
     * If the status field is omitted or blank in the request body,
     * defaults to "DRAFT".
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (URL routing only -- config
     *                       is per-project, not per-architecture)
     * @param request the request body containing the config payload and status
     * @return the saved discovery config DTO
     */
    @PutMapping
    public ResponseEntity<DiscoveryConfigDto> saveConfig(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody SaveDiscoveryConfigRequest request) {
        log.debug("PUT /api/model/projects/{}/architectures/{}/discovery/config",
            projectId, architectureId);

        String status = request.status() != null && !request.status().isBlank()
            ? request.status()
            : DEFAULT_STATUS;

        DiscoveryConfigDto saved = discoveryConfigService.upsertConfig(
            projectId,
            request.configPayload(),
            status
        );
        return ResponseEntity.ok(saved);
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/discovery/config
     *
     * Retrieve a discovery config by project ID.
     * Returns 404 if not found.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID (URL routing only -- config
     *                       is per-project, not per-architecture)
     * @return the discovery config DTO, or 404 if not found
     */
    @GetMapping
    public ResponseEntity<DiscoveryConfigDto> getConfig(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/config",
            projectId, architectureId);

        DiscoveryConfigDto dto = discoveryConfigService.getConfig(projectId);
        if (dto == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(dto);
    }

    /**
     * Request body for saving a discovery config.
     *
     * @param configPayload the structured discovery config JSON payload as a Map
     * @param status the lifecycle status (DRAFT or COMPLETE); defaults to DRAFT if omitted
     */
    public record SaveDiscoveryConfigRequest(
        @JsonProperty("config_payload")
        Map<String, Object> configPayload,

        @JsonProperty("status")
        String status
    ) {}
}
