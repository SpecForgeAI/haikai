# Task Breakdown: Palette Context Menu

## Overview
Total Tasks: 32 tasks across 6 task groups

This feature adds a custom right-click context menu to palette panel items with Add/Delete actions for all items, plus extended "Add with business processes" and "Add with app components" options for APPLICATION entities.

## Task List

### Foundation Layer

#### Task Group 1: Types, Interfaces, and State Management
**Dependencies:** None

- [x] 1.0 Complete foundation layer for context menu
  - [x] 1.1 Write 2-4 focused tests for context menu state management
    - Test context menu state structure validation
    - Test state transitions (visible/hidden)
    - Test menu positioning from mouse coordinates
  - [x] 1.2 Define TypeScript interfaces for context menu
    - File: `frontend/src/types/contextMenu.ts` (new file)
    - Define `ContextMenuState` interface: `{ visible: boolean; x: number; y: number; item: PaletteItemData; sectionId: string } | null`
    - Define `PaletteItemData` interface: `{ id: string; name: string }`
    - Define `ContextMenuAction` type for menu action callbacks
    - Export all types for use in components
  - [x] 1.3 Add context menu state to PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Add `contextMenuState` useState hook with null initial value
    - Add `setContextMenuState` setter function
    - Create `handleContextMenu` callback to set menu state from event
    - Create `handleCloseMenu` callback to reset state to null
  - [x] 1.4 Add ADD_DIAGRAM_NODES action type to ArchitectureContext
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add new action type for batch node addition: `{ type: 'ADD_DIAGRAM_NODES'; payload: { diagramId: string; nodes: DiagramNode[] } }`
    - Implement reducer case that adds multiple nodes in single state update
    - Include duplicate checking for each node in the batch
  - [x] 1.5 Ensure foundation layer tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify type definitions compile without errors

**Acceptance Criteria:**
- TypeScript interfaces defined and exported
- Context menu state can be stored and updated in PalettePanel
- ADD_DIAGRAM_NODES action type exists in ArchitectureContext
- All foundation tests pass

---

### Component Layer

#### Task Group 2: PaletteContextMenu Component
**Dependencies:** Task Group 1

