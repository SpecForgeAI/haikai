package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.ModelFileSummaryDto;
import com.example.architecturemodel.model.dto.diagram.DiagramDto;
import com.example.architecturemodel.model.dto.export.CanonicalDiagramExportDto;
import com.example.architecturemodel.model.dto.export.ProjectContextPackageDto;
import com.example.architecturemodel.model.dto.export.ProjectUIScreenContextPackageDto;
import com.example.architecturemodel.model.dto.export.ProjectUIWorkflowContextPackageDto;
import com.example.architecturemodel.service.DiagramExportService;
import com.example.architecturemodel.service.ModelService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST Controller for model file load + utility endpoints.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 *   The model-load endpoint underwent a HARD CUTOVER from query-param to
 *   path-segment form:
 *     OLD (REMOVED): GET /api/model?projectId={id}
 *     NEW:           GET /api/model/projects/{projectId}/architectures/{architectureId}
 *   Forgetting {architectureId} now produces a 404 at the route layer
 *   (no controller-side default-resolution).
 *
 *   Other endpoints in this controller (filename-based load, save, delete,
 *   project-context exports, SVG exports) remain on their existing routes.
 *   They use filename, not project/architecture pairs, and are out of scope
 *   for this spec's path-segment migration.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model")
@RequiredArgsConstructor
@Slf4j
public class ModelController {

    private final ModelService modelService;
    private final DiagramExportService diagramExportService;

    /**
     * GET /api/model/filenames
     * List all saved model files.
     *
     * @return List of ModelFileSummary
     */
    @GetMapping("/filenames")
    public ResponseEntity<List<ModelFileSummaryDto>> getModelFilenames() {
        log.debug("GET /api/model/filenames");
        List<ModelFileSummaryDto> filenames = modelService.getModelFilenames();
        return ResponseEntity.ok(filenames);
    }

