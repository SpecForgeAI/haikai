# Task Breakdown: Sequence Diagram Message Exchange Collection Entity Display

## Overview
Total Tasks: 5 Task Groups, 27 Sub-tasks

This feature enables Sequence Diagram message exchanges to indicate that a referenced data entity payload represents a collection (list/array/set) rather than a single instance. When enabled, the diagram renders the label as `Collection<EntityName>` instead of just `EntityName`.

## Task List

### Backend Layer

#### Task Group 1: Backend Model Update
**Dependencies:** None

- [x] 1.0 Complete backend DTO update
  - [x] 1.1 Write 3 focused tests for SequenceMessageDto serialization
    - Test JSON serialization with `is_collection: true`
    - Test JSON deserialization with `is_collection: null` (backward compatibility)
    - Test JSON deserialization with missing `is_collection` field (backward compatibility)
  - [x] 1.2 Add `isCollection` field to SequenceMessageDto.java
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java`
    - Add `@JsonProperty("is_collection") Boolean isCollection` to record
    - Use `Boolean` (nullable) rather than `boolean` (primitive) for backward compatibility
  - [x] 1.3 Verify JSON serialization uses snake_case
    - Confirm `is_collection` appears in JSON output
    - Confirm null values are handled gracefully
  - [x] 1.4 Ensure backend tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify backward compatibility with existing data

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- `is_collection` field serializes/deserializes correctly
- Missing or null values treated as `false`
- No breaking changes to existing API consumers

---

### Frontend Types Layer

#### Task Group 2: Frontend Type Definitions
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend type updates
  - [x] 2.1 Write 2 focused tests for type compatibility
    - Test that SequenceMessageRef accepts optional `is_collection`
    - Test that SequenceMessage accepts optional `is_collection`
  - [x] 2.2 Update SequenceMessageRef interface in typedContent.ts
    - File: `frontend/src/types/typedContent.ts`
    - Add `is_collection?: boolean` property (optional, defaults to false if missing)
  - [x] 2.3 Update SequenceMessage interface in sequenceDiagram.ts
    - File: `frontend/src/types/sequenceDiagram.ts`
    - Add `is_collection?: boolean` property (optional, defaults to false if missing)
  - [x] 2.4 Verify TypeScript compilation succeeds
    - Run `tsc --noEmit` to confirm no type errors
    - Verify existing code using these interfaces still compiles
  - [x] 2.5 Ensure type tests pass
    - Run ONLY the 2 tests written in 2.1
    - Verify backward compatibility with existing code

**Acceptance Criteria:**
- The 2 tests written in 2.1 pass
- TypeScript compilation succeeds
- All existing usages of SequenceMessageRef and SequenceMessage remain valid
- Optional property correctly typed as `boolean | undefined`

---

### Frontend Modal Layer

#### Task Group 3: AddMessageExchangeDrawer Modal Updates
**Dependencies:** Task Group 2

- [x] 3.0 Complete modal form updates
  - [x] 3.1 Write 6 focused tests for checkbox behavior
    - Test checkbox visible when mode=reference and refKind=PhysicalEntity
    - Test checkbox visible when mode=reference and refKind=LogicalEntity
    - Test checkbox hidden when mode=label
    - Test checkbox hidden when refKind=Method
    - Test requestIsCollection resets when refKind changes to non-entity type
    - Test is_collection=true included in submitted message when checked
  - [x] 3.2 Extend FormData interface with collection fields
    - File: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
    - Add `requestIsCollection: boolean` to FormData interface
    - Add `responseIsCollection: boolean` to FormData interface
    - Update INITIAL_FORM_DATA with `requestIsCollection: false`
    - Update INITIAL_FORM_DATA with `responseIsCollection: false`
  - [x] 3.3 Add helper constants and functions
    - Add `ENTITY_REF_KINDS_SUPPORTING_COLLECTION` constant array with `['PhysicalEntity', 'LogicalEntity']`
    - Add `supportsCollectionFlag(refKind: string | undefined): boolean` helper function
  - [x] 3.4 Add checkbox visibility computed values
    - Add `showRequestIsCollectionCheckbox` useMemo hook
    - Add `showResponseIsCollectionCheckbox` useMemo hook
    - Visibility depends on mode=reference AND refKind in [PhysicalEntity, LogicalEntity]
  - [x] 3.5 Update handleFieldChange for reset behavior
    - Reset `requestIsCollection` to false when `requestRefKind` changes to non-entity type
    - Reset `requestIsCollection` to false when `requestMode` changes to 'label'
    - Reset `responseIsCollection` to false when `responseRefKind` changes to non-entity type
    - Reset `responseIsCollection` to false when `responseMode` changes to 'label'
  - [x] 3.6 Add Request Is Collection checkbox UI
    - Add checkbox inside Request Content section, below Reference dropdown
    - Only render when `showRequestIsCollectionCheckbox` is true
    - Label: "Is Collection?"
    - Add `data-testid="field-requestIsCollection"`
  - [x] 3.7 Add Response Is Collection checkbox UI
    - Add checkbox inside Response Content section, below Reference dropdown
    - Only render when `showResponseIsCollectionCheckbox` is true
    - Label: "Is Collection?"
    - Add `data-testid="field-responseIsCollection"`
  - [x] 3.8 Update handleSubmit to include is_collection
    - Include `is_collection: true` on request message when `requestIsCollection` is true AND refKind supports it
    - Include `is_collection: true` on response message when `responseIsCollection` is true AND refKind supports it
    - Omit `is_collection` field entirely when false (do not include `is_collection: false`)
  - [x] 3.9 Ensure modal tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify checkbox visibility logic works correctly
    - Verify reset behavior works correctly
    - Verify submit includes correct data

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- Checkbox appears only for PhysicalEntity/LogicalEntity in Reference mode
- Checkbox defaults to unchecked
- Changing reference type resets checkbox to unchecked
- Submitted messages include `is_collection: true` only when checkbox is checked

---

### Frontend Renderer Layer

#### Task Group 4: SequenceDiagramRenderer Label Formatting
**Dependencies:** Task Group 2

- [x] 4.0 Complete renderer label updates
  - [x] 4.1 Write 6 focused tests for label formatting
    - Test PhysicalEntity with is_collection=true returns "Collection<EntityName>"
    - Test PhysicalEntity with is_collection=false returns "EntityName"
    - Test LogicalEntity with is_collection=true returns "Collection<EntityName>"
    - Test Method with is_collection=true still returns "MethodName" (no collection support)
    - Test missing is_collection field returns "EntityName" (backward compatibility)
    - Test entity not found with is_collection=true returns "Collection<ref_id>"
  - [x] 4.2 Add ENTITY_REF_KINDS_SUPPORTING_COLLECTION constant
    - File: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`
    - Define as `const ENTITY_REF_KINDS_SUPPORTING_COLLECTION: MessageRefKind[] = ['PhysicalEntity', 'LogicalEntity']`
  - [x] 4.3 Add supportsCollectionWrapper helper function
    - Function signature: `function supportsCollectionWrapper(refKind: MessageRefKind | string | undefined): boolean`
    - Returns true if refKind is in ENTITY_REF_KINDS_SUPPORTING_COLLECTION
  - [x] 4.4 Add formatEntityLabel helper function
    - Function signature: `function formatEntityLabel(entityName: string, isCollection: boolean | undefined, refKind: MessageRefKind | string | undefined): string`
    - If isCollection=true AND refKind supports collection, return `Collection<${entityName}>`
    - Otherwise return entityName unchanged
  - [x] 4.5 Update resolveMessageLabel function
    - Apply `formatEntityLabel()` when resolving entity name from metaModel
    - Apply `formatEntityLabel()` to fallback ref_id when entity not found
    - Do NOT apply collection formatting to label_text mode
    - Preserve existing fallback behavior for missing label information
  - [x] 4.6 Ensure renderer tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify collection formatting works correctly
    - Verify backward compatibility with existing messages

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- Collection<EntityName> format applied for PhysicalEntity/LogicalEntity with is_collection=true
- Non-entity references (Method, Event, Interface, etc.) ignore is_collection flag
- Label text mode unaffected by is_collection
- Existing messages without is_collection render normally

