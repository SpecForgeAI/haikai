package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.TemporaryDiagramDto;
import com.example.architecturemodel.service.TemporaryDiagramService;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

/**
 * REST Controller for Temporary Diagram endpoints.
 *
 * Provides PUT (upsert) and GET (retrieve) access to temporary architecture diagrams
 * for a (project, architecture) pair.
 *
 * Spec 2026-03-26: MCP Endpoint for Saving Temporary Architecture Diagrams (Increment 3)
 * Task Group 2: Java Service, DTO, and Controller
 *
 * Spec "Multi-Architecture Plumbing" (Spec #1):
 *   Added {architectureId} path variable. Forgetting it produces a 404
 *   at the route layer (no controller-side default-resolution).
 *
 * Base path: /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams")
@RequiredArgsConstructor
@Slf4j
public class TemporaryDiagramController {

    private final TemporaryDiagramService temporaryDiagramService;

    /**
     * PUT /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}
     *
     * Save (upsert) a temporary diagram for a (project, architecture) pair.
     * Creates a new diagram if none exists for the given
     * (projectId, architectureId, temporaryDiagramId), or updates the existing
     * diagram's payload.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @param request the request body containing the diagram payload
     * @return the saved temporary diagram DTO
     */
    @PutMapping("/{temporaryDiagramId}")
    public ResponseEntity<TemporaryDiagramDto> saveDiagram(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String temporaryDiagramId,
            @RequestBody SaveTemporaryDiagramRequest request) {
        log.debug("PUT /api/projects/{}/architectures/{}/temporary-diagrams/{}",
            projectId, architectureId, temporaryDiagramId);

        TemporaryDiagramDto saved = temporaryDiagramService.saveDiagram(
            projectId,
            architectureId,
            temporaryDiagramId,
            request.diagramPayload()
        );
        return ResponseEntity.ok(saved);
    }

    /**
     * GET /api/projects/{projectId}/architectures/{architectureId}/temporary-diagrams/{temporaryDiagramId}
     *
     * Retrieve a temporary diagram by (project ID, architecture ID, temporary diagram
     * ID). Returns 404 if not found in the requested architecture (even if a sibling
     * architecture in the same project has one with the same id).
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @param temporaryDiagramId the client/LLM-provided diagram identifier
     * @return the temporary diagram DTO, or 404 if not found
     */
    @GetMapping("/{temporaryDiagramId}")
    public ResponseEntity<TemporaryDiagramDto> getDiagram(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String temporaryDiagramId) {
        log.debug("GET /api/projects/{}/architectures/{}/temporary-diagrams/{}",
            projectId, architectureId, temporaryDiagramId);

        TemporaryDiagramDto dto = temporaryDiagramService.getDiagram(
            projectId, architectureId, temporaryDiagramId);
        if (dto == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(dto);
    }

    /**
     * Request body for saving a temporary diagram.
     *
     * @param diagramPayload the full diagram JSON payload as a Map
     */
    public record SaveTemporaryDiagramRequest(
        @JsonProperty("diagram_payload")
        Map<String, Object> diagramPayload
    ) {}
}
