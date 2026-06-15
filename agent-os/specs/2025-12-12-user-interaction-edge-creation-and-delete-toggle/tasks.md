# Task Breakdown: User Interaction Edge Creation and Add/Delete Toggle

## Overview
Total Tasks: 15
Estimated Complexity: Medium

## Context

### Current State
- Edge creation functions exist and are complete (`addUserInteractionToDiagram`, etc.)
- Click handler routing exists but may not be working end-to-end
- Row enable/disable logic works, but no Delete action when edges exist
- Edge rendering for dotted lines is implemented

### What's Missing
1. Verify/fix edge creation flow from palette click to diagram update
2. Implement Delete action for interaction rows when edges exist
3. Create Add/Delete toggle UI in palette rows

## Task List

### Task Group 1: Diagnose Edge Creation Flow
**Dependencies:** None

Verify that clicking "Add" on an interaction row actually creates and renders edges.

- [x] 1.0 Complete edge creation diagnosis
  - [x] 1.1 Add diagnostic logging to `handleAddUserInteraction()` in PalettePanel.tsx
    - Log when function is called
    - Log the interaction being processed
    - Log the result from `addUserInteractionToDiagram()`
    - Log when `onAddEdge()` is called
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx` (lines 782-823)
  - [x] 1.2 Verify `onAddEdge` prop is connected
    - Trace `onAddEdge` from PalettePanel to parent component
    - Verify it dispatches to ArchitectureContext reducer
    - Check ADD_EDGE action in reducer handles the edge correctly
    - Files: PalettePanel.tsx, DiagramsView.tsx, ArchitectureContext.tsx
  - [x] 1.3 Test edge creation manually
    - Run application
    - Open diagram with required nodes
    - Click enabled interaction row
    - Check console for logs
    - Check if edges appear in diagram state (React DevTools)
    - Document findings
  - [x] 1.4 Fix any issues found in edge creation flow
    - Apply fixes based on diagnosis
    - Ensure edges are added to diagram state
    - Ensure Canvas receives and renders the edges

**Acceptance Criteria:**
- Clicking "Add" successfully creates MAIN edge (and USER_LINK if applicable)
- Edges appear visually on the canvas as dotted lines
- Label appears at midpoint of MAIN edge

**Files to Examine/Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/contexts/ArchitectureContext.tsx`

---

### Task Group 2: Implement Delete Action State
**Dependencies:** Task Group 1

Update `PaletteSection.tsx` to return "delete" action when edges exist.

- [x] 2.0 Complete delete action state implementation
  - [x] 2.1 Update `getRelationshipInfo()` to return action type
    - Add `action: 'add' | 'delete'` to return type
    - When edges exist for interaction: return `{ enabled: true, action: 'delete' }`
    - When no edges and can add: return `{ enabled: true, action: 'add' }`
    - When disabled: return `{ enabled: false, action: 'add' }`
    - File: `frontend/src/components/DiagramsView/PaletteSection.tsx` (lines 51-124)
  - [x] 2.2 Update `RelationshipInfo` type definition
    - Add optional `action` field to type
    - Ensure backward compatibility with other sections
    - File: `frontend/src/components/DiagramsView/PaletteSection.tsx`
  - [x] 2.3 Pass action to PaletteItem
    - Update PaletteSection to pass action prop to items
    - Ensure interactions section uses the new action field
    - File: `frontend/src/components/DiagramsView/PaletteSection.tsx`

**Acceptance Criteria:**
- `getRelationshipInfo()` returns correct action based on edge existence
- Action is passed through to PaletteItem component

**Files to Modify:**
- `frontend/src/components/DiagramsView/PaletteSection.tsx`

---

### Task Group 3: Implement Delete Handler
**Dependencies:** Task Group 2

Add handler to delete all edges for an interaction.

- [x] 3.0 Complete delete handler implementation
  - [x] 3.1 Create `handleDeleteUserInteraction()` function
    - Find all USER_INTERACTION edges for the given interaction ID
    - Delete each edge (cascade handled by reducer)
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    ```typescript
    const handleDeleteUserInteraction = useCallback((interactionId: string) => {
      if (!activeDiagram) return;

      const edgesToDelete = (activeDiagram.diagram_edges || []).filter(
        edge =>
          edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
          edge.relationship_id === interactionId
      );

      edgesToDelete.forEach(edge => {
        onDeleteEdge(edge.id);
      });
    }, [activeDiagram, onDeleteEdge]);
    ```
  - [x] 3.2 Update `handleItemClick()` to route delete action
    - Check action type for interactions section
    - Route to `handleDeleteUserInteraction()` when action is 'delete'
    - Route to `handleAddUserInteraction()` when action is 'add'
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
  - [x] 3.3 Verify cascade deletion works
    - When MAIN edge is deleted, USER_LINK should also be deleted
    - Check `shouldCascadeDeleteUserLink()` is called in reducer
    - File: `frontend/src/contexts/ArchitectureContext.tsx`

**Acceptance Criteria:**
- Clicking a "delete" action row removes all edges for that interaction
- Cascade deletion removes USER_LINK when MAIN is deleted
- After deletion, row returns to "add" action state

**Files to Modify:**
- `frontend/src/components/DiagramsView/PalettePanel.tsx`

---

### Task Group 4: Update UI for Add/Delete Toggle
**Dependencies:** Task Groups 2 and 3

