# Task Breakdown: Fix Context Bundle + Depth Wiring End-to-End

## Overview
Total Tasks: 28

This spec ensures that when users select physical data entities with depth >= 1 and/or bundle types in the Context Picker, the Implement Assistant chat requests use the expand-resolve path and the LLM receives resolved context containing entity names, attribute lists, and relationship metadata.

## Task List

### Frontend Layer

#### Task Group 1: Type Extensions and API Updates
**Dependencies:** None

- [x] 1.0 Complete frontend type extensions
  - [x] 1.1 Write 4 focused tests for type and payload construction
    - Test EntityBundleSelection interface has entity_type, entity_id, bundle_type, depth fields
    - Test DiagramBundleSelection interface has diagram_id, bundle_type fields
    - Test ArchitectureContextPayload includes optional entities[] and diagrams[] arrays
    - Test backward compatibility with legacy entityIds/diagramIds arrays
  - [x] 1.2 Add EntityBundleSelection interface to `frontend/src/api/chatApi.ts`
    - Fields: entity_type: string, entity_id: string, bundle_type: string, depth?: number
    - Mirror gateway type definition from `gateway/src/types/chat.ts`
  - [x] 1.3 Add DiagramBundleSelection interface to `frontend/src/api/chatApi.ts`
    - Fields: diagram_id: string, bundle_type: string
    - Mirror gateway type definition from `gateway/src/types/chat.ts`
  - [x] 1.4 Extend ArchitectureContextPayload interface in `frontend/src/api/chatApi.ts`
    - Add optional `entities?: EntityBundleSelection[]` field
    - Add optional `diagrams?: DiagramBundleSelection[]` field
    - Keep existing entityIds and diagramIds for backward compatibility
  - [x] 1.5 Ensure frontend type tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify type definitions compile correctly

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- New types mirror gateway definitions
- Backward compatibility maintained with legacy fields

#### Task Group 2: buildContext() Enhancement
**Dependencies:** Task Group 1

- [x] 2.0 Complete buildContext() enhancement in ImplementationAssistantPanel
  - [x] 2.1 Write 4 focused tests for buildContext() payload construction
    - Test entities[] array is populated from contextState.entity_refs
    - Test each entity includes entity_type, entity_id, bundle_type, depth from EntityRef
    - Test diagrams[] array is populated from contextState.diagram_refs
    - Test depth defaults to 1 when undefined in EntityRef
  - [x] 2.2 Update buildContext() to construct entities[] array
    - Path: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Map contextState.entity_refs[] to EntityBundleSelection objects
    - Include entity_type, entity_id from each EntityRef
    - Include bundle_type from EntityRef.bundle_type (when present)
    - Include depth from EntityRef.depth (default to 1 if undefined)
  - [x] 2.3 Update buildContext() to construct diagrams[] array
    - Map contextState.diagram_refs[] to DiagramBundleSelection objects
    - Include diagram_id and bundle_type from each DiagramRef
  - [x] 2.4 Add entities[] and diagrams[] to architectureContext in return object
    - Maintain legacy entityIds and diagramIds for backward compatibility
    - architectureContext now contains: { entityIds, diagramIds, entities, diagrams }
  - [x] 2.5 Ensure buildContext() tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify payload structure matches spec requirements

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- buildContext() produces structured entities[] with depth and bundle_type
- Legacy entityIds/diagramIds arrays maintained for backward compatibility

### Gateway Layer

#### Task Group 3: Entity Type Normalization for Structured Entities
**Dependencies:** Task Group 1

