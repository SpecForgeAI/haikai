# Task Breakdown: Fix Decoration Reload Rendering and Override Browser Context Menu

## Overview
Total Tasks: 20 sub-tasks across 4 task groups

This feature fixes two issues:
1. Decorations not rendering when diagram is loaded from JSON
2. Browser context menu appearing instead of custom element context menu

## Task List

### Diagnostic and Verification Layer

#### Task Group 1: Diagnose Decoration Loading Issue
**Dependencies:** None

- [x] 1.0 Complete decoration loading diagnosis
  - [x] 1.1 Write diagnostic tests for decoration loading
    - Test decorations exist in state after LOAD_MODEL
    - Test decorations are passed to Canvas component
    - Test renderDecoration is called for each decoration
    - Test decoration type matching (uppercase vs lowercase)
    - **Test file:** `frontend/src/__tests__/decoration-loading-diagnostic.test.ts`
  - [x] 1.2 Verify LOAD_MODEL preserves decorations
    - Add console.log in LOAD_MODEL to verify decorations exist
    - Check if decorations array is populated after load
    - Verify no transformation is stripping decorations
  - [x] 1.3 Verify Canvas receives decorations prop
    - Check DiagramsView passes decorations to Canvas
    - Verify diagram prop includes decorations array
    - Check if selectedDiagram has decorations
  - [x] 1.4 Verify renderDecoration is called
    - Add console.log in renderDecoration
    - Check if lowZIndexDecorations/highZIndexDecorations are populated
    - Verify getDisplayDecorations returns loaded decorations
  - [x] 1.5 Fix identified gap and run tests
    - Apply fix based on diagnostic findings
    - Ensure decorations render after reload

**Acceptance Criteria:**
- Root cause of decoration not rendering is identified
- Fix is applied and decorations render on load

**Files to examine:**
- `frontend/src/contexts/ArchitectureContext.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/Canvas.tsx`

---

### Context Menu State Layer

#### Task Group 2: Add Context Menu State and Handlers to DiagramsView
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete context menu state implementation
  - [x] 2.1 Write tests for context menu state management
    - Test initial state is not visible
    - Test state updates on handleElementContextMenu call
    - Test state resets on handleCloseContextMenu call
    - Test element selection on right-click
    - **Test file:** `frontend/src/__tests__/context-menu-state.test.ts`
  - [x] 2.2 Add ElementContextMenu imports to DiagramsView
    - Import ElementContextMenu component
    - Import ElementContextMenuState and ElementContextMenuType from model.ts
    - Import getZIndexBounds from zIndexUtils.ts
    - Import Z_INDEX_DEFAULTS from defaults.ts
  - [x] 2.3 Add context menu state to DiagramsView
    - Add useState for elementContextMenu
    - Initialize with visible: false
    - Type as ElementContextMenuState
  - [x] 2.4 Implement handleElementContextMenu callback
    - Accept event, elementType, elementId, currentAutoSize
    - Call event.preventDefault() and event.stopPropagation()
    - Select the element (clear other selections)
    - Update context menu state with position and element info
  - [x] 2.5 Implement handleCloseContextMenu callback
    - Set visible to false
    - Preserve other state for potential reuse
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npx vitest run context-menu-state.test.ts`

**Acceptance Criteria:**
- Context menu state exists in DiagramsView
- Handler functions update state correctly
- Element is selected when right-clicked

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/__tests__/context-menu-state.test.ts` (new)

---

### Context Menu Actions Layer

#### Task Group 3: Implement Auto-Size and Z-Index Handlers
**Dependencies:** Task Group 2

- [x] 3.0 Complete context menu action handlers
  - [x] 3.1 Write tests for auto-size toggle
    - Test toggles node auto_size from false to true
    - Test toggles node auto_size from true to false
    - Test toggles shape decoration auto_size
    - Test does not apply to edges or line decorations
    - **Test file:** `frontend/src/__tests__/context-menu-actions.test.ts`
  - [x] 3.2 Write tests for z-index changes
    - Test "forward" increments z_index by 1
    - Test "backward" decrements z_index by 1
    - Test "front" sets z_index to max + 1
    - Test "back" sets z_index to min - 1
    - Test works for nodes, edges, and decorations
  - [x] 3.3 Implement handleAutoSizeToggle callback
    - Find element by ID and type
    - Toggle auto_size property
    - Dispatch UPDATE_DIAGRAM_NODE or UPDATE_DECORATION
    - Close context menu after action
  - [x] 3.4 Implement handleZIndexChange callback
    - Calculate current z-index bounds using getZIndexBounds
    - Find element and current z_index
    - Calculate new z_index based on action
    - Dispatch appropriate UPDATE action
    - Close context menu after action
  - [x] 3.5 Verify UPDATE_DECORATION action exists
    - Check ArchitectureContext.tsx for UPDATE_DECORATION
    - Add if missing (similar to UPDATE_DIAGRAM_NODE pattern)
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run: `cd frontend && npx vitest run context-menu-actions.test.ts`

**Acceptance Criteria:**
- Auto-size toggle updates node/decoration correctly
- Z-index changes update element correctly
- All dispatched actions persist to state

