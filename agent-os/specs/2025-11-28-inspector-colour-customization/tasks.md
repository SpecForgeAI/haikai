# Task Breakdown: Inspector Colour Customization

## Overview
Total Tasks: 27

This feature extends the left-hand Inspector panel to support colour customization for diagram nodes and edges, allowing users to override default background, line/border, and text colours for selected elements.

## Task List

### Schema Layer

#### Task Group 1: Data Model Extensions
**Dependencies:** None

- [x] 1.0 Complete schema layer updates
  - [x] 1.1 Write 3-4 focused tests for DiagramNode colour properties
    - Test that DiagramNode accepts optional `background_color` string field
    - Test that DiagramNode accepts optional `line_color` string field
    - Test that DiagramNode accepts optional `text_color` string field
    - Test that colour fields are preserved through state updates
  - [x] 1.2 Extend DiagramNode interface in `frontend/src/types/model.ts` (line 233-254)
    - Add `background_color?: string` - hex colour for node fill
    - Add `line_color?: string` - hex colour for node border/stroke
    - Add `text_color?: string` - hex colour for node label text
    - Place new fields after `text_text_decoration` field (line 253)
  - [x] 1.3 Extend DiagramEdge interface in `frontend/src/types/model.ts` (line 206-231)
    - Add `line_color?: string` - hex colour for edge stroke
    - Add `text_color?: string` - hex colour for edge label_text
    - Place new fields after `label_text_decoration` field (line 227)
  - [x] 1.4 Ensure schema layer tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds with new interface fields

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- DiagramNode interface has `background_color`, `line_color`, `text_color` optional fields
- DiagramEdge interface has `line_color`, `text_color` optional fields
- All existing code continues to compile without modification
- New fields are all optional strings using hex format (e.g., "#RRGGBB")

---

### Inspector UI Layer

#### Task Group 2: Colour Section UI Components
**Dependencies:** Task Group 1