Update PaletteItem to visually indicate Add vs Delete action.

- [x] 4.0 Complete UI toggle implementation
  - [x] 4.1 Update PaletteItem props interface
    - Add optional `action?: 'add' | 'delete'` prop
    - File: `frontend/src/components/DiagramsView/PaletteItem.tsx`
  - [x] 4.2 Update PaletteItem rendering for delete state
    - Show visual indicator when action is 'delete' (e.g., different icon, "Remove" text)
    - Maintain enabled styling (not disabled)
    - Use different hover color for delete action
    - File: `frontend/src/components/DiagramsView/PaletteItem.tsx`
  - [x] 4.3 Add CSS styles for delete action state
    - Add class for delete state styling
    - Consider using red/warning color for delete action
    - File: `frontend/src/components/DiagramsView/PaletteItem.module.css` or similar

**Acceptance Criteria:**
- Rows with "add" action show standard enabled styling
- Rows with "delete" action show distinct visual indicator
- Both states are clickable and respond to hover

**Files to Modify:**
- `frontend/src/components/DiagramsView/PaletteItem.tsx`
- `frontend/src/components/DiagramsView/PaletteItem.module.css` (or similar)

---

### Task Group 5: Write Tests and Verify
**Dependencies:** Task Groups 1-4

Write tests and verify the complete flow.

- [x] 5.0 Complete testing and verification
  - [x] 5.1 Write unit tests for add/delete toggle
    - Test `getRelationshipInfo()` returns correct action
    - Test `handleAddUserInteraction()` creates edges
    - Test `handleDeleteUserInteraction()` removes edges
    - File: `frontend/src/__tests__/user-interaction-add-delete-toggle.test.ts`
  - [x] 5.2 Run all related tests
    - Run user-interaction* tests
    - Run palette* tests
    - Verify no regressions
  - [x] 5.3 Manual verification
    - Test Case A: Add interaction with P+S, verify MAIN and USER_LINK edges
    - Test Case B: Add interaction with P only, verify MAIN edge
    - Test Delete: Click delete, verify edges removed
    - Test Re-add: After delete, verify can add again
    - Verify dotted line rendering
    - Verify label at midpoint
  - [x] 5.4 Remove diagnostic logging
    - Remove any console.log statements added for debugging
    - Clean up temporary code

**Acceptance Criteria:**
- All tests pass
- Manual verification confirms Add/Delete flow works
- No debug code remains

**Files to Create:**
- `frontend/src/__tests__/user-interaction-add-delete-toggle.test.ts`

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1 (Diagnose Edge Creation) <- First priority, may reveal issues
2. Task Group 2 (Delete Action State)    <- Foundation for toggle
3. Task Group 3 (Delete Handler)         <- Core delete functionality
4. Task Group 4 (UI Toggle)              <- Visual feedback
5. Task Group 5 (Tests & Verification)   <- Final validation
```

---

## File Summary

### Files to Modify
| File | Change Description |
|------|-------------------|
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Add action to getRelationshipInfo return |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Add handleDeleteUserInteraction, update click routing |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Add action prop, visual toggle |
| `frontend/src/components/DiagramsView/PaletteItem.module.css` | Delete action styling |

### Files to Create
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-add-delete-toggle.test.ts` | Tests for add/delete functionality |

### Files to Verify
| File | Verification |
|------|--------------|
| `frontend/src/utils/userInteractionUtils.ts` | Edge creation functions |
| `frontend/src/contexts/ArchitectureContext.tsx` | ADD_EDGE and DELETE_EDGE handlers |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Edge rendering |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Edge creation callback not connected | Medium | High | Task 1.2 traces full callback chain |
| Cascade deletion not triggering | Low | Medium | Task 3.3 verifies cascade logic |
| UI changes break other palette sections | Low | Medium | Action prop is optional |
| State not updating after operations | Medium | Medium | Verify reducer handles correctly |

---

## Technical Notes

### Edge Types
```typescript
// MAIN edge: Connects P-S (Case A) or U-P (Case B)
{
  relationship_type: 'USER_INTERACTION',
  relationship_id: interaction.id,
  subType: 'MAIN',
  line_dashes: '4,4',
  label_text: interaction.name,
}

// USER_LINK edge: Connects User to MAIN midpoint (Case A only)
{
  relationship_type: 'USER_INTERACTION',
  relationship_id: interaction.id,
  subType: 'USER_LINK',
  line_dashes: '4,4',
  target_node_id: 'midpoint-{interaction.id}',
}
```

### Action Determination Logic
```typescript
// In getRelationshipInfo for interactions:
const existingEdges = edges.filter(e =>
  e.relationship_type === 'USER_INTERACTION' &&
  e.relationship_id === item.id
);

if (existingEdges.length > 0) {
  return { enabled: true, disabledReason: null, action: 'delete' };
}

if (canAdd) {
  return { enabled: true, disabledReason: null, action: 'add' };
}

return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
```

---

## Success Criteria

The implementation is successful when:
1. Clicking "Add" on enabled interaction row creates visible dotted edges
2. After adding, row shows "Delete" action
3. Clicking "Delete" removes all edges for the interaction
4. After deleting, row returns to "Add" action (if nodes still present)
5. Visual feedback distinguishes Add vs Delete states
6. All automated tests pass