    /**
     * GET /api/model/projects/{projectId}/architectures/{architectureId}
     *
     * Load full ArchitectureModel for the given (project, architecture) pair.
     *
     * Spec "Multi-Architecture Plumbing" (Spec #1) -- this endpoint REPLACES the
     * old query-param form (GET /api/model?projectId=...). The old form is
     * removed entirely; no back-compat layer.
     *
     * @param projectId the project UUID
     * @param architectureId the architecture UUID
     * @return ArchitectureModel
     */
    @GetMapping("/projects/{projectId}/architectures/{architectureId}")
    public ResponseEntity<ArchitectureModelDto> loadModelForArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId) {
        log.debug("GET /api/model/projects/{}/architectures/{}", projectId, architectureId);
        ArchitectureModelDto model = modelService.loadModelByProjectIdAndArchitectureId(
            projectId, architectureId);
        return ResponseEntity.ok(model);
    }

    /**
     * GET /api/model
     *
     * Load full ArchitectureModel by filename (or fall back to default/latest if
     * no filename is provided). This filename-based path remains in place for
     * non-architecture callers (e.g. the SVG export and project-context exports
     * below, which take filename directly).
     *
     * NOTE: the projectId query-param form was REMOVED in spec #1 -- use the
     * path-segment endpoint above instead.
     *
     * @param filename Optional filename query parameter
     * @return ArchitectureModel
     */
    @GetMapping
    public ResponseEntity<ArchitectureModelDto> loadModel(
            @RequestParam(required = false) String filename) {
        log.debug("GET /api/model?filename={}", filename);
        ArchitectureModelDto model = modelService.loadModel(filename);
        return ResponseEntity.ok(model);
    }

    /**
     * PUT /api/model
     * Save or replace ArchitectureModel for the given filename.
     * Creates a new file if it doesn't exist.
     *
     * <p>Legacy entry point. Internally
     * {@link com.example.architecturemodel.service.ModelService#saveModel(String, com.example.architecturemodel.model.dto.ArchitectureModelDto)}
     * resolves the active project + its Default architecture so the
     * architecture-scoped {@code findByFilenameAndArchitectureId} lookup
     * picks the correct row. Callers that already have an architecture
     * context should prefer the path-segment endpoint
     * {@code PUT /api/model/projects/{projectId}/architectures/{architectureId}}
     * below.</p>
     *
     * @param filename Required filename query parameter
     * @param model The ArchitectureModel to save
     * @return ModelFileSummary
     */
    @PutMapping
    public ResponseEntity<ModelFileSummaryDto> saveModel(
            @RequestParam(required = false) String filename,
            @RequestBody ArchitectureModelDto model) {
        log.debug("PUT /api/model?filename={}", filename);

        if (filename == null || filename.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        ModelFileSummaryDto summary = modelService.saveModel(filename, model);
        return ResponseEntity.ok(summary);
    }

    /**
     * PUT /api/model/projects/{projectId}/architectures/{architectureId}
     *
     * Architecture-scoped save endpoint. Required for the post-clone scenario
     * where two model_files rows share the same filename across architectures
     * (changeset 096 relaxed the legacy global UNIQUE constraint to a
     * per-architecture composite UNIQUE INDEX). Without this endpoint the
     * legacy filename-only lookup is non-deterministic and corrupts the
     * wrong architecture on save.
     *
     * <p>Spec: Cross-Architecture Save Bug Fix (Spec 2026-05-01).</p>
     *
     * @param projectId      the owning project UUID (path segment)
     * @param architectureId the owning architecture UUID (path segment)
     * @param filename       optional filename (defaults to the project name
     *                       when omitted, matching the legacy convention)
     * @param model          the model payload
     * @return summary DTO for the saved model file
     */
    @PutMapping("/projects/{projectId}/architectures/{architectureId}")
    public ResponseEntity<ModelFileSummaryDto> saveModelForArchitecture(
            @PathVariable UUID projectId,
            @PathVariable UUID architectureId,
            @RequestParam(required = false) String filename,
            @RequestBody ArchitectureModelDto model) {
        log.debug("PUT /api/model/projects/{}/architectures/{}?filename={}",
            projectId, architectureId, filename);

        if (filename == null || filename.isBlank()) {
            return ResponseEntity.badRequest().build();
        }

        ModelFileSummaryDto summary = modelService.saveModel(
            filename, projectId, architectureId, model);
        return ResponseEntity.ok(summary);
    }

    /**
     * DELETE /api/model
     * Delete model file and all associated data.
     *
     * @param filename Required filename query parameter
     * @return 204 No Content
     */
    @DeleteMapping
    public ResponseEntity<Void> deleteModel(@RequestParam String filename) {
        log.debug("DELETE /api/model?filename={}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        modelService.deleteModel(filename);
        return ResponseEntity.noContent().build();
    }

    // ============================================================================
    // Export Endpoints for Agent OS
    // ============================================================================

    /**
     * GET /api/model/project-context/{filename}
     * Export project context for Agent OS consumption.
     *
     * Returns a ProjectContextPackageDto containing:
     * - project_id: the filename
     * - metaModel: full meta-model data
     * - diagrams: only "General" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to export
     * @return ProjectContextPackageDto with filtered and canonicalized diagrams
     */
    @GetMapping("/project-context/{filename}")
    public ResponseEntity<ProjectContextPackageDto> getProjectContext(
            @PathVariable String filename) {
        log.debug("GET /api/model/project-context/{}", filename);
        ProjectContextPackageDto projectContext = modelService.loadProjectContext(filename);
        return ResponseEntity.ok(projectContext);
    }

    /**
     * GET /api/model/project-ui-workflow-context/{filename}
     * Export UI workflow context for Agent OS consumption.
     *
     * Returns a ProjectUIWorkflowContextPackageDto containing:
     * - project_id: the filename
     * - ui_screens: all UIScreen entities
     * - ui_workflow_transitions: all UIWorkflowTransition relationships
     * - diagrams: only "UI_Workflow" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to export
     * @return ProjectUIWorkflowContextPackageDto with filtered and canonicalized diagrams
     */
    @GetMapping("/project-ui-workflow-context/{filename}")
    public ResponseEntity<ProjectUIWorkflowContextPackageDto> getProjectUIWorkflowContext(
            @PathVariable String filename) {
        log.debug("GET /api/model/project-ui-workflow-context/{}", filename);
        ProjectUIWorkflowContextPackageDto uiWorkflowContext = modelService.loadProjectUIWorkflowContext(filename);
        return ResponseEntity.ok(uiWorkflowContext);
    }

    /**
     * GET /api/model/project-ui-screen-context/{filename}
     * Export UI screen context for Agent OS consumption.
     *
     * Returns a ProjectUIScreenContextPackageDto containing:
     * - project_id: the filename
     * - ui_screens: all UIScreen entities
     * - ui_components: all UIComponent entities
     * - ui_actions: all UIAction entities
     * - ui_contracts: all UIContract entities
     * - diagrams: only "UI_SCREEN" diagrams (case-insensitive), each canonicalized
     *
     * @param filename The model file to export
     * @return ProjectUIScreenContextPackageDto with filtered and canonicalized diagrams
     */
    @GetMapping("/project-ui-screen-context/{filename}")
    public ResponseEntity<ProjectUIScreenContextPackageDto> getProjectUIScreenContext(
            @PathVariable String filename) {
        log.debug("GET /api/model/project-ui-screen-context/{}", filename);
        ProjectUIScreenContextPackageDto uiScreenContext = modelService.loadProjectUIScreenContext(filename);
        return ResponseEntity.ok(uiScreenContext);
    }

    /**
     * GET /api/model/diagrams/{diagramId}/canonical
     * Export a single diagram in canonical JSON format.
     *
     * Returns a CanonicalDiagramExportDto containing:
     * - project_id: the filename
     * - diagram_id: the requested diagram id
     * - diagram_type: the type of the diagram
     * - canonical: the canonicalized diagram DTO
     *
     * @param diagramId The id of the diagram to export
     * @param filename Required query parameter - the model file containing the diagram
     * @return CanonicalDiagramExportDto with canonicalized diagram
     */
    @GetMapping("/diagrams/{diagramId}/canonical")
    public ResponseEntity<CanonicalDiagramExportDto> getCanonicalDiagram(
            @PathVariable String diagramId,
            @RequestParam String filename) {
        log.debug("GET /api/model/diagrams/{}/canonical?filename={}", diagramId, filename);
        CanonicalDiagramExportDto canonicalDiagram = modelService.exportCanonicalDiagram(filename, diagramId);
        return ResponseEntity.ok(canonicalDiagram);
    }

    /**
     * GET /api/model/ui-screens/{screenId}/ui-screen-diagram
     * Retrieve the UI_SCREEN diagram associated with a given UIScreen.
     *
     * Searches for a diagram where:
     * - diagramType is "UI_SCREEN" (case-insensitive)
     * - typedContent.screen_id matches the provided screenId
     *
     * @param screenId The UIScreen entity ID
     * @param filename Required query parameter - the model file to search
     * @return DiagramDto for the matching UI_SCREEN diagram
     */
    @GetMapping("/ui-screens/{screenId}/ui-screen-diagram")
    public ResponseEntity<DiagramDto> getUIScreenDiagram(
            @PathVariable String screenId,
            @RequestParam String filename) {
        log.debug("GET /api/model/ui-screens/{}/ui-screen-diagram?filename={}", screenId, filename);
        DiagramDto diagram = modelService.getUIScreenDiagram(filename, screenId);
        return ResponseEntity.ok(diagram);
    }

    // ============================================================================
    // SVG Export Endpoints
    // Spec: Export Diagrams as SVG
    // ============================================================================

    /**
     * GET /api/model/diagrams/{diagramId}/export-svg
     * Export a single diagram as SVG file.
     *
     * Exports the specified diagram to SVG format and writes it to the project's
     * exports/diagrams folder. Returns the SVG file as a downloadable attachment.
     *
     * @param diagramId The id of the diagram to export
     * @param filename Required query parameter - the model file containing the diagram
     * @return ResponseEntity<Resource> with Content-Type image/svg+xml and attachment header
     */
    @GetMapping("/diagrams/{diagramId}/export-svg")
    public ResponseEntity<Resource> exportDiagramAsSvg(
            @PathVariable String diagramId,
            @RequestParam String filename) {
        log.debug("GET /api/model/diagrams/{}/export-svg?filename={}", diagramId, filename);

        // Validate parameters
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }
        if (diagramId == null || diagramId.isBlank()) {
            throw new IllegalArgumentException("Diagram ID is required");
        }

        // Export the diagram
        DiagramExportService.SingleDiagramExportResult result =
            diagramExportService.exportSingleDiagramSvg(filename, diagramId);

        // Return the file as a downloadable resource
        Resource resource = new FileSystemResource(result.path().toFile());

        return ResponseEntity.ok()
            .contentType(MediaType.valueOf("image/svg+xml"))
            .header(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"" + result.downloadFileName() + "\"")
            .body(resource);
    }

    /**
     * GET /api/model/diagrams/export-all-svg
     * Export all diagrams in the model as a ZIP archive containing SVG files.
     *
     * Exports all diagrams to SVG format, writes individual SVG files to the project's
     * exports/diagrams folder, and returns a ZIP archive containing all SVG files.
     *
     * @param filename Required query parameter - the model file containing the diagrams
     * @return ResponseEntity<byte[]> with Content-Type application/zip and attachment header
     */
    @GetMapping("/diagrams/export-all-svg")
    public ResponseEntity<byte[]> exportAllDiagramsAsSvg(
            @RequestParam String filename) {
        log.debug("GET /api/model/diagrams/export-all-svg?filename={}", filename);

        // Validate parameters
        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        // Export all diagrams
        DiagramExportService.AllDiagramsExportResult result =
            diagramExportService.exportAllDiagramsAsZip(filename);

        // Return the ZIP as a downloadable attachment
        return ResponseEntity.ok()
            .contentType(MediaType.valueOf("application/zip"))
            .header(HttpHeaders.CONTENT_DISPOSITION,
                "attachment; filename=\"" + result.downloadFileName() + "\"")
            .body(result.zipBytes());
    }
}