- [x] 2.0 Complete Inspector UI colour section
  - [x] 2.1 Write 4-5 focused tests for Colour section UI
    - Test that Colour section renders below Text Alignment section when selection exists
    - Test that three colour buttons render with correct tooltips
    - Test that Background button is disabled when only edges are selected
    - Test that colour picker opens on button click
    - Test that colour change calls updateSelectedNodes/updateSelectedEdges
  - [x] 2.2 Add CSS styles for colour buttons in `frontend/src/components/DiagramsView/InspectorPanel.module.css`
    - Add `.colourToggles` class (copy from `.styleToggles` pattern, lines 166-170)
    - Add `.colourToggle` class (copy from `.styleToggle` pattern, lines 172-187)
    - Add `.colourToggleDisabled` class for greyed-out state
    - Add `.hiddenColourInput` class to hide native colour input element
    - Add `.colourIndicator` class for colour swatch display on buttons
  - [x] 2.3 Create colour section JSX in `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Add new "Colour" control group below Text Alignment section (after line 698)
    - Use `.controlGroup` and `.controlGroupHeader` classes (matching existing sections)
    - Create three icon buttons using `.colourToggles` container with 4px gap
    - Background button: filled square icon, tooltip "Set background colour"
    - Line button: square outline icon, tooltip "Set line/border colour"
    - Text button: "A" letter icon, tooltip "Set text colour"
  - [x] 2.4 Add hidden HTML5 colour inputs with refs
    - Create three `<input type="color">` elements with `display: none`
    - Add useRef hooks for each colour input (backgroundColorRef, lineColorRef, textColorRef)
    - Wire button onClick to trigger corresponding input click
  - [x] 2.5 Implement Background button disabled logic
    - Add helper function `hasOnlyEdgesSelected(selectedNodeIds, selectedEdgeIds)`
    - Disable Background button when `selectedNodeIds.size === 0 && selectedEdgeIds.size > 0`
    - Apply `.colourToggleDisabled` class when disabled
  - [x] 2.6 Ensure UI component tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify Colour section renders correctly with all buttons

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- Colour section appears below Text Alignment section
- Three icon buttons display with correct tooltips
- Background button is visually disabled (greyed out) when only edges selected
- Hidden colour inputs are correctly linked to buttons

---

#### Task Group 3: Colour Change Handlers
**Dependencies:** Task Group 2

- [x] 3.0 Complete colour change event handlers
  - [x] 3.1 Write 3-4 focused tests for colour change handlers
    - Test that Background colour change updates `background_color` on selected nodes only
    - Test that Line colour change updates `line_color` on both nodes and edges
    - Test that Text colour change updates `text_color` on both nodes and edges
    - Test multi-select applies colour to all selected items
  - [x] 3.2 Implement handleBackgroundColourChange callback
    - Create callback with useCallback hook
    - Extract colour value from event: `e.target.value`
    - Call `updateSelectedNodes({ background_color: colour })` for nodes
    - Skip edges (background colour only applies to nodes)
  - [x] 3.3 Implement handleLineColourChange callback
    - Create callback with useCallback hook
    - Extract colour value from event: `e.target.value`
    - Call `updateSelectedNodes({ line_color: colour })` for nodes
    - Call `updateSelectedEdges({ line_color: colour })` for edges
  - [x] 3.4 Implement handleTextColourChange callback
    - Create callback with useCallback hook
    - Extract colour value from event: `e.target.value`
    - Call `updateSelectedNodes({ text_color: colour })` for nodes
    - Call `updateSelectedEdges({ text_color: colour })` for edges
  - [x] 3.5 Wire onChange handlers to hidden colour inputs
    - Add `onChange={handleBackgroundColourChange}` to background colour input
    - Add `onChange={handleLineColourChange}` to line colour input
    - Add `onChange={handleTextColourChange}` to text colour input
  - [x] 3.6 Ensure handler tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify colour changes dispatch correct actions

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Background colour only updates nodes, not edges
- Line colour updates both nodes and edges
- Text colour updates both nodes and edges
- Multi-select correctly applies colour to all selected items
- Uses existing `updateSelectedNodes` and `updateSelectedEdges` callbacks (lines 339-357)

---

### Node Rendering Layer

#### Task Group 4: Node Colour Rendering
**Dependencies:** Task Group 1

- [x] 4.0 Complete node colour rendering updates
  - [x] 4.1 Write 3-4 focused tests for node colour rendering
    - Test that node renders with custom `background_color` when set
    - Test that node renders with custom `line_color` for border when set
    - Test that node text renders with custom `text_color` when set
    - Test that default colours from entityColors are used when overrides absent
  - [x] 4.2 Update rectangular node rendering in `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate node rendering (lines 1203-1237)
    - Replace `fill={colors.background}` with `fill={node.background_color || colors.background}` (line 1210)
    - Replace `stroke={colors.border}` with `stroke={node.line_color || colors.border}` (line 1211)
    - Replace `fill="#333"` with `fill={node.text_color || "#333"}` for text elements (lines 1230, 1184)
  - [x] 4.3 Update BUSINESS_USER stick man rendering in `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate stick man rendering (lines 1108-1190)
    - Replace `stroke={colors.border}` with `stroke={node.line_color || colors.border}` for:
      - Head circle stroke (line 1129)
      - Body line stroke (line 1139)
      - Arms line stroke (line 1147)
      - Left leg stroke (line 1156)
      - Right leg stroke (line 1165)
    - Replace text `fill="#333"` with `fill={node.text_color || "#333"}` (line 1183)
    - Note: BUSINESS_USER has no background fill, so background_color has no effect
  - [x] 4.4 Ensure node rendering tests pass
    - Run ONLY the 3-4 tests written in 4.1
    - Verify nodes display correct colours

**Acceptance Criteria:**
- The 3-4 tests written in 4.1 pass
- Nodes with `background_color` set display that colour as fill
- Nodes with `line_color` set display that colour as border
- Nodes with `text_color` set display that colour for label text
- BUSINESS_USER stroke colour can be customized via `line_color`
- Default colours from `entityColors` (defaults.ts lines 178-187) used when no override

---

### Edge Rendering Layer

#### Task Group 5: Edge Colour Rendering
**Dependencies:** Task Group 1

- [x] 5.0 Complete edge colour rendering updates
  - [x] 5.1 Write 3-4 focused tests for edge colour rendering
    - Test that edge renders with custom `line_color` for stroke when set
    - Test that arrowhead uses same colour as edge stroke
    - Test that edge label renders with custom `text_color` when set
    - Test that default colours ("#616161" for stroke, "#333" for text) used when absent
  - [x] 5.2 Update edge path rendering in `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate edge rendering (lines 1241-1330)
    - Create edge colour variable: `const edgeStrokeColor = edge.line_color || '#616161'`
    - Modify strokeColor logic (around line 1262):
      - When selected: use `edgeInteraction.selectedEdgeColor`
      - When not selected: use `edgeStrokeColor` instead of hardcoded '#616161'
    - Update path stroke (line 1307): use `strokeColor` variable (already uses variable)
    - Update arrowhead fill (line 1311): ensure it uses `strokeColor` (already does)
  - [x] 5.3 Update edge label text colour rendering in `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate label text element (lines 1313-1326)
    - Create label colour variable: `const edgeLabelColor = edge.text_color || '#333'`
    - Replace `fill={isLabelSelected ? edgeInteraction.selectedLabelColor : '#333'}` (line 1322)
    - With: `fill={isLabelSelected ? edgeInteraction.selectedLabelColor : edgeLabelColor}`
  - [x] 5.4 Ensure edge rendering tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify edges display correct colours

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Edges with `line_color` set display that colour for stroke
- Arrowheads match the edge stroke colour
- Edge labels with `text_color` set display that colour
- Selected edge styling still works correctly (blue highlight)
- Default colours used when no override present

---

### Testing Layer

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 3-4 tests written by schema engineer (Task 1.1)
    - Review the 4-5 tests written by UI component engineer (Task 2.1)
    - Review the 3-4 tests written by handler engineer (Task 3.1)
    - Review the 3-4 tests written by node rendering engineer (Task 4.1)
    - Review the 3-4 tests written by edge rendering engineer (Task 5.1)
    - Total existing tests: approximately 16-21 tests
  - [x] 6.2 Analyse test coverage gaps for colour customization feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to colour customization requirements
    - Prioritize end-to-end workflows: user selects node -> picks colour -> canvas updates
    - Check for save/load persistence testing gap
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - End-to-end: Single node background colour change workflow
    - End-to-end: Multi-select node/edge line colour change workflow
    - Integration: Colour persists after save and reload JSON
    - Integration: Colour section visibility based on selection state
    - Edge case: Colour applied to newly added node defaults correctly
    - Edge case: Clearing selection hides colour section
    - Do NOT write exhaustive unit tests for every code path
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to colour customization (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 24-29 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-29 tests total)
- Critical user workflows for colour customization are covered
- No more than 8 additional tests added when filling in testing gaps
- Save/load persistence verified
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Schema Layer (Task Group 1)** - Add colour fields to interfaces first, as all other groups depend on this
2. **Node Rendering Layer (Task Group 4)** - Can proceed in parallel with Task Group 5 once schema complete
3. **Edge Rendering Layer (Task Group 5)** - Can proceed in parallel with Task Group 4 once schema complete
4. **Inspector UI Layer (Task Group 2)** - Requires schema but can proceed while rendering updates happen
5. **Colour Change Handlers (Task Group 3)** - Depends on Task Group 2 UI being in place
6. **Testing Layer (Task Group 6)** - Final review and gap analysis after all implementation complete

```
Task Group 1 (Schema)
       |
       +-----------------+
       |                 |
       v                 v