- [x] 2.0 Complete PaletteContextMenu component
  - [x] 2.1 Write 3-5 focused tests for PaletteContextMenu component
    - Test menu renders at correct position (x, y coordinates)
    - Test menu displays correct options based on item presence on diagram
    - Test menu dismisses on outside click
    - Test menu dismisses on Escape key press
    - Test APPLICATION items show extended options
  - [x] 2.2 Create PaletteContextMenu component structure
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` (new file)
    - Props: `x`, `y`, `item`, `sectionId`, `isOnDiagram`, `onAdd`, `onDelete`, `onAddWithBusinessProcesses`, `onAddWithAppComponents`, `onClose`
    - Render positioned div at (x, y) coordinates using absolute positioning
    - Use portal (ReactDOM.createPortal) to render at document body level for z-index
  - [x] 2.3 Create PaletteContextMenu styles
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.module.css` (new file)
    - White background with border and box-shadow
    - Minimum width of 180px for readability
    - Clickable rows with hover state
    - Z-index high enough to appear above other elements (e.g., 1000)
    - Match existing UI patterns from PalettePanel styles
  - [x] 2.4 Implement menu option rendering logic
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Show "Add" option only when `isOnDiagram === false`
    - Show "Delete" option only when `isOnDiagram === true`
    - Show "Add with business processes" when `sectionId === 'applications'`
    - Show "Add with app components" when `sectionId === 'applications'`
    - Each menu item calls appropriate callback and then `onClose`
  - [x] 2.5 Implement auto-dismiss behavior
    - File: `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Add useEffect with document click listener to close menu on outside click
    - Add useEffect with keydown listener for Escape key
    - Clean up event listeners on unmount
    - Stop propagation on menu clicks to prevent immediate dismissal
  - [x] 2.6 Ensure PaletteContextMenu component tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify component renders correctly with all option variations

**Acceptance Criteria:**
- Component renders at specified coordinates
- Shows Add/Delete based on diagram presence
- Shows extended options for APPLICATION entities
- Auto-dismisses on outside click or Escape key
- All component tests pass

---

### Integration Layer

#### Task Group 3: PaletteItem and PaletteSection Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete palette component integration
  - [x] 3.1 Write 2-4 focused tests for right-click event handling
    - Test onContextMenu event fires with correct item data
    - Test browser default context menu is prevented
    - Test context menu position matches mouse coordinates
  - [x] 3.2 Add onContextMenu prop to PaletteItem component
    - File: `frontend/src/components/DiagramsView/PaletteItem.tsx`
    - Add `onContextMenu?: (e: React.MouseEvent, item: { id: string; name: string }) => void` prop
    - Call `e.preventDefault()` to suppress browser default menu
    - Invoke callback with event and item data
  - [x] 3.3 Wire onContextMenu through PaletteSection
    - File: `frontend/src/components/DiagramsView/PaletteSection.tsx`
    - Add `onItemContextMenu: (e: React.MouseEvent, item: { id: string; name: string }) => void` prop
    - Pass to each PaletteItem's onContextMenu prop
  - [x] 3.4 Connect context menu to PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create `handleItemContextMenu(e, item, sectionId)` function
    - Set contextMenuState with `{ visible: true, x: e.clientX, y: e.clientY, item, sectionId }`
    - Pass handler to each PaletteSection
  - [x] 3.5 Render PaletteContextMenu in PalettePanel
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Conditionally render PaletteContextMenu when contextMenuState is not null
    - Pass all required props including action handlers
    - Calculate `isOnDiagram` using `nodeExistsForEntity` utility
  - [x] 3.6 Ensure integration tests pass
    - Run ONLY the 2-4 tests written in 3.1
    - Verify right-click opens context menu at correct position

**Acceptance Criteria:**
- Right-clicking palette item opens custom context menu
- Browser default menu is suppressed
- Menu appears at cursor position
- All integration tests pass

---

### Base Actions Layer

#### Task Group 4: Add and Delete Actions
**Dependencies:** Task Group 3

- [x] 4.0 Complete base Add and Delete action handlers
  - [x] 4.1 Write 2-4 focused tests for Add and Delete actions
    - Test Add action creates node using createDiagramNodeFromEntity
    - Test Add action does nothing if entity already exists on diagram
    - Test Delete action removes node and cascades to edges
    - Test palette visual state updates after actions
  - [x] 4.2 Implement Add action handler
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create `handleContextMenuAdd(item, sectionId)` function
    - Reuse existing `handleItemClick` logic for node creation
    - Get entity_type using `getEntityTypeConstant(sectionId)`
    - Create node using `createDiagramNodeFromEntity`
    - Dispatch `ADD_DIAGRAM_NODE` action
    - Close context menu after action
  - [x] 4.3 Implement Delete action handler
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create `handleContextMenuDelete(item, sectionId)` function
    - Find node ID by querying diagram_nodes for matching entity_type and entity_id
    - Dispatch `DELETE_DIAGRAM_ELEMENTS` with nodeIds array containing the found node ID
    - Edge cascade handled automatically by existing reducer logic
    - Close context menu after action
  - [x] 4.4 Wire action handlers to PaletteContextMenu
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Pass `handleContextMenuAdd` to `onAdd` prop
    - Pass `handleContextMenuDelete` to `onDelete` prop
    - Ensure handlers receive correct item and sectionId from context menu state
  - [x] 4.5 Ensure base action tests pass
    - Run ONLY the 2-4 tests written in 4.1
    - Verify Add creates nodes correctly
    - Verify Delete removes nodes with edge cascade

**Acceptance Criteria:**
- Add action creates new diagram node
- Delete action removes node and associated edges
- Palette updates to show correct Add/Delete option after action
- All base action tests pass

---

### Compound Actions Layer

#### Task Group 5: Compound Add Operations and Layout Algorithm
**Dependencies:** Task Group 4

- [x] 5.0 Complete compound add operations
  - [x] 5.1 Write 4-6 focused tests for compound add operations
    - Test "Add with business processes" creates parent and children
    - Test "Add with app components" creates parent and children
    - Test children have correct parent_node_id set
    - Test parent auto-sizes to contain children
    - Test skips children that already exist on diagram
    - Test adds only missing children when parent exists
  - [x] 5.2 Create compound layout utility functions
    - File: `frontend/src/utils/compoundLayout.ts` (new file)
    - Create `calculateChildPosition(parentNode, childIndex, existingChildCount)` function
      - X position: `parent.pos_x + 5` (5px left padding)
      - Y position: `parent.pos_y + 5 + 20 + 5 + (childIndex * (60 + 5))` (label height 20px, child height 60px, 5px gaps)
    - Create `calculateParentSize(childCount, maxChildWidth)` function
      - Width: `5 + Math.max(maxChildWidth, 120) + 5` (5px padding each side)
      - Height: `5 + 20 + 5 + (childCount * 60) + ((childCount - 1) * 5) + 5` (padding + label + children + gaps)
    - Export functions for use in action handlers
  - [x] 5.3 Create helper to find linked business processes
    - File: `frontend/src/utils/compoundLayout.ts`
    - Create `findLinkedBusinessProcesses(metaModel, applicationId)` function
    - Find all application_points for the application (filter by application_id)
    - Query `metaModel.relationships.application_point_business_processes`
    - Filter where `application_point_id` matches any of the application's application_points
    - Return array of business_process_ids
  - [x] 5.4 Create helper to find app components
    - File: `frontend/src/utils/compoundLayout.ts`
    - Create `findAppComponents(metaModel, applicationId)` function
    - Filter `metaModel.entities.app_components` by `application_id === applicationId`
    - Return array of ApplicationComponent objects
  - [x] 5.5 Implement "Add with business processes" handler
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create `handleAddWithBusinessProcesses(item, sectionId)` function
    - Step 1: Create/find parent Application node
    - Step 2: Find linked business processes using helper
    - Step 3: Filter out processes that already exist on diagram
    - Step 4: Create child nodes with parent_node_id set
    - Step 5: Calculate and apply parent sizing
    - Dispatch ADD_DIAGRAM_NODES for batch add, then UPDATE_DIAGRAM_NODE for parent resize
  - [x] 5.6 Implement "Add with app components" handler
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Create `handleAddWithAppComponents(item, sectionId)` function
    - Step 1: Create/find parent Application node
    - Step 2: Find app components using helper
    - Step 3: Filter out components that already exist on diagram
    - Step 4: Create child nodes with entity_type APP_COMPONENT and parent_node_id set
    - Step 5: Calculate and apply parent sizing
    - Dispatch ADD_DIAGRAM_NODES for batch add, then UPDATE_DIAGRAM_NODE for parent resize
  - [x] 5.7 Wire compound action handlers to PaletteContextMenu
    - File: `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Pass `handleAddWithBusinessProcesses` to `onAddWithBusinessProcesses` prop
    - Pass `handleAddWithAppComponents` to `onAddWithAppComponents` prop
  - [x] 5.8 Ensure compound action tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify parent-child relationships are correct
    - Verify layout calculations are accurate

