# Task Breakdown: Implement Context Include Relationships and Propagate to Planner Payload

## Overview
Total Tasks: 9 Task Groups (35 sub-tasks)

**Summary:** Persist relationship selections from Context Picker to backend, return on GET, include in chat payload for planner LLM, and display relationship count chip in UI.

## Task List

### Backend Layer (architecture-model-service)

#### Task Group 1: Backend DTO and Entity Changes
**Dependencies:** None
**Estimated Effort:** S (2-3 days)

- [x] 1.0 Complete backend DTO and entity layer for relationship persistence
  - [x] 1.1 Write 4-6 focused tests for DTO serialization and entity mapping
    - Test `RelationshipSelection` record JSON serialization (snake_case)
    - Test `ImplementContextDto` with relationship fields serialization
    - Test `WorkItemImplementContextEntity` JSONB column mapping
    - Test backward-compatible constructor (no relationship fields)
  - [x] 1.2 Create `RelationshipSelection.java` DTO record
    - File: `src/main/java/com/example/architecturemodel/model/dto/RelationshipSelection.java`
    - Fields: `relationship_type`, `relationship_id`, `label`
    - Use `@JsonProperty` annotations with snake_case
    - Follow pattern from `EntitySelection.java` and `DiagramSelection.java`
  - [x] 1.3 Extend `ImplementContextDto.java` with relationship fields
    - File: `src/main/java/com/example/architecturemodel/model/dto/ImplementContextDto.java`
    - Add `selected_relationship_ids: List<String>` (legacy ID field)
    - Add `selected_relationship_selections: List<RelationshipSelection>` (structured)
    - Add backward-compatible constructor defaulting new fields to empty lists
  - [x] 1.4 Extend `WorkItemImplementContextEntity.java` with JSONB columns
    - File: `src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
    - Add `selectedRelationshipIds: List<String>` with `@Type(JsonType.class)`
    - Add `selectedRelationshipSelections: List<RelationshipSelection>` with `@Type(JsonType.class)`
    - Use `@Builder.Default` to initialize as `new ArrayList<>()`
  - [x] 1.5 Create database migration `035-work-item-implement-context-relationships.sql`
    - File: `src/main/resources/db/changelog/sql/035-work-item-implement-context-relationships.sql`
    - Add `selected_relationship_ids JSONB DEFAULT '[]'::jsonb`
    - Add `selected_relationship_selections JSONB DEFAULT '[]'::jsonb`
    - Include COMMENT for column documentation
  - [x] 1.6 Update `db.changelog-master.yaml` to include migration
    - File: `src/main/resources/db/changelog/db.changelog-master.yaml`
    - Add include for `035-work-item-implement-context-relationships.sql`
  - [x] 1.7 Ensure DTO and entity tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify JSON serialization works correctly
    - Verify migration runs successfully

**Acceptance Criteria:**
- `RelationshipSelection` record created with correct JSON annotations
- `ImplementContextDto` extended with relationship fields and backward-compatible constructor
- `WorkItemImplementContextEntity` has JSONB columns with proper Hibernate types
- Migration creates columns with empty array defaults
- Tests from 1.1 pass

---

#### Task Group 2: Backend Service and Controller Changes
**Dependencies:** Task Group 1
**Estimated Effort:** S (2-3 days)

- [x] 2.0 Complete backend service and controller layer for relationship handling
  - [x] 2.1 Write 4-6 focused tests for service and controller methods
    - Test `saveContext()` with relationship parameters persists correctly
    - Test `getContext()` returns relationship fields (empty arrays for null)
    - Test `toDto()` maps entity relationship fields to DTO
    - Test controller PUT accepts relationship fields in request body
    - Test controller GET returns relationship fields in response
  - [x] 2.2 Update `WorkItemImplementContextService.saveContext()` signature
    - File: `src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`
    - Add parameters: `List<String> relationshipIds`, `List<RelationshipSelection> relationshipSelections`
    - Set entity fields from parameters (default to empty ArrayList if null)
  - [x] 2.3 Update `WorkItemImplementContextService.toDto()` method
    - Map `selectedRelationshipIds` and `selectedRelationshipSelections` from entity to DTO
    - Return empty lists (never null) for backward compatibility
  - [x] 2.4 Update `WorkItemImplementContextService.getContext()` method
    - Ensure returned DTO has empty arrays (not null) for relationship fields
  - [x] 2.5 Update `SaveContextRequest` record with relationship fields
    - File: `src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
    - Add `selected_relationship_ids: List<String>` with `@JsonProperty`
    - Add `selected_relationship_selections: List<RelationshipSelection>` with `@JsonProperty`
  - [x] 2.6 Update controller to pass relationship fields to service
    - Extract relationship fields from request body
    - Pass to `saveContext()` method call
  - [x] 2.7 Ensure service and controller tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify save/retrieve roundtrip works
    - Verify backward compatibility with requests missing relationship fields

