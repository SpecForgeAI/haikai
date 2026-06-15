package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryRelationshipDto;
import com.example.architecturemodel.service.DiscoveryRelationshipService;
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
 * REST Controller for Discovery Relationship endpoints.
 *
 * Provides bulk insert, query (with optional relationship type filter), and count
 * access to Phase 1b discovery relationships for a discovery run.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Task Group 2: Relationship JPA Stack (1b)
 *
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: All Discovery* endpoints adopt the {architectureId} path
 * segment. Filtering applied via JOIN to discovery_run.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/relationships")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryRelationshipController {

    private final DiscoveryRelationshipService discoveryRelationshipService;

    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryRelationshipDto> relationships) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/relationships - {} relationships",
            projectId, architectureId, runId, relationships.size());

        try {
            List<DiscoveryRelationshipDto> result = discoveryRelationshipService.bulkCreateInArchitecture(
                runId, projectId, architectureId, relationships);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for relationship insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting relationships for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listRelationships(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String type) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/relationships?type={}",
            projectId, architectureId, runId, type);

        try {
            List<DiscoveryRelationshipDto> relationships = discoveryRelationshipService.getByRunIdInArchitecture(
                runId, projectId, architectureId, type);
            return ResponseEntity.ok(relationships);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for relationship list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/count")
    public ResponseEntity<?> countRelationships(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/relationships/count",
            projectId, architectureId, runId);

        try {
            long count = discoveryRelationshipService.countByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("count", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for relationship count: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }
}
