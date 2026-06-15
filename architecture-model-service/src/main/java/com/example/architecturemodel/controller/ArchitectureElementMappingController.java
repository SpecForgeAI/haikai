package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ArchitectureElementMappingDto;
import com.example.architecturemodel.model.dto.CreateArchitectureElementMappingRequest;
import com.example.architecturemodel.model.dto.UpdateArchitectureElementMappingRequest;
import com.example.architecturemodel.service.ArchitectureElementMappingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for cross-architecture element mappings.
 *
 * <p>Endpoints (mirrors {@code ArchitectureController.java}'s
 * {@code @PathVariable UUID projectId} pattern):</p>
 * <ul>
 *   <li>{@code GET    /api/projects/{projectId}/architecture-mappings}
 *       — filtered list (query params: sourceArchitectureId,
 *       targetArchitectureId, sourceElementType, targetElementType,
 *       mappingType, status, q).</li>
 *   <li>{@code POST   /api/projects/{projectId}/architecture-mappings}
 *       — create; {@code created_by_task} is set server-side to
 *       {@code "mapping-review-modal-add"}.</li>
 *   <li>{@code PUT    /api/projects/{projectId}/architecture-mappings/{mappingId}}
 *       — update mutable fields only; {@code created_by_task} is overwritten
 *       server-side to {@code "mapping-review-modal-edit"}.</li>
 *   <li>{@code DELETE /api/projects/{projectId}/architecture-mappings/{mappingId}}
 *       — hard delete.</li>
 * </ul>
 *
 * <p>HTTP status mapping for service-layer exceptions lives in
 * {@link com.example.architecturemodel.exception.GlobalExceptionHandler}:
 * duplicates -> 422 {@code {code: "duplicate_mapping"}}; same-architecture
 * -> 422 {@code {code: "same_architecture"}}; unknown architecture ->
 * 404 {@code Not Found}.</p>
 *
 * <p>Spec: Create Target Baseline from Current State (2026-05-15) -- Task Group 3</p>
 */
@RestController
@RequestMapping("/api/projects/{projectId}/architecture-mappings")
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class ArchitectureElementMappingController {

    private final ArchitectureElementMappingService service;

    /**
     * GET filtered list. All query parameters except path {@code projectId}
     * are optional. v1 wizard always passes both
     * {@code sourceArchitectureId} and {@code targetArchitectureId}; the
     * controller accepts the broader shape so future callers can list
     * project-wide mappings without binding to a single arch pair.
     */
    @GetMapping
    public ResponseEntity<List<ArchitectureElementMappingDto>> list(
            @PathVariable UUID projectId,
            @RequestParam(required = false) UUID sourceArchitectureId,
            @RequestParam(required = false) UUID targetArchitectureId,
            @RequestParam(required = false) String sourceElementType,
            @RequestParam(required = false) String targetElementType,
            @RequestParam(required = false) String mappingType,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q) {
        log.debug("GET /api/projects/{}/architecture-mappings (source={}, target={}, srcType={}, tgtType={}, mappingType={}, status={}, q={})",
            projectId, sourceArchitectureId, targetArchitectureId,
            sourceElementType, targetElementType, mappingType, status, q);

        List<ArchitectureElementMappingDto> mappings = service.list(
            projectId,
            sourceArchitectureId,
            targetArchitectureId,
            sourceElementType,
            targetElementType,
            mappingType,
            status,
            q);
        return ResponseEntity.ok(mappings);
    }

    @PostMapping
    public ResponseEntity<ArchitectureElementMappingDto> create(
            @PathVariable UUID projectId,
            @RequestBody CreateArchitectureElementMappingRequest request) {
        log.info("POST /api/projects/{}/architecture-mappings (mappingType={}, status={})",
            projectId,
            request == null ? null : request.mappingType(),
            request == null ? null : request.status());

        ArchitectureElementMappingDto created = service.create(projectId, request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/{mappingId}")
    public ResponseEntity<ArchitectureElementMappingDto> update(
            @PathVariable UUID projectId,
            @PathVariable UUID mappingId,
            @RequestBody UpdateArchitectureElementMappingRequest request) {
        log.info("PUT /api/projects/{}/architecture-mappings/{}", projectId, mappingId);

        ArchitectureElementMappingDto updated = service.update(projectId, mappingId, request);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{mappingId}")
    public ResponseEntity<Void> delete(
            @PathVariable UUID projectId,
            @PathVariable UUID mappingId) {
        log.info("DELETE /api/projects/{}/architecture-mappings/{}", projectId, mappingId);

        service.delete(projectId, mappingId);
        return ResponseEntity.noContent().build();
    }
}
