# Specification: Global "Select All" Control for Advanced Add Diagram Modal

## Goal
Add a "Select All" checkbox control to the Advanced Add modal footer that allows users to fully select or fully deselect all hierarchy items with a single click, and increase modal width to 900px for better visibility of deeply nested labels.

## User Stories
- As a user adding complex entities to a diagram, I want to select all related items in the hierarchy with one click so that I can quickly include everything without manually checking each checkbox.
- As a user reviewing a hierarchy, I want to deselect all items at once so that I can start fresh with my selections.

## Specific Requirements

**Increase Modal Width**
- Change `.dialog` max-width from 700px to 900px in `AdvancedAddDialog.module.css`
- Provides adequate space for deeply nested hierarchy labels without text wrapping
- Maintains 90% width constraint for smaller viewports

**Add Select All Checkbox State**
- Add new state `selectAllChecked` (boolean, initially false) in `AdvancedAddDialog.tsx`
- State is independent from `selectedKeys` and does not auto-sync based on individual selections
- State only updates when user directly clicks the Select All checkbox

**Add Select All Change Handler**
- Create `handleSelectAllChange` function in `AdvancedAddDialog.tsx`
- When checked: collect all non-root node keys using `getDescendantKeys(treeData)` and add to `selectedKeys`
- When unchecked: reset `selectedKeys` to contain only the root node key
- Update `selectAllChecked` state to match the checkbox's new checked value

**Position Select All Control in Footer**
- Add Select All control on left side of footer, after the existing layout controls (Spacing, Columns, Width)
- Place before the `footerSpacer` element that pushes buttons to the right
- Visual separation from Cancel/Add buttons via the existing flexbox gap

**Select All Checkbox Styling**
- Match existing tree checkbox styling: 18x18px, accent-color: #1976D2
- Add new `.selectAllControl` CSS class following `.layoutControl` pattern
- Include label "Select All" with same styling as `.layoutLabel` (14px, color: #666)

**Deterministic Override Behavior**
- Checking Select All always selects ALL non-root items (ignores current partial state)
- Unchecking Select All always deselects ALL non-root items (ignores current partial state)
- Does not toggle based on current selection state

**No Sync-Back from Individual Selections**
- Manual checkbox changes on individual tree items do NOT update Select All checkbox state
- Select All checkbox retains its last user-set value until clicked again
- Select All never displays indeterminate state

**Expansion State Independence**
- Select All does NOT auto-expand collapsed tree nodes
- Users can expand nodes manually to see their selections
- `expandedState` remains completely independent from `selectedKeys`

## Existing Code to Leverage

**`selectedKeys` State (lines 907-909)**
- Existing `useState<Set<string>>` tracks all selected node keys
- Root key is always included; modifications should preserve root
- Use `setSelectedKeys` to update selections when Select All is toggled

**`getDescendantKeys()` Helper (lines 677-684)**
- Recursively collects all descendant node keys from a given node
- Pass `treeData` to get all non-root keys in the tree
- Returns array of strings suitable for adding to `selectedKeys` Set

**Footer Layout Controls (lines 1115-1168)**
- `.spacingControl` and `.layoutControl` CSS classes provide consistent styling
- Flex container with gap: 12px for control spacing
- `.footerSpacer` pushes action buttons to right side

**Checkbox Styling (lines 279-290 in CSS)**
- `.checkbox` class: 18x18px, accent-color: #1976D2
- Disabled state styling available but not needed for Select All
- Standard focus and hover states already defined

**`treeData` and Root Key**
- `treeData` is built via `buildTreeData()` and available via useMemo
- Root key format: `root-{entityId}`
- Root is always selected and disabled; Select All should not affect it

## Out of Scope
- Tri-state/indeterminate checkbox behavior for Select All
- Automatic detection or display of "all selected" or "partially selected" states
- Auto-expanding collapsed nodes when Select All is used
- Keyboard shortcuts for Select All action
- Changes to backend APIs or data models
- Changes to which entity types can be added to diagrams
- Changes to diagram creation, persistence, or rendering logic
- Changes to the `onAdd` callback or `AdvancedAddResult` type
- Synchronizing Select All state based on manual individual selections
- Any changes to tree structure, relationships, or traversal logic
