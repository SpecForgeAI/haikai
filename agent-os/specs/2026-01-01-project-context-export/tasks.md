# Task Breakdown: Export ProjectContextPackage + Deterministic Canonical JSON for Diagrams

## Overview
Total Tasks: 5 Task Groups, ~25 Sub-tasks

This feature adds two new GET endpoints to the architecture-model-service for exporting project context and canonical diagram JSON. It is backend-only with no schema changes or frontend modifications required.

## Task List

### DTO Layer

#### Task Group 1: Export DTO Records
**Dependencies:** None

- [x] 1.0 Complete DTO layer for export package
  - [x] 1.1 Write 3-4 focused tests for export DTOs
    - Test ProjectContextPackageDto serialization with Jackson (snake_case JSON properties)
    - Test CanonicalDiagramExportDto serialization with Jackson
    - Test both DTOs handle null diagrams/metaModel gracefully
    - Verify @JsonProperty annotations produce expected JSON output
  - [x] 1.2 Create export DTO package
    - Package: `com.example.architecturemodel.model.dto.export`
  - [x] 1.3 Create ProjectContextPackageDto record
    - Fields: project_id (String), metaModel (MetaModelDto), diagrams (List<DiagramDto>)
    - Add @JsonProperty annotations for snake_case serialization
    - Reference pattern: existing DTO records in `model.dto.diagram` package
  - [x] 1.4 Create CanonicalDiagramExportDto record
    - Fields: project_id (String), diagram_id (String), diagram_type (String), canonical (DiagramDto)
    - Add @JsonProperty annotations for snake_case serialization
  - [x] 1.5 Ensure DTO tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify serialization produces expected JSON structure

**Acceptance Criteria:**
- Both DTO records compile and serialize correctly
- JSON output uses snake_case property names (project_id, diagram_id, diagram_type)
- Tests verify Jackson serialization behavior

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectContextPackageDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/CanonicalDiagramExportDto.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/dto/ExportDtoSerializationTest.java`

---

### Canonicalization Layer

#### Task Group 2: DiagramCanonicalizer Utility
**Dependencies:** Task Group 1

- [x] 2.0 Complete DiagramCanonicalizer utility
  - [x] 2.1 Write 5-6 focused tests for DiagramCanonicalizer
    - Test canonicalize() sorts diagramNodes by id (String compare)
    - Test canonicalize() sorts diagramEdges by id
    - Test canonicalize() sorts decorations by id
    - Test canonicalizeJson() converts Map to TreeMap with sorted keys
    - Test canonicalizeJson() preserves List order but recursively canonicalizes elements
    - Test canonicalizeJson() returns primitives unchanged
  - [x] 2.2 Create DiagramCanonicalizer class
    - Package: `com.example.architecturemodel.service.export`
    - Annotate with @Component for Spring DI
  - [x] 2.3 Implement canonicalize(DiagramDto in) method
    - Create new ArrayList from diagramNodes, sort by id using Comparator.comparing()
    - Create new ArrayList from diagramEdges, sort by id
    - Create new ArrayList from decorations, sort by id
    - Apply canonicalizeJson() to typedContent field
    - Return new DiagramDto with sorted collections and canonicalized typedContent
    - Handle null collections gracefully (return null or empty list as appropriate)
  - [x] 2.4 Implement private canonicalizeJson(Object o) method
    - If o is null: return null
    - If o is Map<?, ?>: create TreeMap, recursively canonicalize all values, return TreeMap
    - If o is List<?>: create ArrayList, recursively canonicalize each element, return ArrayList
    - Otherwise: return o unchanged (handles String, Number, Boolean primitives)
  - [x] 2.5 Ensure DiagramCanonicalizer tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - Verify deterministic ordering of collections and map keys

**Acceptance Criteria:**
- DiagramCanonicalizer produces identical output for semantically equivalent input
- Map keys are sorted alphabetically via TreeMap
- List order is preserved (only elements are recursively canonicalized)
- Null values handled gracefully throughout

**Files to Create:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/export/DiagramCanonicalizer.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/export/DiagramCanonicalizerTest.java`

