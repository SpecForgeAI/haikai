# Task Breakdown: Typed Diagram Persistence API Serialization

## Overview
Total Tasks: 11

This specification fixes typed diagram content persistence by adding deterministic snake_case/camelCase key mapping at the frontend API boundary. The fix ensures `typed_content` from the backend is mapped to `typedContent` on load, and `typedContent` is mapped back to `typed_content` on save.

## Task List

### Utility Layer

#### Task Group 1: Create modelSerialization.ts Utility Module
**Dependencies:** None

- [x] 1.0 Complete modelSerialization.ts utility module
  - [x] 1.1 Write 3-4 focused unit tests for serialization functions
    - Test `normalizeModelFromApi` maps `typed_content` to `typedContent`
    - Test `normalizeModelFromApi` removes `typed_content` key after copying
    - Test `prepareModelForApiSave` maps `typedContent` to `typed_content`
    - Test `prepareModelForApiSave` removes `typedContent` key after copying
  - [x] 1.2 Create `frontend/src/api/modelSerialization.ts` file
    - Import `ArchitectureModel` from `../types/model`
    - Import `TypedContentEnvelope` from `../types/typedContent`
    - Export `normalizeModelFromApi` and `prepareModelForApiSave` functions
  - [x] 1.3 Implement `normalizeModelFromApi(rawModel: any): ArchitectureModel`
    - Deep clone input to avoid mutation
    - Iterate over `rawModel.diagrams` array
    - For each diagram: if `typedContent` is undefined and `typed_content` is present, copy `typed_content` to `typedContent`
    - Delete `typed_content` from each diagram after copying
    - Return properly typed ArchitectureModel
    - Reference pattern: `frontend/src/utils/fileOperations.ts` lines 114-148 (`parseTypedContent` function)
  - [x] 1.4 Implement `prepareModelForApiSave(model: ArchitectureModel): any`
    - Create deep clone using `JSON.parse(JSON.stringify(model))` to avoid app state mutation
    - Iterate over cloned `payload.diagrams` array
    - For each diagram: if `typedContent` is present, copy to `typed_content`
    - Delete `typedContent` from each diagram in payload
    - Return payload object ready for API submission
  - [x] 1.5 Ensure utility tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify both functions handle edge cases (empty diagrams array, undefined typedContent)

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- `normalizeModelFromApi` correctly maps snake_case to camelCase keys
- `prepareModelForApiSave` correctly maps camelCase to snake_case keys
- Neither function mutates its input object
- Both functions handle empty/undefined diagrams gracefully

### API Integration Layer

#### Task Group 2: Integrate with modelApi.ts
**Dependencies:** Task Group 1

- [x] 2.0 Complete API integration
  - [x] 2.1 Write 2 focused integration tests for API layer
    - Test `loadModelByFilename` returns model with `typedContent` (not `typed_content`)
    - Test `saveModelByFilename` sends payload with `typed_content` (not `typedContent`)
  - [x] 2.2 Update `loadModelByFilename` in `frontend/src/api/modelApi.ts`
    - Import `normalizeModelFromApi` from `./modelSerialization`
    - After `res.json()`, store in variable `const raw = await res.json()`
    - Call `return normalizeModelFromApi(raw)` before returning
    - Ensures all models loaded from backend have correct camelCase `typedContent`
  - [x] 2.3 Update `saveModelByFilename` in `frontend/src/api/modelApi.ts`
    - Import `prepareModelForApiSave` from `./modelSerialization`
    - Before `JSON.stringify(model)`, call `const payload = prepareModelForApiSave(model)`
    - Update body to `body: JSON.stringify(payload)`
    - Ensures backend receives snake_case `typed_content`
  - [x] 2.4 Ensure API integration tests pass
    - Run ONLY the 2 tests written in 2.1
    - Verify load/save operations use correct key mapping

**Acceptance Criteria:**
- The 2 tests written in 2.1 pass
- `loadModelByFilename` returns model with `typedContent` key
- `saveModelByFilename` sends payload with `typed_content` key
- No changes to function signatures or return types

### Testing Layer

#### Task Group 3: Regression Tests
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete regression test suite
  - [x] 3.1 Create test file at `frontend/src/__tests__/typed-content-serialization.test.ts`
    - Import both serialization functions
    - Import relevant types for test data
  - [x] 3.2 Implement Test A: normalizeModelFromApi mapping
    - Create raw model with `typed_content` (snake_case) on diagrams
    - Call `normalizeModelFromApi`
    - Assert result has `typedContent` (camelCase)
    - Assert result does NOT have `typed_content` key
  - [x] 3.3 Implement Test B: prepareModelForApiSave mapping
    - Create model with `typedContent` (camelCase) on diagrams
    - Call `prepareModelForApiSave`
    - Assert result has `typed_content` (snake_case)
    - Assert result does NOT have `typedContent` key
  - [x] 3.4 Implement Test C: Round-trip sanity test
    - Create raw model with `typed_content`
    - Call `normalizeModelFromApi` to get app model
    - Call `prepareModelForApiSave` on result
    - Assert final payload has `typed_content` with preserved content
    - Verify data integrity through the full cycle
  - [x] 3.5 Run all regression tests
    - Run ONLY the tests in `typed-content-serialization.test.ts`
    - Verify all 3 test scenarios pass

**Acceptance Criteria:**
- All 3 regression tests pass
- Tests verify correct key mapping in both directions
- Round-trip test confirms data integrity
- Tests are focused and do not duplicate Task Group 1 tests

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Utility Module** - Create core serialization functions with focused tests
2. **Task Group 2: API Integration** - Wire serialization into modelApi.ts load/save
3. **Task Group 3: Regression Tests** - Add comprehensive round-trip verification

## Files to Create/Modify

### New Files
- `frontend/src/api/modelSerialization.ts` - Utility module with serialization functions
- `frontend/src/__tests__/typed-content-serialization.test.ts` - Regression test suite

### Modified Files
- `frontend/src/api/modelApi.ts` - Integrate normalization/preparation calls

## Reference Code

### Pattern from fileOperations.ts (lines 114-148)
```typescript
// Try both snake_case (from backend API) and camelCase (from local JSON)
const rawTypedContent = diagram.typed_content ?? diagram.typedContent;
```

### Existing modelApi.ts functions (lines 51-82)
- `loadModelByFilename` - Integration point for `normalizeModelFromApi`
- `saveModelByFilename` - Integration point for `prepareModelForApiSave`

### TypedContentEnvelope interface (typedContent.ts lines 64-71)
```typescript
interface TypedContentEnvelope {
  type: DiagramTypedContentType;
  version: number;
  content: SequenceContent | ERContent | ActivityContent | StateContent | UIScreenContent;
}
```

## Out of Scope Reminders
- No backend changes
- No schema changes to TypedContentEnvelope or Diagram interfaces
- No changes to file-based load/save in fileOperations.ts
- No changes to ArchitectureContext reducer logic
- No changes to validation.ts or UI components
