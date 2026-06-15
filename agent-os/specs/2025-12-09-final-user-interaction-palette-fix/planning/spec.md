# Specification: Final Fix for User Interaction Palette Enablement and Removal of "Show User Interactions" Toggle

## 1. Overview

### 1.1 Problem Statement

Two issues remain with the User Interaction palette in the Diagrams view:

1. **User Interaction rows are disabled** even when the User node and both Application nodes ("My App" and "Your App") are present on the diagram and there are no interaction edges. The enablement logic is not correctly linking App_Business_Points to the concrete diagram nodes.

2. **Unwanted "Show User Interactions" checkbox** exists at the top of the palette panel. This toggle was not requested and should be removed. User interactions should always be visible when present.

### 1.2 Goals

1. Fix the ABP-to-diagram-node mapping so enablement logic correctly detects when required nodes are present
2. Remove the "Show User Interactions" checkbox and all associated state/logic
3. Ensure User Interaction rows enable/disable correctly based on Case A and Case B rules

### 1.3 Non-Goals

- Changing the underlying data model for App_Business_Points
- Modifying how interaction edges are created or rendered
- Adding new features to the palette

## 2. Current Implementation Analysis

### 2.1 App_Business_Point Type Definition

**File:** `frontend/src/types/model.ts` (lines 439-448)

```typescript
export interface AppBusinessPoint {
  id: string;                    // Auto-generated: 'abp_{source_entity_id}'
  name: string;                  // Mirrors source entity name
  kind: AppBusinessPointKind;    // APPLICATION, APP_COMPONENT, SERVICE, etc.
  source_entity_id: string;      // FK to the source entity
}
```

**Key fields:**
- `kind` - The type of entity (APPLICATION, APP_COMPONENT, SERVICE, INTERFACE, BUSINESS_PROCESS, PROCESS_ACTIVITY)
- `source_entity_id` - The ID of the underlying concrete entity

### 2.2 Current ABP Resolution Function

**File:** `frontend/src/utils/userInteractionUtils.ts` (lines 191-224)

The `getAppBusinessPointNodeId()` function:
1. Finds the ABP by ID in `metaModel.entities.app_business_points`
2. Maps `abp.kind` to the corresponding ENTITY_TYPES constant
3. Uses `findNodeForEntity(nodes, entityType, abp.source_entity_id)` to find the diagram node
4. Returns the node ID if found, null otherwise

### 2.3 Current Enablement Logic

**File:** `frontend/src/utils/userInteractionUtils.ts` (lines 254-316)

The `isUserInteractionRowEnabled()` function implements:

**Case A** (both primary AND secondary ABPs exist):
- ENABLED when: P node exists AND S node exists AND no interaction edges exist
- User node is NOT required

**Case B** (only primary ABP exists):
- ENABLED when: P node exists AND U (User) node exists AND no interaction edges exist
- User node IS required

### 2.4 "Show User Interactions" Checkbox Location

**File:** `frontend/src/components/DiagramsView/PalettePanel.tsx`

- Props: lines 703-706 (`showUserInteractions`, `onToggleUserInteractions`)
- Default values: lines 724-725
- Handler: lines 765-769 (`handleUserInteractionsToggle`)
- JSX: lines 2125-2138 (checkbox rendering)

## 3. Root Cause Analysis

### 3.1 Why User Interaction Rows Stay Disabled

The issue is likely in how `getAppBusinessPointNodeId()` resolves ABP IDs to diagram nodes. Possible causes:

1. The ABP lookup in `metaModel.entities.app_business_points` may be failing
2. The `kind` to ENTITY_TYPES mapping may not match the actual node entity_type
3. The `source_entity_id` may not match the diagram node's `entity_id`
4. The `findNodeForEntity()` function may have a bug

### 3.2 Debugging Approach

To diagnose, we need to:
1. Add logging/tests to verify ABP lookup succeeds
2. Verify the kind-to-entityType mapping is correct
3. Confirm source_entity_id matches diagram node entity_id
4. Trace through the entire enablement flow

## 4. Technical Design

### 4.1 Task Group 1: Debug and Fix ABP Resolution

#### 4.1.1 Add Diagnostic Logging

Add temporary console.log statements to trace the flow:

```typescript
export function getAppBusinessPointNodeId(
  abpId: string,
  nodes: DiagramNode[],
  metaModel: MetaModel
): string | null {
  console.log('=== getAppBusinessPointNodeId DEBUG ===');
  console.log('Looking for ABP ID:', abpId);
  console.log('Available ABPs:', metaModel.entities.app_business_points?.map(a => ({ id: a.id, kind: a.kind, source_entity_id: a.source_entity_id })));

  const abp = metaModel.entities.app_business_points?.find(a => a.id === abpId);
  console.log('Found ABP:', abp);

  if (!abp) return null;

  const entityType = kindToEntityType[abp.kind];
  console.log('Mapped entity type:', entityType, 'from kind:', abp.kind);

  console.log('Looking for node with entity_type:', entityType, 'entity_id:', abp.source_entity_id);
  console.log('Available nodes:', nodes.map(n => ({ id: n.id, entity_type: n.entity_type, entity_id: n.entity_id })));

  const node = findNodeForEntity(nodes, entityType, abp.source_entity_id);
  console.log('Found node:', node?.id);

  return node ? node.id : null;
}
```

