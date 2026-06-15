# Task Breakdown: Fix Context Chips Hydrate Labels After Navigation

## Overview
Total Tasks: 17

This is a focused bug fix to ensure context chips always display human-readable names instead of raw IDs after navigation or page reload. The fix leverages existing `rehydrateContextLabels()` infrastructure and adds proper hydration timing in `ProductImplementPage.tsx` plus fallback rendering in `WorkItemSummaryPanel.tsx`.

## Key Files to Modify

| File | Purpose |
|------|---------|
| `frontend/src/components/ProductView/ProductImplementPage.tsx` | Add label hydration after context fetch and on architecture data load |
| `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx` | Update chip components to display "Loading..." instead of raw IDs |
| `frontend/src/__tests__/context-chips-hydration.test.ts` | New test file for hydration logic |
| `frontend/src/__tests__/WorkItemSummaryPanel.chip-fallback.test.tsx` | New test file for chip rendering fallback |

## Existing Code to Leverage

| Module | Key Functions |
|--------|--------------|
| `frontend/src/utils/contextLabelResolver.ts` | `rehydrateContextLabels()`, `resolveEntityLabel()`, `resolveDiagramLabel()`, `resolveRelationshipLabel()` |
| `frontend/src/utils/contextRelationshipLabelUtils.ts` | `computeRelationshipLabel()` |
| `frontend/src/contexts/ArchitectureContext.tsx` | `useArchitecture()` hook for accessing `model.metaModel.entities`, `model.diagrams`, `model.metaModel.relationships` |

## Risk Areas and Mitigations

| Risk | Mitigation |
|------|------------|
| Infinite re-render loop when rehydrating labels | Add deep comparison before `setContextState()`; use `isHydrating` ref guard |
| Architecture data not loaded when context arrives | Add `useEffect` to re-run hydration when architecture data changes |
| Label equals raw ID (not caught as invalid) | Check if `ref.label === ref.entity_id` or `ref.label === ref.diagram_id` in chip rendering |
| Performance impact of frequent label resolution | `rehydrateContextLabels()` already skips refs with valid labels; comparison before state update prevents unnecessary renders |

---

## Task List

### Frontend - Label Hydration Logic

#### Task Group 1: Hydration on Context Fetch
**Dependencies:** None

- [x] 1.0 Complete hydration after context fetch
  - [x] 1.1 Write 3-4 focused tests for hydration on context fetch
    - Test: `fetchImplementContext` resolves, `rehydrateContextLabels()` is called before `setContextState()`
    - Test: context with labels matching IDs + loaded metaModel -> hydrated labels resolve to entity names
    - Test: diagram refs hydrate to `diagram.name` from `diagrams` array
    - Test: relationship refs hydrate using `resolveRelationshipLabel()` to computed label
  - [x] 1.2 Import `rehydrateContextLabels` in ProductImplementPage.tsx
    - Add import from `../../utils/contextLabelResolver`
  - [x] 1.3 Modify the context fetch useEffect to hydrate labels
    - After `fetchImplementContext()` resolves with `loaded` context
    - Call `rehydrateContextLabels(loaded, model.metaModel.entities, model.diagrams, model.metaModel.relationships)`
    - Pass the rehydrated result to `setContextState()`
    - Update the localStorage cache with rehydrated context
  - [x] 1.4 Ensure hydration tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify hydration occurs on context fetch

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- Labels are hydrated immediately when context data arrives from backend
- Entity refs resolve to entity names
- Diagram refs resolve to diagram names
- Relationship refs resolve to computed labels

---

#### Task Group 2: Re-Hydration on Architecture Data Load
**Dependencies:** Task Group 1

- [x] 2.0 Complete re-hydration when architecture data changes
  - [x] 2.1 Write 3-4 focused tests for re-hydration on architecture data change
    - Test: context loads before architecture data -> shows "Loading..."; architecture data loads -> labels resolve
    - Test: metaModel.entities updates -> entity refs re-hydrate
    - Test: model.diagrams updates -> diagram refs re-hydrate
    - Test: metaModel.relationships updates -> relationship refs re-hydrate
  - [x] 2.2 Add useEffect hook to watch architecture data changes
    - Dependencies: `model.metaModel.entities`, `model.diagrams`, `model.metaModel.relationships`, `contextState`
    - Only run when architecture data is available (not undefined/empty)
  - [x] 2.3 Implement label comparison to prevent infinite loops
    - Before calling `setContextState()`, compare old vs new labels
    - Use `JSON.stringify()` on the refs arrays or concatenate labels for comparison
    - Only update state if comparison shows a difference
  - [x] 2.4 Add isHydrating ref guard
    - Create `const isHydratingRef = useRef<boolean>(false)`
    - Set `isHydratingRef.current = true` before hydration
    - Set `isHydratingRef.current = false` after state update
    - Skip the re-hydration effect if `isHydratingRef.current` is true
  - [x] 2.5 Ensure re-hydration tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify no infinite loops occur
    - Verify labels update when architecture data becomes available

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- Re-hydration occurs when architecture data loads after context
- No infinite re-render loops
- Guard ref prevents effect from firing during hydration

---

### Frontend - Chip Rendering Fallback