- [x] 3.0 Complete entity_type normalization for structured entities
  - [x] 3.1 Write 4 focused tests for entity_type normalization in expand-resolve path
    - Test normalizeEntityType() converts physical_data_entities to physicalDataEntities
    - Test normalizeEntityType() converts logical_data_entities to logicalDataEntities
    - Test entities[] in expandResolveContext() request has normalized entity_types
    - Test camelCase entity_types pass through unchanged
  - [x] 3.2 Create normalizeEntityType() helper function in `gateway/src/services/architectureModelClient.ts`
    - Reuse ENTITY_TYPE_CANONICAL_MAP for snake_case to camelCase conversion
    - Accept entity_type string, return normalized string
    - Log debug warning for unmapped snake_case types
  - [x] 3.3 Apply entity_type normalization before calling expandResolveContext()
    - In tryResolveImplementContextWithBundles(), normalize entities[] before API call
    - Map each entity's entity_type through normalizeEntityType()
    - Create new normalized entities array for the request
  - [x] 3.4 Ensure entity_type normalization tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify normalization applies to structured entities array

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- physical_data_entities normalized to physicalDataEntities in expand-resolve requests
- Existing ENTITY_TYPE_CANONICAL_MAP reused for consistency

#### Task Group 4: PDE Attribute Validation in Gateway
**Dependencies:** Task Group 3

- [x] 4.0 Complete PDE attribute validation in expand-resolve response
  - [x] 4.1 Write 4 focused tests for PDE attribute validation
    - Test validation passes when physicalDataEntities have relevant_fields.attributes
    - Test validation logs error when attributes missing for PDEs
    - Test warning marker added to prompt when attributes missing
    - Test processing continues even when validation fails (graceful degradation)
  - [x] 4.2 Create validatePdeAttributes() function in `gateway/src/services/architectureModelClient.ts`
    - Accept ExpandResolveResponseDto
    - Filter resolved_entities for entity_type === 'physicalDataEntities'
    - Check each PDE for relevant_fields.attributes existence
    - Return { valid: boolean, missingEntityIds: string[] }
  - [x] 4.3 Call validatePdeAttributes() after receiving expand-resolve response
    - In tryResolveImplementContextWithBundles() after successful expandResolveContext() call
    - Log error with entity IDs if validation fails
    - Continue processing (do not throw)
  - [x] 4.4 Add warning marker mechanism for prompt builder
    - Return validation result from tryResolveImplementContextWithBundles()
    - Update return type to include attributeValidation field
    - Prompt builder can check and add [WARNING: attributes missing] marker
  - [x] 4.5 Ensure PDE attribute validation tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify validation and warning mechanism works correctly

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- PDEs with missing attributes are logged for debugging
- Warning marker mechanism available for prompt builder
- Processing continues gracefully when attributes missing

### Model Service Layer

#### Task Group 5: Add depth Field to EntityBundleSelection DTO
**Dependencies:** None

- [x] 5.0 Complete depth field addition to EntityBundleSelection
  - [x] 5.1 Write 3 focused tests for depth field in DTO
    - Test EntityBundleSelection deserializes depth field from JSON
    - Test depth=null deserializes correctly (defaults to null, service treats as 1)
    - Test depth=2 deserializes and is accessible
  - [x] 5.2 Extend EntityBundleSelection.java record with depth field
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/EntityBundleSelection.java`
    - Add `@JsonProperty("depth") Integer depth` parameter to record
    - Integer type (nullable) to allow absence/null in JSON
  - [x] 5.3 Add accessor logic for defaulting depth to 1
    - Create helper method or use in service: depth != null ? depth : 1
    - Ensure null depth is treated as depth=1 for backward compatibility
  - [x] 5.4 Ensure EntityBundleSelection tests pass
    - Run ONLY the 3 tests written in 5.1
    - Verify JSON deserialization works correctly

**Acceptance Criteria:**
- The 3 tests written in 5.1 pass
- EntityBundleSelection accepts optional depth field
- Null/absent depth defaults to 1 behavior

#### Task Group 6: Depth-Aware Expansion in ContextBundleExpansionService
**Dependencies:** Task Group 5

- [x] 6.0 Complete depth-aware expansion logic
  - [x] 6.1 Write 5 focused tests for depth-aware expansion
    - Test depth=1 expands direct relationships only (existing behavior)
    - Test depth=2 expands relationships to 2-hop neighbors
    - Test depth=2 applies truncation limits to prevent unbounded expansion
    - Test attributes returned for PDEs at depth >= 1
    - Test depth=null treated as depth=1
  - [x] 6.2 Pass depth from EntityBundleSelection to expandEntity() method
    - Modify expandEntity() signature to accept depth parameter
    - Extract depth from selection, default to 1 if null
  - [x] 6.3 Update expandDataEntityWithAttributesAndRelationships() for depth=2
    - Add depth parameter to method signature
    - For depth=1: existing behavior (direct relationships)
    - For depth=2: traverse one more hop from each related entity
    - Apply per-entity expansion limit (e.g., max 10 related per hop) to prevent explosion
  - [x] 6.4 Ensure attributes are populated in resolveEntity() for PDEs
    - Verify ImplementContextResolutionService.resolveEntity() populates relevant_fields.attributes
    - Attributes should include: name, type, pk (when available), nullable (when available)
    - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java`
  - [x] 6.5 Ensure depth-aware expansion tests pass
    - Run ONLY the 5 tests written in 6.1
    - Verify depth=2 traversal works with truncation