#### 4.1.2 Write Targeted Tests

Create tests that verify the exact scenario:
- Two Applications ("My App" and "Your App") on diagram
- ABPs exist for both
- Interaction references both ABPs
- Verify `getAppBusinessPointNodeId()` returns correct node IDs
- Verify `isUserInteractionRowEnabled()` returns true

#### 4.1.3 Potential Fixes

Based on diagnosis, potential fixes may include:
1. Ensure ABPs are being created/synced when Applications are added
2. Fix any case sensitivity issues in kind matching
3. Ensure entity_id fields match correctly
4. Add null safety for edge cases

### 4.2 Task Group 2: Remove "Show User Interactions" Checkbox

#### 4.2.1 Files to Modify

**PalettePanel.tsx:**
- Remove props: `showUserInteractions`, `onToggleUserInteractions` (lines 703-706)
- Remove default values (lines 724-725)
- Remove handler function `handleUserInteractionsToggle` (lines 765-769)
- Remove checkbox JSX (lines 2125-2138)

**Parent component (DiagramsView.tsx or similar):**
- Remove state for `showUserInteractions` if it exists
- Remove prop passing to PalettePanel

#### 4.2.2 Behavior After Removal

- User Interaction edges (MAIN & USER_LINK) are always rendered when present
- The "User Interactions" palette section is always shown
- No toggle to hide/show interactions

## 5. Acceptance Criteria

### AC1 - ABP Mapping
- For an Interaction involving Applications, the enablement logic correctly detects App_Business_Points as long as the relevant Application nodes are on the diagram
- `getAppBusinessPointNodeId()` matches nodes based solely on (kind → entity_type, source_entity_id → entity_id)

### AC2 - Case A Enablement
- For a valid Interaction with User + P + S and both concrete nodes for P and S present on the diagram (no edges yet):
  - The row under "Interactions" in the palette is **enabled**, regardless of whether the User node is present

### AC3 - Case B Enablement
- For a valid Interaction with only P defined and both User + P nodes present (no edges yet):
  - The row is enabled
- If User or P node is missing, the row is disabled

### AC4 - Edges Disable Rows
- After adding an interaction (creating MAIN edge and optional USER_LINK edge), the row becomes disabled
- After deleting all edges for a given interaction id (MAIN and USER_LINK), and with required nodes still present, the row becomes enabled again

### AC5 - UI Cleanup
- The Palette panel no longer shows "Show User Interactions" checkbox
- No code path uses `showUserInteractions` to filter or hide anything
- Interactions are always visible and controllable solely via the palette section

## 6. Test Plan

### 6.1 Unit Tests for ABP Resolution

```typescript
describe('getAppBusinessPointNodeId - Real Scenario', () => {
  it('resolves "My App" ABP to Application node when on diagram', () => {
    const abp = { id: 'abp_app-my-app', name: 'My App', kind: 'APPLICATION', source_entity_id: 'app-my-app' };
    const node = { id: 'node-1', entity_type: 'APPLICATION', entity_id: 'app-my-app', ... };
    const metaModel = { entities: { app_business_points: [abp], ... }, ... };

    const result = getAppBusinessPointNodeId('abp_app-my-app', [node], metaModel);
    expect(result).toBe('node-1');
  });
});
```

### 6.2 Integration Tests for Enablement

```typescript
describe('isUserInteractionRowEnabled - Case A with Applications', () => {
  it('returns true when both Application nodes are on diagram', () => {
    // Setup: Interaction with P="My App" and S="Your App"
    // Diagram has nodes for both Applications
    // No edges exist
    // Expected: enabled = true
  });
});
```

### 6.3 UI Tests for Checkbox Removal

- Verify "Show User Interactions" checkbox does not render
- Verify interaction edges always render when present
- Verify palette section always shows

## 7. Implementation Notes

### 7.1 Field Name Clarification

The spec references `related_entity_type` and `related_entity_id`, but the actual codebase uses:
- `kind` (not `related_entity_type`)
- `source_entity_id` (not `related_entity_id`)

The implementation should use the existing field names.

### 7.2 Existing Helper Functions

The following functions already exist and should be reused:
- `findNodeForEntity()` in `relationshipUtils.ts`
- `isUserInteractionCase()` in `userInteractionUtils.ts`
- `getInteractionEdgesOnDiagram()` in `userInteractionUtils.ts`

### 7.3 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ABP sync not creating entries | Medium | High | Add logging, verify ABP creation on entity add |
| Breaking existing functionality | Low | Medium | Comprehensive test coverage before changes |
| Missing edge case in enablement | Low | Medium | Test all combinations of Case A/B scenarios |

## 8. Files Summary

### Files to Modify
| File | Changes |
|------|---------|
| `frontend/src/utils/userInteractionUtils.ts` | Debug and fix `getAppBusinessPointNodeId()` if needed |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Remove checkbox and related props/handlers |

### Files to Create
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-palette-enablement.test.ts` | Tests for the exact failing scenario |

### Files to Verify
| File | Verification |
|------|--------------|
| `frontend/src/utils/relationshipUtils.ts` | Confirm `findNodeForEntity()` works correctly |
| `frontend/src/types/model.ts` | Confirm ABP type definition |
