# Task Breakdown: Export Diagrams as SVG

## Overview
Total Tasks: 24

This feature enables users to export the currently selected diagram as an SVG file or all diagrams in the active project as a ZIP archive containing SVG files. The implementation spans backend SVG rendering, export service logic, REST endpoints, and frontend UI integration.

## Task List

### Backend Layer

#### Task Group 1: DiagramSvgRenderer Component
**Dependencies:** None

- [x] 1.0 Complete DiagramSvgRenderer component
  - [x] 1.1 Write 4-6 focused tests for DiagramSvgRenderer functionality
    - Test renderToSvg produces valid SVG root element with xmlns, width, height, viewBox
    - Test node rendering produces rect elements with correct position, dimensions, fill, stroke
    - Test edge rendering produces polyline/path elements with arrow markers
    - Test empty diagram produces valid minimal SVG
    - Test canvas bounds calculation with padding
    - Test text label rendering for nodes
  - [x] 1.2 Create DiagramSvgRenderer.java as Spring @Component
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramSvgRenderer.java`
    - Inject no dependencies (pure rendering logic)
    - Follow existing component patterns in export package
  - [x] 1.3 Implement renderToSvg(DiagramDto diagram) method
    - Return String containing complete SVG markup
    - Use StringBuilder for efficient string construction
    - Produce deterministic output from canonical diagram data
  - [x] 1.4 Implement canvas bounds calculation
    - Scan all nodes for minX, minY, maxX, maxY coordinates
    - Scan all edge points for bounds contribution
    - Add configurable padding (e.g., 50px) to bounds
    - Handle empty diagrams with sensible defaults
  - [x] 1.5 Implement SVG root element generation
    - Set xmlns="http://www.w3.org/2000/svg"
    - Set width and height from calculated bounds
    - Set viewBox attribute for proper scaling
  - [x] 1.6 Implement node rendering as rect elements
    - Position using posX, posY from DiagramNodeDto
    - Dimensions using width, height from DiagramNodeDto
    - Fill color from backgroundColor (default to white)
    - Stroke color from lineColor (default to black)
    - Add text element for node label using entity name
  - [x] 1.7 Implement edge rendering as polyline/path elements
    - Use edgePoints waypoints for polyline coordinates
    - Set stroke color from lineColor
    - Implement arrow markers via defs/marker elements
    - Handle arrow_start and arrow_end properties
  - [x] 1.8 Ensure DiagramSvgRenderer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify SVG output is well-formed
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- renderToSvg produces valid SVG for diagrams with nodes and edges
- SVG includes proper xmlns, viewBox, and dimension attributes
- Nodes render as rect with fill/stroke colors and text labels
- Edges render as polyline/path with arrow markers
- Empty diagrams produce valid minimal SVG

---

#### Task Group 2: DiagramExportService
**Dependencies:** Task Group 1

- [x] 2.0 Complete DiagramExportService
  - [x] 2.1 Write 4-6 focused tests for DiagramExportService functionality
    - Test exportSingleDiagramSvg writes file to correct path and returns result
    - Test exportSingleDiagramSvg throws ResourceNotFoundException for non-existent diagram
    - Test exportAllDiagramsAsZip creates ZIP with correct entries
    - Test filename normalization (whitespace to hyphen)
    - Test timestamp format in filenames
    - Test export path construction from project parent folder
  - [x] 2.2 Create DiagramExportService.java as Spring @Service
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`
    - Inject: ModelService, ProjectService, DiagramCanonicalizer, DiagramSvgRenderer
    - Follow existing service patterns
  - [x] 2.3 Define result record types
    - SingleDiagramExportResult(Path path, String downloadFileName)
    - AllDiagramsExportResult(byte[] zipBytes, String downloadFileName)
    - Place as inner records or separate file in dto package
  - [x] 2.4 Implement exportSingleDiagramSvg method
    - Load active project via ProjectService.getActiveProject()
    - Load model via ModelService.loadModel(filename)
    - Find diagram by id; throw ResourceNotFoundException if not found
    - Canonicalize diagram via DiagramCanonicalizer.canonicalize()
    - Render SVG via DiagramSvgRenderer.renderToSvg()
  - [x] 2.5 Implement file path construction for single export
    - Build export path: [projectParentFolder]/exports/diagrams/
    - Create directory if not exists
    - Normalize names: replace whitespace with "-"
    - Timestamp format: yyyyMMdd-HHmmss
    - Filename pattern: {projectNameNorm}_{diagramNameNorm}_{timestamp}.svg
  - [x] 2.6 Implement file write for single export
    - Write SVG string to constructed file path
    - Return SingleDiagramExportResult with path and download filename
  - [x] 2.7 Implement exportAllDiagramsAsZip method
    - Iterate all diagrams from loaded model
    - Export each diagram SVG to disk
    - Build ZIP in-memory using ByteArrayOutputStream + ZipOutputStream
    - ZIP filename: {projectNameNorm}_all-diagrams_{timestamp}.zip
    - Return AllDiagramsExportResult with ZIP bytes and filename
  - [x] 2.8 Ensure DiagramExportService tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify file operations work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- exportSingleDiagramSvg writes SVG file to correct location