**Acceptance Criteria:**
- Service saves and retrieves relationship selections correctly
- Controller accepts relationship fields in PUT request
- GET response includes relationship fields (empty arrays if none)
- Backward compatibility maintained for existing clients
- Tests from 2.1 pass

---

#### Task Group 3: Backend Unit Tests
**Dependencies:** Task Groups 1 and 2
**Estimated Effort:** S (2-3 days)

- [x] 3.0 Complete backend unit test coverage for relationship functionality
  - [x] 3.1 Add service tests for relationship save/retrieve
    - File: `src/test/java/com/example/architecturemodel/service/WorkItemImplementContextServiceTest.java`
    - Test saving context with multiple relationship selections
    - Test retrieving context returns all relationship selections
    - Test empty relationships default to empty arrays (not null)
  - [x] 3.2 Add controller tests for relationship endpoints
    - File: `src/test/java/com/example/architecturemodel/controller/WorkItemImplementContextControllerTest.java`
    - Test PUT with relationship fields returns 200 OK
    - Test GET returns relationship fields in response body
    - Test JSON serialization uses snake_case for relationship fields
  - [x] 3.3 Add backward compatibility tests
    - Test PUT without relationship fields succeeds (defaults to empty)
    - Test existing contexts without relationship columns return empty arrays
    - Test DTO constructor backward compatibility
  - [x] 3.4 Ensure all backend tests pass
    - Run all tests from 1.1, 2.1, 3.1, 3.2, 3.3
    - Verify no regressions in existing functionality
    - Expected total: approximately 12-18 backend tests

**Acceptance Criteria:**
- All backend unit tests pass
- Service tests verify CRUD operations for relationships
- Controller tests verify API contract
- Backward compatibility verified
- No test failures in existing tests

---

### Frontend Layer

#### Task Group 4: Frontend API Client Changes
**Dependencies:** Task Groups 1-3 (backend must be complete)
**Estimated Effort:** S (2-3 days)

