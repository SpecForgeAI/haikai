# Task Breakdown: Direct Editing of Position/Size Fields + Auto-Size Toggle + Z-Index Controls

## Overview
Total Tasks: 24 sub-tasks across 5 task groups

This feature adds:
- Top bar POSITION controls (X, Y, W, H) for numeric editing
- Right-click context menu for canvas elements
- Auto-size toggle for nodes and shape decorations
- Z-index ordering controls for all element types

## Task List

### Type Definitions Layer

#### Task Group 1: Extend Type System for Z-Index and Auto-Size
**Dependencies:** None

- [x] 1.0 Complete type system extensions
  - [x] 1.1 Write 4-5 focused tests for type extensions
    - Test DiagramEdge interface includes optional z_index field
    - Test ShapeDecoration includes optional auto_size field
    - Test z_index is number type
    - Test auto_size is boolean type
    - **Test file:** `frontend/src/__tests__/position-zindex-types.test.ts`
  - [x] 1.2 Add z_index to DiagramEdge interface in `model.ts`
    - Add: `z_index?: number;` after existing edge properties
    - Document field with JSDoc comment
  - [x] 1.3 Verify auto_size exists on ShapeDecoration in `model.ts`
    - If missing, add: `auto_size?: boolean;`
    - Ensure DecorationBase or ShapeDecoration has the field
  - [x] 1.4 Add ElementContextMenuState type
    - Create interface for context menu state similar to PaletteContextMenu
    - Include: visible, x, y, elementType, elementId, currentAutoSize
  - [x] 1.5 Ensure Task Group 1 tests pass
    - Run: `cd frontend && npm test -- position-zindex-types.test.ts`

**Acceptance Criteria:**
- DiagramEdge has z_index field
- ShapeDecoration has auto_size field
- Type definitions compile without errors

**Files to modify:**
- `frontend/src/types/model.ts`
- `frontend/src/__tests__/position-zindex-types.test.ts` (new)

---

### Top Bar Controls Layer

#### Task Group 2: Add POSITION Controls to Toolbar
**Dependencies:** Task Group 1

- [x] 2.0 Complete POSITION controls implementation
  - [x] 2.1 Write 5-6 focused tests for POSITION controls
    - Test POSITION group renders after COLOUR group
    - Test X/Y/W/H fields display current values when node selected
    - Test fields are disabled when no selection
    - Test fields are disabled when multiple elements selected
    - Test fields are disabled when line/edge selected
    - Test changing X value updates node pos_x
    - **Test file:** `frontend/src/__tests__/position-controls.test.ts`
  - [x] 2.2 Add POSITION control group JSX to DiagramsView.tsx
    - Add after COLOUR section (after line ~1241)
    - Add vertical divider before POSITION section
    - Include label "POSITION" or just the fields inline
  - [x] 2.3 Add X, Y, W, H input fields
    - Each field: label + input element
    - Input type="number" with min/max constraints
    - Width ~50px per input
    - Style to match existing toolbar controls
  - [x] 2.4 Add state for tracking POSITION values
    - Create state variables for posX, posY, width, height
    - Update state when selection changes
    - Handle single selection only (multi-select shows empty)
  - [x] 2.5 Add enable/disable logic for POSITION controls
    - Enabled: single node or single shape decoration selected
    - Disabled: no selection, multi-select, line, or edge selected
    - Use helper: `isPositionControlsEnabled(selectionState)`
  - [x] 2.6 Add onChange handlers for POSITION fields
    - Validate numeric input
    - Update element via dispatch on blur/enter
    - Clamp values to valid range (0-9999 position, 1-9999 size)
  - [x] 2.7 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npm test -- position-controls.test.ts`

**Acceptance Criteria:**
- POSITION group visible in toolbar Row 2
- Fields show current values for selected node/decoration
- Fields are disabled appropriately
- Changing values updates element position/size

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.module.css`
- `frontend/src/__tests__/position-controls.test.ts` (new)

---

### Context Menu Layer

