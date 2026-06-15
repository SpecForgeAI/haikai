# Specification: User Interaction Edge Creation on "Add" and Toggle Row Action to "Delete"

## 1. Overview

### 1.1 Problem Statement

The User Interaction palette rows have working enablement logic (enabled when required nodes are present), but two critical features are missing:

1. **Clicking "Add" does not visibly add edges** - The `handleAddUserInteraction()` function is called but edges may not be added to the diagram state correctly, or the diagram is not re-rendering.

2. **No "Delete" action toggle** - After edges exist, the row becomes disabled with "Already visualised" tooltip instead of showing a "Delete" action like other palette sections.

### 1.2 Current Implementation Status

Based on codebase analysis:

| Component | Status | Location |
|-----------|--------|----------|
| Edge creation functions | ✅ Complete | `userInteractionUtils.ts` |
| `addUserInteractionToDiagram()` | ✅ Complete | Lines 597-678 |
| `createUserInteractionMainEdge()` | ✅ Complete | Lines 464-505 |
| `createUserInteractionUserLinkEdge()` | ✅ Complete | Lines 531-568 |
| Click handler routing | ✅ Complete | `PalettePanel.tsx` line 832 |
| `handleAddUserInteraction()` | ⚠️ Exists | Lines 782-823, may have issues |
| Edge rendering (dotted lines) | ✅ Complete | `rendering.ts` lines 1451-1481 |
| **Delete action for rows** | ❌ Missing | N/A |
| **Add/Delete toggle UX** | ❌ Missing | N/A |

### 1.3 Goals

1. Ensure clicking "Add" successfully creates and renders USER_INTERACTION edges on the diagram
2. Implement "Delete" action for interaction rows when edges exist
3. Create visual Add/Delete toggle in palette rows consistent with other sections

### 1.4 Non-Goals

- Changing the underlying data model for edges
- Modifying edge rendering logic (already works correctly)
- Changing Case A/B determination logic (already correct)

## 2. Technical Analysis

### 2.1 Edge Creation Flow

Current flow in `handleAddUserInteraction()` (PalettePanel.tsx lines 782-823):

```typescript
const handleAddUserInteraction = useCallback((interactionId: string) => {
  // 1. Find interaction in metaModel
  const interaction = metaModel.entities.interactions?.find(i => i.id === interactionId);

  // 2. Create full Diagram object
  const fullDiagram: Diagram = {
    id: activeDiagram.id,
    name: activeDiagram.name,
    description: '',
    diagram_nodes: activeDiagram.diagram_nodes,
    diagram_edges: activeDiagram.diagram_edges || [],
  };

  // 3. Validate enabled
  const isEnabled = isUserInteractionRowEnabled(interaction, fullDiagram, metaModel);
  if (!isEnabled) return;

  // 4. Call edge creation
  const result = addUserInteractionToDiagram(interaction, fullDiagram, metaModel);

  // 5. Add edges via callback
  onAddEdge(result.mainEdge);
  if (result.userLinkEdge) {
    onAddEdge(result.userLinkEdge);
  }
}, [...]);
```

**Potential Issue:** Need to verify that `onAddEdge` is properly wired up and the diagram state is updated.

### 2.2 Missing Delete Action

When edges exist for an interaction:
- Current: Row is disabled with `disabledReason: 'already_visualised'`
- Expected: Row should be enabled with action "Delete"

The `getRelationshipInfo()` function in PaletteSection.tsx needs to return a different state when edges exist:
- `enabled: true`
- `action: 'delete'`

### 2.3 Edge Deletion Requirements

When "Delete" is clicked for an interaction:
1. Find all edges with `relationship_type === 'USER_INTERACTION'` and `relationship_id === interactionId`
2. Delete MAIN edge (cascade logic will handle USER_LINK deletion)
3. After deletion, row returns to "Add" state

## 3. Technical Design

### 3.1 Fix Edge Creation (if needed)

Verify `onAddEdge` callback is working:

**File:** `PalettePanel.tsx`

Check that `onAddEdge` prop is:
1. Passed correctly from parent (DiagramsView.tsx)
2. Dispatches to ArchitectureContext reducer
3. Reducer handles ADD_EDGE action correctly

If `onAddEdge` is working but edges don't render, check:
1. Edge is added to `diagram.diagram_edges` array
2. Canvas component receives updated edges
3. Edge rendering logic handles USER_INTERACTION type

