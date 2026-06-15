# Specification: Fix Diagram Type Deserialization Compatibility

## Goal
Add backward/forward compatibility to DiagramDto deserialization so the backend accepts diagram type from multiple JSON field names ("diagram_type", "type", "diagramType") and persists it correctly, restoring Sequence/typed diagram RHS editor functionality.

## User Stories
- As a frontend developer, I want the backend to accept diagram type under alternate JSON field names so that diagrams saved with "type" or "diagramType" persist correctly.
- As an end user, I want my Sequence diagrams to retain their diagram type after save/reload so that the Sequence RHS editor displays correctly.

## Specific Requirements

**Add JsonAlias annotations to DiagramDto.diagramType**
- File: `src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java`
- Add `@JsonAlias({ "type", "diagramType" })` annotation alongside existing `@JsonProperty("diagram_type")`
- Import `com.fasterxml.jackson.annotation.JsonAlias`
- Keep the Java component name as `diagramType` (do not rename)
- Keep `@JsonProperty("diagram_type")` as canonical JSON output name
- This allows Jackson to deserialize from any of the three field names during request parsing

**Create unit test for DiagramDto deserialization**
- File: `src/test/java/com/example/architecturemodel/model/dto/diagram/DiagramDtoDeserializationTest.java` (new file)
- Create three test cases covering each JSON field name variant
- Test case 1: JSON with `"diagram_type": "Sequence"` deserializes correctly
- Test case 2: JSON with `"type": "Sequence"` deserializes correctly
- Test case 3: JSON with `"diagramType": "Sequence"` deserializes correctly
- Each test should use ObjectMapper to deserialize JSON string into DiagramDto
- Assert that `dto.diagramType()` equals "Sequence" in all cases
- Use minimal valid JSON for DiagramDto record (id, name, empty arrays for nodes/edges/decorations/interactionEdges)

**Create integration test for diagram type persistence**
- File: `src/test/java/com/example/architecturemodel/service/ModelServiceDiagramTypePersistenceTest.java` (new file)
- Test that saving a model with diagram using alternate field name persists correctly
- Use "type": "Sequence" in request JSON (not "diagram_type")
- Verify loaded DiagramDto has `diagramType == "Sequence"`
- Optionally verify serialized response uses canonical "diagram_type" field name
- Follow existing test patterns from ModelServiceSaveTest and ModelServiceLoadTest

**Canonical output field name must remain "diagram_type"**
- Response serialization must continue using "diagram_type" as the JSON field name
- The `@JsonProperty("diagram_type")` annotation controls output serialization
- Existing clients expecting "diagram_type" in responses continue to work unchanged

**TypedContent auto-population must function correctly**
- When diagramType is resolved to "Sequence", "ER", "Activity", or "State"
- ModelService.processTypedContent() must detect the type and auto-populate defaults if typedContent is absent
- TypedContentDefaults.requiresTypedContent() must receive the resolved diagramType value

## Existing Code to Leverage

**DiagramDto record structure**
- Located at `src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java`
- Already uses `@JsonProperty("diagram_type")` annotation on diagramType component
- Record has 11 components; maintain exact structure when adding JsonAlias

**ModelService.processTypedContent() method**
- Located at `src/main/java/com/example/architecturemodel/service/ModelService.java` lines 582-619
- Calls `diagram.diagramType()` to get the type for validation and default population
- Works correctly once diagramType is populated; issue is upstream deserialization

**ModelServiceSaveTest and ModelServiceLoadTest patterns**
- Located in `src/test/java/com/example/architecturemodel/service/`
- Use Mockito with `@ExtendWith(MockitoExtension.class)`
- Create ModelService via constructor injection with EntityMapper and DiagramMapper
- Provide patterns for mocking repository interactions and asserting saved/loaded data

**TypedContentDefaults utility class**
- Located at `src/main/java/com/example/architecturemodel/service/TypedContentDefaults.java`
- Defines TYPED_DIAGRAM_TYPES as Set of "Sequence", "ER", "Activity", "State"
- Provides getDefaultTypedContent() and requiresTypedContent() methods
- These work correctly when diagramType is non-null; fix ensures they receive the value

## Out of Scope
- Frontend changes (the fix is backend-only and unblocks frontend immediately)
- Database migrations (diagrams.diagram_type column already exists)
- Changes to DiagramEntity or DiagramMapper
- Changes to TypedContentDefaults or TypedContentValidator
- Adding new diagram types
- Modifying the typed_content envelope structure
- API contract changes for response serialization (must remain "diagram_type")
- Changes to other DTO classes
- Modifying the canonical JSON field name from "diagram_type"
- Adding validation for diagramType values
