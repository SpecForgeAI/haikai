# Task Breakdown: Standardise User Interaction Palette Row UI and Context Menu Behaviour

## Overview
Total Tasks: 16
Estimated Complexity: Low

## Context

### Current State
- User Interaction rows display an inline "Add"/"Remove" badge on the right side
- Rows have special pink/red styling (`#fff3f3`) when edges exist (delete state)
- Context menu always shows "Add" even when edges exist
- The `action` prop is already computed correctly ('add' or 'delete') in `PaletteSection.tsx`
- Delete handler (`handleDeleteUserInteraction`) already exists in `PalettePanel.tsx`

### What Needs to Change
1. Remove the inline action indicator badge from User Interaction rows
2. Remove the special delete-state row styling (pink/red background)
3. Update context menu to show "Delete" when `action === 'delete'`
4. Connect the `action` prop and delete handler through the prop chain to context menu

## Task List

### Frontend Component Layer

#### Task Group 1: PaletteItem Visual Standardisation
**Dependencies:** None

- [x] 1.0 Complete PaletteItem visual changes
  - [x] 1.1 Write 2-4 focused tests for PaletteItem changes
    - File: `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts`
    - Test 1: Relationship items should NOT render action indicator badge (no `.actionIndicatorAdd` or `.actionIndicatorDelete`)
    - Test 2: Relationship items with `action='delete'` should NOT have `itemRelationshipDelete` class
    - Test 3: Enabled relationship items should have `itemRelationshipEnabled` class regardless of action
    - Test 4: Disabled relationship items should have `itemRelationshipDisabled` class
  - [x] 1.2 Remove action indicator badge JSX from PaletteItem.tsx
    - File: `frontend/src/components/DiagramsView/PaletteItem.tsx`
    - Location: Lines 129-135 (inside `<div className={styles.itemContent}>`)
    - **Remove this block:**
    ```tsx
    {/* Task Group 4: Show action indicator for interaction rows */}
    {itemType === 'relationship' && isRelationshipEnabled && (
      <div className={isDeleteAction ? styles.actionIndicatorDelete : styles.actionIndicatorAdd}>
        {isDeleteAction ? 'Remove' : 'Add'}
      </div>
    )}
    ```
  - [x] 1.3 Remove delete-state className logic from PaletteItem.tsx
    - File: `frontend/src/components/DiagramsView/PaletteItem.tsx`
    - Location: Lines 60-73 (className building for relationship items)
    - **Before:**
    ```tsx
    } else if (itemType === 'relationship') {
      className = `${styles.item} ${styles.itemRelationship}`;
      if (isRelationshipEnabled) {
        if (isDeleteAction) {
          // Delete action styling - enabled but shows delete state
          className = `${className} ${styles.itemRelationshipEnabled} ${styles.itemRelationshipDelete}`;
        } else {
          // Add action styling - standard enabled state
          className = `${className} ${styles.itemRelationshipEnabled}`;
        }
      } else {
        className = `${className} ${styles.itemRelationshipDisabled}`;
      }
    }
    ```
    - **After:**
    ```tsx
    } else if (itemType === 'relationship') {
      className = `${styles.item} ${styles.itemRelationship}`;
      if (isRelationshipEnabled) {
        className = `${className} ${styles.itemRelationshipEnabled}`;
      } else {
        className = `${className} ${styles.itemRelationshipDisabled}`;
      }
    }
    ```
  - [x] 1.4 Update tooltip text (optional cleanup)
    - Location: Lines 83-89 (tooltip for delete action)
    - **Before:** `'Click to remove interaction edges from diagram'`
    - **After:** `'Click to delete interaction edges from diagram'` (consistent terminology)
  - [x] 1.5 Ensure PaletteItem tests pass
    - Run ONLY the tests written in 1.1
    - Verify action indicator is not rendered
    - Verify delete-state class is not applied

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- No "Add" or "Remove" badge appears on User Interaction rows
- No pink/red background when edges exist (delete state)
- All enabled relationship rows use standard blue hover styling

**Files to Modify:**
- `frontend/src/components/DiagramsView/PaletteItem.tsx`

---

