# Specification: Standardise User Interaction Palette Row UI and Context Menu Behaviour

## 1. Overview

### 1.1 Problem Statement

The "User Interactions" rows in the Diagrams RHS palette currently have custom UI elements that differ from all other palette sections:

1. **Inline Action Badge**: Each row displays an "Add" (blue) or "Remove" (red) badge on the right side
2. **Special Row Styling**: Pink/red background (`#fff3f3`) when edges exist, special hover colours
3. **Inconsistent Context Menu**: Always shows "Add" even when edges exist and should show "Delete"

This creates visual inconsistency and confuses users who expect palette sections to behave uniformly.

### 1.2 Current Implementation

**Location**: `frontend/src/components/DiagramsView/PaletteItem.tsx` (lines 130-134)

```tsx
{itemType === 'relationship' && isRelationshipEnabled && (
  <div className={isDeleteAction ? styles.actionIndicatorDelete : styles.actionIndicatorAdd}>
    {isDeleteAction ? 'Remove' : 'Add'}
  </div>
)}
```

**Styling**: `frontend/src/components/DiagramsView/PaletteItem.module.css`

```css
/* Lines 54-60 - Delete state row styling */
.itemRelationshipDelete {
  background-color: #fff3f3;  /* Light pink/red background */
}

.itemRelationshipDelete:hover {
  background: #ffebeb;
}

/* Lines 82-101 - Action indicator badges */
.actionIndicatorAdd {
  font-size: 10px;
  color: #1976d2;
  background-color: #e3f2fd;
  padding: 2px 6px;
  border-radius: 3px;
}

.actionIndicatorDelete {
  font-size: 10px;
  color: #d32f2f;
  background-color: #ffebee;
  padding: 2px 6px;
  border-radius: 3px;
}
```

**Context Menu**: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` (lines 257-277)
- Always renders "Add" for relationship items
- Does not check `action` prop to show "Delete" when edges exist

### 1.3 Goals

1. Remove the inline "Add"/"Remove" action indicator badge from User Interaction rows
2. Remove the special pink/red row styling for delete state
3. Update context menu to show "Delete" when edges exist (matching entity row behaviour)
4. Maintain existing left-click toggle functionality (add when no edges, delete when edges exist)
5. Ensure User Interaction rows look and behave like other palette relationship rows

### 1.4 Non-Goals

- Changing the underlying add/delete logic (already works correctly)
- Modifying how other relationship sections behave
- Changing the enabled/disabled logic for interactions

## 2. Technical Design

### 2.1 Remove Inline Action Indicator Badge

**File**: `frontend/src/components/DiagramsView/PaletteItem.tsx`

Remove the conditional rendering of the action indicator:

**Before (lines 130-134)**:
```tsx
{itemType === 'relationship' && isRelationshipEnabled && (
  <div className={isDeleteAction ? styles.actionIndicatorDelete : styles.actionIndicatorAdd}>
    {isDeleteAction ? 'Remove' : 'Add'}
  </div>
)}
```

**After**:
```tsx
{/* Action indicator removed - use context menu for Add/Delete */}
```

Or simply delete lines 130-134 entirely.

### 2.2 Remove Special Row Styling for Delete State

**File**: `frontend/src/components/DiagramsView/PaletteItem.tsx`

Update the row className logic to not apply special delete styling:

**Before (approximate line 85-95)**:
```tsx
const itemClassName = useMemo(() => {
  if (itemType === 'relationship') {
    if (isDeleteAction) {
      return `${styles.item} ${styles.itemRelationship} ${styles.itemRelationshipDelete}`;
    }
    if (isRelationshipEnabled) {
      return `${styles.item} ${styles.itemRelationship} ${styles.itemRelationshipEnabled}`;
    }
    return `${styles.item} ${styles.itemRelationship} ${styles.itemRelationshipDisabled}`;
  }
  // ...
}, [itemType, isDeleteAction, isRelationshipEnabled, isOnDiagram]);
```

**After**:
```tsx
const itemClassName = useMemo(() => {
  if (itemType === 'relationship') {
    // Remove special delete state styling - use standard enabled/disabled only
    if (isRelationshipEnabled) {
      return `${styles.item} ${styles.itemRelationship} ${styles.itemRelationshipEnabled}`;
    }
    return `${styles.item} ${styles.itemRelationship} ${styles.itemRelationshipDisabled}`;
  }
  // ...
}, [itemType, isRelationshipEnabled, isOnDiagram]);
```

### 2.3 Update Context Menu to Show Dynamic Add/Delete

**File**: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`

Update `renderRelationshipMenu()` to check the `action` prop:

**Before (lines 257-277)**:
```tsx
const renderRelationshipMenu = () => {
  const handleAddClick = () => {
    if (isRelationshipEnabled && onAddRelationship) {
      handleMenuItemClick(onAddRelationship);
    }
  };

  return (
    <>
      <div
        className={`${styles.menuItem} ${!isRelationshipEnabled ? styles.menuItemDisabled : ''}`}
        onClick={handleAddClick}
      >
        Add
      </div>
    </>
  );
};
```

