# Task Breakdown: Extend Sequence Diagram Message Exchange Reference Types to Support Interface and Endpoint

## Overview

This feature extends the sequence diagram Message Exchange functionality to support referencing Interface and InterfaceEndpoint entities from the meta-model. The implementation involves updating type definitions, UI component switch cases, utility functions, and renderer mappings.

**Total Tasks:** 12
**Estimated Complexity:** Low - focused extension of existing patterns

## Task List

### Type Definitions Layer

#### Task Group 1: Extend MessageRefKind Type Definition
**Dependencies:** None
**Files:** `frontend/src/types/sequenceDiagram.ts`

- [x] 1.0 Complete type definitions extension
  - [x] 1.1 Write 2 focused tests for MessageRefKind validation
    - Test that `isMessageRefKind('Interface')` returns true
    - Test that `isMessageRefKind('InterfaceEndpoint')` returns true
  - [x] 1.2 Add `Interface` and `InterfaceEndpoint` to `MessageRefKind` union type
    - Location: Lines 29-34 in `sequenceDiagram.ts`
    - Add `| 'Interface'` and `| 'InterfaceEndpoint'` to the union
  - [x] 1.3 Add both values to `MESSAGE_REF_KINDS` array constant
    - Location: Lines 76-82 in `sequenceDiagram.ts`
    - Add `'Interface'` and `'InterfaceEndpoint'` to the array
  - [x] 1.4 Verify type guard `isMessageRefKind` automatically validates new values
    - The existing implementation uses `MESSAGE_REF_KINDS.includes()` so no changes needed
  - [x] 1.5 Ensure type definition tests pass
    - Run ONLY the 2 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- `MessageRefKind` type includes `Interface` and `InterfaceEndpoint`
- `MESSAGE_REF_KINDS` array contains 7 values (Method, LogicalEntity, PhysicalEntity, Class, Event, Interface, InterfaceEndpoint)
- `isMessageRefKind` type guard validates both new values
- TypeScript compilation passes without errors

---

### UI Components Layer

#### Task Group 2: Update Reference Options and Label Resolution
**Dependencies:** Task Group 1
**Files:**
- `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`
- `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx`

- [x] 2.0 Complete UI component updates
  - [x] 2.1 Write 3 focused tests for UI component functions
    - Test `getReferenceOptions('Interface', metaModel)` returns interfaces from metaModel
    - Test `getReferenceOptions('InterfaceEndpoint', metaModel)` returns endpoints from metaModel
    - Test `getMessageContentLabel` resolves Interface and InterfaceEndpoint names correctly
  - [x] 2.2 Extend `getReferenceOptions` function in AddMessageExchangeDrawer.tsx
    - Location: Lines 122-142 in `AddMessageExchangeDrawer.tsx`
    - Add case `'Interface'` returning `metaModel.entities.interfaces.map(i => ({ id: i.id, name: i.name }))`
    - Add case `'InterfaceEndpoint'` returning `metaModel.entities.endpoints.map(e => ({ id: e.id, name: e.name }))`
    - Follow existing optional chaining pattern: `(metaModel.entities.X || []).map()`
  - [x] 2.3 Extend `getMessageContentLabel` function in SequenceNodeRow.tsx
    - Location: Lines 93-126 in `SequenceNodeRow.tsx`
    - Add case `'Interface'` returning `metaModel.entities.interfaces?.find(i => i.id === refId)?.name || refKind`
    - Add case `'InterfaceEndpoint'` returning `metaModel.entities.endpoints?.find(e => e.id === refId)?.name || refKind`
  - [x] 2.4 Ensure UI component tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify dropdown population works for new reference kinds

**Acceptance Criteria:**
- Reference Type dropdown shows `Interface` and `InterfaceEndpoint` options
- Selecting `Interface` populates the Reference dropdown with interfaces from metaModel
- Selecting `InterfaceEndpoint` populates the Reference dropdown with endpoints from metaModel
- Message content labels resolve Interface and InterfaceEndpoint names correctly in SequenceNodeRow

---

### Utility and Renderer Layer

