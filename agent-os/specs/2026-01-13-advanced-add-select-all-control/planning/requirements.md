# Spec Requirements: Global "Select All" Control for Advanced Add Diagram Modal

## Initial Description

The "Advanced Add" modal in the Diagram view allows users to select architecture entities and relationships (via a hierarchical checkbox tree) to add to a diagram. When adding complex interfaces or applications, users frequently want to include all nested items in the hierarchy, but currently must manually select each checkbox.

This feature adds a "Select All" checkbox control to the modal footer that allows users to fully select or fully deselect all items in the hierarchy with a single click. The modal width will also be increased to better accommodate deeply nested hierarchy labels.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the "Select All" checkbox should be positioned in the footer area, on the left side with the other layout controls (Spacing, Columns, Width), before the Cancel/Add buttons. Is that correct, or should it be placed in a distinct visual area (e.g., at the very bottom of the tree area as a divider)?
**Answer:** Yes, the footer area is correct. Position the "Select All" control on the left side of the footer, visually separated from the Cancel/Add buttons. It should be clearly associated with the tree above but in the footer control area.

**Q2:** I'm thinking the modal width increase should go from the current `max-width: 700px` to approximately `max-width: 900px` or `max-width: 950px`. Does that sound reasonable, or do you have a specific width target in mind?
**Answer:** Yes, increase to approximately `max-width: 900px` is reasonable. The goal is to accommodate deeply nested labels without wrapping, so 900px should provide adequate space.

**Q3:** I assume "all hierarchy checkboxes" means all non-root checkboxes should be affected by the Select All control (since the root checkbox is always checked and disabled). Is that correct?
**Answer:** Yes, "all hierarchy checkboxes" means all selectable checkboxes in the tree. The root is already checked and disabled, so it should not be affected. Only the child/nested items that are currently interactive should be toggled.

**Q4:** I notice the current tree has expand/collapse behavior. When "Select All" is checked, should it also expand all collapsed nodes so users can see all the checked items? Or should expansion state remain independent from selection state?
**Answer:** Expansion state should remain independent from selection state. Do NOT auto-expand nodes when Select All is used. Users can expand manually if they want to see the selections.

**Q5:** I assume the "Select All" checkbox should use the same checkbox styling as the tree node checkboxes (18x18px, accent-color: #1976D2). Is that correct, or should it be visually distinct (e.g., larger or different styling)?
**Answer:** Yes, use the same checkbox styling (18x18px, accent-color) for visual consistency. The Select All checkbox should look like the tree checkboxes but be positioned in the footer.

**Q6:** The raw idea mentions "no tri-state/indeterminate behavior" for the Select All checkbox. I assume this means the Select All checkbox is always either checked or unchecked (never showing the indeterminate dash), and we simply ignore its visual state after manual individual changes. Is that the intended behavior?
**Answer:** Correct. The Select All checkbox is always either checked or unchecked (never indeterminate). After manual individual changes, the Select All checkbox state is simply ignored/unsynced - it stays in whatever state it was last set to. Users can click it again to override all selections.

**Q7:** Is there anything specific you want to exclude from this feature, such as accessibility considerations, keyboard shortcuts for the Select All action, or specific edge cases?
**Answer:** No specific exclusions beyond what's in the raw idea. Standard accessibility (keyboard focusable, proper labels) is expected. No keyboard shortcuts needed for this feature.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Footer layout controls - Path: `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` (lines 1115-1187)
- Components to potentially reuse: Existing footer control containers (`.spacingControl`, `.layoutControl` CSS classes), checkbox styling from tree nodes (`.checkbox` class)
- Backend logic to reference: None (frontend-only feature)
- State management pattern: The existing `selectedKeys` state (useState with Set) at line 907-909

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - user confirmed this is a straightforward UI addition following existing patterns.

## Requirements Summary

### Functional Requirements
- Add a "Select All" checkbox control to the Advanced Add modal footer
- When the "Select All" checkbox is checked: all selectable (non-root) checkboxes in the hierarchy become checked
- When the "Select All" checkbox is unchecked: all selectable (non-root) checkboxes in the hierarchy become unchecked
- The "Select All" checkbox acts as a deterministic override (does not toggle relative to current state)
- Manual changes to individual tree checkboxes do NOT sync back to the "Select All" checkbox state
- The "Select All" checkbox never displays indeterminate state
- Increase modal width from 700px to 900px for better visibility of nested items
- Expansion/collapse state of tree nodes remains independent from selection state
- The "Add to Diagram" button continues to add exactly the items currently selected (no change to existing behavior)

### Reusability Opportunities
- Reuse existing footer layout pattern with `.spacingControl` / `.layoutControl` CSS classes
- Reuse existing checkbox styling (18x18px, accent-color: #1976D2)
- Leverage existing `selectedKeys` state (Set<string>) and `setSelectedKeys` setter
- Reference existing `getDescendantKeys()` helper function for traversing all tree nodes

### Scope Boundaries

**In Scope:**
- Adding "Select All" checkbox control to modal footer
- Implementing select all / deselect all functionality
- Increasing modal width to 900px
- Standard accessibility (keyboard focusable checkbox, proper label association)

**Out of Scope:**
- Tri-state/indeterminate checkbox behavior for Select All
- Automatic detection of "all selected" or "partially selected" states
- Auto-expanding collapsed nodes when Select All is used
- Keyboard shortcuts for Select All action
- Changes to backend APIs or data models
- Changes to which entity types can be added to diagrams
- Changes to diagram creation, persistence, or rendering logic

### Technical Considerations

**Files to Modify:**
1. `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
   - Add new state: `const [selectAllChecked, setSelectAllChecked] = useState<boolean>(false);`
   - Add handler function to collect all non-root node keys and update `selectedKeys`
   - Add Select All checkbox control to footer JSX

2. `frontend/src/components/DiagramsView/AdvancedAddDialog.module.css`
   - Update `.dialog` class: change `max-width: 700px` to `max-width: 900px`
   - Add new `.selectAllControl` class (following `.spacingControl` pattern)

**State Management Approach:**
- The `selectedKeys` state (Set<string>) already tracks selected node keys
- The root node key is always in `selectedKeys` and should not be removed
- To select all: collect all node keys from tree, add to `selectedKeys` (root already included)
- To deselect all: reset `selectedKeys` to contain only the root node key
- The `selectAllChecked` state is independent and only tracks the checkbox's own state

**Tree Traversal:**
- Use existing `getDescendantKeys()` function or similar recursive traversal
- Starting from `treeData` root, collect all `node.key` values except the root
- The tree structure is already built by `buildTreeData()` and available via `treeData`

**Integration Points:**
- No changes to `onAdd` callback or `AdvancedAddResult` type
- No changes to how selections are processed after "Add to Diagram" is clicked
- The feature only modifies the selection state within the modal
