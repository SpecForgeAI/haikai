package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.store.SessionProjectStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.UUID;

/**
 * REST Controller for Session Project operations.
 *
 * Spec 2026-01-22: Explicit Project Session API
 *
 * This controller provides explicit endpoints for session-backed project operations.
 * These endpoints are ALWAYS available regardless of the database toggle setting
 * (include-database), creating a clean separation between:
 * - DB-backed projects (/api/projects/*) - Persistent storage in PostgreSQL
 * - Session projects (/api/project-session/*) - In-memory, ephemeral storage
 *
 * Spec 2026-01-22: File Mode Blank Start UX
 * - GET endpoints now auto-initialize blank project/snapshot when none exists
 * - Returns 200 with blank "Untitled" project instead of 404
 * - Import normalizes snapshot to use session project identity
 *
 * Endpoints:
 * - GET /api/project-session - Get current session project (auto-initializes blank)
 * - POST /api/project-session/import - Import snapshot into session
 * - GET /api/project-session/export - Export session snapshot (auto-initializes blank)
 * - POST /api/project-session/clear - Clear session project
 *
 * This controller is always active regardless of the database toggle setting.
 * DO NOT use @ConditionalOnProperty annotation.
 */
@RestController
@RequestMapping("/api/project-session")
@Slf4j
public class ProjectSessionController {

    private final SessionProjectStore sessionProjectStore;

    /**
     * Constructor injection for required dependency.
     * No optional dependencies - SessionProjectStore is always available.
     *
     * @param sessionProjectStore The session project store
     */
    public ProjectSessionController(SessionProjectStore sessionProjectStore) {
        this.sessionProjectStore = sessionProjectStore;
    }

    /**
     * Gets the current session project.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     * Auto-initializes a blank "Untitled" project if none exists.
     * Always returns 200 with a valid project (never 404).
     *
     * GET /api/project-session
     *
     * @return ResponseEntity with ProjectDto (200 OK)
     */
    @GetMapping
    public ResponseEntity<ProjectDto> getSessionProject() {
        log.debug("GET /api/project-session");

        // Spec 2026-01-22: Use ensureActiveProject to auto-initialize if needed
        ProjectDto project = sessionProjectStore.ensureActiveProject();

        return ResponseEntity.ok(project);
    }

    /**
     * Imports a project snapshot into the session.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     * Normalizes the snapshot to use the session project identity, ensuring
     * subsequent exports return a coherent snapshot.
     *
     * POST /api/project-session/import
     *
     * Creates a synthetic ProjectDto with a generated UUID and stores both
     * the project and normalized snapshot in the SessionProjectStore.
     *
     * @param request The import request containing the snapshot
     * @return ResponseEntity with ProjectSnapshotImportResultDto and HTTP 201 status
     */
    @PostMapping("/import")
    public ResponseEntity<ProjectSnapshotImportResultDto> importToSession(
            @RequestBody ProjectSnapshotImportRequestDto request) {
        log.info("POST /api/project-session/import");

        // Create synthetic ProjectDto with generated UUID
        ProjectDto syntheticProject = new ProjectDto(
            UUID.randomUUID(),
            request.effectiveProjectName(),
            null,  // projectParentFolder - not needed in session mode
            null,  // projectHierarchy
            null,  // organisationId
            null,  // repoUrl
            true,  // isActive
            Instant.now(),
            Instant.now()
        );

        // Spec 2026-01-22: File Mode Blank Start UX
        // Normalize snapshot to use session project identity
        // This ensures subsequent exports return a coherent snapshot with matching project
        ProjectSnapshotDto normalizedSnapshot = new ProjectSnapshotDto(
            request.snapshot().meta(),
            syntheticProject,  // Use session project, not snapshot.project
            request.snapshot().model(),
            request.snapshot().workItems(),
            request.snapshot().artifacts()
        );

        // Store in session with normalized snapshot
        sessionProjectStore.setActiveProject(syntheticProject, normalizedSnapshot);

        log.info("Project imported to session store: name='{}', id={}",
            syntheticProject.name(), syntheticProject.id());

        // Create result with modelSaved=false, counts=0
        ProjectSnapshotImportResultDto result = ProjectSnapshotImportResultDto.of(
            syntheticProject, false, 0, 0
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    /**
     * Exports the session project snapshot.
     *
     * Spec 2026-01-22: File Mode Blank Start UX
     * Auto-initializes a blank snapshot if none exists.
     * Always returns 200 with a valid snapshot (never 404).
     *
     * GET /api/project-session/export
     *
     * @return ResponseEntity with ProjectSnapshotDto (200 OK)
     */
    @GetMapping("/export")
    public ResponseEntity<ProjectSnapshotDto> exportSessionSnapshot() {
        log.debug("GET /api/project-session/export");

        // Spec 2026-01-22: Use ensureActiveSnapshot to auto-initialize if needed
        ProjectSnapshotDto snapshot = sessionProjectStore.ensureActiveSnapshot();

        return ResponseEntity.ok(snapshot);
    }

    /**
     * Clears the session project.
     *
     * POST /api/project-session/clear
     *
     * This operation is idempotent - succeeds even when no session exists.
     *
     * @return ResponseEntity with HTTP 204 No Content
     */
    @PostMapping("/clear")
    public ResponseEntity<Void> clearSession() {
        log.info("POST /api/project-session/clear");

        sessionProjectStore.clear();

        return ResponseEntity.noContent().build();
    }
}
