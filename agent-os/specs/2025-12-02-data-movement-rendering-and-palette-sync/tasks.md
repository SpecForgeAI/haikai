# Task Breakdown: Data Movement Rendering and Palette Synchronisation Fix

## Overview
Total Tasks: 16

## Summary

This is a targeted bug fix for Data Movement edges not rendering on the canvas. There were **TWO root causes**:

**Bug 1: getRelationshipEndpointEntities includes Logical Data Entity**
- Location: `frontend/src/utils/rendering.ts` lines 208-219
- The DATA_MOVEMENT case incorrectly included the Logical Data Entity in the returned endpoints array
- When time filtering checks this array, it fails because the Logical Data Entity is not on the diagram
- **Fix:** Remove line 218 (`if (dataEntity) endpoints.push(dataEntity);`) so DATA_MOVEMENT only returns `[sourceApp, targetApp]`

**Bug 2: getDataMovementNodes only looks for APPLICATION_POINT nodes**
- Location: `frontend/src/utils/relationshipUtils.ts` lines 921-959
- The function used `findAppPointNode()` which ONLY finds nodes with `entity_type === 'APPLICATION_POINT'`
- When users add an "Application" from the palette, it creates a node with `entity_type = 'APPLICATION'`
- The eligibility check (`isDataMovementEnabledWithSets`) correctly maps APPLICATION → application_points, so the row shows as **enabled**
- But `getDataMovementNodes()` returned null because it couldn't find `APPLICATION_POINT` nodes, so no edge was created
- **Fix:** Update `getDataMovementNodes()` to check for all node types: APPLICATION, APPLICATION_POINT, APP_COMPONENT, SERVICE

## Task List

### Core Rendering Fix

#### Task Group 1: Fix getRelationshipEndpointEntities for DATA_MOVEMENT
**Dependencies:** None

- [x] 1.0 Complete core rendering fix
  - [x] 1.1 Write 4 focused tests for DATA_MOVEMENT endpoint entity resolution
    - Test 1: `getRelationshipEndpointEntities` for DATA_MOVEMENT returns exactly 2 entities (source and target apps only)
    - Test 2: `getRelationshipEndpointEntities` for DATA_MOVEMENT does NOT include logical data entity
    - Test 3: `getEdgesForDiagram` includes DATA_MOVEMENT edge when both app nodes visible (logical entity NOT on diagram)
    - Test 4: `getEdgesForDiagram` excludes DATA_MOVEMENT edge when source app node not visible
  - [x] 1.2 Modify `getRelationshipEndpointEntities` function in `frontend/src/utils/rendering.ts`
    - Locate the DATA_MOVEMENT case (lines 208-219)
    - Remove line 218: `if (dataEntity) endpoints.push(dataEntity);`
    - Keep lines 213-217 unchanged (source/target app lookup and push)
    - Add comment explaining why logical entity is excluded: "Logical data entity is used for label text only, not required on diagram"
  - [x] 1.3 Ensure core rendering tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify DATA_MOVEMENT edges now pass filtering correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `getRelationshipEndpointEntities('DATA_MOVEMENT', ...)` returns array of length 2
- Array contains only source and target Application entities
- Logical Data Entity is NOT included in returned array
- DATA_MOVEMENT edges render when both app nodes are on diagram

### Debugging and Observability

#### Task Group 2: Add Console Warnings for Filtered Edges
**Dependencies:** Task Group 1

- [x] 2.0 Complete console warning implementation
  - [x] 2.1 Write 3 focused tests for console warning behaviour
    - Test 1: Console warning logged when edge filtered due to missing source node
    - Test 2: Console warning logged when edge filtered due to relationship not visible in period
    - Test 3: Console warning includes edge ID, relationship type, and specific reason
  - [x] 2.2 Add warning logging to `getEdgesForDiagram` in `frontend/src/utils/rendering.ts`
    - Add console.warn before each `return false` in the filter callback
    - Format: `console.warn("Filtered out edge", { edgeId: edge.id, relationshipType: edge.relationship_type, reason: "reason_code" })`
    - Reason codes to implement:
      - `"relationship_not_found"` - when relationship lookup returns null
      - `"relationship_not_visible"` - when `isRelationshipVisibleInPeriod` returns false
      - `"endpoint_entity_not_visible"` - when endpoint entity fails temporal check
      - `"source_node_not_on_diagram"` - when source diagram node not in visibleNodeIds
      - `"target_node_not_on_diagram"` - when target diagram node not in visibleNodeIds
  - [x] 2.3 Ensure console warning tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify warnings are logged with correct format and reason codes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Console warnings logged for all edge filtering scenarios
