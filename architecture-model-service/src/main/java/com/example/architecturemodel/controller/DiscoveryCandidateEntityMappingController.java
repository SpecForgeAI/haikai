package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryCandidateEntityMappingDto;
import com.example.architecturemodel.service.DiscoveryCandidateEntityMappingService;
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
 * REST Controller for Discovery Candidate Entity Mapping endpoints (provenance tracking).
 *
 * Spec: Candidate Save-Back to Canonical Model (Increment 11)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidate-entity-mappings
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/candidate-entity-mappings")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCandidateEntityMappingController {

    private final DiscoveryCandidateEntityMappingService mappingService;

    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryCandidateEntityMappingDto> mappings) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidate-entity-mappings - {} mappings",
            projectId, architectureId, runId, mappings.size());

        try {
            List<DiscoveryCandidateEntityMappingDto> result = mappingService.bulkCreateInArchitecture(
                runId, projectId, architectureId, mappings);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for mapping insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting candidate entity mappings for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listMappings(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/candidate-entity-mappings",
            projectId, architectureId, runId);

        try {
            List<DiscoveryCandidateEntityMappingDto> mappings = mappingService.getByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(mappings);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for mapping list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }
}
