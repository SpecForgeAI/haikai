# Specification: Export ProjectContextPackage + Deterministic Canonical JSON for Diagrams

## Goal
Provide deterministic, machine-friendly exports for project-level context (meta-model + General diagrams only) to feed Agent OS planning docs, and enable canonical JSON exports for individual diagrams with stable key/list ordering.

## User Stories
- As an Agent OS consumer, I want to retrieve a ProjectContextPackage for a given project filename so that I can generate tech-stack.md and other planning documents with full meta-model context and General diagrams.
- As an integration developer, I want to export any diagram in canonical JSON format so that repeated calls return identical ordering for deterministic diffing and caching.

## Specific Requirements

**ProjectContextPackage endpoint**
- Add GET /api/model/project-context/{filename} returning ProjectContextPackageDto
- Response includes project_id (filename), metaModel (identical to loadModel output), and diagrams array
- Filter diagrams to include ONLY those where diagram_type equals "General" (case-insensitive comparison)
- Each diagram in the response MUST be canonicalized using the DiagramCanonicalizer utility
- Return 404 ResourceNotFoundException if model file not found (reuse existing loadModel behavior)
- Return 400 for blank filename via IllegalArgumentException (consistent with existing patterns)

**CanonicalDiagramExport endpoint**
- Add GET /api/model/diagrams/{diagramId}/canonical?filename={filename} returning CanonicalDiagramExportDto
- Response includes project_id, diagram_id, diagram_type, and canonical (the canonicalized DiagramDto)
- Locate diagram by id within model file identified by filename parameter
- Return 404 ResourceNotFoundException if model file not found OR diagram id not found in that file
- Return 400 for blank filename or blank diagramId via IllegalArgumentException

**DiagramCanonicalizer utility**
- Create new class DiagramCanonicalizer in package com.example.architecturemodel.service.export
- Implement public DiagramDto canonicalize(DiagramDto in) method
- Sort diagramNodes list ascending by id (String compare)
- Sort diagramEdges list ascending by id (String compare)
- Sort decorations list ascending by id (String compare)
- Apply canonicalizeJson() to typedContent field recursively

**canonicalizeJson helper method**
- Implement private Object canonicalizeJson(Object o) in DiagramCanonicalizer
- If o is Map: return new TreeMap with all values canonicalized recursively (sorts keys alphabetically)
- If o is List: return new ArrayList with each element passed through canonicalizeJson (preserve list order)
- Otherwise: return o unchanged
- This ensures stable JSON serialization via Jackson without modifying semantic content

**New DTO classes**
- Create package com.example.architecturemodel.model.dto.export
- Add ProjectContextPackageDto record with @JsonProperty annotations for project_id, metaModel, diagrams
- Add CanonicalDiagramExportDto record with @JsonProperty annotations for project_id, diagram_id, diagram_type, canonical

**ModelService additions**
- Add loadProjectContext(String filename) method with @Transactional(readOnly = true)
- Add exportCanonicalDiagram(String filename, String diagramId) method with @Transactional(readOnly = true)
- Inject DiagramCanonicalizer via constructor injection
- Use existing loadModel() internally and filter/transform results

**Controller additions**
- Add two new endpoint methods in ModelController
- Include log.debug statements matching existing logging pattern
- Follow existing ResponseEntity return patterns

## Visual Design
No visual mockups provided for this backend-only feature.

## Existing Code to Leverage

**ModelService.java**
- Reuse loadModel(String filename) method to retrieve full ArchitectureModelDto
- Reuse existing ResourceNotFoundException throwing pattern for missing model files
- Follow @Transactional(readOnly = true) pattern for read operations
- Use @RequiredArgsConstructor for constructor injection of new DiagramCanonicalizer dependency

**ModelController.java**
- Follow existing @GetMapping patterns with @PathVariable and @RequestParam
- Reuse log.debug("GET /api/model/...") logging pattern
- Follow ResponseEntity.ok() return pattern
- Reuse existing blank parameter validation pattern (return 400 for blank values)

**GlobalExceptionHandler.java**
- ResourceNotFoundException already mapped to 404 with standard error body
- IllegalArgumentException already mapped to 400 with standard error body
- No changes needed to exception handling

**DiagramDto record**
- Contains diagramNodes, diagramEdges, decorations, typedContent fields for canonicalization
- Immutable record pattern requires creating new instance with sorted collections

**Existing test patterns (ModelControllerTest, ModelServiceLoadTest)**
- Use MockMvc standalone setup with GlobalExceptionHandler for controller tests
- Use @ExtendWith(MockitoExtension.class) with @Mock repositories for service tests
- Follow createEmptyModel() helper pattern for test data

## Out of Scope
- No schema changes or Liquibase migrations
- No persistence of canonicalized data (read-only transformation)
- No frontend changes
- No changes to existing loadModel endpoint behavior
- No filtering by diagram types other than "General" in ProjectContextPackage
- No sorting of semantic lists inside typed_content (e.g., sequence messages must preserve order)
- No modification of values during canonicalization (only ordering changes)
- No caching of canonicalized results
- No pagination of diagrams in ProjectContextPackage response
- No authentication/authorization changes (follow existing security context)