**After**:
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

  return (
    <>
      <div
        className={`${styles.menuItem} ${!isRelationshipEnabled ? styles.menuItemDisabled : ''}`}
        onClick={handleActionClick}
      >
        {isDeleteAction ? 'Delete' : 'Add'}
      </div>
    </>
  );
};
```

### 2.4 Ensure Props are Passed Correctly

**File**: `frontend/src/components/DiagramsView/PaletteSection.tsx`

Verify that the `action` prop is passed to `PaletteContextMenu`:

```tsx
<PaletteContextMenu
  // ... other props
  action={relationshipInfo.action}
  onAddRelationship={handleAddRelationship}
  onDeleteRelationship={handleDeleteRelationship}
  // ...
/>
```

**File**: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`

Add `onDeleteRelationship` to props interface if not already present:

```tsx
interface PaletteContextMenuProps {
  // ... existing props
  action?: 'add' | 'delete';
  onDeleteRelationship?: () => void;
}
```

### 2.5 CSS Cleanup (Optional)

**File**: `frontend/src/components/DiagramsView/PaletteItem.module.css`

The following CSS classes can be removed or kept for potential future use:

```css
/* Can be removed - no longer used */
.itemRelationshipDelete { ... }
.itemRelationshipDelete:hover { ... }
.actionIndicatorAdd { ... }
.actionIndicatorDelete { ... }
```

## 3. Acceptance Criteria

### AC1 - Visual Consistency
- User Interaction rows have the same base styling as other relationship sections
- No inline "Add"/"Remove" badge appears on the right side of rows
- No special pink/red background when edges exist
- Standard blue hover effect for enabled relationship rows

### AC2 - Context Menu Consistency
- For a User Interaction **not** on the diagram (no USER_INTERACTION edges):
  - Right-click context menu shows **"Add"**
  - Choosing "Add" creates the dotted edges + label

- For a User Interaction **on** the diagram (USER_INTERACTION edges exist):
  - Right-click context menu shows **"Delete"**
  - Choosing "Delete" removes all edges for that interaction

### AC3 - Left-Click Behaviour Preserved
- Left-clicking an enabled User Interaction row still toggles:
  - If no edges → adds edges (same as "Add")
  - If edges exist → removes edges (same as "Delete")

### AC4 - No "Remove" Label
- The word "Remove" no longer appears anywhere in the User Interaction UI
- Only "Add" and "Delete" are used, consistent with entity sections

### AC5 - Other Sections Unaffected
- Applications, Business Processes, Services, etc. continue to work as before
- Other relationship sections (Business User <-> Business Point, etc.) unchanged

## 4. Test Plan

### 4.1 Unit Tests

```typescript
describe('PaletteItem - User Interaction row styling', () => {
  it('should not render action indicator badge for relationship items', () => {
    // Render a relationship item with action='add'
    // Assert no .actionIndicatorAdd or .actionIndicatorDelete element exists
  });

  it('should not apply itemRelationshipDelete class when action is delete', () => {
    // Render a relationship item with action='delete'
    // Assert className does not include itemRelationshipDelete
  });

  it('should apply standard enabled styling for relationship items', () => {
    // Render an enabled relationship item
    // Assert className includes itemRelationshipEnabled
  });
});

describe('PaletteContextMenu - Relationship menu', () => {
  it('should show "Add" when action is add', () => {
    // Render context menu with action='add'
    // Assert menu item text is "Add"
  });

  it('should show "Delete" when action is delete', () => {
    // Render context menu with action='delete'
    // Assert menu item text is "Delete"
  });

  it('should call onDeleteRelationship when Delete is clicked', () => {
    // Render with action='delete' and mock onDeleteRelationship
    // Click the menu item
    // Assert onDeleteRelationship was called
  });
});
```

### 4.2 Manual Verification

1. Open a diagram with required nodes for User Interactions
2. Verify User Interaction rows look like other relationship rows (no badge)
3. Right-click an interaction not on diagram → should show "Add"
4. Click "Add" → edges appear
5. Right-click same interaction → should now show "Delete"
6. Click "Delete" → edges removed
7. Left-click behaviour still works (toggle add/delete)

## 5. Files Summary

### Files to Modify

| File | Change Description |
|------|-------------------|
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Remove action indicator badge, remove delete state className |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Update renderRelationshipMenu to show "Add"/"Delete" based on action prop |
| `frontend/src/components/DiagramsView/PaletteItem.module.css` | Optional: remove unused CSS classes |

### Files to Verify

| File | Verification |
|------|-------------|
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Ensure action prop passed correctly |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Ensure delete handler connected |

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking left-click toggle behaviour | Low | High | Only changing visual elements, not logic |
| Affecting other relationship sections | Low | Medium | Changes scoped to styling/context menu only |
| Missing delete handler connection | Medium | Medium | Verify prop chain from Section to ContextMenu |

## 7. Implementation Notes

### 7.1 Existing Logic Reuse

The `action` property is already computed correctly in `PaletteSection.tsx`:

```tsx
if (sectionId === 'interactions') {
  const existingEdges = (diagram.diagram_edges || []).filter(
    edge =>
      edge.relationship_type === RELATIONSHIP_EDGE_TYPES.USER_INTERACTION &&
      edge.relationship_id === item.id
  );

  if (existingEdges.length > 0) {
    return { enabled: true, disabledReason: null, action: 'delete' };
  }
  // ...
  return { enabled: true, disabledReason: null, action: 'add' };
}
```

This logic is correct and should not be changed. The context menu just needs to use this `action` value.

### 7.2 Delete Handler

The delete handler already exists in `PalettePanel.tsx` (`handleDeleteUserInteraction`). Ensure it's passed through the prop chain to the context menu.