**Acceptance Criteria:**
- "Add with business processes" creates Application parent with BusinessProcess children
- "Add with app components" creates Application parent with AppComponent children
- Children have correct parent_node_id referencing the parent
- Parent auto-sizes based on number and size of children
- Existing entities are not duplicated
- All compound action tests pass

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 2-4 tests from Task Group 1 (foundation)
    - Review the 3-5 tests from Task Group 2 (component)
    - Review the 2-4 tests from Task Group 3 (integration)
    - Review the 2-4 tests from Task Group 4 (base actions)
    - Review the 4-6 tests from Task Group 5 (compound actions)
    - Total existing tests: approximately 13-23 tests
  - [x] 6.2 Analyze test coverage gaps for context menu feature
    - Identify end-to-end workflows lacking coverage
    - Focus on user interaction flows (right-click -> menu -> action -> result)
    - Check edge cases: empty relationships, partial existing entities
    - Verify JSON serialization/deserialization after actions
  - [x] 6.3 Write up to 8 additional strategic tests (if needed)
    - Test: Right-click on relationship item shows no menu (relationships are browse-only)
    - Test: Context menu positioning at viewport edges (clamp to visible area)
    - Test: Save/Load preserves compound node layout
    - Test: Multiple rapid right-clicks handle state correctly
    - Test: Compound add with zero linked entities handles gracefully
    - Test: Parent resize when adding children to existing parent
    - Additional tests as identified in 6.2 gap analysis
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to Palette Context Menu feature
    - Expected total: approximately 21-31 tests maximum
    - Verify all critical user workflows pass
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 21-31 tests total)
- Critical user workflows for context menu feature are covered
- No more than 8 additional tests added in gap analysis
- Edge cases for empty states and partial data are handled

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Types, Interfaces, and State Management**
   - Establishes type safety foundation
   - Adds batch node action to context
   - No external dependencies

2. **Task Group 2: PaletteContextMenu Component**
   - Creates the visual context menu component
   - Depends on types from Task Group 1

3. **Task Group 3: PaletteItem and PaletteSection Integration**
   - Wires right-click events through component hierarchy
   - Depends on PaletteContextMenu from Task Group 2

4. **Task Group 4: Add and Delete Actions**
   - Implements base menu functionality
   - Depends on integration from Task Group 3

5. **Task Group 5: Compound Add Operations and Layout Algorithm**
   - Implements advanced APPLICATION-specific features
   - Depends on base actions from Task Group 4

6. **Task Group 6: Test Review and Gap Analysis**
   - Validates all functionality
   - Depends on all previous task groups

---

## Files to Create

| File Path | Purpose |
|-----------|---------|
| `frontend/src/types/contextMenu.ts` | TypeScript interfaces for context menu |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | Context menu component |
| `frontend/src/components/DiagramsView/PaletteContextMenu.module.css` | Context menu styles |
| `frontend/src/utils/compoundLayout.ts` | Layout calculation utilities |

## Files to Modify

| File Path | Changes |
|-----------|---------|
| `frontend/src/contexts/ArchitectureContext.tsx` | Add ADD_DIAGRAM_NODES action |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | Context menu state, handlers, rendering |
| `frontend/src/components/DiagramsView/PaletteSection.tsx` | Add onItemContextMenu prop |
| `frontend/src/components/DiagramsView/PaletteItem.tsx` | Add onContextMenu prop and handler |

## Key Dependencies and Utilities to Leverage

- `nodeExistsForEntity()` from `frontend/src/utils/nodeCreation.ts` - check if entity on diagram
- `createDiagramNodeFromEntity()` from `frontend/src/utils/nodeCreation.ts` - create new nodes
- `calculateZIndex()` from `frontend/src/utils/nodeCreation.ts` - proper z-ordering
- `getEntityTypeConstant()` from `frontend/src/utils/paletteData.ts` - map sectionId to entity type
- `DELETE_DIAGRAM_ELEMENTS` action - existing delete with edge cascade
- `ADD_DIAGRAM_NODE` action - existing single node addition
- `UPDATE_DIAGRAM_NODE` action - resize parent after children added