### 3.2 Implement Delete Action

#### 3.2.1 Update Row State Model

**File:** `PaletteSection.tsx`

Update `getRelationshipInfo()` to return different state when edges exist:

```typescript
if (sectionId === 'interactions') {
  const interaction = metaModel.entities.interactions?.find(i => i.id === item.id);
  if (!interaction) {
    return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
  }

  // Check if edges already exist
  const existingEdges = (diagram.diagram_edges || []).filter(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === item.id
  );

  if (existingEdges.length > 0) {
    // Edges exist - enable Delete action
    return { enabled: true, disabledReason: null, action: 'delete' };
  }

  // No edges - check if can add
  const fullDiagram: Diagram = { ... };
  const canAdd = isUserInteractionRowEnabled(interaction, fullDiagram, metaModel);

  if (canAdd) {
    return { enabled: true, disabledReason: null, action: 'add' };
  }

  return { enabled: false, disabledReason: 'endpoints_missing', action: 'add' };
}
```

#### 3.2.2 Add Delete Handler

**File:** `PalettePanel.tsx`

Add handler to delete interaction edges:

```typescript
const handleDeleteUserInteraction = useCallback((interactionId: string) => {
  if (!activeDiagram) return;

  // Find all edges for this interaction
  const edgesToDelete = (activeDiagram.diagram_edges || []).filter(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === interactionId
  );

  // Delete each edge (cascade handled by reducer)
  edgesToDelete.forEach(edge => {
    onDeleteEdge(edge.id);
  });
}, [activeDiagram, onDeleteEdge]);
```

#### 3.2.3 Update Click Handler

**File:** `PalettePanel.tsx`

Update `handleItemClick` to route to delete handler when action is 'delete':

```typescript
const handleItemClick = useCallback((sectionId: string, item: PaletteItem) => {
  if (sectionId === 'interactions') {
    const info = getRelationshipInfo(item);
    if (info.action === 'delete') {
      handleDeleteUserInteraction(item.id);
    } else {
      handleAddUserInteraction(item.id);
    }
    return;
  }
  // ... rest of handler
}, [...]);
```

### 3.3 Update UI to Show Add/Delete

**File:** `PaletteItem.tsx`

Update item rendering to show appropriate action text:

```typescript
interface PaletteItemProps {
  // ... existing props
  action?: 'add' | 'delete';
}

// In render:
<div className={...}>
  <span>{item.name}</span>
  {action === 'delete' && (
    <span className={styles.actionIndicator}>Remove</span>
  )}
</div>
```

Or use different styling/icon for delete state.

### 3.4 Verify Edge Rendering

Ensure USER_INTERACTION edges render correctly:

**File:** `Canvas.tsx`

The edge rendering should already work via `getEdgeStrokeStyle()` which applies `line_dashes: '4,4'` as dotted stroke. Verify:

1. USER_INTERACTION edges are included in the edges passed to render
2. `getEdgeStrokeStyle()` is called for all edges
3. Dotted pattern appears visually

## 4. Acceptance Criteria

### AC1 - Adding Case A Interaction

Given:
- Interaction I with User="My User", Primary="My App" ABP, Secondary="Your App" ABP
- User, "My App", and "Your App" nodes on diagram
- No USER_INTERACTION edges exist

When: Click interaction row (Add action)

Then:
- MAIN dotted edge drawn between "My App" and "Your App" nodes
- Label with Interaction name at midpoint of MAIN edge
- USER_LINK dotted edge from "My User" to MAIN edge midpoint (if User node present)
- Row action changes to "Delete"

### AC2 - Adding Case B Interaction

Given:
- Interaction I with User="My User", Primary="My App" ABP, no Secondary
- User and "My App" nodes on diagram
- No edges exist

When: Click interaction row (Add action)

Then:
- MAIN dotted edge drawn between "My User" and "My App" nodes
- Label with Interaction name at midpoint
- Row action changes to "Delete"

### AC3 - Deleting Interaction Edges

Given:
- Interaction I with edges on diagram
- Row shows "Delete" action

When: Click interaction row (Delete action)

Then:
- All USER_INTERACTION edges for I are removed
- Dotted lines and label disappear
- Row action changes back to "Add" (enabled if nodes still present)

### AC4 - Row State Consistency