**Files to modify:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/contexts/ArchitectureContext.tsx` (if UPDATE_DECORATION missing)
- `frontend/src/__tests__/context-menu-actions.test.ts` (new)

---

### Canvas Integration Layer

#### Task Group 4: Wire Context Menu to Canvas
**Dependencies:** Task Groups 2-3

- [x] 4.0 Complete Canvas context menu integration
  - [x] 4.1 Write tests for Canvas right-click handling
    - Test onContextMenu is called on right-click
    - Test event.preventDefault is called
    - Test correct element type detected (node/edge/decoration)
    - Test hit testing for nodes, edges, decorations
    - Test empty canvas right-click suppresses browser menu
    - **Test file:** `frontend/src/__tests__/canvas-context-menu.test.ts`
  - [x] 4.2 Add onElementContextMenu prop to Canvas
    - Add prop type to CanvasProps interface
    - Optional callback for context menu events
  - [x] 4.3 Implement handleContextMenu in Canvas
    - Call event.preventDefault() always
    - Get canvas coordinates from event
    - Check nodes (in reverse z-order)
    - Check decorations (shapes then lines)
    - Check edges
    - Call onElementContextMenu with detected element
  - [x] 4.4 Add hit testing utilities
    - isPointInNode(x, y, node)
    - isPointInShapeDecoration(x, y, decoration)
    - isPointNearLineDecoration(x, y, decoration, tolerance)
    - isPointNearEdge(x, y, edge, tolerance)
  - [x] 4.5 Add onContextMenu to SVG element
    - Add onContextMenu={handleContextMenu} prop
    - Ensure it fires before any other handlers
  - [x] 4.6 Pass onElementContextMenu from DiagramsView to Canvas
    - Add prop to Canvas component instance
    - Pass handleElementContextMenu callback
  - [x] 4.7 Render ElementContextMenu in DiagramsView
    - Add conditional rendering based on visible state
    - Pass all required props
    - Position at x/y from state
  - [x] 4.8 Ensure Task Group 4 tests pass
    - Run: `cd frontend && npx vitest run canvas-context-menu.test.ts`

**Acceptance Criteria:**
- Right-click on canvas elements shows custom menu
- Browser context menu is suppressed
- Correct element is detected and passed to handler
- ElementContextMenu renders at correct position

**Files to modify:**
- `frontend/src/components/DiagramsView/Canvas.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/__tests__/canvas-context-menu.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Decoration Loading** - Diagnose and fix why decorations don't render
2. **Task Group 2: Context Menu State** - Add state management (parallel with TG1)
3. **Task Group 3: Action Handlers** - Implement auto-size and z-index actions
4. **Task Group 4: Canvas Integration** - Wire everything together

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Add context menu state, handlers, render ElementContextMenu |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Add onContextMenu handler, hit testing, onElementContextMenu prop |
| `frontend/src/contexts/ArchitectureContext.tsx` | Verify decoration loading, add UPDATE_DECORATION if needed |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/decoration-loading-diagnostic.test.ts` | Decoration loading diagnosis |
| `frontend/src/__tests__/context-menu-state.test.ts` | Context menu state management |
| `frontend/src/__tests__/context-menu-actions.test.ts` | Auto-size and z-index actions |
| `frontend/src/__tests__/canvas-context-menu.test.ts` | Canvas right-click handling |

## Key Implementation Notes

1. **Browser Menu Suppression**: MUST call `event.preventDefault()` on the `contextmenu` event to suppress browser menu.

2. **Hit Testing Order**: Check elements in reverse z-order (highest first) to match visual layering.

3. **Selection on Right-Click**: Right-clicking should select the element and deselect others before showing menu.

4. **Decoration Types**: All 11 types must work:
   - Shapes: BOX, OVAL, DIAMOND, PARALLELOGRAM, CIRCLE, CYLINDER, TRAPEZOID, HEXAGON
   - Lines: LINE, ARROW_SINGLE, ARROW_DOUBLE

5. **Menu Content by Element Type**:
   - Nodes + Shape decorations: 5 items (auto-size + 4 z-index)
   - Edges + Line decorations: 4 items (z-index only)

6. **Z-Index Bounds**: Use `getZIndexBounds()` from `zIndexUtils.ts` to calculate min/max.

7. **Dismiss Behavior**: Menu closes on:
   - Menu item click (after action)
   - Outside click (handled by ElementContextMenu)
   - Escape key (handled by ElementContextMenu)

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Decoration Loading | 5 tests | Diagnostic, data flow |
| TG2: Context Menu State | 5 tests | State management |
| TG3: Action Handlers | 8 tests | Auto-size, z-index |
| TG4: Canvas Integration | 8 tests | Right-click, hit testing |
| **Total** | **26 tests** | Full feature coverage |

## Debugging Tips

### Decoration Loading
1. Check browser console for errors during load
2. Add `console.log(diagram.decorations)` in Canvas render
3. Verify JSON file contains `decorations` array with correct structure

### Context Menu
1. Check browser DevTools Elements panel for ElementContextMenu in DOM
2. Verify `event.preventDefault()` is being called
3. Check if ElementContextMenu is imported and rendered

## Visual Reference

### Context Menu - Node/Shape (5 items)
```
+----------------------+
| Enable Auto-Size     |
+----------------------+
| Bring Forward        |
| Bring to Front       |
| Send Backward        |
| Send to Back         |
+----------------------+
```

### Context Menu - Edge/Line (4 items)
```
+----------------------+
| Bring Forward        |
| Bring to Front       |
| Send Backward        |
| Send to Back         |
+----------------------+
```
