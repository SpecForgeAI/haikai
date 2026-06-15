# Task Breakdown: Ensure Physical Data Entity Attributes Reach Planner LLM

## Overview
Total Tasks: 32

This feature ensures that physical data entity (PDE) attributes (columns) deterministically appear in the Planner LLM highlighted context by:
1. Persisting bundle_type and depth selections per entity in the database
2. Ensuring the expand-resolve endpoint returns attributes in resolved output
3. Injecting warnings for PDEs missing attributes

## Task List

### Database Layer

#### Task Group 1: Database Migration and Entity Updates
**Dependencies:** None

- [x] 1.0 Complete database migration and JPA entity updates
  - [x] 1.1 Write 4 focused tests for WorkItemImplementContextEntity structured selections
    - Test JSONB serialization of entity selections with bundle_type and depth
    - Test JSONB serialization of diagram selections with bundle_type
    - Test null handling for new JSONB columns (defaults to empty array)
    - Test backward compatibility reading legacy records without new columns
  - [x] 1.2 Create Flyway migration script for new JSONB columns
    - Migration file: `V{next_version}__add_structured_selections_to_implement_context.sql`
    - Add `selected_entity_selections JSONB DEFAULT '[]'::jsonb`
    - Add `selected_diagram_selections JSONB DEFAULT '[]'::jsonb`
    - Add to `work_item_implement_context` table
  - [x] 1.3 Update WorkItemImplementContextEntity with new JSONB fields
    - Add `selectedEntitySelections` field with `@Type(JsonBinaryType.class)` annotation
    - Add `selectedDiagramSelections` field with same JSONB type
    - Follow existing pattern from `selectedEntityIds` JSONB column
  - [x] 1.4 Create EntitySelection and DiagramSelection DTOs for structured data
    - EntitySelection: entityType, entityId, bundleType, depth (optional)
    - DiagramSelection: diagramId, bundleType
    - Add Jackson annotations for JSON serialization
  - [x] 1.5 Ensure database layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify migration runs successfully
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- Migration script executes without errors
- Entity correctly serializes/deserializes JSONB structured selections
- Legacy records without new columns read successfully with empty arrays

---

### Backend API Layer

#### Task Group 2: Controller and DTO Updates for Structured Selections
**Dependencies:** Task Group 1

- [x] 2.0 Complete controller and DTO updates for structured selections
  - [x] 2.1 Write 4 focused tests for WorkItemImplementContextController structured selections
    - Test GET endpoint returns structured selections in response DTO
    - Test PUT endpoint saves structured selections from request body
    - Test backward compatibility: GET returns inferred defaults for legacy contexts
    - Test round-trip: save structured selections then load returns same values
  - [x] 2.2 Update ImplementContextDto to include structured selection arrays
    - Add `selectedEntitySelections: List<EntitySelection>`
    - Add `selectedDiagramSelections: List<DiagramSelection>`
    - Maintain existing `selectedEntityIds` and `selectedDiagramIds` for backward compat
  - [x] 2.3 Update SaveContextRequest to accept structured selections
    - Add fields matching ImplementContextDto structure
    - Support both legacy ID arrays and new structured selections in same request
  - [x] 2.4 Update WorkItemImplementContextController GET/PUT methods
    - GET: Map entity fields to DTO including new structured selection arrays
    - PUT: Save structured selections to entity when provided in request
  - [x] 2.5 Implement backward compatibility inference logic
    - When loading contexts with only `selectedEntityIds` (no structured selections):
    - Interfaces -> `interface_with_endpoints_and_schemas`
    - Services -> `service_with_parents_and_children`
    - Physical/Logical data entities -> `entity_with_attributes_and_relationships` with depth=1
    - Create `inferDefaultBundleType(entityType)` helper method
  - [x] 2.6 Ensure controller layer tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify GET/PUT operations work with structured selections
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- GET endpoint returns structured selections when available
- PUT endpoint persists structured selections
- Legacy contexts load with inferred bundle_type defaults

---

#### Task Group 3: Resolution Service - Include Attributes in Resolved PDEs
**Dependencies:** Task Group 1

- [x] 3.0 Complete resolution service updates for PDE attributes
  - [x] 3.1 Write 4 focused tests for ImplementContextResolutionService PDE attribute resolution
    - Test resolvePhysicalDataEntity() returns attributes in relevant_fields
    - Test attributes array contains name, type, pk, nullable fields
    - Test PDE with no attributes returns empty attributes array
    - Test multiple attributes are ordered consistently (database order)
  - [x] 3.2 Inject PhysicalDataAttributeRepository into ImplementContextResolutionService
    - Add `@Autowired` field for PhysicalDataAttributeRepository
    - Import repository class
    - Follow existing injection pattern from other repositories in service
  - [x] 3.3 Update resolvePhysicalDataEntity() to query and include attributes
    - Call `physicalDataAttributeRepository.findByPhysicalEntityId(entityId)`
    - Build attributes List with Map entries for each attribute
    - Map fields: name -> attr.getName(), type -> attr.getDataType(), pk -> attr.isPrimaryKey(), nullable -> attr.isNullable()
    - Add to relevantFields: `relevantFields.put("attributes", attributesList)`
  - [x] 3.4 Handle edge cases in attribute resolution
    - Null check for attribute list from repository
    - Handle null values in attribute fields gracefully
    - Log warning if PDE has no attributes found
  - [x] 3.5 Ensure resolution service tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify attributes appear in resolved entity relevant_fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- resolvePhysicalDataEntity() includes attributes in relevant_fields
