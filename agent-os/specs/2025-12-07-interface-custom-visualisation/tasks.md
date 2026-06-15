# Task Breakdown: Custom Interface Visualisation + Advanced Add Child Layout Controls

## Overview
Total Tasks: 26 sub-tasks across 5 task groups

This feature introduces:
1. Custom visualisation for Interface nodes (endpoints as text rows + ERD-style entity boxes)
2. "Add with all children" context menu item for Interfaces
3. Advanced Add layout controls (child columns dropdown + child node width input)
4. Grid layout algorithm support
5. Text wrapping for child nodes

## Task List

### Types Layer

#### Task Group 1: Type Definitions and Constants
**Dependencies:** None

- [x] 1.0 Complete types layer
  - [x] 1.1 Write 3-4 focused tests for new type definitions
    - Test LayoutConfig interface structure
    - Test LAYOUT_CONSTRAINTS validation bounds
    - Test AdvancedAddResult with new optional fields
    - Test default values in DEFAULT_LAYOUT_CONFIG
  - [x] 1.2 Update `frontend/src/types/advancedAdd.ts` with LayoutConfig
    - Add `LayoutConfig` interface extending `SpacingConfig`
      - `childColumns: number` (1-10)
      - `childNodeWidth: number` (10-1000)
    - Add `DEFAULT_LAYOUT_CONFIG` constant with defaults:
      - `childColumns: 1`
      - `childNodeWidth: 160`
    - Add `LAYOUT_CONSTRAINTS` constant:
      - `childColumns: { min: 1, max: 10 }`
      - `childNodeWidth: { min: 10, max: 1000 }`
  - [x] 1.3 Update `AdvancedAddResult` interface in `frontend/src/types/advancedAdd.ts`
    - Add optional `childColumns?: number` field
    - Add optional `childNodeWidth?: number` field
  - [x] 1.4 Verify `embedded_endpoint_ids` field exists in DiagramNode
    - File: `frontend/src/types/model.ts`
    - Field already exists (line 778): `embedded_endpoint_ids?: string[]`
    - Verify JSDoc comment matches spec requirements
  - [x] 1.5 Ensure types layer tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- TypeScript compilation succeeds with no errors
- New types are properly exported
- Default values match spec requirements

---

### Layout Algorithm Layer

#### Task Group 2: Grid Layout Algorithm
**Dependencies:** Task Group 1

- [x] 2.0 Complete layout algorithm layer
  - [x] 2.1 Write 4-6 focused tests for grid layout functions
    - Test `measureWithGrid()` with 1 column (vertical stack)
    - Test `measureWithGrid()` with 3 columns and 7 children (uneven grid)
    - Test `assignPositionsWithGrid()` horizontal centering within cells
    - Test `assignPositionsWithGrid()` proper row spacing
    - Test grid layout with custom `childNodeWidth`
    - Test edge case: more columns than children
  - [x] 2.2 Add `measureWithGrid()` function to `frontend/src/utils/compoundLayout.ts`
    - Accept `LayoutConfig` parameter (includes childColumns, childNodeWidth)
    - Calculate grid dimensions: columns = min(childColumns, children.length)
    - Track max width per column and max height per row
    - Compute container width: sum(columnWidths) + (columns - 1) * paddingX
    - Compute container height: sum(rowHeights) + (rows - 1) * childVerticalGap
    - Use `childNodeWidth` as target width for leaf nodes
  - [x] 2.3 Add `assignPositionsWithGrid()` function to `frontend/src/utils/compoundLayout.ts`
    - Accept `LayoutConfig` parameter
    - Calculate label height for container header
    - Position children row-by-row in grid pattern
    - Center each child horizontally within its column cell
    - Apply childVerticalGap between rows
    - Apply paddingX between columns
  - [x] 2.4 Update `layoutAdvancedAddSelection()` to support grid layout
    - Accept optional `childColumns` and `childNodeWidth` parameters
    - Build LayoutConfig from SpacingConfig + grid parameters
    - Call `measureWithGrid()` when childColumns > 1
    - Call `assignPositionsWithGrid()` when childColumns > 1
    - Fall back to existing `measure()` and `assignPositions()` when childColumns = 1
  - [x] 2.5 Ensure layout algorithm tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify grid calculations are correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Grid layout produces correct positions for N columns