**Acceptance Criteria:**
- The 5 tests written in 6.1 pass
- depth=1 returns direct relationships (backward compatible)
- depth=2 returns 2-hop neighbors with truncation limits
- PDEs include attributes in resolved summaries

### Integration Testing

#### Task Group 7: Test Review and E2E Integration Tests
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and add E2E integration tests
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4 tests written by frontend (Task 1.1)
    - Review the 4 tests written by frontend (Task 2.1)
    - Review the 4 tests written by gateway (Task 3.1)
    - Review the 4 tests written by gateway (Task 4.1)
    - Review the 3 tests written by model-service (Task 5.1)
    - Review the 5 tests written by model-service (Task 6.1)
    - Total existing tests: approximately 24 tests
  - [x] 7.2 Write E2E integration test: chat payload contains structured entities
    - Frontend sends architectureContext.entities[] with depth and bundle_type
    - Gateway receives and processes the structured entities
    - Mock model-service returns expected expand-resolve response
  - [x] 7.3 Write E2E integration test: expand-resolve path used when entities[] provided
    - Gateway calls expandResolveContext() when entities[] has bundle_type items
    - Gateway falls back to resolveImplementContext() when no bundle_type present
  - [x] 7.4 Write E2E integration test: PDEs include attributes at depth=1
    - Model service returns attributes for physicalDataEntities
    - Gateway validates attributes present
    - Prompt builder includes attribute lists in context
  - [x] 7.5 Write E2E test: refine chat with PDEs shows attributes in prompt
    - Full flow: frontend selects PDE with bundle_type=entity_with_attributes_and_relationships
    - Gateway routes to expand-resolve
    - Model service returns PDE with attributes
    - Prompt includes entity name and attribute list
  - [x] 7.6 Run all feature-specific tests
    - Run all tests from Task Groups 1-6 plus new E2E tests (7.2-7.5)
    - Expected total: approximately 28 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All 28 feature-specific tests pass
- E2E flow verified from frontend to prompt generation
- PDEs with depth >= 1 include attribute lists in LLM prompt

## Execution Order

Recommended implementation sequence:

1. **Frontend Types (Task Group 1)** - No dependencies, can start immediately
2. **Model Service DTO (Task Group 5)** - No dependencies, can start in parallel with Task Group 1
3. **Gateway Normalization (Task Group 3)** - Depends on Task Group 1
4. **Frontend buildContext (Task Group 2)** - Depends on Task Group 1
5. **Gateway Validation (Task Group 4)** - Depends on Task Group 3
6. **Model Service Expansion (Task Group 6)** - Depends on Task Group 5
7. **Integration Testing (Task Group 7)** - Depends on all previous groups

**Parallel Execution Opportunities:**
- Task Groups 1 and 5 can be developed in parallel (no dependencies)
- Task Groups 3 and 2 can be developed in parallel (both depend on Task Group 1)