- Attributes have correct structure: name, type, pk, nullable
- Edge cases (no attributes, null values) handled gracefully

---

### Frontend Layer

#### Task Group 4: Frontend Persistence API Updates
**Dependencies:** Task Group 2

- [x] 4.0 Complete frontend persistence API updates
  - [x] 4.1 Write 4 focused tests for implementContextApi.ts structured selections
    - Test saveImplementContext() includes bundle_type and depth in request body
    - Test mapDtoToContextState() populates bundle_type and depth from response
    - Test loadContext() from localStorage preserves bundle_type and depth
    - Test backward compatibility: loading DTO without structured selections works
  - [x] 4.2 Extend ImplementContextDto TypeScript interface
    - Add `selected_entity_selections?: EntitySelection[]` array
    - Add `selected_diagram_selections?: DiagramSelection[]` array
    - Define EntitySelection type: entityType, entityId, bundleType, depth?
    - Define DiagramSelection type: diagramId, bundleType
  - [x] 4.3 Update saveImplementContext() to send structured selections
    - Extract bundle_type and depth from EntityRef objects
    - Build selectedEntitySelections array from entities with bundle info
    - Build selectedDiagramSelections array from diagrams with bundle info
    - Include in request body alongside legacy ID arrays
  - [x] 4.4 Update mapDtoToContextState() to populate bundle_type and depth
    - When structured selections exist in DTO, use them
    - Map bundle_type and depth to EntityRef objects
    - Fallback to inferring defaults when only legacy IDs present
  - [x] 4.5 Update localStorage handling to preserve bundle_type and depth
    - Ensure loadContext() reads bundle_type/depth from cached data
    - Ensure saveToLocalStorage includes bundle_type/depth
  - [x] 4.6 Ensure frontend persistence tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify save/load preserves structured selections
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- saveImplementContext() sends bundle_type and depth
- mapDtoToContextState() correctly populates selections from DTO
- localStorage operations preserve bundle_type and depth

---

### Gateway Integration Layer

#### Task Group 5: Gateway Expand-Resolve Integration
**Dependencies:** Task Group 3

- [x] 5.0 Complete gateway expand-resolve integration
  - [x] 5.1 Write 3 focused tests for gateway expand-resolve depth handling
    - Test expandResolveContext() passes depth from entity selections
    - Test normalizeEntitiesForExpandResolve() preserves depth parameter
    - Test tryResolveImplementContextWithBundles() calls expand-resolve with correct structure
  - [x] 5.2 Verify depth parameter passing in architectureModelClient.ts
    - Confirm expandResolveContext() includes depth in EntityBundleSelection
    - Verify normalizeEntitiesForExpandResolve() maps depth correctly
    - Add logging for depth value being sent (debug level)
  - [x] 5.3 Update tryResolveImplementContextWithBundles() if needed
    - Ensure entity selections with bundle_type trigger expand-resolve path
    - Pass depth from each entity selection to expand-resolve request DTO
    - Handle missing depth by using default (undefined lets backend use effectiveDepth())
  - [x] 5.4 Ensure gateway expand-resolve tests pass
    - Run ONLY the 3 tests written in 5.1
    - Verify depth flows through to backend call
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 5.1 pass
- Depth parameter correctly passed to expand-resolve endpoint
- Entity type normalization preserves depth values

---

#### Task Group 6: Gateway Prompt Builder - Attribute Handling and Warnings
**Dependencies:** Task Group 5

