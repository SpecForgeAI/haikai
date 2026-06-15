package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.DiscoverySummaryDto;
import com.example.architecturemodel.service.DiscoverySummaryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for the Discovery Summary endpoint.
 *
 * Spec: Discovery Results Visibility (Increment 12)
 * Spec: Discovery Service architectureId Integration (Spec #4 -- 2026-05-01)
 * Task Group 2: URL adopts the {architectureId} path segment. Summary
 * aggregation is delegated to {@link DiscoverySummaryService}, which Group 2
 * leaves project-scoped for now. The Summary endpoint is read-only and not on
 * the spec #4 critical path; future work can refine to scope by architecture.
 *
 * Base path: /api/model/projects/{projectId}/architectures/{architectureId}/discovery/summary
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}/discovery/summary")
@RequiredArgsConstructor
@Slf4j
public class DiscoverySummaryController {

    private final DiscoverySummaryService discoverySummaryService;

    @GetMapping
    public ResponseEntity<DiscoverySummaryDto> getSummary(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/discovery/summary",
            projectId, architectureId);

        DiscoverySummaryDto summary = discoverySummaryService.getSummary(projectId);
        return ResponseEntity.ok(summary);
    }
}
