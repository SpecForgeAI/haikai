# Specification: Fix compile error in ModelService diagram SVG export

## Goal
Fix the Java compile error in ModelService.java where the export methods incorrectly call `.diagram()` on CanonicalDiagramExportDto when the actual accessor method is `.canonical()`. The CanonicalDiagramExportDto record has field `canonical` (not `diagram`), so the accessor method is `canonical()`.

## User Stories
- As a developer, I want the backend to compile successfully so that the SVG export feature works.
- As a user, I want to export diagrams as SVG files so that I can share architecture documentation.

## Specific Requirements

**1) Fix ModelService.java exportDiagramAsSvg method**
- In the `exportDiagramAsSvg` method (around line 411-435):
- Change line ~418:
  - FROM: `String diagramName = normalizeName(canonical.diagram().name());`
  - TO: `String diagramName = normalizeName(canonical.canonical().name());`
- Change line ~430:
  - FROM: `String svg = diagramSvgRenderer.renderToSvg(canonical.diagram());`
  - TO: `String svg = diagramSvgRenderer.renderToSvg(canonical.canonical());`

**2) Root Cause**
- The CanonicalDiagramExportDto record has these fields:
  - `projectId` (String)
  - `diagramId` (String)
  - `diagramType` (String)
  - `canonical` (DiagramDto) ← this is the field, so accessor is `canonical()`
- The code incorrectly used `.diagram()` which doesn't exist

## Existing Code to Leverage

**CanonicalDiagramExportDto**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/CanonicalDiagramExportDto.java`
- Record with field `canonical` of type `DiagramDto`
- Accessor method is `canonical()` not `diagram()`

**DiagramExportService**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`
- Already correctly uses the canonical diagram pattern
- Can be referenced for correct usage patterns

## Out of Scope
- Changes to the CanonicalDiagramExportDto record structure
- Changes to the frontend export functionality
- Changes to DiagramExportService (already working correctly)
- Any other backend services

## Acceptance Criteria
- Backend compiles successfully with `mvn compile`
- Export Current SVG button calls backend and downloads SVG file
- Export All SVG button calls backend and downloads ZIP file
- SVG files are written to [project_parent_folder]/exports/diagrams/
- Filename pattern is {projectName}_{diagramName}_{timestamp}.svg
