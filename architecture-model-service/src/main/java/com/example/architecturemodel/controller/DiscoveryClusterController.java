package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoveryClusterDto;
import com.example.architecturemodel.service.DiscoveryClusterService;
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
 * REST Controller for Discovery Cluster endpoints.
 *
 * Spec: Phase 1 Evidence Schema Backbone (Increment 7)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/runs/{runId}/clusters")
@RequiredArgsConstructor
@Slf4j
public class DiscoveryClusterController {

    private final DiscoveryClusterService discoveryClusterService;

    @PostMapping
    public ResponseEntity<?> bulkInsert(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestBody List<DiscoveryClusterDto> clusters) {
        log.debug("POST /api/model/projects/{}/architectures/{}/discovery/runs/{}/clusters - {} clusters",
            projectId, architectureId, runId, clusters.size());

        try {
            List<DiscoveryClusterDto> result = discoveryClusterService.bulkCreateInArchitecture(
                runId, projectId, architectureId, clusters);
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException e) {
            log.warn("Run not found in architecture for cluster insert: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        } catch (IllegalArgumentException e) {
            log.warn("Bad request bulk inserting clusters for run {}: {}", runId, e.getMessage());
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<?> listClusters(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId,
            @RequestParam(required = false) String type) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/clusters?type={}",
            projectId, architectureId, runId, type);

        try {
            List<DiscoveryClusterDto> clusters = discoveryClusterService.getByRunIdInArchitecture(
                runId, projectId, architectureId, type);
            return ResponseEntity.ok(clusters);
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for cluster list: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/count")
    public ResponseEntity<?> countClusters(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/runs/{}/clusters/count",
            projectId, architectureId, runId);

        try {
            long count = discoveryClusterService.countByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("count", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for cluster count: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping
    public ResponseEntity<?> deleteClusters(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable UUID runId) {
        log.debug("DELETE /api/model/projects/{}/architectures/{}/discovery/runs/{}/clusters",
            projectId, architectureId, runId);

        try {
            long count = discoveryClusterService.deleteByRunIdInArchitecture(
                runId, projectId, architectureId);
            return ResponseEntity.ok(Map.of("deleted", count));
        } catch (NoSuchElementException e) {
            log.debug("Run not found in architecture for cluster delete: {}", e.getMessage());
            return ResponseEntity.notFound().build();
        }
    }
}