- [x] 4.0 Complete frontend API client changes for relationship handling
  - [x] 4.1 Write 4-6 focused tests for API client functions
    - Test `parseRelationshipRef()` parses "type::id" format correctly
    - Test `parseRelationshipRef()` uses label from selections when available
    - Test `relationshipRefToString()` serializes to "type::id" format
    - Test `relationshipRefToSelection()` creates correct DTO structure
    - Test `mapDtoToContextState()` populates `relationship_refs` array
  - [x] 4.2 Add `RelationshipSelectionDto` interface
    - File: `frontend/src/api/implementContextApi.ts`
    - Fields: `relationship_type`, `relationship_id`, `label`
    - Match backend `RelationshipSelection` structure
  - [x] 4.3 Extend `ImplementContextDto` interface
    - Add `selected_relationship_ids?: string[]`
    - Add `selected_relationship_selections?: RelationshipSelectionDto[] | null`
  - [x] 4.4 Implement `parseRelationshipRef()` function
    - Parse "relationshipType::relationshipId" format
    - Look up label from structured selections if available
    - Return `RelationshipRef` with kind='RELATIONSHIP'
    - Handle fallback for simple ID format
  - [x] 4.5 Implement `relationshipRefToString()` function
    - Convert `RelationshipRef` to "type::id" storage format
  - [x] 4.6 Implement `relationshipRefToSelection()` function
    - Convert `RelationshipRef` to `RelationshipSelectionDto`
  - [x] 4.7 Update `mapDtoToContextState()` function
    - Map `selected_relationship_ids` through `parseRelationshipRef()`
    - Populate `relationship_refs` in returned `ContextState`
    - Handle undefined/null with empty array fallback
  - [x] 4.8 Update `saveImplementContext()` request body
    - Add `selected_relationship_ids` mapped from `relationship_refs`
    - Add `selected_relationship_selections` mapped from `relationship_refs`
    - Use `|| []` pattern for undefined `relationship_refs`
  - [x] 4.9 Ensure API client tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify parsing and serialization roundtrip
    - Verify empty/null handling

**Acceptance Criteria:**
- All relationship parsing/serialization functions implemented
- `mapDtoToContextState()` correctly populates `relationship_refs`
- `saveImplementContext()` includes relationship fields in request
- Empty/null handling follows existing patterns
- Tests from 4.1 pass

---

#### Task Group 5: Frontend Chat Payload Changes
**Dependencies:** Task Group 4
**Estimated Effort:** S (2-3 days)

- [x] 5.0 Complete frontend chat payload changes for relationship propagation
  - [x] 5.1 Write 3-5 focused tests for chat payload construction
    - Test `buildContext()` includes `relationshipIds` array
    - Test `buildContext()` includes `relationships` array with resolved details
    - Test empty relationships handled gracefully (empty arrays, not undefined)
    - Test relationship format matches gateway expectations
  - [x] 5.2 Add `RelationshipContextPayload` interface
    - File: `frontend/src/api/chatApi.ts`
    - Fields: `relationship_type`, `relationship_id`, `label`
    - Add JSDoc comment referencing spec
  - [x] 5.3 Extend `ArchitectureContextPayload` interface
    - Add `relationshipIds?: string[]`
    - Add `relationships?: RelationshipContextPayload[]`
    - Add JSDoc comments referencing spec
  - [x] 5.4 Update `buildContext()` in `ImplementationAssistantPanel.tsx`
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Construct `relationshipIds` from `contextState.relationship_refs`
    - Format as "relationshipType::relationshipId"
    - Construct `relationships` array with resolved details (id, type, label)
    - Add to `architectureContext` return object
    - Update `useCallback` dependency array if needed
  - [x] 5.5 Ensure chat payload tests pass
    - Run ONLY the 3-5 tests written in 5.1
    - Verify payload structure matches gateway types
    - Verify empty state handling

**Acceptance Criteria:**
- `RelationshipContextPayload` interface added to chatApi.ts
- `ArchitectureContextPayload` extended with relationship fields
- `buildContext()` includes relationship data in architectureContext
- Payload format matches gateway expectations
- Tests from 5.1 pass

---

#### Task Group 6: Frontend UI Changes (Relationship Chip)
**Dependencies:** Task Group 4
**Estimated Effort:** XS (1 day)

- [x] 6.0 Complete frontend UI changes for relationship count display
  - [x] 6.1 Write 2-3 focused tests for relationship chip display
    - Test chip displays correct count when relationships > 0
    - Test chip hidden when relationship count is 0
    - Test plural/singular label ("1 Relationship" vs "2 Relationships")
  - [x] 6.2 Add relationship count chip to context summary
    - File: `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` (already implemented)
    - Follow existing pattern from entity/diagram chips
    - Add `data-testid="relationship-count-chip"` for testing
    - Conditionally render only when count > 0
  - [x] 6.3 Add CSS styles for relationship chip
    - Use existing `relationshipChip` class in FeatureDefinitionPanel.module.css
    - Match visual style of entity/diagram chips
  - [x] 6.4 Ensure UI tests pass
    - Run ONLY the 2-3 tests written in 6.1
    - Verify visual appearance matches existing chips

