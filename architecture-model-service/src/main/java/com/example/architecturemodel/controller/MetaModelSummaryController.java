package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.MetaModelSummaryDto;
import com.example.architecturemodel.service.MetaModelSummaryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for Meta-Model Summary endpoint.
 *
 * Provides a GET endpoint that returns a comprehensive summary of the
 * architecture meta-model for a (project, architecture) pair, including
 * services, data entities, interfaces, and relationships.
 *
 * This endpoint is used by the Gateway during the Implementation Assistant
 * bootstrap phase to provide rich architecture context to the LLM.
 *
 * Base path: /api/projects/{projectId}/architectures/{architectureId}/meta-model-summary
 *
 * Spec: Implement Assistant Stage 3 - Bootstrap Phase
 * Spec: Multi-Architecture Plumbing (Spec #1) -- added {architectureId}
 *   path variable. Forgetting it produces a 404 (no controller-layer
 *   default-resolution).
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/meta-model-summary")
@RequiredArgsConstructor
@Slf4j
public class MetaModelSummaryController {

    private final MetaModelSummaryService metaModelSummaryService;

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/meta-model-summary
     *
     * Returns a comprehensive summary of the architecture meta-model.
     * Includes: services, data entities, interfaces, and relationships.
     * All entities are resolved to human-readable names.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return MetaModelSummaryDto with all entities and relationships
     * @throws IllegalArgumentException if projectId or architectureId is null
     */
    @GetMapping
    public ResponseEntity<MetaModelSummaryDto> getMetaModelSummary(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/projects/{}/architectures/{}/meta-model-summary", projectId, architectureId);

        // Validation
        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (architectureId == null) {
            throw new IllegalArgumentException("Architecture ID cannot be null");
        }

        MetaModelSummaryDto result = metaModelSummaryService.getMetaModelSummary(projectId, architectureId);

        log.debug("Returning meta-model summary with {} services, {} data entities, {} interfaces, {} relationships for project {} architecture {}",
            result.services() != null ? result.services().size() : 0,
            result.dataEntities() != null ? result.dataEntities().size() : 0,
            result.interfaces() != null ? result.interfaces().size() : 0,
            result.relationships() != null ? result.relationships().size() : 0,
            projectId, architectureId);

        return ResponseEntity.ok(result);
    }
}