---

### Service Layer

#### Task Group 3: ModelService Additions
**Dependencies:** Task Group 2

- [x] 3.0 Complete ModelService export methods
  - [x] 3.1 Write 5-6 focused tests for ModelService export methods
    - Test loadProjectContext() returns only "General" diagrams (case-insensitive)
    - Test loadProjectContext() canonicalizes each returned diagram
    - Test loadProjectContext() throws ResourceNotFoundException for missing model file
    - Test loadProjectContext() throws IllegalArgumentException for blank filename
    - Test exportCanonicalDiagram() returns canonicalized diagram by id
    - Test exportCanonicalDiagram() throws ResourceNotFoundException when diagram id not found
  - [x] 3.2 Add DiagramCanonicalizer constructor injection to ModelService
    - Add private final DiagramCanonicalizer diagramCanonicalizer field
    - Add to @RequiredArgsConstructor injection (Lombok will auto-generate constructor)
  - [x] 3.3 Implement loadProjectContext(String filename) method
    - Annotate with @Transactional(readOnly = true)
    - Validate filename is not blank, throw IllegalArgumentException if blank
    - Call existing loadModel(filename) to retrieve ArchitectureModelDto
    - Filter diagrams to include only where diagramType.equalsIgnoreCase("General")
    - Apply diagramCanonicalizer.canonicalize() to each filtered diagram
    - Return new ProjectContextPackageDto with filename as project_id, metaModel, and filtered/canonicalized diagrams
  - [x] 3.4 Implement exportCanonicalDiagram(String filename, String diagramId) method
    - Annotate with @Transactional(readOnly = true)
    - Validate filename and diagramId are not blank, throw IllegalArgumentException if either is blank
    - Call existing loadModel(filename) to retrieve ArchitectureModelDto
    - Find diagram by id in diagrams list using stream().filter()
    - If not found, throw ResourceNotFoundException with message: "Diagram not found: " + diagramId
    - Apply diagramCanonicalizer.canonicalize() to found diagram
    - Return new CanonicalDiagramExportDto with filename as project_id, diagramId, diagram.diagramType(), canonicalized diagram
  - [x] 3.5 Ensure ModelService export tests pass
    - Run ONLY the 5-6 tests written in 3.1
    - Verify filtering, canonicalization, and error handling work correctly

**Acceptance Criteria:**
- loadProjectContext() returns only General diagrams, all canonicalized
- exportCanonicalDiagram() returns single canonicalized diagram
- Appropriate exceptions thrown for missing model files or diagrams
- Validation matches existing patterns (IllegalArgumentException for blank params)

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`

**Files to Create:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceProjectContextTest.java`

---

### Controller Layer

#### Task Group 4: API Endpoints
**Dependencies:** Task Group 3

- [x] 4.0 Complete Controller endpoints for export
  - [x] 4.1 Write 5-6 focused tests for controller endpoints
    - Test GET /api/model/project-context/{filename} returns 200 with ProjectContextPackageDto
    - Test GET /api/model/project-context/{filename} returns 404 for missing model file
    - Test GET /api/model/project-context with blank filename returns 400
    - Test GET /api/model/diagrams/{diagramId}/canonical?filename={filename} returns 200 with CanonicalDiagramExportDto
    - Test GET /api/model/diagrams/{diagramId}/canonical returns 404 when diagram not found
    - Test GET /api/model/diagrams/{diagramId}/canonical with blank filename returns 400
  - [x] 4.2 Add getProjectContext endpoint to ModelController
    - @GetMapping("/project-context/{filename}")
    - PathVariable: filename (String)
    - Add log.debug("GET /api/model/project-context/{}", filename)
    - Validate filename is not blank, throw IllegalArgumentException if blank
    - Call modelService.loadProjectContext(filename)
    - Return ResponseEntity.ok(result)
  - [x] 4.3 Add getCanonicalDiagram endpoint to ModelController
    - @GetMapping("/diagrams/{diagramId}/canonical")
    - PathVariable: diagramId (String)
    - RequestParam: filename (String, required = true)
    - Add log.debug("GET /api/model/diagrams/{}/canonical?filename={}", diagramId, filename)
    - Validate diagramId and filename are not blank, throw IllegalArgumentException if either is blank
    - Call modelService.exportCanonicalDiagram(filename, diagramId)
    - Return ResponseEntity.ok(result)
  - [x] 4.4 Ensure Controller tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify HTTP status codes and response bodies match expectations

