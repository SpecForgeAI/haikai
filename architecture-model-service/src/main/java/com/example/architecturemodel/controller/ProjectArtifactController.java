package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProjectArtifactDto;
import com.example.architecturemodel.model.dto.ProjectArtifactMetadataDto;
import com.example.architecturemodel.service.ProjectArtifactService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for Project Artifact endpoints.
 *
 * Provides access to versioned markdown artifacts (mission.md, roadmap.md, backlog.md)
 * with automatic revision tracking.
 *
 * Base path: /api/model/projects/{projectId}/artifacts
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Added latest-metadata endpoint.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/projects/{projectId}/artifacts")
@RequiredArgsConstructor
@Slf4j
public class ProjectArtifactController {

    private final ProjectArtifactService projectArtifactService;

    /**
     * GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest
     *
     * Get the latest revision of an artifact by type.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type (MISSION_MD, ROADMAP_MD, BACKLOG_MD)
     * @return the latest revision
     */
    @GetMapping("/{artifactType}/latest")
    public ResponseEntity<ProjectArtifactDto> getLatestArtifact(
            @PathVariable UUID projectId,
            @PathVariable String artifactType) {
        log.debug("GET /api/model/projects/{}/artifacts/{}/latest", projectId, artifactType);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (artifactType == null || artifactType.isBlank()) {
            throw new IllegalArgumentException("Artifact type cannot be blank");
        }

        ProjectArtifactDto artifact = projectArtifactService.getLatestArtifact(projectId, artifactType);
        return ResponseEntity.ok(artifact);
    }

    /**
     * GET /api/model/projects/{projectId}/artifacts/{artifactType}/latest-metadata
     *
     * Get lightweight metadata for the latest revision of an artifact.
     * Returns metadata without content for efficient status checks.
     *
     * Spec 2026-01-04: Roadmap Import UX Glue - Task Group 2.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type (MISSION_MD, ROADMAP_MD)
     * @return the latest revision metadata without content
     */
    @GetMapping("/{artifactType}/latest-metadata")
    public ResponseEntity<ProjectArtifactMetadataDto> getLatestArtifactMetadata(
            @PathVariable UUID projectId,
            @PathVariable String artifactType) {
        log.debug("GET /api/model/projects/{}/artifacts/{}/latest-metadata", projectId, artifactType);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (artifactType == null || artifactType.isBlank()) {
            throw new IllegalArgumentException("Artifact type cannot be blank");
        }

        ProjectArtifactMetadataDto metadata = projectArtifactService.getLatestArtifactMetadata(
            projectId, artifactType);
        return ResponseEntity.ok(metadata);
    }

    /**
     * GET /api/model/projects/{projectId}/artifacts/{artifactType}
     *
     * Get all revisions of an artifact by type, ordered by revision descending.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type (MISSION_MD, ROADMAP_MD, BACKLOG_MD)
     * @return list of all revisions, newest first
     */
    @GetMapping("/{artifactType}")
    public ResponseEntity<List<ProjectArtifactDto>> getArtifactRevisions(
            @PathVariable UUID projectId,
            @PathVariable String artifactType) {
        log.debug("GET /api/model/projects/{}/artifacts/{}", projectId, artifactType);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (artifactType == null || artifactType.isBlank()) {
            throw new IllegalArgumentException("Artifact type cannot be blank");
        }

        List<ProjectArtifactDto> revisions = projectArtifactService.getArtifactRevisions(
            projectId, artifactType);
        return ResponseEntity.ok(revisions);
    }

    /**
     * POST /api/model/projects/{projectId}/artifacts/{artifactType}
     *
     * Create a new artifact revision. The revision number is auto-incremented.
     *
     * @param projectId the project ID
     * @param artifactType the artifact type (MISSION_MD, ROADMAP_MD, BACKLOG_MD)
     * @param dto the artifact to create (content and source)
     * @return the created artifact with auto-incremented revision
     */
    @PostMapping("/{artifactType}")
    public ResponseEntity<ProjectArtifactDto> createArtifact(
            @PathVariable UUID projectId,
            @PathVariable String artifactType,
            @RequestBody ProjectArtifactDto dto) {
        log.debug("POST /api/model/projects/{}/artifacts/{}", projectId, artifactType);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (artifactType == null || artifactType.isBlank()) {
            throw new IllegalArgumentException("Artifact type cannot be blank");
        }
        if (dto == null) {
            throw new IllegalArgumentException("Request body cannot be null");
        }

        ProjectArtifactDto created = projectArtifactService.createArtifact(
            projectId, artifactType, dto);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * GET /api/model/projects/{projectId}/artifacts/by-id/{id}
     *
     * Get a specific artifact by ID.
     *
     * @param projectId the project ID
     * @param id the artifact ID
     * @return the artifact
     */
    @GetMapping("/by-id/{id}")
    public ResponseEntity<ProjectArtifactDto> getArtifactById(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        log.debug("GET /api/model/projects/{}/artifacts/by-id/{}", projectId, id);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (id == null) {
            throw new IllegalArgumentException("Artifact ID cannot be null");
        }

        ProjectArtifactDto artifact = projectArtifactService.getArtifactById(id);
        return ResponseEntity.ok(artifact);
    }

    /**
     * DELETE /api/model/projects/{projectId}/artifacts/by-id/{id}
     *
     * Delete a specific artifact by ID.
     *
     * @param projectId the project ID
     * @param id the artifact ID
     * @return 204 No Content on success
     */
    @DeleteMapping("/by-id/{id}")
    public ResponseEntity<Void> deleteArtifact(
            @PathVariable UUID projectId,
            @PathVariable UUID id) {
        log.debug("DELETE /api/model/projects/{}/artifacts/by-id/{}", projectId, id);

        if (projectId == null) {
            throw new IllegalArgumentException("Project ID cannot be null");
        }
        if (id == null) {
            throw new IllegalArgumentException("Artifact ID cannot be null");
        }

        projectArtifactService.deleteArtifact(id);
        return ResponseEntity.noContent().build();
    }
}