- exportAllDiagramsAsZip creates valid ZIP archive with all diagrams
- Filename normalization and timestamping work correctly
- ResourceNotFoundException thrown for non-existent diagrams
- Export directory created automatically if missing

---

#### Task Group 3: Export Endpoints in ModelController
**Dependencies:** Task Group 2

- [x] 3.0 Complete export endpoints in ModelController
  - [x] 3.1 Write 4-6 focused tests for export endpoints
    - Test GET /api/model/diagrams/{diagramId}/export-svg returns SVG with correct headers
    - Test GET /api/model/diagrams/export-all-svg returns ZIP with correct headers
    - Test 400 response for missing/invalid filename parameter
    - Test 400 response for missing/invalid diagramId
    - Test 404 response for non-existent diagram
    - Test Content-Disposition header contains correct filename
  - [x] 3.2 Add single diagram export endpoint to ModelController
    - Location: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
    - Endpoint: GET /api/model/diagrams/{diagramId}/export-svg
    - Query param: filename (required)
    - Return ResponseEntity<Resource> with Content-Type image/svg+xml
    - Set Content-Disposition attachment header with filename
  - [x] 3.3 Add all diagrams export endpoint to ModelController
    - Endpoint: GET /api/model/diagrams/export-all-svg
    - Query param: filename (required)
    - Return ResponseEntity<byte[]> with Content-Type application/zip
    - Set Content-Disposition attachment header with ZIP filename
  - [x] 3.4 Implement parameter validation
    - Return 400 for missing or blank filename
    - Return 400 for missing or blank diagramId
    - Follow existing validation patterns (throw IllegalArgumentException)
  - [x] 3.5 Implement error handling
    - Return 404 for non-existent diagram (ResourceNotFoundException)
    - Return 404 for non-existent model file
    - Follow existing exception handling patterns
  - [x] 3.6 Ensure export endpoint tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify HTTP responses and headers are correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Single diagram export endpoint returns SVG with correct Content-Type
- All diagrams export endpoint returns ZIP with correct Content-Type
- Content-Disposition headers contain proper attachment filenames
- 400 returned for invalid parameters
- 404 returned for non-existent resources

---

### Frontend Layer

#### Task Group 4: API Helpers in modelApi.ts
**Dependencies:** Task Group 3

