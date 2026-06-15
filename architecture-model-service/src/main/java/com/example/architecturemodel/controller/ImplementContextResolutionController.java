package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ExpandResolveRequestDto;
import com.example.architecturemodel.model.dto.ExpandResolveResponseDto;
import com.example.architecturemodel.model.dto.ImplementContextResolveRequestDto;
import com.example.architecturemodel.model.dto.ResolvedImplementContextDto;
import com.example.architecturemodel.service.ContextBundleExpansionService;
import com.example.architecturemodel.service.ImplementContextResolutionService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST Controller for resolving implement context entity and diagram IDs.
 *
 * Provides POST endpoints to resolve entity IDs (in format "entityType::entityId")
 * and diagram IDs into detailed summaries for LLM context enrichment.
 *
 * Base path: /api/projects/{projectId}/implement-context
 *
 * Spec: Implement Context Resolution - Iteration 3
 * Spec: Context Bundles Backend Expansion - adds expand-resolve endpoint
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/implement-context")
@RequiredArgsConstructor
@Slf4j
public class ImplementContextResolutionController {

    private final ImplementContextResolutionService resolutionService;
    private final ContextBundleExpansionService expansionService;

    /**
     * POST /api/projects/{projectId}/implement-context/resolve
     *
     * Resolves entity and diagram IDs into detailed summaries.
     *
     * @param projectId the project ID (filename)
     * @param request the request body containing entity and diagram IDs to resolve
     * @return the resolved context with entity and diagram summaries
     * @throws IllegalArgumentException if projectId is blank or request is null
     */
    @PostMapping("/resolve")
    public ResponseEntity<ResolvedImplementContextDto> resolveContext(
            @PathVariable UUID projectId,
            @RequestBody ImplementContextResolveRequestDto request) {

        log.debug("POST /api/projects/{}/implement-context/resolve", projectId);

        // Validation
        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (request == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        // Resolve the context
        ResolvedImplementContextDto result = resolutionService.resolveContext(
            projectId,
            request.selectedEntityIds(),
            request.selectedDiagramIds()
        );

        log.debug("Resolved {} entities and {} diagrams for project {}",
            result.resolvedEntities() != null ? result.resolvedEntities().size() : 0,
            result.resolvedDiagrams() != null ? result.resolvedDiagrams().size() : 0,
            projectId);

        return ResponseEntity.ok(result);
    }

    /**
     * POST /api/projects/{projectId}/implement-context/expand-resolve
     *
     * Expands entity and diagram bundle selections according to their bundle types,
     * then resolves the expanded IDs into detailed summaries.
     *
     * This endpoint handles bundle expansion rules (e.g., interface_with_endpoints,
     * service_with_parents_and_children) and de-duplicates the expanded entity set
     * before resolution.
     *
     * Spec: Context Bundles Backend Expansion
     *
     * @param projectId the project ID (filename)
     * @param request the request body containing entity and diagram bundle selections
     * @return the expanded IDs and resolved summaries with truncation metadata
     * @throws IllegalArgumentException if projectId is blank or request is null
     */
    @PostMapping("/expand-resolve")
    public ResponseEntity<ExpandResolveResponseDto> expandResolveContext(
            @PathVariable UUID projectId,
            @RequestBody ExpandResolveRequestDto request) {

        log.info("POST /api/projects/{}/implement-context/expand-resolve with {} entities and {} diagrams",
            projectId,
            request != null && request.selectedEntities() != null ? request.selectedEntities().size() : 0,
            request != null && request.selectedDiagrams() != null ? request.selectedDiagrams().size() : 0);

        // Validation
        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (request == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        // Expand and resolve the context
        ExpandResolveResponseDto result = expansionService.expandAndResolve(
            projectId,
            request.selectedEntities(),
            request.selectedDiagrams()
        );

        log.info("Expand-resolve completed for project {}: {} expanded entities, {} expanded diagrams, truncated={}",
            projectId,
            result.expandedEntityIds() != null ? result.expandedEntityIds().size() : 0,
            result.expandedDiagramIds() != null ? result.expandedDiagramIds().size() : 0,
            result.truncated());

        return ResponseEntity.ok(result);
    }
}