- Warning includes edge ID for traceability
- Warning includes specific reason code for debugging
- Warnings only appear in development (or are suppressible in production)

### Palette Verification

#### Task Group 3: Verify Palette State Synchronisation
**Dependencies:** Task Group 1

- [x] 3.0 Complete palette verification
  - [x] 3.1 Write 4 focused tests for palette enabled/disabled state
    - Test 1: Data Movement row is ENABLED when both source and target app nodes on diagram
    - Test 2: Data Movement row is DISABLED when only source app node on diagram
    - Test 3: Data Movement row becomes ENABLED after adding missing target app node
    - Test 4: Data Movement row becomes DISABLED after removing source app node
  - [x] 3.2 Verify `isDataMovementEnabledWithSets` in `frontend/src/utils/relationshipUtils.ts`
    - Confirm function only checks `applicationPointsOnDiagram` Set (lines 497-504)
    - Confirm function does NOT check for logical data entity presence
    - No code changes expected - this is verification only
  - [x] 3.3 Verify `PaletteSection.tsx` recomputes on diagram changes
    - Confirm `entitiesOnDiagram` is computed on every render (line 43-45)
    - Confirm `getRelationshipInfo` uses `getRelationshipEligibility` (lines 59-66)
    - No code changes expected - this is verification only
  - [x] 3.4 Verify disabled tooltip text for Data Movements
    - Confirm tooltip displays: "Source and target Applications must be on this diagram to add this data movement"
    - Check `PaletteItem.tsx` for tooltip rendering logic
    - No code changes expected unless tooltip text is incorrect
  - [x] 3.5 Ensure palette tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify palette state updates correctly on diagram changes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Palette correctly enables Data Movement rows when both endpoints present
- Palette correctly disables Data Movement rows when endpoints missing
- Palette state updates immediately when nodes added/removed
- Tooltip text is accurate and helpful

### Integration Testing

#### Task Group 4: End-to-End Scenario Testing
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration testing
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests from Task Group 1 (rendering fix)
    - Review the 3 tests from Task Group 2 (console warnings)
    - Review the 4 tests from Task Group 3 (palette state)
    - Total existing tests: 11 tests
  - [x] 4.2 Analyze test coverage gaps for acceptance criteria
    - Map each acceptance criterion from spec to existing tests
    - Identify any critical scenarios not covered
    - Focus on end-to-end workflows and integration points
  - [x] 4.3 Write up to 5 additional integration tests if needed
    - Test: Full workflow - Add Data Movement via palette, verify edge renders
    - Test: Switch diagrams - Data Movement disabled on empty diagram
    - Test: Time filtering - Data Movement visible when relationship and apps effective
    - Test: Delete node - Edge disappears and palette disables
    - Test: Reload/persist - Data Movement edge survives save and reload
  - [x] 4.4 Run all feature-specific tests
    - Run all tests from Task Groups 1-4 (up to 16 tests total)
    - Verify all acceptance criteria pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All 6 acceptance criteria from spec are covered by tests
- Full add workflow works correctly
- Diagram switching updates palette correctly
- Time filtering works for Data Movements
- Node deletion updates both edge and palette
- All feature tests pass (approximately 11-16 tests)

## Execution Order

Recommended implementation sequence:
1. **Core Rendering Fix** (Task Group 1) - Fix the root cause first
2. **Console Warnings** (Task Group 2) - Add debugging capability for any remaining issues
3. **Palette Verification** (Task Group 3) - Confirm existing palette logic is correct
4. **Integration Testing** (Task Group 4) - Validate complete fix with end-to-end tests

## Key Files to Modify

| File | Changes Required | Status |
|------|------------------|--------|
| `frontend/src/utils/rendering.ts` | Bug 1: Remove dataEntity from DATA_MOVEMENT endpoints (line 218), add console.warn in getEdgesForDiagram | ✅ DONE |
| `frontend/src/utils/relationshipUtils.ts` | Bug 2: Fix getDataMovementNodes to check APPLICATION/APP_COMPONENT/SERVICE nodes | ✅ DONE |
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Verification only - no changes expected | ✅ Verified |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Verification only - possibly tooltip text update | ✅ Verified |

## Code Changes

### Bug 1 Fix: getRelationshipEndpointEntities (rendering.ts)