---

### Testing Layer

#### Task Group 5: Test Review and Integration Tests
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 3 tests written by backend-engineer (Task 1.1)
    - Review the 8 tests written for types (Task 2.1) - actual count higher than estimated
    - Review the 7 tests written for modal (Task 3.1) - actual count higher than estimated
    - Review the 20 tests written for renderer (Task 4.1) - actual count higher than estimated
    - Total existing tests: 38 tests (3 backend + 8 types + 7 modal + 20 renderer)
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identified need for integration between modal submission and diagram rendering
    - Identified need for backward compatibility scenarios
    - Identified need for round-trip persistence verification
  - [x] 5.3 Write up to 8 additional integration tests
    - File: `frontend/src/__tests__/SequenceDiagramCollection.integration.test.tsx` (new file)
    - Test: renders Collection<Order> label for PhysicalEntity with is_collection=true
    - Test: renders Collection<Customer> label for LogicalEntity with is_collection=true
    - Test: renders Order label for PhysicalEntity with is_collection=false
    - Test: handles mixed messages (one collection, one not) in same exchange
    - Test: backward compatibility - existing messages without is_collection render normally
    - Test: full flow - create message with collection flag, verify it renders correctly
    - Test: response message with collection flag independent of request
    - Test: round-trip persistence - save and reload diagram preserves is_collection
    - **14 integration tests written** (within expanded test scope)
  - [x] 5.4 Run feature-specific tests only
    - Ran backend tests: 3 tests pass (SequenceMessageDtoSerializationTest)
    - Ran frontend tests: 49 tests pass (8 types + 7 modal + 20 renderer + 14 integration)
    - Total: 52 feature-specific tests pass
    - All critical workflows verified