**Acceptance Criteria:**
- GET /api/model/project-context/{filename} endpoint works correctly
- GET /api/model/diagrams/{diagramId}/canonical?filename={filename} endpoint works correctly
- 404 returned for missing resources via GlobalExceptionHandler
- 400 returned for blank parameters via GlobalExceptionHandler
- Response JSON matches DTO structure

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`

**Files to Modify (add tests):**
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectContextExportControllerTest.java`

---

### Integration Testing Layer

#### Task Group 5: Test Review and Integration Tests
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and add integration coverage
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 3-4 DTO serialization tests from Task 1.1
    - Review 5-6 DiagramCanonicalizer unit tests from Task 2.1
    - Review 5-6 ModelService export tests from Task 3.1
    - Review 5-6 Controller endpoint tests from Task 4.1
    - Total existing tests: approximately 19-22 tests
  - [x] 5.2 Analyze test coverage gaps for export feature
    - Identify critical end-to-end workflows that lack coverage
    - Focus on canonicalization determinism (same input = same output)
    - Focus on General diagram filtering edge cases
  - [x] 5.3 Write up to 6 additional integration tests if needed
    - Test canonicalization produces identical JSON for same diagram called twice
    - Test typedContent with nested Maps/Lists is fully canonicalized
    - Test mixed diagram types (General + Sequence + Activity) filters correctly
    - Test empty diagrams list in ProjectContextPackage
    - Test diagram with null typedContent canonicalizes correctly
    - Test special characters in diagram ids work correctly
  - [x] 5.4 Run all feature-specific tests
    - Run ONLY tests related to this feature (from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 25-28 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-28 tests total)
- Canonicalization produces deterministic output verified by tests
- General diagram filtering verified with edge cases
- No more than 6 additional integration tests added

**Files to Create:**
- `architecture-model-service/src/test/java/com/example/architecturemodel/integration/ProjectContextExportIntegrationTest.java`

---

## Execution Order

Recommended implementation sequence:

1. **DTO Layer (Task Group 1)** - Create DTOs first as foundation for all other layers
2. **Canonicalization Layer (Task Group 2)** - Implement core utility before service integration
3. **Service Layer (Task Group 3)** - Add business logic methods that use DTOs and canonicalizer
4. **Controller Layer (Task Group 4)** - Expose endpoints that call service methods
5. **Integration Testing (Task Group 5)** - Verify end-to-end behavior and fill gaps

## Key Reference Files

| File | Purpose |
|------|---------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` | Add new export methods (loadProjectContext, exportCanonicalDiagram) |
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` | Add new GET endpoints |
| `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java` | Reference for DiagramDto structure and fields to canonicalize |
| `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceLoadTest.java` | Follow test patterns for service tests |
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java` | Follow MockMvc test patterns for controller tests |
| `architecture-model-service/src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java` | Exception handling (no changes needed, reuse existing) |

## Notes

- **No schema changes required** - This is a read-only transformation feature
- **No frontend changes required** - Backend-only feature
- **Reuse existing loadModel()** - Both new methods delegate to loadModel() internally
- **DiagramCanonicalizer is a Spring @Component** - Inject via constructor into ModelService
- **Use @Transactional(readOnly = true)** - Both new service methods are read-only operations
- **Case-insensitive "General" filtering** - Use equalsIgnoreCase() for diagram type comparison
- **TreeMap for deterministic JSON** - Jackson serializes TreeMap keys in natural (alphabetical) order