#### Task Group 3: Update Utility Functions and Renderer Mappings
**Dependencies:** Task Group 1
**Files:**
- `frontend/src/utils/sequenceDiagramUtils.ts`
- `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

- [x] 3.0 Complete utility and renderer updates
  - [x] 3.1 Write 3 focused tests for utility and renderer functions
    - Test `resolveMessageLabel` (utils) returns Interface name for Interface ref_kind
    - Test `resolveMessageLabel` (utils) returns InterfaceEndpoint name for InterfaceEndpoint ref_kind
    - Test `resolveMessageLabel` (renderer) uses MESSAGE_REF_KIND_TO_COLLECTION mapping correctly for new kinds
  - [x] 3.2 Extend `resolveMessageLabel` in sequenceDiagramUtils.ts
    - Location: Lines 90-128 in `sequenceDiagramUtils.ts`
    - Add case `'Interface'` looking up from `metaModel.entities.interfaces`
    - Add case `'InterfaceEndpoint'` looking up from `metaModel.entities.endpoints`
    - Return fallback format `Interface:${message.ref_id}` or `InterfaceEndpoint:${message.ref_id}` when entity not found
  - [x] 3.3 Extend `MESSAGE_REF_KIND_TO_COLLECTION` constant in SequenceDiagramRenderer.tsx
    - Location: Lines 166-172 in `SequenceDiagramRenderer.tsx`
    - Add mapping `Interface: 'interfaces'` to match `MetaModel.entities.interfaces`
    - Add mapping `InterfaceEndpoint: 'endpoints'` to match `MetaModel.entities.endpoints`
  - [x] 3.4 Ensure utility and renderer tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify message labels resolve correctly in both utility and renderer contexts

**Acceptance Criteria:**
- `resolveMessageLabel` utility returns correct names for Interface and InterfaceEndpoint references
- `resolveMessageLabel` utility returns correct fallback format when entity not found
- `MESSAGE_REF_KIND_TO_COLLECTION` mapping includes both new reference kinds
- Renderer resolves message labels correctly for Interface and InterfaceEndpoint

---

### Testing Layer

#### Task Group 4: Update Existing Tests and Final Verification
**Dependencies:** Task Groups 1-3
**Files:** `frontend/src/__tests__/flow-tab.test.ts`

- [x] 4.0 Complete test updates and verification
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 2 tests written for type definitions (Task 1.1)
    - Review the 3 tests written for UI components (Task 2.1)
    - Review the 3 tests written for utilities/renderer (Task 3.1)
    - Total existing new tests: 8 tests
  - [x] 4.2 Update existing test assertions in flow-tab.test.ts
    - Location: Lines 718-727 in `flow-tab.test.ts`
    - Update test `'should have all valid MESSAGE_REF_KINDS'` to include Interface and InterfaceEndpoint
    - Add `expect(MESSAGE_REF_KINDS).toContain('Interface')`
    - Add `expect(MESSAGE_REF_KINDS).toContain('InterfaceEndpoint')`
    - Update length assertion from `expect(MESSAGE_REF_KINDS).toHaveLength(5)` to `toHaveLength(7)`
  - [x] 4.3 Run feature-specific tests only
    - Run all tests from Task Groups 1-3 (8 tests)
    - Run updated flow-tab.test.ts assertions
    - Verify all feature-related tests pass
  - [x] 4.4 Manual verification of end-to-end workflow
    - Create a sequence diagram message exchange referencing an Interface
    - Create a sequence diagram message exchange referencing an InterfaceEndpoint
    - Verify labels display correctly in SequenceNodeRow and SequenceDiagramRenderer

**Acceptance Criteria:**
- Updated flow-tab.test.ts assertions pass with new MESSAGE_REF_KINDS values
- All 8 new tests from Task Groups 1-3 pass
- Manual verification confirms Interface and InterfaceEndpoint selection works end-to-end
- No regressions in existing sequence diagram functionality

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Foundation layer, no dependencies
2. **Task Group 2: UI Components** - Depends on type definitions being updated
3. **Task Group 3: Utility/Renderer** - Depends on type definitions being updated
4. **Task Group 4: Test Updates** - Final verification after all code changes

**Note:** Task Groups 2 and 3 can be executed in parallel after Task Group 1 is complete, as they have no interdependencies.

---

## Summary

| Task Group | Description | Tasks | Tests | Dependencies | Status |
|------------|-------------|-------|-------|--------------|--------|
| 1 | Type Definitions Layer | 5 | 2 | None | COMPLETED |
| 2 | UI Components Layer | 4 | 3 | Group 1 | COMPLETED |
| 3 | Utility/Renderer Layer | 4 | 3 | Group 1 | COMPLETED |
| 4 | Testing Layer | 4 | 0 (updates existing) | Groups 1-3 | COMPLETED |
| **Total** | | **17 sub-tasks** | **8 new tests** | | **ALL COMPLETED** |

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/types/sequenceDiagram.ts` | Add Interface and InterfaceEndpoint to MessageRefKind type and MESSAGE_REF_KINDS array |
| `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx` | Add 2 cases to getReferenceOptions function |
| `frontend/src/components/DiagramsView/SequenceEditor/SequenceNodeRow.tsx` | Add 2 cases to getMessageContentLabel function |
| `frontend/src/utils/sequenceDiagramUtils.ts` | Add 2 cases to resolveMessageLabel function |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | Add 2 mappings to MESSAGE_REF_KIND_TO_COLLECTION constant |
| `frontend/src/__tests__/flow-tab.test.ts` | Update MESSAGE_REF_KINDS assertions |
| `frontend/src/__tests__/message-ref-kind-interface-endpoint.test.ts` | NEW: 18 tests covering all new functionality |

## Implementation Notes

All 4 task groups have been implemented successfully:

1. **Task Group 1**: Extended `MessageRefKind` type and `MESSAGE_REF_KINDS` array in `sequenceDiagram.ts`
2. **Task Group 2**: Updated `getReferenceOptions` in `AddMessageExchangeDrawer.tsx` and `getMessageContentLabel` in `SequenceNodeRow.tsx`
3. **Task Group 3**: Updated `resolveMessageLabel` in `sequenceDiagramUtils.ts` and `MESSAGE_REF_KIND_TO_COLLECTION` in `SequenceDiagramRenderer.tsx`
4. **Task Group 4**: Updated `flow-tab.test.ts` assertions and ran all 42 tests (all passing)

Test Results: 42 tests passed across 2 test files:
- `message-ref-kind-interface-endpoint.test.ts`: 18 tests
- `flow-tab.test.ts`: 24 tests