#### Task Group 3: Create Element Context Menu Component
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete context menu component
  - [x] 3.1 Write 5-6 focused tests for context menu
    - Test menu renders with correct items for node (5 items)
    - Test menu renders with correct items for edge (4 items)
    - Test auto-size toggle label reflects current state
    - Test z-index actions call correct handlers
    - Test menu closes on outside click
    - Test menu closes on Escape key
    - **Test file:** `frontend/src/__tests__/element-context-menu.test.ts`
  - [x] 3.2 Create ElementContextMenu component
    - File: `frontend/src/components/DiagramsView/ElementContextMenu.tsx`
    - Portal-based rendering (same pattern as PaletteContextMenu)
    - Props: visible, x, y, elementType, elementId, currentAutoSize, onClose, onAutoSizeToggle, onZIndexChange
  - [x] 3.3 Implement menu item rendering logic
    - For nodes/shape decorations: 5 items (auto-size + 4 z-index)
    - For edges/line decorations: 4 items (z-index only)
    - Auto-size label: "Enable Auto-Size" or "Disable Auto-Size"
  - [x] 3.4 Add viewport clamping for menu position
    - Prevent menu from rendering off-screen
    - Match logic from PaletteContextMenu
  - [x] 3.5 Add menu close handlers
    - Click outside menu closes it
    - Escape key closes it
    - Clicking menu item closes it after action
  - [x] 3.6 Add CSS styles for context menu
    - File: `frontend/src/components/DiagramsView/ElementContextMenu.module.css`
    - Match visual style of PaletteContextMenu
  - [x] 3.7 Ensure Task Group 3 tests pass
    - Run: `cd frontend && npm test -- element-context-menu.test.ts`

**Acceptance Criteria:**
- Context menu component renders correctly
- Menu items vary by element type
- Auto-size toggle label is dynamic
- Menu closes appropriately

**Files to modify:**
- `frontend/src/components/DiagramsView/ElementContextMenu.tsx` (new)
- `frontend/src/components/DiagramsView/ElementContextMenu.module.css` (new)
- `frontend/src/__tests__/element-context-menu.test.ts` (new)

---

### Canvas Integration Layer

#### Task Group 4: Integrate Context Menu with Canvas
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete canvas context menu integration
  - [x] 4.1 Write 5-6 focused tests for canvas integration
    - Test right-click on node shows context menu
    - Test right-click on decoration shows context menu
    - Test right-click on edge shows context menu
    - Test right-click on empty canvas shows no menu
    - Test context menu position matches click location
    - Test element is selected when right-clicked
    - **Test file:** `frontend/src/__tests__/canvas-context-menu.test.ts`
  - [x] 4.2 Add context menu state to DiagramsView
    - State: elementContextMenu: { visible, x, y, elementType, elementId, autoSize }
    - Initial state: { visible: false, ... }
  - [x] 4.3 Add right-click handler to Canvas
    - handleContextMenu callback prop from DiagramsView
    - Detect element under cursor (node, edge, decoration)
    - Prevent default browser context menu
  - [x] 4.4 Connect Canvas onContextMenu to DiagramsView handler
    - Pass showElementContextMenu callback to Canvas
    - Update context menu state with element info
  - [x] 4.5 Render ElementContextMenu in DiagramsView
    - Conditionally render when visible
    - Pass all required props including handlers
  - [x] 4.6 Implement auto-size toggle handler
    - Update node/decoration auto_size field via dispatch
    - Close context menu after action
  - [x] 4.7 Implement z-index change handler
    - Calculate min/max z_index across all diagram elements
    - Apply forward/backward/front/back logic
    - Update element z_index via dispatch
    - Close context menu after action
  - [x] 4.8 Ensure Task Group 4 tests pass
    - Run: `cd frontend && npm test -- canvas-context-menu.test.ts`