- [x] 6.0 Complete prompt builder attribute handling and PDE warnings
  - [x] 6.1 Write 4 focused tests for prompt builder PDE attribute handling
    - Test extractAttributes() reads attributes from relevant_fields.attributes array
    - Test formatHighlightedContext() includes attributes in output
    - Test buildImplementPlannerPrompt() injects warning for PDEs missing attributes
    - Test warning format: `[WARNING: Physical Data Entity <id> is missing attribute metadata]`
  - [x] 6.2 Verify extractAttributes() and buildEntityAndAttributesDtos() work correctly
    - Confirm existing implementation handles attributes array from relevant_fields
    - Add debug logging for attribute count extraction
    - No changes needed if backend populates correctly (verify with tests)
  - [x] 6.3 Extend validatePdeAttributes() to generate warning text
    - Return warning messages for PDEs with missing attributes
    - Format: `[WARNING: Physical Data Entity <entityId> is missing attribute metadata]`
    - Return empty array if all PDEs have attributes
  - [x] 6.4 Update buildImplementPlannerPrompt() to inject warnings
    - Call validatePdeAttributes() to get warning messages
    - Inject warnings into prompt context section
    - Position warnings before entity context for visibility
  - [x] 6.5 Add debug logging for attribute flow verification
    - Log attribute count in buildCondensedContextForPrompt()
    - Log warning count with entity IDs when PDEs missing attributes
    - Include hint about checking depth parameter in warning log
  - [x] 6.6 Ensure prompt builder tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify attributes appear in prompt output
    - Verify warnings injected for PDEs missing attributes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- extractAttributes() correctly reads from relevant_fields.attributes
- Warnings injected into prompt for PDEs missing attributes
- Debug logging shows attribute counts at each stage

---

### Testing and Verification

#### Task Group 7: Integration Testing
**Dependencies:** Task Groups 1-6

- [x] 7.0 Complete integration testing
  - [x] 7.1 Write end-to-end test: PDE attributes flow from expansion to prompt
    - Set up PDE with attributes in test database
    - Call expand-resolve with depth=1
    - Verify resolved_entities[].relevant_fields.attributes has length > 0
    - Verify prompt builder includes attribute names in output
  - [x] 7.2 Write persistence round-trip integration test
    - Save context with bundle_type and depth via frontend API
    - Load context via GET endpoint
    - Verify bundle_type and depth values match saved values
    - Verify entity selections preserved across save/load cycle
  - [x] 7.3 Write backward compatibility integration test
    - Create legacy context with only selectedEntityIds (no structured selections)
    - Load via GET endpoint
    - Verify inferred bundle_type defaults are applied correctly
    - Verify no errors or data loss
  - [x] 7.4 Write warning injection integration test
    - Create PDE without attributes in test database
    - Call expand-resolve and build prompt
    - Verify warning appears in prompt output
    - Verify warning includes correct entity ID

**Acceptance Criteria:**
- End-to-end attribute flow verified
- Persistence round-trip preserves all bundle_type/depth values
- Legacy contexts load with correct inferred defaults
- Missing attribute warnings appear in prompt

---

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests written by Task Group 1 (database layer)
    - Review the 4 tests written by Task Group 2 (controller layer)
    - Review the 4 tests written by Task Group 3 (resolution service)
    - Review the 4 tests written by Task Group 4 (frontend persistence)
    - Review the 3 tests written by Task Group 5 (gateway expand-resolve)
    - Review the 4 tests written by Task Group 6 (prompt builder)
    - Review the 4 tests written by Task Group 7 (integration tests)
    - Total existing tests: approximately 27 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to PDE attribute flow
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 8.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Focus on integration points between layers
    - Potential gaps: error handling, concurrent save/load, migration rollback
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 27-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 27-32 tests total)
- Critical user workflows for PDE attribute flow are covered
- No more than 5 additional tests added when filling in gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Database Layer (Task Group 1)** - Foundation for persistence
2. **Backend API Layer (Task Group 2)** - Controller/DTO for structured selections
3. **Resolution Service (Task Group 3)** - Critical fix for attributes in resolved PDEs
4. **Frontend Persistence (Task Group 4)** - Depends on backend API contract
5. **Gateway Expand-Resolve (Task Group 5)** - Depends on resolution service
6. **Gateway Prompt Builder (Task Group 6)** - Depends on expand-resolve output
7. **Integration Testing (Task Group 7)** - Verify full flow
8. **Test Review and Gap Analysis (Task Group 8)** - Final verification

**Parallel Execution Opportunities:**
- Task Groups 2 and 3 can run in parallel (both depend only on Group 1)
- Task Group 4 can start once Group 2 API contract is defined
- Task Groups 5 and 6 can be developed together once Group 3 is complete

---

## Key Files to Modify

### Model Service (Java)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java`
- `architecture-model-service/src/main/resources/db/migration/V{next}__add_structured_selections.sql`

### Frontend (TypeScript)
- `frontend/src/api/implementContextApi.ts`

### Gateway (TypeScript)
- `gateway/src/services/architectureModelClient.ts`
- `gateway/src/services/promptBuilder.ts`

---

## Risk Areas and Mitigations

| Risk | Mitigation |
|------|------------|
| JSONB serialization issues | Use existing JSONB patterns from selectedEntityIds column |
| Backward compatibility breaks | Inference logic with explicit defaults; maintain legacy ID fields |
| Attribute count mismatch in logs | Add logging at each layer to trace attribute flow |
| Migration failure on existing data | Default new columns to empty arrays; no data transformation needed |
| Frontend/backend DTO mismatch | Define TypeScript types to match Java DTOs exactly |