#### Task Group 2: PaletteContextMenu Dynamic Add/Delete
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete PaletteContextMenu changes
  - [x] 2.1 Write 3-4 focused tests for PaletteContextMenu changes
    - File: `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts`
    - Test 1: Context menu should show "Add" when `action='add'`
    - Test 2: Context menu should show "Delete" when `action='delete'`
    - Test 3: Clicking menu item should call `onDeleteRelationship` when `action='delete'`
    - Test 4: Clicking menu item should call `onAddRelationship` when `action='add'`
  - [x] 2.2 Add `action` prop to PaletteContextMenuProps interface
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Location: Lines 8-31 (interface definition)
    - Add to interface:
    ```tsx
    // Action type for relationship items (add or delete)
    action?: 'add' | 'delete';
    // Handler for deleting relationship (User Interactions)
    onDeleteRelationship?: ContextMenuAction;
    ```
  - [x] 2.3 Destructure new props in component
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Location: Lines 33-51 (component destructuring)
    - Add `action` and `onDeleteRelationship` to destructured props
  - [x] 2.4 Update renderRelationshipMenu() to show dynamic Add/Delete
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Location: Lines 256-277 (renderRelationshipMenu function)
    - **After:**
    ```tsx
    const renderRelationshipMenu = () => {
      const isDeleteAction = action === 'delete';

      const handleActionClick = () => {
        if (!isRelationshipEnabled) return;

        if (isDeleteAction && onDeleteRelationship) {
          handleMenuItemClick(onDeleteRelationship);
        } else if (onAddRelationship) {
          handleMenuItemClick(onAddRelationship);
        }
      };

      const menuLabel = isDeleteAction ? 'Delete' : 'Add';
      const menuTitle = !isRelationshipEnabled
        ? 'Both endpoints must be on diagram'
        : isDeleteAction
          ? 'Delete relationship from diagram'
          : 'Add relationship to diagram';

      return (
        <>
          <div
            className={`${styles.menuItem} ${!isRelationshipEnabled ? styles.menuItemDisabled : ''}`}
            onClick={handleActionClick}
            data-testid={isDeleteAction ? 'context-menu-delete-relationship' : 'context-menu-add-relationship'}
            title={menuTitle}
          >
            {menuLabel}
          </div>
        </>
      );
    };
    ```
  - [x] 2.5 Ensure PaletteContextMenu tests pass
    - Run ONLY the tests written in 2.1
    - Verify "Add" shown when action='add'
    - Verify "Delete" shown when action='delete'
    - Verify correct handlers called on click

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- Context menu shows "Add" when no edges exist for the interaction
- Context menu shows "Delete" when edges exist for the interaction
- Correct handler called based on action state

**Files to Modify:**
- `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`

---

#### Task Group 3: Connect Props Through Component Chain
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete prop chain connection
  - [x] 3.1 Write 2 focused integration tests for prop chain
    - File: `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts`
    - Test 1: PalettePanel should pass `action` prop to context menu for interactions
    - Test 2: PalettePanel should pass delete handler to context menu for interactions
  - [x] 3.2 Verify action prop is passed from PalettePanel to PaletteContextMenu
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Location: Lines 2184-2203 (PaletteContextMenu rendering)
    - Check if `action` prop is already passed; if not, add it
    - Need to compute action for context menu item (similar to PaletteSection)
  - [x] 3.3 Add onDeleteRelationship handler to PalettePanel context menu
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create a new handler or reuse existing `handleDeleteUserInteraction`
    - Pass as `onDeleteRelationship` prop to `PaletteContextMenu`
    - **Add to PaletteContextMenu props:**
    ```tsx
    onDeleteRelationship={(item, sectionId) => {
      if (sectionId === 'interactions') {
        handleDeleteUserInteraction(item);
      }
    }}
    ```
  - [x] 3.4 Add action computation for context menu relationship items
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create helper function to compute action based on existing edges:
    ```tsx
    const getContextMenuRelationshipAction = (): 'add' | 'delete' => {
      if (!contextMenuState || !diagram) return 'add';
      if (contextMenuState.sectionId !== 'interactions') return 'add';

      const existingEdges = (diagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === contextMenuState.item.id
      );

      return existingEdges.length > 0 ? 'delete' : 'add';
    };
    ```
  - [x] 3.5 Ensure prop chain tests pass
    - Run ONLY the tests written in 3.1
    - Verify action prop flows correctly
    - Verify delete handler is connected