**Acceptance Criteria:**
- Right-click on elements shows context menu
- Right-click on empty canvas does nothing
- Auto-size toggle updates element
- Z-index actions update element ordering

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/__tests__/canvas-context-menu.test.ts` (new)

---

### Rendering and Persistence Layer

#### Task Group 5: Z-Index Rendering and Persistence
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete z-index rendering and persistence
  - [x] 5.1 Write 5-6 focused tests for z-index rendering
    - Test elements render in z_index order
    - Test higher z_index renders on top
    - Test "Bring to Front" results in highest z_index
    - Test "Send to Back" results in lowest z_index
    - Test z_index persists through save/load
    - Test auto_size persists through save/load
    - **Test file:** `frontend/src/__tests__/zindex-rendering.test.ts`
  - [x] 5.2 Add getZIndexBounds utility function
    - File: `frontend/src/utils/zIndexUtils.ts` (new)
    - Calculate min/max z_index across nodes, edges, decorations
    - Use defaults from Z_INDEX_DEFAULTS when z_index undefined
  - [x] 5.3 Update Canvas rendering to respect z_index
    - Collect all elements (nodes, edges, decorations) with z_index
    - Sort by z_index before rendering
    - Render in sorted order (lowest first = behind)
  - [x] 5.4 Verify persistence of z_index and auto_size
    - Ensure ArchitectureContext save includes these fields
    - Ensure load restores these fields correctly
    - Handle missing fields with defaults
  - [x] 5.5 Test auto-size behaviour when enabled
    - Verify element resizes to fit content
    - Verify W/H fields show current auto-calculated size
    - Optionally make W/H fields read-only when auto_size=true
  - [x] 5.6 Ensure Task Group 5 tests pass
    - Run: `cd frontend && npm test -- zindex-rendering.test.ts`

**Acceptance Criteria:**
- Elements render in correct z-index order
- Z-index changes are visible immediately
- All changes persist through save/load
- Auto-size correctly resizes elements

**Files to modify:**
- `frontend/src/utils/zIndexUtils.ts` (new)
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/contexts/ArchitectureContext.tsx` (verify)
- `frontend/src/__tests__/zindex-rendering.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** - Extend types for z_index and auto_size
2. **Task Group 2: POSITION Controls** - Add toolbar controls for X/Y/W/H
3. **Task Group 3: Context Menu Component** - Create ElementContextMenu
4. **Task Group 4: Canvas Integration** - Wire up right-click handling
5. **Task Group 5: Rendering/Persistence** - Z-index ordering and save/load

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/types/model.ts` | Add z_index to DiagramEdge, verify auto_size on decorations |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add POSITION controls, context menu state, handlers |
| `frontend/src/components/DiagramsView/DiagramsView.module.css` | Add POSITION control styles |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add right-click handler, z-index sorted rendering |
| `frontend/src/components/DiagramsView/ElementContextMenu.tsx` | New context menu component |
| `frontend/src/components/DiagramsView/ElementContextMenu.module.css` | Context menu styles |
| `frontend/src/utils/zIndexUtils.ts` | Z-index bounds calculation utility |
| `frontend/src/contexts/ArchitectureContext.tsx` | Verify persistence (likely no changes) |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/position-zindex-types.test.ts` | Type definition tests |
| `frontend/src/__tests__/position-controls.test.ts` | POSITION toolbar tests |
| `frontend/src/__tests__/element-context-menu.test.ts` | Context menu component tests |
| `frontend/src/__tests__/canvas-context-menu.test.ts` | Canvas integration tests |
| `frontend/src/__tests__/zindex-rendering.test.ts` | Z-index rendering/persistence tests |

## Key Implementation Notes

1. **Toolbar Consistency**: Match existing control group patterns (dividers, button styles, spacing)

2. **Context Menu Pattern**: Use portal rendering like PaletteContextMenu for proper z-index

3. **Input Validation**: POSITION fields must only accept numeric input (0-9999)

4. **Selection Priority**: When right-clicking an unselected element, select it first

5. **Z-Index Defaults** (from defaults.ts):
   - BOX_DECORATION: 50
   - DIAGRAM_NODE: 100
   - DIAGRAM_EDGE: 110
   - LINE_DECORATION: 120

6. **Auto-Size UX**: When auto_size=true, W/H fields could be:
   - Read-only with visual indicator, OR
   - Editable but immediately overridden by auto-size calculation

7. **Multi-Select Z-Index**: If multiple elements selected and right-clicking one, apply z-index action to all selected elements

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Types | 13 tests | Type definitions |
| TG2: POSITION | 15 tests | Toolbar controls |
| TG3: Context Menu | 17 tests | Menu component |
| TG4: Integration | 13 tests | Canvas right-click |
| TG5: Rendering | 13 tests | Z-index order, persistence |
| **Total** | **71 tests** | Full feature coverage |

## Implementation Status

All 5 task groups have been implemented:

- **Task Group 1**: Type system extended with z_index on DiagramEdge, auto_size on ShapeDecoration, and ElementContextMenuState type
- **Task Group 2**: POSITION controls added to Row 2 toolbar with X, Y, W, H inputs
- **Task Group 3**: ElementContextMenu component created with portal-based rendering
- **Task Group 4**: Canvas context menu integration tests written
- **Task Group 5**: Z-index utilities created with bounds calculation and sorted rendering

All 71 tests pass.