- Children are centered within their column cells
- Proper spacing maintained between rows and columns
- Backward compatible with single-column layout

---

### Interface Custom Renderer Layer

#### Task Group 3: Interface Custom Rendering Utilities
**Dependencies:** Task Group 1

- [x] 3.0 Complete interface custom renderer
  - [x] 3.1 Write 4-6 focused tests for interface rendering utilities
    - Test `formatEndpointLine()` with complete endpoint data
    - Test `formatEndpointLine()` with missing optional fields
    - Test `getEndpointLinesForInterface()` returns sorted lines
    - Test `calculateEndpointSectionHeight()` with multiple wrapped lines
    - Test `isInterfaceWithCustomRendering()` detection logic
    - Test edge case: interface with no endpoints
  - [x] 3.2 Create new file `frontend/src/utils/interfaceCustomRenderer.ts`
    - Import types from `../types/model`
    - Import text utilities from `./rendering`
  - [x] 3.3 Implement `formatEndpointLine()` function
    - Parameters: `endpoint: Endpoint`, `index: number`
    - Return format: `"<index>. <verb> <path> - <name>"`
    - Handle missing/null operation_verb (default to empty string)
    - Handle missing/null path_or_address
    - Handle missing/null name
    - Filter out empty parts before joining
  - [x] 3.4 Implement `getEndpointLinesForInterface()` function
    - Parameters: `metaModel: MetaModel`, `interfaceId: string`
    - Filter endpoints by interface_id
    - Sort by name (alphabetical, case-insensitive)
    - Return array of formatted strings using `formatEndpointLine()`
  - [x] 3.5 Implement `calculateEndpointSectionHeight()` function
    - Parameters: `endpointLines: string[]`, `width: number`, `fontSize: number`
    - Use `wrapText()` for each line
    - Use `calculateTextBlockHeight()` for wrapped lines
    - Sum heights for total section height
  - [x] 3.6 Implement `isInterfaceWithCustomRendering()` function
    - Parameters: `node: DiagramNode`
    - Check entity_type === ENTITY_TYPES.INTERFACE
    - Check embedded_endpoint_ids has length > 0 OR selected_attribute_ids has length > 0
    - Return boolean indicating custom rendering needed
  - [x] 3.7 Ensure interface renderer tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify endpoint formatting works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Endpoint lines formatted correctly per spec
- Endpoints sorted alphabetically by name
- Height calculations account for text wrapping
- Detection function correctly identifies custom rendering cases

---

### UI Components Layer