**Acceptance Criteria:**
- Relationship count chip displays when relationships selected
- Chip hidden when count is 0
- Correct singular/plural label
- Visual style matches entity/diagram chips
- Tests from 6.1 pass

---

### Gateway Layer

#### Task Group 7: Gateway Type Updates
**Dependencies:** None (can run in parallel with Task Groups 1-3)
**Estimated Effort:** XS (1 day)

- [x] 7.0 Complete gateway type updates for relationship pass-through
  - [x] 7.1 Write 2-3 focused tests for gateway type handling
    - Test `ArchitectureContext` accepts relationship fields
    - Test missing relationship fields default to undefined (not error)
    - Test relationship data passes through to prompt builder
  - [x] 7.2 Add `RelationshipContextPayload` interface
    - File: `gateway/src/types/chat.ts`
    - Fields: `relationship_type`, `relationship_id`, `label`
    - Match frontend interface exactly
  - [x] 7.3 Extend `ArchitectureContext` interface
    - Add `relationshipIds?: string[]`
    - Add `relationships?: RelationshipContextPayload[]`
    - Add JSDoc comments referencing spec
  - [x] 7.4 Verify pass-through in chat route
    - File: `gateway/src/routes/chat.ts`
    - Confirm `architectureContext` passed through without modification
    - No code changes expected (verification only)
  - [x] 7.5 Update `promptBuilder.ts` for relationship formatting (if needed)
    - File: `gateway/src/services/promptBuilder.ts`
    - Add relationship section to context prompt if not auto-included
    - Format: "## User-Selected Relationships" section
    - Order before auto-discovered `resolved_relationships[]`
  - [x] 7.6 Ensure gateway tests pass
    - Run ONLY the 2-3 tests written in 7.1
    - Verify type compatibility with frontend payload

**Acceptance Criteria:**
- Gateway types match frontend payload structure
- Relationship data passes through to planner
- Prompt includes user-selected relationships if applicable
- No breaking changes to existing functionality
- Tests from 7.1 pass

---

### Testing Layer

#### Task Group 8: Frontend Unit Tests
**Dependencies:** Task Groups 4-6
**Estimated Effort:** S (2-3 days)

- [x] 8.0 Complete frontend unit test coverage for relationship functionality
  - [x] 8.1 Create `implementContextApi.relationships.test.ts`
    - File: `frontend/src/__tests__/implementContextApi.relationships.test.ts`
    - Test `parseRelationshipRef()` with various input formats
    - Test `relationshipRefToString()` serialization
    - Test `relationshipRefToSelection()` conversion
    - Test `mapDtoToContextState()` with relationship data
    - Test `saveImplementContext()` request body structure
    - Test empty/null relationship handling
  - [x] 8.2 Create `ImplementationAssistantPanel.relationships.test.tsx`
    - File: `frontend/src/__tests__/ImplementationAssistantPanel.relationships.test.tsx`
    - Test `buildContext()` includes relationshipIds
    - Test `buildContext()` includes relationships array
    - Test relationship format in architectureContext
    - Test empty relationship state handling
  - [x] 8.3 Add relationship chip display tests
    - Test chip renders with correct count
    - Test chip hidden when count is 0
    - Test accessibility attributes
  - [x] 8.4 Ensure all frontend unit tests pass
    - Run all tests from 4.1, 5.1, 6.1, 8.1, 8.2, 8.3
    - Verify no regressions in existing tests
    - Expected total: approximately 15-20 frontend tests