#### Task Group 3: Chip Component Fallback Display
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete chip rendering fallback logic
  - [x] 3.1 Write 3-4 focused tests for chip fallback rendering
    - Test: EntityChip with `label === undefined` renders "Loading..."
    - Test: EntityChip with `label === entity_id` renders "Loading..."
    - Test: DiagramChip with `label === ''` (empty string) renders "Loading..."
    - Test: RelationshipChip with `label === relationship_id` renders "Loading..."
  - [x] 3.2 Update EntityChip component with fallback logic
    - If `entityRef.label` is falsy, empty, or equals `entityRef.entity_id`, display "Loading..."
    - Never render raw `entity_id` as fallback text
    - Update: `<span className={styles.chipLabel}>{getDisplayLabel(entityRef.label, entityRef.entity_id)}</span>`
  - [x] 3.3 Update DiagramChip component with fallback logic
    - If `diagramRef.label` is falsy, empty, or equals `diagramRef.diagram_id`, display "Loading..."
    - Never render raw `diagram_id` as fallback text
  - [x] 3.4 Update RelationshipChip component with fallback logic
    - If `relationshipRef.label` is falsy, empty, or equals `relationshipRef.relationship_id`, display "Loading..."
    - Never render raw `relationship_id` as fallback text
  - [x] 3.5 Add helper function for label display logic
    - Create `function getChipDisplayLabel(label: string | undefined, idValue: string): string`
    - Return "Loading..." if label is falsy, empty after trim, or equals idValue
    - Return label otherwise
    - Can be defined inline in WorkItemSummaryPanel.tsx or exported for reuse
  - [x] 3.6 Ensure chip fallback tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify "Loading..." displays instead of raw IDs

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Entity chips never show raw entity_id
- Diagram chips never show raw diagram_id
- Relationship chips never show raw relationship_id
- "Loading..." displays as placeholder for unresolved labels

---

### Testing - Integration and Regression

#### Task Group 4: Integration Tests and Gap Analysis
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete integration tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3-4 tests from Task 1.1 (hydration on fetch)
    - Review the 3-4 tests from Task 2.1 (re-hydration on data load)
    - Review the 3-4 tests from Task 3.1 (chip fallback rendering)
    - Total existing tests: approximately 9-12 tests
  - [x] 4.2 Write navigation simulation integration test
    - Mount ProductImplementPage with workItemId
    - Simulate fetch returning context with ID-as-label
    - Verify chips display resolved names
    - Unmount component
    - Remount with same workItemId
    - Verify chips still display resolved names (not IDs)
  - [x] 4.3 Write end-to-end hydration flow test
    - Test the full flow: context loads -> architecture data loads -> labels hydrate -> chips render names
    - Test the reverse flow: architecture data loads -> context loads -> labels hydrate -> chips render names
  - [x] 4.4 Run all feature-specific tests
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 11-14 tests
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 11-14 tests total)
- Navigation simulation proves labels persist as names
- Both timing scenarios (context-first, architecture-first) are covered
- No more than 2-3 additional integration tests added

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 3: Chip Component Fallback Display** - Can be done first as it has no dependencies and provides immediate safety net for unresolved labels
2. **Task Group 1: Hydration on Context Fetch** - Add hydration call in the existing context fetch flow
3. **Task Group 2: Re-Hydration on Architecture Data Load** - Handle the timing edge case when architecture data loads after context
4. **Task Group 4: Integration Tests** - Verify the complete flow works end-to-end

**Rationale for this order:**
- Task Group 3 provides immediate visual improvement (no raw IDs shown)
- Task Group 1 is the primary fix path for most cases
- Task Group 2 handles the edge case where architecture data loads after context
- Task Group 4 verifies the complete integration

---

## Implementation Notes

### Label Comparison Strategy (Task 2.3)

```typescript
// Example comparison approach
function hasLabelsChanged(oldState: ContextState, newState: ContextState): boolean {
  const oldLabels = [
    ...oldState.entity_refs.map(r => r.label),
    ...oldState.diagram_refs.map(r => r.label),
    ...(oldState.relationship_refs || []).map(r => r.label),
  ].join('|');

  const newLabels = [
    ...newState.entity_refs.map(r => r.label),
    ...newState.diagram_refs.map(r => r.label),
    ...(newState.relationship_refs || []).map(r => r.label),
  ].join('|');

  return oldLabels !== newLabels;
}
```

### Chip Display Label Helper (Task 3.5)

```typescript
// Example helper function
function getChipDisplayLabel(label: string | undefined, idValue: string): string {
  if (!label || !label.trim() || label === idValue) {
    return 'Loading...';
  }
  return label;
}
```

### Guard Ref Pattern (Task 2.4)

```typescript
// Example guard ref pattern
const isHydratingRef = useRef<boolean>(false);

useEffect(() => {
  // Skip if already hydrating
  if (isHydratingRef.current) return;

  // Skip if no architecture data or no context
  if (!model.metaModel.entities || contextState.entity_refs.length === 0) return;

  const rehydrated = rehydrateContextLabels(
    contextState,
    model.metaModel.entities,
    model.diagrams,
    model.metaModel.relationships
  );

  if (hasLabelsChanged(contextState, rehydrated)) {
    isHydratingRef.current = true;
    setContextState(rehydrated);
    isHydratingRef.current = false;
  }
}, [model.metaModel.entities, model.diagrams, model.metaModel.relationships, contextState]);
```

---

## Implementation Summary

All task groups have been completed:

### Completed Files Modified:
1. **`frontend/src/utils/contextLabelResolver.ts`** - Updated `rehydrateContextLabels()` to check if label equals ID and re-resolve in that case
2. **`frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`** - Added `getChipDisplayLabel()` helper and updated all chip components to use it
3. **`frontend/src/components/ProductView/ProductImplementPage.tsx`** - Added hydration on context fetch and re-hydration useEffect when architecture data changes

### Completed Test Files Created:
1. **`frontend/src/__tests__/context-chips-hydration.test.ts`** - 12 tests for hydration logic
2. **`frontend/src/__tests__/WorkItemSummaryPanel.chip-fallback.test.tsx`** - 7 tests for chip fallback rendering
3. **`frontend/src/__tests__/context-chips-hydration-integration.test.tsx`** - 11 tests for integration scenarios

### Test Results:
- Total tests: 30
- All tests passing
