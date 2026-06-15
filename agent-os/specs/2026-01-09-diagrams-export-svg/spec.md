# Specification: Export Diagrams as SVG

## Goal
Enable users to export the current diagram or all diagrams in the active project to SVG files, with server-side writes to the project's exports folder and browser download of the resulting SVG or ZIP archive.

## User Stories
- As a user, I want to export the currently selected diagram as an SVG file so that I can share or archive it outside the application.
- As a user, I want to export all diagrams in my project as a ZIP file containing SVG files so that I can bulk-export my architecture documentation.

## Specific Requirements

**1) DiagramSvgRenderer Component (Backend)**
- Create `src/main/java/com/example/architecturemodel/service/export/DiagramSvgRenderer.java` as a Spring `@Component`
- Public method: `String renderToSvg(DiagramDto diagram)` that converts a canonical DiagramDto to an SVG string
- Compute canvas bounds by scanning all nodes/edges (minX, minY, maxX, maxY) and adding padding
- Build SVG using StringBuilder: root `<svg>` element with xmlns, width, height, viewBox attributes
- Render nodes as `<rect>` elements with position (posX, posY), dimensions (width, height), fill (backgroundColor), stroke (lineColor); add `<text>` for labels
- Render edges as `<polyline>` or `<path>` using edgePoints waypoints; include arrow markers via `<defs><marker>`
- No external SVG libraries; deterministic output based on sorted canonical diagram data

**2) DiagramExportService (Backend)**
- Create `src/main/java/com/example/architecturemodel/service/DiagramExportService.java` as a Spring `@Service`
- Inject: ModelService, ProjectService, DiagramCanonicalizer, DiagramSvgRenderer
- Method `SingleDiagramExportResult exportSingleDiagramSvg(String filename, String diagramId)`:
  - Load active project via ProjectService.getActiveProject()
  - Load model via ModelService.loadModel(filename)
  - Find diagram by id; throw ResourceNotFoundException if not found
  - Canonicalize diagram via DiagramCanonicalizer.canonicalize()
  - Build export path: `[projectParentFolder]/exports/diagrams/`
  - Normalize names: replace whitespace with "-"
  - Timestamp format: `yyyyMMdd-HHmmss`
  - Filename pattern: `{projectNameNorm}_{diagramNameNorm}_{timestamp}.svg`
- Method `AllDiagramsExportResult exportAllDiagramsAsZip(String filename)`:
  - Iterate all diagrams, export each SVG to disk
  - Build ZIP in-memory using ByteArrayOutputStream + ZipOutputStream
  - ZIP filename: `{projectNameNorm}_all-diagrams_{timestamp}.zip`
- Define result records: `SingleDiagramExportResult(Path path, String downloadFileName)` and `AllDiagramsExportResult(byte[] zipBytes, String downloadFileName)`

**3) Export Endpoints in ModelController (Backend)**
- Add to `src/main/java/com/example/architecturemodel/controller/ModelController.java`
- Endpoint: `GET /api/model/diagrams/{diagramId}/export-svg?filename={file}` returning `ResponseEntity<Resource>` with Content-Type `image/svg+xml` and Content-Disposition attachment header
- Endpoint: `GET /api/model/diagrams/export-all-svg?filename={file}` returning `ResponseEntity<byte[]>` with Content-Type `application/zip` and Content-Disposition attachment header
- Return 400 for missing/invalid filename or diagramId; return 404 for non-existent diagram or model

**4) API Helpers in modelApi.ts (Frontend)**
- Add to `frontend/src/api/modelApi.ts`
- Function `exportDiagramAsSvg(filename: string, diagramId: string): Promise<Response>` calling GET endpoint for single SVG
- Function `exportAllDiagramsAsZip(filename: string): Promise<Response>` calling GET endpoint for ZIP
- Return raw Response so caller can handle blob download and parse Content-Disposition header for filename

**5) Toolbar Buttons and Handlers in DiagramsView (Frontend)**
- Modify `frontend/src/components/DiagramsView/DiagramsView.tsx`
- Add local state: `isExporting: boolean`, `exportError: string | null`
- Add handler `handleExportCurrentAsSvg`: call API, convert response to blob, parse filename from Content-Disposition, trigger browser download
- Add handler `handleExportAllAsSvg`: similar flow for ZIP download
- Add toolbar buttons in Row 1 (near zoom section or new section): "Export Current as SVG" (enabled when selectedDiagramId is set), "Export All as SVG" (enabled when diagrams.length > 0)
- Display inline error message on export failure; clear error on next attempt

**6) CSS Styles for Export Section (Frontend)**
- Add to `frontend/src/components/DiagramsView/DiagramsView.module.css`
- Class `.exportSection`: flex container for export buttons
- Class `.exportButton`: button styling matching existing `.fitButton` pattern
- Class `.exportError`: red error text matching existing `.validationError` pattern

## Existing Code to Leverage

**DiagramCanonicalizer**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramCanonicalizer.java`
- Provides `canonicalize(DiagramDto)` method that sorts nodes, edges, decorations by id and produces deterministic output
- Must be called before SVG rendering to ensure consistent output

**ProjectService.getActiveProject()**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
- Returns ProjectDto with `projectParentFolder` field needed to construct export directory path
- Throws ResourceNotFoundException if no active project

**ModelController export endpoint patterns**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
- Follow existing pattern of `@GetMapping` with `@PathVariable` for diagramId and `@RequestParam` for filename
- Use existing validation patterns that throw IllegalArgumentException for bad input

**modelApi.ts patterns**
- Located at `frontend/src/api/modelApi.ts`
- Follow API_BASE usage pattern and fetch patterns for new export functions
- projectSnapshotApi.ts shows pattern for handling raw Response objects and error extraction

**DiagramsView.module.css toolbar patterns**
- Located at `frontend/src/components/DiagramsView/DiagramsView.module.css`
- Reuse `.zoomSection`, `.fitButton`, `.validationError` styling patterns for export section

## Out of Scope
- Database schema changes (no new tables or columns)
- Changes to diagram editing, creation, or canvas behavior
- Changes to how diagrams are stored in the database
- PDF export or any format other than SVG
- Batch export scheduling or automation (exports are user-triggered only)
- Export history, versioning, or tracking of past exports
- Customizable export settings (e.g., resolution, scale, colors)
- Export of individual diagram elements (nodes only, edges only)
- Integration with external storage services (S3, cloud drives)
- Toast notifications (use inline error display instead)
