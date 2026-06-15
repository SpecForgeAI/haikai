# Task Breakdown: Fix ModelService Diagram SVG Export Compile Error

## Overview
Total Tasks: 4

This is a minimal bug fix requiring 2 line changes to resolve a compile error where incorrect accessor method `.diagram()` is called instead of `.canonical()` on `CanonicalDiagramExportDto`.

## Task List

### Backend Fix

#### Task Group 1: Fix Compile Error in ModelService.java
**Dependencies:** None

- [ ] 1.0 Complete compile error fix
  - [ ] 1.1 Fix accessor method call on line ~418
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Change: `canonical.diagram().name()` to `canonical.canonical().name()`
    - Context: In `exportDiagramAsSvg` method, getting diagram name for SVG filename
  - [ ] 1.2 Fix accessor method call on line ~430
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
    - Change: `canonical.diagram()` to `canonical.canonical()`
    - Context: In `exportDiagramAsSvg` method, passing diagram to SVG renderer
  - [ ] 1.3 Verify backend compiles successfully
    - Run: `mvn compile` in `architecture-model-service` directory
    - Expected: Build SUCCESS with no compile errors

**Acceptance Criteria:**
- `mvn compile` completes without errors
- Both accessor method calls use `.canonical()` instead of `.diagram()`

### Verification

#### Task Group 2: Manual Testing
**Dependencies:** Task Group 1

- [ ] 2.0 Verify SVG export functionality works
  - [ ] 2.1 Test Export Current SVG button
    - Start backend and frontend
    - Open a project with diagrams
    - Click "Export Current SVG" button
    - Verify: SVG file downloads successfully
    - Verify: File is written to `[project_parent_folder]/exports/diagrams/`
    - Verify: Filename follows pattern `{projectName}_{diagramName}_{timestamp}.svg`
  - [ ] 2.2 Test Export All SVG button
    - Click "Export All SVG" button
    - Verify: ZIP file downloads successfully
    - Verify: ZIP contains SVG files for all diagrams
    - Verify: Individual SVG files are also written to exports directory

**Acceptance Criteria:**
- Export Current SVG downloads valid SVG file
- Export All SVG downloads ZIP with all diagram SVGs
- SVG files are persisted to disk in correct location
- Filename pattern is correct: `{projectName}_{diagramName}_{timestamp}.svg`

## Execution Order

Recommended implementation sequence:
1. Backend Fix (Task Group 1) - Fix the 2 incorrect method calls
2. Verification (Task Group 2) - Manual testing of export functionality

## Reference Files

- **File to modify:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- **DTO definition:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/CanonicalDiagramExportDto.java`
- **Correct usage pattern:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiagramExportService.java`

## Root Cause Summary

The `CanonicalDiagramExportDto` record has a field named `canonical` of type `DiagramDto`. In Java records, accessor methods are named after the field, so the accessor is `canonical()` not `diagram()`. The code incorrectly called `.diagram()` which does not exist on this record.