**Acceptance Criteria:**
- All frontend unit tests pass
- API client functions fully tested
- buildContext() relationship handling tested
- UI chip display tested
- No test failures in existing tests

---

#### Task Group 9: Integration Tests
**Dependencies:** Task Groups 1-8 (all implementation complete)
**Estimated Effort:** S (2-3 days)

- [x] 9.0 Complete integration test coverage for end-to-end relationship flow
  - [x] 9.1 Create `implement-context-relationships.integration.test.ts`
    - File: `frontend/src/__tests__/implement-context-relationships.integration.test.ts`
    - Test full save/load roundtrip with relationships
    - Mock backend API responses with relationship data
    - Verify ContextState correctly populated after load
  - [x] 9.2 Add save/load roundtrip test
    - Save context with entity, diagram, and relationship selections
    - Load context and verify all selections rehydrated
    - Verify relationship_refs matches original data
  - [x] 9.3 Add chat payload verification test
    - Trigger chat request with relationship context
    - Verify architectureContext includes relationshipIds
    - Verify architectureContext includes relationships array
    - Verify format matches gateway expectations
  - [x] 9.4 Add rehydration test
    - Simulate page reload scenario
    - Load persisted context from backend
    - Verify UI state reflects persisted relationships
    - Verify relationship chip displays correct count
  - [x] 9.5 Add backward compatibility integration test
    - Load context saved before relationship feature
    - Verify no errors with missing relationship fields
    - Verify relationship_refs defaults to empty array
  - [x] 9.6 Run full feature test suite
    - Run ALL tests related to this feature (Groups 1-8 plus 9.1-9.5)
    - Expected total: approximately 30-40 tests
    - Verify end-to-end flow works correctly
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All integration tests pass
- Save/load roundtrip verified
- Chat payload verified
- Rehydration verified
- Backward compatibility verified
- Feature is production-ready

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: Backend (can run in parallel with Gateway)
  Task Group 1: Backend DTO and Entity Changes
  Task Group 2: Backend Service and Controller Changes
  Task Group 3: Backend Unit Tests

Phase 2: Gateway (can run in parallel with Phase 1)
  Task Group 7: Gateway Type Updates

Phase 3: Frontend (depends on Phase 1 and 2)
  Task Group 4: Frontend API Client Changes
  Task Group 5: Frontend Chat Payload Changes
  Task Group 6: Frontend UI Changes (Relationship Chip)
  Task Group 8: Frontend Unit Tests

Phase 4: Verification (depends on all above)
  Task Group 9: Integration Tests
```

**Parallel Execution Opportunities:**
- Task Groups 1-3 (Backend) can run in parallel with Task Group 7 (Gateway)
- Task Groups 4, 5, and 6 can be developed in parallel once backend is ready
- Task Group 8 should follow the respective implementation groups

---

## Files Summary

### New Files
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/RelationshipSelection.java`
- `architecture-model-service/src/main/resources/db/changelog/sql/035-work-item-implement-context-relationships.sql`
- `frontend/src/__tests__/implementContextApi.relationships.test.ts`
- `frontend/src/__tests__/implement-context-relationships.integration.test.ts`

### Modified Files
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementContextDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
- `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`
- `architecture-model-service/src/test/java/com/example/architecturemodel/service/WorkItemImplementContextServiceTest.java`
- `frontend/src/api/implementContextApi.ts`
- `frontend/src/api/chatApi.ts`
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- `gateway/src/types/chat.ts`

---

## References

- Existing patterns: `EntitySelection.java`, `DiagramSelection.java`
- Context storage types: `frontend/src/utils/contextStorage.ts`
- Context picker: `frontend/src/components/ProductView/ContextPickerModal.tsx`
- Implement context API: `frontend/src/api/implementContextApi.ts`
- Chat API types: `frontend/src/api/chatApi.ts`, `gateway/src/types/chat.ts`