- [x] 4.0 Complete API helpers for export functionality
  - [x] 4.1 Write 3-4 focused tests for export API functions
    - Test exportDiagramAsSvg calls correct endpoint with parameters
    - Test exportAllDiagramsAsZip calls correct endpoint with parameters
    - Test error handling for failed responses
    - Test raw Response returned for blob handling
  - [x] 4.2 Add exportDiagramAsSvg function to modelApi.ts
    - Location: `frontend/src/api/modelApi.ts`
    - Signature: exportDiagramAsSvg(filename: string, diagramId: string): Promise<Response>
    - Call GET /api/model/diagrams/{diagramId}/export-svg?filename={file}
    - Return raw Response (not parsed) for blob handling
    - Follow existing API_BASE usage pattern
  - [x] 4.3 Add exportAllDiagramsAsZip function to modelApi.ts
    - Signature: exportAllDiagramsAsZip(filename: string): Promise<Response>
    - Call GET /api/model/diagrams/export-all-svg?filename={file}
    - Return raw Response for blob handling
  - [x] 4.4 Ensure API helper tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify fetch calls use correct URLs and methods
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Export API functions call correct endpoints
- Raw Response objects returned for caller blob handling
- Error responses properly propagated

---

#### Task Group 5: Toolbar Buttons and Handlers in DiagramsView
**Dependencies:** Task Group 4

- [x] 5.0 Complete export UI in DiagramsView
  - [x] 5.1 Write 4-6 focused tests for export UI functionality
    - Test "Export Current as SVG" button disabled when no diagram selected
    - Test "Export Current as SVG" button enabled when diagram selected
    - Test "Export All as SVG" button disabled when no diagrams exist
    - Test "Export All as SVG" button enabled when diagrams exist
    - Test handleExportCurrentAsSvg triggers browser download
    - Test error message displayed on export failure
  - [x] 5.2 Add export state to DiagramsView component
    - Location: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Add state: isExporting: boolean (default false)
    - Add state: exportError: string | null (default null)
  - [x] 5.3 Implement handleExportCurrentAsSvg handler
    - Set isExporting to true, clear exportError
    - Call exportDiagramAsSvg API with filename and selectedDiagramId
    - Parse Content-Disposition header for filename
    - Convert response to blob
    - Trigger browser download using anchor element with blob URL
    - Set isExporting to false on completion
    - Set exportError on failure
  - [x] 5.4 Implement handleExportAllAsSvg handler
    - Similar flow to single export
    - Call exportAllDiagramsAsZip API
    - Parse Content-Disposition header for ZIP filename
    - Trigger browser download for ZIP blob
    - Handle errors with exportError state
  - [x] 5.5 Add export section to toolbar Row 1
    - Add vertical divider after zoom section
    - Add export section with two buttons
    - "Export Current as SVG" button (enabled when selectedDiagramId is set)
    - "Export All as SVG" button (enabled when diagrams.length > 0)
    - Both disabled when isExporting is true
  - [x] 5.6 Add inline error display
    - Display exportError message in export section
    - Use .exportError CSS class
    - Clear error on next export attempt
  - [x] 5.7 Ensure export UI tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify button states and handlers work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Export buttons appear in toolbar with correct enabled/disabled states
- Single diagram export downloads SVG file with correct filename
- All diagrams export downloads ZIP file with correct filename
- Export errors displayed inline and cleared on retry
- Buttons disabled during export operation

---

#### Task Group 6: CSS Styles for Export Section
**Dependencies:** Task Group 5

- [x] 6.0 Complete CSS styles for export UI
  - [x] 6.1 Write 2-3 focused tests for CSS class application
    - Test export section container has correct flex layout
    - Test export button styling matches fitButton pattern
    - Test export error styling matches validationError pattern
  - [x] 6.2 Add .exportSection class to DiagramsView.module.css
    - Location: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Flex container for export buttons
    - Match gap and alignment of existing sections (e.g., .zoomSection)
  - [x] 6.3 Add .exportButton class
    - Style matching existing .fitButton pattern
    - Padding: 8px 12px
    - Border: 1px solid #ddd
    - Background: white
    - Border-radius: 4px
    - Font-size: 12px
    - Hover state: background #f5f5f5
    - Disabled state: opacity 0.5, cursor not-allowed
  - [x] 6.4 Add .exportError class
    - Style matching existing .validationError pattern
    - Color: #d32f2f (red)
    - Font-size: 12px
    - Margin-left: 8px
    - White-space: nowrap
    - Fade-in animation
  - [x] 6.5 Ensure CSS tests pass
    - Run ONLY the 2-3 tests written in 6.1
    - Verify styles applied correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 6.1 pass