Task Group 4      Task Group 5
(Node Render)     (Edge Render)
       |                 |
       +-----------------+
       |
       v
Task Group 2 (Inspector UI)
       |
       v
Task Group 3 (Handlers)
       |
       v
Task Group 6 (Testing)
```

---

## Key Files Reference

| File | Purpose | Key Line Numbers |
|------|---------|------------------|
| `frontend/src/types/model.ts` | DiagramNode and DiagramEdge interfaces | 206-254 |
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | Inspector panel UI | 339-357 (update callbacks), 636-699 (alignment section to place colour section after) |
| `frontend/src/components/DiagramsView/InspectorPanel.module.css` | Inspector styles | 166-219 (styleToggle patterns to copy) |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Node and edge rendering | 1093-1237 (nodes), 1240-1330 (edges) |
| `frontend/src/config/defaults.ts` | Default entityColors | 178-187 |

---

## Notes

- All colour values should be stored as hex strings (e.g., "#RRGGBB")
- The browser-native `<input type="color">` returns hex colours
- Existing `updateSelectedNodes()` and `updateSelectedEdges()` callbacks handle batch updates
- No new reducer actions required - existing UPDATE_DIAGRAM_NODES and UPDATE_DIAGRAM_EDGES support partial updates
- Save/Load behaviour is automatic through existing JSON serialization
