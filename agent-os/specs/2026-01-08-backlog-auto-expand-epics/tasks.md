# Task Breakdown: Backlog Auto-Expand Epics on Initial Load

## Overview
Total Tasks: 6

This is a focused frontend behavioral change to ensure the Product Backlog displays all Features under all Epics immediately on initial load. The change is isolated to the first-load initialization effect in `ProductBacklogPage.tsx`.

## Task List

### Frontend Component Update

#### Task Group 1: Update Initial Expansion Logic
**Dependencies:** None

- [x] 1.0 Complete initial expansion behavior update
  - [x] 1.1 Write 2-4 focused tests for auto-expand behavior
    - Test that INITIATIVE nodes are expanded on first load (existing behavior preserved)
    - Test that EPIC nodes are expanded on first load (new behavior)
    - Test that FEATURE nodes remain collapsed on first load
    - Test that existing expansion state is preserved when context has data
  - [x] 1.2 Modify initialization loop in `ProductBacklogPage.tsx`
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ProductBacklogPage.tsx`
    - Location: Lines 261-266 (first-load initialization useEffect)
    - Change the loop condition from `item.type === 'INITIATIVE'` to `item.type === 'INITIATIVE' || item.type === 'EPIC'`
    - This adds both INITIATIVE and EPIC item IDs to the `initialExpanded` Set
  - [x] 1.3 Update inline comment to reflect new behavior
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ProductBacklogPage.tsx`
    - Location: Line 260
    - Change comment from "First load: context is empty, compute initial expansion (INITIATIVE nodes expanded)" to "First load: expand INITIATIVE and EPIC nodes so Features are visible under Epics"
  - [x] 1.4 Verify guards remain unchanged
    - Confirm `if (expandedIds.size > 0)` guard (lines 254-258) is preserved
    - Confirm `initializedForProjectRef` guard logic is preserved
    - Confirm `setExpandedIds` call uses context setter (line 270)
  - [x] 1.5 Run tests written in 1.1 to verify changes
    - Run ONLY the 2-4 tests written in 1.1
    - Verify INITIATIVE and EPIC nodes are both auto-expanded
    - Verify FEATURE nodes remain collapsed
    - Verify user expansion state is not overwritten

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- On initial load with empty context, both INITIATIVE and EPIC nodes are expanded
- FEATURE nodes remain collapsed (stories hidden until user expands)
- Existing expansion state is preserved when user has interacted (expandedIds.size > 0)
- Tab switch persistence continues to work (no regression)
- Comment accurately describes the new behavior

### Verification

#### Task Group 2: Manual Verification and Regression Check
**Dependencies:** Task Group 1

- [x] 2.0 Complete manual verification
  - [x] 2.1 Test initial load behavior
    - Load a project with INITIATIVEs, EPICs, FEATUREs, and STORYs
    - Verify all Epics under Initiatives are visible without user interaction
    - Verify all Features under Epics are visible without user interaction
    - Verify Stories remain hidden (Features collapsed by default)
  - [x] 2.2 Test user state preservation
    - Manually collapse an Epic
    - Switch to another tab (e.g., Roadmap)
    - Switch back to Backlog tab
    - Verify the manually collapsed Epic remains collapsed
  - [x] 2.3 Test no regression to existing functionality
    - Verify INITIATIVE expansion still works
    - Verify expand/collapse toggle still functions
    - Verify selection and details panel still work
    - Verify create/edit/delete modals still function

**Acceptance Criteria:**
- Initial load shows Features visible under all Epics
- User manual expansion choices persist across tab switches
- No regression to existing backlog functionality

## Execution Order

Recommended implementation sequence:
1. Frontend Component Update (Task Group 1)
2. Manual Verification (Task Group 2)

## Code Change Summary

The change is minimal and isolated to a single file:

**File:** `frontend/src/components/ProductView/ProductBacklogPage.tsx`

**Change 1 - Line 260:** Update comment
```typescript
// Before:
// First load: context is empty, compute initial expansion (INITIATIVE nodes expanded)

// After:
// First load: expand INITIATIVE and EPIC nodes so Features are visible under Epics
```

**Change 2 - Lines 262-265:** Update loop condition
```typescript
// Before:
for (const item of workItems) {
  if (item.type === 'INITIATIVE') {
    initialExpanded.add(item.id);
  }
}

// After:
for (const item of workItems) {
  if (item.type === 'INITIATIVE' || item.type === 'EPIC') {
    initialExpanded.add(item.id);
  }
}
```

## Out of Scope (per spec)
- Backend changes or API modifications
- WorkItemTree rendering logic changes
- Roadmap page expansion behavior changes
- Changes to how expansion state is persisted in ProductUiStateContext
- Changes to create/update/delete handlers
- Adding expansion defaults for FEATURE or STORY nodes
- LocalStorage persistence for expansion state
- Changes to archived filter behavior
- Changes to empty state or error state handling
- Unit test additions or modifications (tests in 1.1 are for verification only, spec explicitly excludes test additions)