**Acceptance Criteria:**
- All feature-specific tests pass (52 tests total: 3 backend + 49 frontend)
- Critical user workflows for collection entity display are covered
- Backward compatibility verified with existing diagram data
- Integration tests added in `SequenceDiagramCollection.integration.test.tsx`

---

## Execution Order

Recommended implementation sequence:

1. **Backend Layer (Task Group 1)** - No dependencies
   - Add is_collection field to SequenceMessageDto.java
   - Verify serialization and backward compatibility

2. **Frontend Types Layer (Task Group 2)** - Depends on Task Group 1
   - Update TypeScript interfaces
   - Verify compilation succeeds

3. **Frontend Renderer Layer (Task Group 4)** - Depends on Task Group 2
   - Can be developed in parallel with Task Group 3
   - Add label formatting helpers
   - Update resolveMessageLabel function

4. **Frontend Modal Layer (Task Group 3)** - Depends on Task Group 2
   - Can be developed in parallel with Task Group 4
   - Add checkbox UI and form state
   - Update submit handler

5. **Testing Layer (Task Group 5)** - Depends on Task Groups 1-4
   - Review all tests
   - Write integration tests
   - Final verification

---

## Files to Modify

| File | Task Group | Change Type |
|------|------------|-------------|
| `architecture-model-service/.../SequenceMessageDto.java` | 1 | Modify |
| `frontend/src/types/typedContent.ts` | 2 | Modify |
| `frontend/src/types/sequenceDiagram.ts` | 2 | Modify |
| `frontend/src/components/.../AddMessageExchangeDrawer.tsx` | 3 | Modify |
| `frontend/src/components/.../SequenceDiagramRenderer.tsx` | 4 | Modify |
| `architecture-model-service/.../SequenceMessageDtoSerializationTest.java` | 1 | Create |
| `frontend/src/__tests__/sequenceMessage.isCollection.types.test.ts` | 2 | Create |
| `frontend/src/__tests__/AddMessageExchangeDrawer.isCollection.test.tsx` | 3 | Create |
| `frontend/src/__tests__/SequenceDiagramRenderer.resolveMessageLabel.test.ts` | 4 | Create |
| `frontend/src/__tests__/SequenceDiagramCollection.integration.test.tsx` | 5 | Create |

---

## Summary

| Task Group | Focus Area | Test Count | Sub-tasks | Status |
|------------|------------|------------|-----------|--------|
| 1 | Backend DTO | 3 | 4 | Complete |
| 2 | Frontend Types | 8 | 5 | Complete |
| 3 | Modal UI | 7 | 9 | Complete |
| 4 | Renderer | 20 | 6 | Complete |
| 5 | Integration | 14 | 4 | Complete |
| **Total** | | **52** | **28** | **Complete** |
