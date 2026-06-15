package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.model.dto.DiscoveryRunDto;
import com.example.architecturemodel.service.DiscoveryCandidateEntityMappingService;
import com.example.architecturemodel.service.DiscoveryRunService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST Controller for the architecture-scoped Discovery Entity Origins endpoint.
 *
 * Returns all candidate-entity mappings across all discovery runs for a
 * (project, architecture) pair, enabling the frontend to display "Discovered"
 * badges on meta-model entities without needing to know individual run IDs.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: URL adopts the {architectureId} path segment. Run lookup is
 * scoped by architecture so badges only reflect promotion activity for the
 * currently-active architecture.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/entity-origins
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/entity-origins")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryEntityOriginsController {

    private final DiscoveryRunService discoveryRunService;
    private final DiscoveryCandidateEntityMappingService mappingService;

    @GetMapping
    public ResponseEntity<List<DiscoveryCandidateEntityMappingDto>> getEntityOrigins(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/entity-origins",
            projectId, architectureId);

        // Fetch all run IDs for the (project, architecture) pair so cross-arch
        // promotion activity does not leak into this list.
        List<UUID> runIds = discoveryRunService.getRunsByProjectAndArchitecture(
                projectId, architectureId)
            .stream()
            .map(DiscoveryRunDto::id)
            .collect(Collectors.toList());

        // Fetch all mappings across the in-architecture runs
        List<DiscoveryCandidateEntityMappingDto> mappings = mappingService.getByProjectRunIds(runIds);

        return ResponseEntity.ok(mappings);
    }
}