## Key Files to Modify

### Frontend
- `frontend/src/api/chatApi.ts` - Type definitions (EntityBundleSelection, DiagramBundleSelection, ArchitectureContextPayload)
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - buildContext() enhancement

### Gateway
- `gateway/src/services/architectureModelClient.ts` - Entity type normalization, PDE validation, expand-resolve call updates

### Model Service
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/EntityBundleSelection.java` - Add depth field
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ContextBundleExpansionService.java` - Depth-aware expansion
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ImplementContextResolutionService.java` - Ensure PDE attributes populated

## Existing Code to Leverage

- `frontend/src/utils/contextStorage.ts` - EntityRef already has bundle_type and depth fields
- `gateway/src/services/architectureModelClient.ts` - ENTITY_TYPE_CANONICAL_MAP for normalization
- `gateway/src/types/chat.ts` - Existing EntityBundleSelection and DiagramBundleSelection types
- `architecture-model-service/.../ContextBundleExpansionService.java` - Existing expansion methods to extend

## Implementation Summary

All task groups have been completed:

### Task Group 1: Frontend Type Extensions
- Added `EntityBundleSelection` and `DiagramBundleSelection` interfaces to `frontend/src/api/chatApi.ts`
- Extended `ArchitectureContextPayload` with optional `entities[]` and `diagrams[]` arrays
- Maintained backward compatibility with legacy `entityIds`/`diagramIds` arrays
- Created tests in `frontend/src/__tests__/context-bundle-depth-wiring-frontend-types.test.ts`

### Task Group 2: Frontend buildContext() Enhancement
- Updated `buildContext()` in `ImplementationAssistantPanel.tsx` to construct `entities[]` and `diagrams[]` arrays
- Maps `contextState.entity_refs` to `EntityBundleSelection` objects with `depth` defaulting to 1
- Maps `contextState.diagram_refs` to `DiagramBundleSelection` objects
- Created tests in `frontend/src/__tests__/context-bundle-depth-wiring-buildContext.test.ts`

### Task Group 3: Gateway Entity Type Normalization
- Created `normalizeEntityType()` function in `architectureModelClient.ts`
- Created `normalizeEntitiesForExpandResolve()` function for bulk normalization
- Applied normalization in `expandResolveContext()` before API call
- Reuses existing `ENTITY_TYPE_CANONICAL_MAP` for snake_case to camelCase conversion

### Task Group 4: Gateway PDE Attribute Validation
- Created `validatePdeAttributes()` function to check PDEs have `relevant_fields.attributes`
- Called after `expandResolveContext()` response to validate and log warnings
- Returns `{ valid, missingEntityIds }` for prompt builder use
- Continues processing gracefully when validation fails

### Task Group 5: Model Service EntityBundleSelection DTO
- Added `depth` field with `@JsonProperty("depth") Integer depth` to `EntityBundleSelection.java`
- Added `effectiveDepth()` helper method that returns depth or 1 if null
- Created tests in `architecture-model-service/src/test/java/.../EntityBundleSelectionDepthTest.java`

### Task Group 6: Model Service Depth-Aware Expansion
- Updated `expandEntity()` to extract and pass depth from `EntityBundleSelection`
- Updated `expandDataEntityWithAttributesAndRelationships()` to accept depth parameter
- Implemented multi-hop expansion for depth=2 with truncation limits
- Added `maxDepth2Entities` configuration property (default 100)
- Created tests in `architecture-model-service/src/test/java/.../ContextBundleExpansionServiceDepthTest.java`

### Task Group 7: Integration Testing
- Created E2E integration tests in `gateway/src/__tests__/context-bundle-depth-wiring-e2e.test.ts`
- Verified entity type normalization flow from frontend to backend
- Verified depth parameter preservation through the flow
- Verified PDE attribute validation for LLM prompt inclusion
- All 33 tests passing (11 frontend + 22 gateway)
