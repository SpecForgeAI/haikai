package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.entity.LibraryDto;
import com.example.architecturemodel.model.dto.library.LibraryFindOrCreateResponse;
import com.example.architecturemodel.service.LibraryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for Library find-or-create + scoped find-by-id endpoints.
 *
 * <p>Spec: 2026-05-06-library-discovery-integration -- Task Group 1.</p>
 *
 * <p>Endpoints:</p>
 * <ul>
 *   <li>{@code POST /api/model/projects/{p}/architectures/{a}/libraries} --
 *       deterministic find-or-create on
 *       {@code (model_file_id, name, ecosystem)}; returns
 *       {@link LibraryFindOrCreateResponse} with {@code is_new=true|false}.
 *       On insert, the same transaction inserts the derived
 *       {@code ApplicationPoint} ({@code target_type='LIBRARY'}).</li>
 *   <li>{@code GET /api/model/projects/{p}/architectures/{a}/libraries/{id}}
 *       -- single Library by id, scoped by project + architecture; 404 on
 *       miss or scoping mismatch.</li>
 * </ul>
 *
 * <p>snake_case JSON throughout (matches Spec 1's {@link LibraryDto}
 * field-naming convention).</p>
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/architectures/{architectureId}")
@RequiredArgsConstructor
@Slf4j
public class LibraryController {

    private final LibraryService libraryService;

    /**
     * POST /api/model/projects/{projectId}/architectures/{architectureId}/libraries
     *
     * <p>Find-or-create on {@code (model_file_id, name, ecosystem)}.</p>
     */
    @PostMapping("/libraries")
    public ResponseEntity<LibraryFindOrCreateResponse> findOrCreateLibrary(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestBody LibraryDto request) {
        log.debug("POST /api/model/projects/{}/architectures/{}/libraries name={} ecosystem={}",
            projectId, architectureId,
            request != null ? request.name() : null,
            request != null ? request.ecosystem() : null);

        LibraryFindOrCreateResponse response = libraryService.findOrCreate(
            projectId, architectureId, request);
        return ResponseEntity.ok(response);
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}/libraries/{libraryId}
     *
     * <p>Single Library by id, scoped to the (project, architecture) pair.
     * Returns 404 on miss or scoping mismatch.</p>
     */
    @GetMapping("/libraries/{libraryId}")
    public ResponseEntity<LibraryDto> getLibrary(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @PathVariable String libraryId) {
        log.debug("GET /api/model/projects/{}/architectures/{}/libraries/{}",
            projectId, architectureId, libraryId);

        LibraryDto dto = libraryService.findById(projectId, architectureId, libraryId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Library not found: " + libraryId
                    + " (project=" + projectId + ", architecture=" + architectureId + ")"));
        return ResponseEntity.ok(dto);
    }
}