- When no edges exist and nodes present: Row enabled, action="Add"
- When edges exist: Row enabled, action="Delete"
- When nodes missing: Row disabled, action="Add" (greyed out)

### AC5 - No-op Prevention

- If preconditions fail during Add (e.g., node deleted during operation):
  - Show error/warning
  - Do not create partial edges

## 5. Test Plan

### 5.1 Unit Tests

```typescript
describe('User Interaction Add/Delete Toggle', () => {
  describe('handleAddUserInteraction', () => {
    it('creates MAIN edge for Case A interaction', () => {
      // Setup: Interaction with P+S, nodes on diagram, no edges
      // Action: Call handleAddUserInteraction
      // Assert: MAIN edge created with correct properties
    });

    it('creates USER_LINK edge when User node present (Case A)', () => {
      // Setup: Case A with User node
      // Action: Call handleAddUserInteraction
      // Assert: Both MAIN and USER_LINK edges created
    });

    it('creates only MAIN edge for Case B interaction', () => {
      // Setup: Interaction with only P, User + P nodes on diagram
      // Action: Call handleAddUserInteraction
      // Assert: MAIN edge from User to P, no USER_LINK
    });
  });

  describe('handleDeleteUserInteraction', () => {
    it('deletes all edges for interaction', () => {
      // Setup: Interaction with MAIN and USER_LINK edges
      // Action: Call handleDeleteUserInteraction
      // Assert: All edges removed
    });

    it('re-enables Add action after deletion', () => {
      // Setup: Delete interaction edges
      // Assert: Row state changes to action='add'
    });
  });

  describe('getRelationshipInfo for interactions', () => {
    it('returns action=add when no edges exist', () => {
      // Assert: enabled=true, action='add'
    });

    it('returns action=delete when edges exist', () => {
      // Assert: enabled=true, action='delete'
    });

    it('returns disabled when nodes missing', () => {
      // Assert: enabled=false, action='add'
    });
  });
});
```

### 5.2 Integration Tests

- Test full flow: Add interaction → edges appear → click Delete → edges removed → Add available
- Test rendering: Verify dotted lines visible on canvas
- Test label: Verify label text and position correct

## 6. Files Summary

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Update `getRelationshipInfo()` to return action state |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Add `handleDeleteUserInteraction()`, update click routing |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Display action indicator (Add/Delete) |

### Files to Verify

| File | Verification |
|------|--------------|
| `frontend/src/utils/userInteractionUtils.ts` | Edge creation functions working |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Edge rendering includes USER_INTERACTION |
| `frontend/src/utils/rendering.ts` | Dotted line style applied |

### Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/__tests__/user-interaction-add-delete-toggle.test.ts` | Tests for Add/Delete functionality |

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `onAddEdge` not connected properly | Medium | High | Verify callback chain first |
| Edge rendering not including USER_INTERACTION | Low | High | Check Canvas edge filtering |
| Delete cascade not working | Low | Medium | Existing cascade logic verified |
| State not updating after delete | Medium | Medium | Ensure proper reducer handling |

## 8. Implementation Notes

### 8.1 Existing Functions to Reuse

From `userInteractionUtils.ts`:
- `addUserInteractionToDiagram()` - Creates edges
- `getInteractionEdgesOnDiagram()` - Finds existing edges
- `isUserInteractionRowEnabled()` - Validates enablement
- `shouldCascadeDeleteUserLink()` - Cascade logic

### 8.2 Edge Properties

MAIN edge properties (from `createUserInteractionMainEdge`):
```typescript
{
  id: generatePrefixedId('edge'),
  relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
  relationship_id: interaction.id,
  source_node_id: primaryNode.id,
  target_node_id: secondaryNode.id,
  subType: 'MAIN',
  line_dashes: LINE_DASHES_DOTTED, // '4,4'
  label_text: interaction.name,
  label_pos_x: midpoint.x,
  label_pos_y: midpoint.y,
  edge_points: [...],
}
```

USER_LINK edge properties:
```typescript
{
  id: generatePrefixedId('edge'),
  relationship_type: RELATIONSHIP_EDGE_TYPES.USER_INTERACTION,
  relationship_id: interaction.id,
  source_node_id: userNode.id,
  target_node_id: `midpoint-${interaction.id}`,
  subType: 'USER_LINK',
  line_dashes: LINE_DASHES_DOTTED,
  edge_points: [...],
}
```
