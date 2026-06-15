# Task Breakdown: Fix Diagram Type Deserialization Compatibility

## Overview
Total Tasks: 7

This is a focused backend-only fix that adds Jackson `@JsonAlias` annotation support to enable backward/forward compatibility for the `diagramType` field during JSON deserialization. The fix is minimal (single annotation change) with supporting unit and integration tests.

## Task List

### Backend Implementation

#### Task Group 1: DTO Annotation Fix
**Dependencies:** None

- [x] 1.0 Complete DiagramDto JsonAlias annotation fix
  - [x] 1.1 Add JsonAlias import and annotation to DiagramDto
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java`
    - Add import: `com.fasterxml.jackson.annotation.JsonAlias`
    - Add `@JsonAlias({ "type", "diagramType" })` annotation to the `diagramType` record component
    - Keep existing `@JsonProperty("diagram_type")` annotation (controls serialization output)
    - Do NOT rename the Java component; keep it as `diagramType`
  - [x] 1.2 Verify build compiles successfully
    - Run `mvn compile -f architecture-model-service/pom.xml`
    - Confirm no compilation errors

**Acceptance Criteria:**
- DiagramDto.java contains both `@JsonProperty("diagram_type")` and `@JsonAlias({ "type", "diagramType" })` on the diagramType component
- Project compiles without errors
- Record structure remains unchanged (11 components)

### Testing

#### Task Group 2: Unit Tests for Deserialization
**Dependencies:** Task Group 1

- [x] 2.0 Complete unit tests for DiagramDto deserialization variants
  - [x] 2.1 Create DiagramDtoDeserializationTest.java
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/diagram/DiagramDtoDeserializationTest.java` (new file)
    - Use JUnit 5 with ObjectMapper for JSON deserialization
  - [x] 2.2 Write test for canonical "diagram_type" field name
    - Test JSON with `"diagram_type": "Sequence"` deserializes correctly
    - Assert `dto.diagramType()` equals "Sequence"
    - Use minimal valid JSON (id, name, empty arrays for nodes/edges/decorations/interactionEdges)
  - [x] 2.3 Write test for alternate "type" field name
    - Test JSON with `"type": "Sequence"` deserializes correctly
    - Assert `dto.diagramType()` equals "Sequence"
  - [x] 2.4 Write test for alternate "diagramType" field name
    - Test JSON with `"diagramType": "Sequence"` deserializes correctly
    - Assert `dto.diagramType()` equals "Sequence"
  - [x] 2.5 Run unit tests and verify all pass
    - Run `mvn test -f architecture-model-service/pom.xml -Dtest=DiagramDtoDeserializationTest`
    - All 3 test cases should pass

**Acceptance Criteria:**
- 3 unit tests exist covering all JSON field name variants
- All tests pass confirming JsonAlias works correctly
- Tests use minimal valid JSON payloads

#### Task Group 3: Integration Test for Persistence
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete integration test for diagram type persistence
  - [x] 3.1 Create ModelServiceDiagramTypePersistenceTest.java
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceDiagramTypePersistenceTest.java` (new file)
    - Follow existing test patterns from ModelServiceSaveTest and ModelServiceLoadTest
    - Use `@ExtendWith(MockitoExtension.class)` with mocked repositories
  - [x] 3.2 Write test for saving diagram with alternate field name
    - Create DiagramDto with diagramType="Sequence" (simulating alternate field deserialization)
    - Save model via ModelService.saveModel()
    - Verify diagram entity is saved with correct diagram_type
  - [x] 3.3 Write test for loading diagram and verifying type preserved
    - Mock repository to return diagram with diagramType="Sequence"
    - Load model via ModelService.loadModel()
    - Assert returned DiagramDto has `diagramType == "Sequence"`
  - [x] 3.4 Run integration tests and verify all pass
    - Run `mvn test -f architecture-model-service/pom.xml -Dtest=ModelServiceDiagramTypePersistenceTest`
    - All test cases should pass

**Acceptance Criteria:**
- 2-3 integration tests exist covering save and load persistence
- Tests follow existing ModelServiceSaveTest/ModelServiceLoadTest patterns
- All tests pass confirming end-to-end flow works

#### Task Group 4: Final Verification
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete final verification of all feature tests
  - [x] 4.1 Run all feature-related tests together
    - Run `mvn test -f architecture-model-service/pom.xml -Dtest=DiagramDtoDeserializationTest,ModelServiceDiagramTypePersistenceTest`
    - Verify all 5-6 tests pass
  - [x] 4.2 Verify canonical output serialization unchanged
    - Confirm response JSON still uses "diagram_type" field name (manual verification or add assertion in existing test)
    - Existing clients expecting "diagram_type" in responses continue to work
  - [x] 4.3 Run full test suite to check for regressions
    - Run `mvn test -f architecture-model-service/pom.xml`
    - All existing tests should continue to pass

**Acceptance Criteria:**
- All 5-6 new tests pass
- Full test suite passes (no regressions)
- Response serialization uses canonical "diagram_type" field name

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: DTO Annotation Fix** - The core fix (single annotation change)
2. **Task Group 2: Unit Tests for Deserialization** - Verify the fix works at DTO level
3. **Task Group 3: Integration Test for Persistence** - Verify end-to-end save/load works
4. **Task Group 4: Final Verification** - Run all tests and confirm no regressions

## Implementation Notes

### File Locations
- **DiagramDto.java**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java`
- **New unit test**: `architecture-model-service/src/test/java/com/example/architecturemodel/model/dto/diagram/DiagramDtoDeserializationTest.java`
- **New integration test**: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceDiagramTypePersistenceTest.java`
- **Existing test patterns**: `architecture-model-service/src/test/java/com/example/architecturemodel/service/ModelServiceSaveTest.java` and `ModelServiceLoadTest.java`

### Key Constraints
- Do NOT modify the canonical JSON output field name (must remain "diagram_type")
- Do NOT rename the Java record component (must remain `diagramType`)
- Do NOT modify DiagramEntity, DiagramMapper, or other classes
- Do NOT add validation for diagramType values
- This is backend-only; no frontend changes required

### Expected Annotation Pattern
```java
@JsonProperty("diagram_type")
@JsonAlias({ "type", "diagramType" })
String diagramType,
```

This allows:
- **Input**: Accept "diagram_type", "type", or "diagramType" during deserialization
- **Output**: Always serialize as "diagram_type" (controlled by @JsonProperty)