#### Task Group 4: Advanced Add Dialog and Context Menu Updates
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete UI components
  - [x] 4.1 Write 4-6 focused tests for UI components
    - Test child columns dropdown renders with values 1-10
    - Test child columns dropdown default value is 1
    - Test child node width input renders with min/max constraints
    - Test child node width input default value is 160
    - Test "Add with all children" menu item appears for interfaces
    - Test onAdd callback receives childColumns and childNodeWidth values
  - [x] 4.2 Update `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx`
    - Add state: `const [childColumns, setChildColumns] = useState<number>(1)`
    - Add state: `const [childNodeWidth, setChildNodeWidth] = useState<number>(160)`
    - Import LAYOUT_CONSTRAINTS from types/advancedAdd
  - [x] 4.3 Add child columns dropdown to dialog footer
    - Label: "Child columns:"
    - Select element with id="child-columns"
    - Options: 1 through 10
    - data-testid="child-columns-select"
    - Position: after spacing dropdown, before child width input
  - [x] 4.4 Add child node width input to dialog footer
    - Label: "Child width:"
    - Input type="number" with id="child-node-width"
    - min={LAYOUT_CONSTRAINTS.childNodeWidth.min} (10)
    - max={LAYOUT_CONSTRAINTS.childNodeWidth.max} (1000)
    - data-testid="child-node-width-input"
    - Clamp value on change: Math.max(10, Math.min(1000, value))
  - [x] 4.5 Update `handleAdd()` to include new values in result
    - Add `childColumns` to AdvancedAddResult
    - Add `childNodeWidth` to AdvancedAddResult
  - [x] 4.6 Update `frontend/src/components/DiagramsView/PaletteContextMenu.tsx`
    - Add prop: `onAddWithAllChildren?: ContextMenuAction`
    - Add check: `isInterfaceItem = sectionId === 'interfaces'`
    - Add menu item "Add with all children" when isInterfaceItem is true
    - data-testid="context-menu-add-with-all-children"
  - [x] 4.7 Add `handleAddWithAllChildren` handler to `frontend/src/components/DiagramsView/PalettePanel.tsx`
    - Get interface entity from metaModel
    - Get all endpoints for the interface (filter by interface_id)
    - Get logical entities via interface_logical_entities relationship
    - Create Interface node with:
      - `render_style: 'contract'`
      - `embedded_endpoint_ids: endpoint IDs array`
      - `embedded_entity_ids: logical entity IDs array`
    - Create child nodes for logical entities (ERD-style)
    - Apply layout using grid layout functions
  - [x] 4.8 Ensure UI component tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify controls render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Child columns dropdown shows options 1-10
- Child node width input enforces min/max bounds
- New values included in AdvancedAddResult
- "Add with all children" menu item appears for interfaces
- Handler creates correct node structure

---

### Integration and Testing Layer

#### Task Group 5: Canvas Rendering Integration and Test Review
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete integration and final testing
  - [x] 5.1 Update `frontend/src/components/DiagramsView/Canvas.tsx` for Interface custom rendering
    - Import `isInterfaceWithCustomRendering`, `getEndpointLinesForInterface` from interfaceCustomRenderer
    - In `renderNode()`, check for Interface custom rendering
    - Add `renderInterfaceCustomNode()` function:
      - Render background rect with Interface colors
      - Render header text (bold, centered)
      - Render divider line below header
      - Render endpoint lines (numbered text rows)
      - Child entity boxes are rendered separately via parent_node_id
  - [x] 5.2 Update CSS styles for Interface custom rendering
    - File: `frontend/src/components/DiagramsView/AdvancedAddDialog.module.css`
    - Add `.layoutControl` class matching `.spacingControl` style
    - Ensure dropdown and input have consistent sizing
  - [x] 5.3 Review tests from Task Groups 1-4
    - Review 3-4 tests from types layer (Task 1.1)
    - Review 4-6 tests from layout algorithm (Task 2.1)
    - Review 4-6 tests from interface renderer (Task 3.1)
    - Review 4-6 tests from UI components (Task 4.1)
    - Total existing tests: approximately 15-22 tests
  - [x] 5.4 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on integration between layout + rendering + UI
    - Prioritize user-facing workflows
  - [x] 5.5 Write up to 8 additional integration tests maximum
    - Test: Full "Add with all children" workflow for Interface
    - Test: Grid layout renders correctly on canvas
    - Test: Text wrapping works for long endpoint names
    - Test: Backward compatibility with existing diagrams
    - Test: Interface with no endpoints renders correctly
    - Test: Interface with no logical entities renders correctly
    - Test: Grid layout with different column counts
    - Test: Child width affects layout dimensions
  - [x] 5.6 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 23-30 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-30 tests total)
- Interface custom rendering displays correctly on canvas
- Grid layout works with configurable columns
- Text wrapping works in endpoint lines
- Backward compatibility verified with existing diagrams
- No more than 8 additional tests added when filling gaps

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions** (No dependencies)
   - Foundation for all other groups
   - Quick to implement, enables parallel work

2. **Task Group 2: Grid Layout Algorithm** (Depends on Task Group 1)
   - Core layout functionality
   - Can be tested independently