```typescript
// Before (lines 208-219 in rendering.ts):
case 'DATA_MOVEMENT': {
  const rel = relationship as { source_application_id: string; target_application_id: string; data_entity_id: string };
  const sourceApp = metaModel.entities.applications.find(e => e.id === rel.source_application_id);
  const targetApp = metaModel.entities.applications.find(e => e.id === rel.target_application_id);
  const dataEntity = metaModel.entities.logical_data_entities.find(e => e.id === rel.data_entity_id);
  if (sourceApp) endpoints.push(sourceApp);
  if (targetApp) endpoints.push(targetApp);
  if (dataEntity) endpoints.push(dataEntity);  // <-- DELETE THIS LINE
  break;
}

// After:
case 'DATA_MOVEMENT': {
  // Logical data entity is used for label text only, not required on diagram
  const rel = relationship as { source_application_id: string; target_application_id: string; data_entity_id: string };
  const sourceApp = metaModel.entities.applications.find(e => e.id === rel.source_application_id);
  const targetApp = metaModel.entities.applications.find(e => e.id === rel.target_application_id);
  // Note: dataEntity lookup removed - not needed for endpoint visibility checking
  if (sourceApp) endpoints.push(sourceApp);
  if (targetApp) endpoints.push(targetApp);
  break;
}
```

### Bug 2 Fix: getDataMovementNodes (relationshipUtils.ts)

```typescript
// Before: Used findAppPointNode() which only finds APPLICATION_POINT nodes
const node = findAppPointNode(nodes, ap.id);

// After: Uses findNodeForApplication() helper that checks all node types
const findNodeForApplication = (applicationId: string): DiagramNode | undefined => {
  // First, check for direct APPLICATION node
  const appNode = nodes.find(
    n => n.entity_type === ENTITY_TYPES.APPLICATION && n.entity_id === applicationId
  );
  if (appNode) return appNode;

  // Find all application_points for this application
  const appPoints = metaModel.entities.application_points.filter(
    ap => ap.application_id === applicationId
  );

  // Check for APPLICATION_POINT, APP_COMPONENT, or SERVICE nodes
  for (const ap of appPoints) {
    const apNode = nodes.find(
      n => n.entity_type === ENTITY_TYPES.APPLICATION_POINT && n.entity_id === ap.id
    );
    if (apNode) return apNode;

    if (ap.application_component_id) {
      const compNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.APP_COMPONENT && n.entity_id === ap.application_component_id
      );
      if (compNode) return compNode;
    }

    if (ap.service_id) {
      const svcNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.SERVICE && n.entity_id === ap.service_id
      );
      if (svcNode) return svcNode;
    }
  }

  return undefined;
};
```

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Fix breaks other relationship types | Low | High | Other cases are in separate switch branches, unaffected |
| Palette state not updating | Low | Medium | Verification in Task Group 3 confirms existing logic is correct |
| Time filtering breaks for Data Movement | Low | Medium | Tests explicitly cover time filtering scenarios |
| Console warnings impact performance | Very Low | Low | Warnings are lightweight and only fire during filtering |

## Notes

- This is a targeted bug fix with minimal code changes
- The root cause is clearly identified in the spec
- Palette logic is already correct - the issue is only in the rendering/filtering layer
- Console warnings are a debugging enhancement, not strictly required for the fix

## Implementation Summary

All 4 task groups have been completed:

### Test Files Created
1. `frontend/src/__tests__/data-movement-rendering-fix.test.ts` - 4 tests (Task Group 1)
2. `frontend/src/__tests__/data-movement-console-warnings.test.ts` - 3 tests (Task Group 2)
3. `frontend/src/__tests__/data-movement-palette-state.test.ts` - 5 tests (Task Group 3)
4. `frontend/src/__tests__/data-movement-integration.test.ts` - 8 tests (Task Group 4)

### Code Changes
- Modified `frontend/src/utils/rendering.ts`:
  - Bug 1 Fix: Removed the line that pushed `dataEntity` to endpoints in the DATA_MOVEMENT case
  - Added explanatory comments
  - Added console.warn calls for all edge filtering scenarios with reason codes
- Modified `frontend/src/utils/relationshipUtils.ts`:
  - Bug 2 Fix: Rewrote `getDataMovementNodes()` with `findNodeForApplication()` helper
  - Now checks APPLICATION, APPLICATION_POINT, APP_COMPONENT, and SERVICE nodes
  - Mirrors the same abstraction logic used in `getEntitiesOnDiagram()` for consistency

### Verification
- TypeScript compilation passes with no errors
- All 20 new tests pass (4 + 3 + 5 + 8)
- Tests use vitest framework consistent with existing codebase
- Manual testing confirms Data Movement edges now render correctly when adding Applications from palette