- Export section styled consistently with existing toolbar sections
- Export buttons match existing button patterns
- Error message styled consistently with existing validation errors

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4-6 tests written by Task Group 1 (DiagramSvgRenderer)
    - Review the 4-6 tests written by Task Group 2 (DiagramExportService)
    - Review the 4-6 tests written by Task Group 3 (Export Endpoints)
    - Review the 3-4 tests written by Task Group 4 (API Helpers)
    - Review the 4-6 tests written by Task Group 5 (DiagramsView Export UI)
    - Review the 2-3 tests written by Task Group 6 (CSS Styles)
    - Total existing tests: approximately 21-31 tests
  - [x] 7.2 Analyze test coverage gaps for export feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to SVG export feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration tests between SVG renderer and export service
  - [x] 7.3 Write up to 8 additional strategic tests maximum
    - End-to-end test: full export flow from UI click to file download
    - Integration test: DiagramSvgRenderer with real DiagramDto data
    - Integration test: Export service file system operations
    - Edge case: Export diagram with no nodes/edges
    - Edge case: Export project with many diagrams (ZIP performance)
    - Error handling: Network failure during export
    - Error handling: Invalid project state (no active project)
    - Skip redundant unit tests already covered
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to export SVG feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3)
    - Expected total: approximately 29-39 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical export workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 29-39 tests total)
- Critical user workflows for diagram export are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on SVG export feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: DiagramSvgRenderer Component** (Backend)
   - Foundation for SVG generation, no dependencies

2. **Task Group 2: DiagramExportService** (Backend)
   - Depends on DiagramSvgRenderer for rendering
   - Handles file system operations and ZIP creation

3. **Task Group 3: Export Endpoints in ModelController** (Backend)
   - Depends on DiagramExportService
   - Exposes REST API for frontend consumption

4. **Task Group 4: API Helpers in modelApi.ts** (Frontend)
   - Depends on backend endpoints being available
   - Provides typed API functions for frontend

5. **Task Group 5: Toolbar Buttons and Handlers in DiagramsView** (Frontend)
   - Depends on API helpers
   - Implements user-facing export functionality

6. **Task Group 6: CSS Styles for Export Section** (Frontend)
   - Can be done in parallel with Task Group 5
   - Provides visual styling for export UI

7. **Task Group 7: Test Review and Gap Analysis** (Testing)
   - Final validation of complete feature
   - Identifies and fills critical test gaps

---

## Files to Create/Modify

### New Files
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramSvgRenderer.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/DiagramSvgRendererTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/DiagramExportServiceTest.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/DiagramExportControllerTest.java`
- `frontend/src/__tests__/export-diagram-svg.test.ts`

### Modified Files
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
- `frontend/src/api/modelApi.ts`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.module.css`

---

## Key Technical Notes

### SVG Rendering Approach
- Use StringBuilder for efficient string concatenation
- No external SVG libraries per spec requirements
- Ensure deterministic output by processing canonicalized diagram data
- Handle coordinate system with proper viewBox for panning/zooming

### File System Operations
- Create export directory if not exists: `[projectParentFolder]/exports/diagrams/`
- Use Java NIO Files API for file operations
- Handle concurrent exports safely

### Browser Download Implementation
- Create blob URL from response blob
- Create temporary anchor element with download attribute
- Programmatically click anchor to trigger download
- Revoke blob URL after download starts

### Error Handling Strategy
- Backend: Use existing exception handling (GlobalExceptionHandler)
- Frontend: Display inline error messages (no toast notifications per spec)
- Clear errors on retry attempts