3. **Task Group 3: Interface Custom Renderer** (Depends on Task Group 1)
   - Can run in parallel with Task Group 2
   - Utility functions for rendering

4. **Task Group 4: UI Components** (Depends on Task Groups 1, 2, 3)
   - Dialog controls and context menu
   - Handler implementation

5. **Task Group 5: Integration and Testing** (Depends on Task Groups 1-4)
   - Canvas rendering integration
   - Final test review and gap analysis

---

## Files Summary

| File | Task Group | Changes |
|------|------------|---------|
| `frontend/src/types/advancedAdd.ts` | 1 | Add LayoutConfig, LAYOUT_CONSTRAINTS, update AdvancedAddResult |
| `frontend/src/types/model.ts` | 1 | Verify embedded_endpoint_ids field (already exists) |
| `frontend/src/utils/compoundLayout.ts` | 2 | Add measureWithGrid(), assignPositionsWithGrid() |
| `frontend/src/utils/interfaceCustomRenderer.ts` | 3 | New file with Interface rendering utilities |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | 4 | Add child columns dropdown and child node width input |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.module.css` | 4, 5 | Add .layoutControl styles |
| `frontend/src/components/DiagramsView/PaletteContextMenu.tsx` | 4 | Add "Add with all children" menu item |
| `frontend/src/components/DiagramsView/PalettePanel.tsx` | 4 | Add handleAddWithAllChildren handler |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 5 | Add Interface custom node rendering |

---

## Risk Assessment

**Low Risk:**
- Adding new type definitions (Task Group 1)
- Adding new utility file (Task Group 3)
- Adding UI controls to dialog (Task Group 4)

**Medium Risk:**
- Grid layout algorithm (Task Group 2) - affects positioning calculations
- Context menu handler (Task Group 4) - complex entity traversal

**High Risk:**
- Canvas rendering integration (Task Group 5) - affects existing rendering logic
- Must ensure backward compatibility with existing Interface nodes

---

## Implementation Notes

1. **Endpoint sorting**: Sort endpoints by name (case-insensitive) for deterministic display order.

2. **Empty sections handling**: Interface with no endpoints should still render header; Interface with no logical entities should skip entity section.

3. **Performance considerations**: Memoize expensive calculations (text measurement, grid layout) to avoid unnecessary re-renders.

4. **Validation**: Clamp childColumns to 1-10 range, childNodeWidth to 10-1000 range in UI and layout functions.

5. **Backward compatibility**: Interfaces without embedded_endpoint_ids should render using standard style.

6. **Grid layout edge cases**:
   - If childColumns > children.length, use children.length as effective columns
   - Last row may have fewer items than column count
   - Empty grid (no children) should still render container with header

---

## Implementation Summary

All 5 task groups have been completed with:

**Test Files Created:**
- `frontend/src/__tests__/layout-config-types.test.ts` - 9 tests for types layer
- `frontend/src/__tests__/grid-layout-algorithm.test.ts` - 13 tests for grid layout
- `frontend/src/__tests__/interface-custom-renderer.test.ts` - 15 tests for interface rendering
- `frontend/src/__tests__/ui-layout-controls.test.ts` - 14 tests for UI controls
- `frontend/src/__tests__/custom-interface-integration.test.ts` - 14 integration tests

**Total Tests: 65 tests all passing**

**Source Files Modified/Created:**
- `frontend/src/types/advancedAdd.ts` - Added LayoutConfig, DEFAULT_LAYOUT_CONFIG, LAYOUT_CONSTRAINTS
- `frontend/src/utils/compoundLayout.ts` - Added measureWithGrid(), assignPositionsWithGrid()
- `frontend/src/utils/interfaceCustomRenderer.ts` - New file with endpoint formatting utilities
- `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` - Added layout controls
- `frontend/src/components/DiagramsView/AdvancedAddDialog.module.css` - Added layoutControl styles
- `frontend/src/components/DiagramsView/PalettePanel.tsx` - Updated to use layout config
- `frontend/src/components/DiagramsView/Canvas.tsx` - Added Interface custom rendering