**Acceptance Criteria:**
- The 2 tests written in 3.1 pass
- `action` prop correctly passed to context menu based on edge existence
- Delete handler connected and functional for User Interactions
- Clicking "Delete" removes all USER_INTERACTION edges for that interaction

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`

---

### CSS Cleanup Layer

#### Task Group 4: CSS Cleanup (Optional)
**Dependencies:** Task Groups 1-3

- [x] 4.0 Clean up unused CSS classes
  - [x] 4.1 Identify unused CSS classes in PaletteItem.module.css
    - File: `frontend/src/components/DiagramsView/PaletteItem.module.css`
    - Classes to review:
      - `.itemRelationshipDelete` (lines 54-56) - no longer applied
      - `.itemRelationshipDelete:hover` (lines 58-60) - no longer applied
      - `.actionIndicatorAdd` (lines 83-91) - no longer rendered
      - `.actionIndicatorDelete` (lines 93-101) - no longer rendered
  - [x] 4.2 Comment out or remove unused CSS classes
    - **Option A (Recommended):** Comment out with deprecation note
    ```css
    /* DEPRECATED: Removed in standardise-user-interaction-palette-ui spec
    .itemRelationshipDelete {
      background-color: #fff3f3;
    }
    ...
    */
    ```
    - **Option B:** Remove entirely if confident they won't be needed

**Acceptance Criteria:**
- CSS file is tidy
- Unused classes are either removed or documented as deprecated
- No visual regressions

**Files to Modify:**
- `frontend/src/components/DiagramsView/PaletteItem.module.css`

---

### Testing Layer

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-3
    - Review the 2-4 tests written for PaletteItem (Task 1.1)
    - Review the 3-4 tests written for PaletteContextMenu (Task 2.1)
    - Review the 2 tests written for prop chain (Task 3.1)
    - Total existing tests: approximately 7-10 tests
  - [x] 5.2 Analyse test coverage gaps for THIS feature only
    - Focus ONLY on gaps related to this spec's feature requirements
    - Check for end-to-end workflow coverage (add -> verify -> delete -> verify)
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 3 additional strategic tests maximum (if needed)
    - Potential gaps:
      - Integration test: Full add/delete cycle via context menu
      - Regression test: Other relationship sections unaffected
      - Tooltip consistency test
    - Skip edge cases unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 7-13 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 7-13 tests total)
- Critical user workflows for this feature are covered
- No more than 3 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

**Files to Create/Modify:**
- `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts`

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Parallel):
  - Task Group 1: PaletteItem Visual Standardisation
  - Task Group 2: PaletteContextMenu Dynamic Add/Delete

Phase 2 (Sequential):
  - Task Group 3: Connect Props Through Component Chain (depends on 1 & 2)

Phase 3 (Optional):
  - Task Group 4: CSS Cleanup (depends on 1-3)

Phase 4 (Final):
  - Task Group 5: Test Review and Gap Analysis (depends on 1-4)
```

---

## File Summary

### Files to Modify

| File | Change Description |
|------|-------------------|
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Remove action indicator badge, remove delete-state className, update tooltip |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Add action/onDeleteRelationship props, update renderRelationshipMenu() |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Pass action prop and delete handler to context menu |
| `frontend/src/components/DiagramsView/PaletteItem.module.css` | Optional: comment out/remove unused CSS classes |

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts` | Unit and integration tests for UI standardisation |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking left-click toggle | Low | High | Only changing visual elements, not click logic in handleAddRelationship |
| Delete handler not connected | Medium | Medium | Task 3 specifically verifies prop chain; handler already exists |
| Affecting other sections | Low | Medium | Changes scoped to relationship itemType and 'interactions' sectionId |
| CSS breaking other components | Low | Low | CSS classes are scoped to PaletteItem module |

---

## Success Criteria

The implementation is successful when:

1. **Visual Consistency (AC1):**
   - User Interaction rows look identical to other relationship rows
   - No inline "Add"/"Remove" badge visible
   - No special pink/red background when edges exist
   - Standard blue hover effect for all enabled relationship rows

2. **Context Menu Consistency (AC2):**
   - Right-click shows "Add" when no edges exist
   - Right-click shows "Delete" when edges exist
   - Clicking performs the correct action

3. **Preserved Functionality (AC3):**
   - Left-click toggle still works (add when no edges, delete when edges exist)

4. **Terminology Consistency (AC4):**
   - The word "Remove" no longer appears in User Interaction UI
   - Only "Add" and "Delete" are used

5. **No Regressions (AC5):**
   - Other palette sections (Applications, Business Processes, etc.) work unchanged
   - Other relationship sections work unchanged

6. **Tests Pass:**
   - All 7-13 feature-specific tests pass

---

## Implementation Summary

**Date Completed:** 2025-12-12

**Tests Written:** 17 tests (all passing)

**Files Modified:**
- `frontend/src/components/DiagramsView/PaletteItem.tsx` - Removed action indicator badge and delete-state className logic
- `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` - Added action prop and onDeleteRelationship handler, updated renderRelationshipMenu()
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Added getContextMenuRelationshipAction(), handleContextMenuDeleteRelationship(), passed action and onDeleteRelationship props
- `frontend/src/components/DiagramsView/PaletteItem.module.css` - Commented out unused CSS classes with deprecation notes

**Files Created:**
- `frontend/src/__tests__/standardise-user-interaction-palette-ui.test.ts` - 17 tests covering all task groups
