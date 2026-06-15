package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.ProjectDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportRequestDto;
import com.example.architecturemodel.model.dto.export.ProjectSnapshotImportResultDto;
import com.example.architecturemodel.service.ProjectService;
import com.example.architecturemodel.service.ProjectSnapshotImportService;
import com.example.architecturemodel.service.ProjectSnapshotService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST Controller for Active Project operations (DB-backed).
 *
 * Spec 2026-01-22: Finalize DB/Session Separation (Phase 4)
 *
 * This controller provides endpoints for the DB-backed active project:
 * - GET /api/projects/active - Get the currently active project from DB
 * - GET /api/projects/active/export - Export the active project as a snapshot
 * - POST /api/projects/import - Import a project snapshot to DB
 *
 * This controller is DB-CONDITIONAL:
 * - Only loaded when app.features.include-database=true (default)
 * - Returns 404 when include-database=false (controller not registered)
 *
 * For session-backed project operations, use ProjectSessionController:
 * - /api/project-session endpoints are ALWAYS available
 *
 * Phase 4 Changes:
 * - Added @ConditionalOnProperty to make controller DB-only
 * - Removed all multiplexing logic (no more session fallbacks)
 * - Removed SessionProjectStore and AppFeaturesProperties dependencies
 * - Simplified to pure DB delegation
 */
@RestController
@RequestMapping("/api/projects")
@Slf4j
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
public class ActiveProjectController {

    private final ProjectService projectService;
    private final ProjectSnapshotService projectSnapshotService;
    private final ProjectSnapshotImportService projectSnapshotImportService;

    /**
     * Constructor with required DB service dependencies.
     *
     * @param projectService Service for project operations
     * @param projectSnapshotService Service for snapshot export
     * @param projectSnapshotImportService Service for snapshot import
     */
    public ActiveProjectController(
            ProjectService projectService,
            ProjectSnapshotService projectSnapshotService,
            ProjectSnapshotImportService projectSnapshotImportService) {
        this.projectService = projectService;
        this.projectSnapshotService = projectSnapshotService;
        this.projectSnapshotImportService = projectSnapshotImportService;
    }

    /**
     * Gets the currently active project from the database.
     *
     * GET /api/projects/active
     *
     * @return ResponseEntity with ProjectDto
     * @throws ResourceNotFoundException if no active project exists
     */
    @GetMapping("/active")
    public ResponseEntity<ProjectDto> getActiveProject() {
        log.debug("GET /api/projects/active");

        ProjectDto project = projectService.getActiveProject();
        return ResponseEntity.ok(project);
    }

    /**
     * Exports the active project as a complete snapshot.
     *
     * GET /api/projects/active/export
     *
     * @return ResponseEntity with ProjectSnapshotDto
     * @throws ResourceNotFoundException if no active project exists
     */
    @GetMapping("/active/export")
    public ResponseEntity<ProjectSnapshotDto> exportActiveProjectSnapshot() {
        log.debug("GET /api/projects/active/export");

        ProjectSnapshotDto snapshot = projectSnapshotService.exportActiveProjectSnapshot();
        return ResponseEntity.ok(snapshot);
    }

    /**
     * Imports a project snapshot to the database.
     *
     * POST /api/projects/import
     *
     * @param request The import request containing the snapshot and options
     * @return ResponseEntity with ProjectSnapshotImportResultDto and HTTP 201 status
     */
    @PostMapping("/import")
    public ResponseEntity<ProjectSnapshotImportResultDto> importSnapshot(
            @RequestBody ProjectSnapshotImportRequestDto request) {
        log.info("POST /api/projects/import");

        ProjectSnapshotImportResultDto result = projectSnapshotImportService.importSnapshot(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }
}
