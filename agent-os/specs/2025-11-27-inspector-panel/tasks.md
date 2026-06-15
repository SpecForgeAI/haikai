# Task Breakdown: Inspector Panel for Text Styling

## Overview
Total Tasks: 49 (37 base + 12 extended)

This feature implements a collapsible left-hand Inspector panel in the Diagrams view that enables users to edit visual text styling (font size, bold/italic/underline, text alignment) for selected diagram nodes and edges through the UI.

**Extended Features (Task Groups 6-9):** Support for BUSINESS_USER node text styling, diagram_edge label text styling, and conditional visibility of alignment controls based on selection type.

## Task List

---

### Data Model Layer

#### Task Group 1: Data Model Extensions and Context Actions [COMPLETED]
**Dependencies:** None

- [x] 1.0 Complete data model and context layer
  - [x] 1.1 Write 4 focused tests for data model and context updates
    - Test UPDATE_DIAGRAM_EDGE action correctly updates single edge
    - Test UPDATE_DIAGRAM_NODES batch action updates multiple nodes
    - Test UPDATE_DIAGRAM_EDGES batch action updates multiple edges
    - Test TOGGLE_INSPECTOR_PANEL action toggles isInspectorPanelCollapsed state
  - [x] 1.2 Extend DiagramNode interface with text_text_decoration field
    - File: `frontend/src/types/model.ts`
    - Add `text_text_decoration?: string` to DiagramNode interface (values: "underline" | "none")
    - Place after existing text_font_style field (around line 222)
  - [x] 1.3 Extend DiagramEdge interface with label decoration and alignment fields
    - File: `frontend/src/types/model.ts`
    - Add `label_text_decoration?: string` to DiagramEdge interface (values: "underline" | "none")
    - Add `label_h_align?: TextHorizontalAlign` to DiagramEdge interface (for future use)
    - Add `label_v_align?: TextVerticalAlign` to DiagramEdge interface (for future use)
    - Place after existing label_font_style field (around line 236)
  - [x] 1.4 Add isInspectorPanelCollapsed to AppState
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add `isInspectorPanelCollapsed: boolean` to AppState interface
    - Default value: false (panel expanded by default)
  - [x] 1.5 Add TOGGLE_INSPECTOR_PANEL action to ArchitectureContext
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Add action type to ArchitectureAction union type
    - Add reducer case that toggles isInspectorPanelCollapsed
    - Follow pattern from existing TOGGLE_PALETTE_PANEL action
  - [x] 1.6 Add UPDATE_DIAGRAM_EDGE action for single edge updates
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Action signature: `{ type: 'UPDATE_DIAGRAM_EDGE'; diagramId: string; edgeId: string; updates: Partial<DiagramEdge> }`
    - Follow UPDATE_DIAGRAM_NODE pattern (lines 237-264)
    - Find diagram by ID, find edge by ID, apply updates with spread operator
  - [x] 1.7 Add UPDATE_DIAGRAM_NODES batch action for multi-node updates
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Action signature: `{ type: 'UPDATE_DIAGRAM_NODES'; diagramId: string; nodeIds: string[]; updates: Partial<DiagramNode> }`
    - Iterate over nodeIds array, apply same updates to each matching node
    - Use single state update to avoid multiple re-renders
  - [x] 1.8 Add UPDATE_DIAGRAM_EDGES batch action for multi-edge updates
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
    - Action signature: `{ type: 'UPDATE_DIAGRAM_EDGES'; diagramId: string; edgeIds: string[]; updates: Partial<DiagramEdge> }`
    - Iterate over edgeIds array, apply same updates to each matching edge
    - Use single state update to avoid multiple re-renders
  - [x] 1.9 Ensure data model layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify all new actions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- DiagramNode interface includes text_text_decoration field
- DiagramEdge interface includes label_text_decoration, label_h_align, label_v_align fields
- All 4 context actions (TOGGLE_INSPECTOR_PANEL, UPDATE_DIAGRAM_EDGE, UPDATE_DIAGRAM_NODES, UPDATE_DIAGRAM_EDGES) work correctly
- The 4 tests written in 1.1 pass

**Files Modified:**
- `frontend/src/types/model.ts`
- `frontend/src/contexts/ArchitectureContext.tsx`

---

### Selection Model Layer

#### Task Group 2: Selection State Enhancement [COMPLETED]
**Dependencies:** Task Group 1

- [x] 2.0 Complete selection model enhancement
  - [x] 2.1 Write 5 focused tests for selection model behavior
    - Test single click selects item and clears previous selection
    - Test Ctrl+click adds item to existing selection (multi-select)
    - Test Ctrl+click on selected item removes it from selection
    - Test click on empty canvas clears all selections
    - Test selection state is properly passed to child components
  - [x] 2.2 Define selection state types and props interfaces
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Create SelectionState type: `{ selectedNodeIds: Set<string>; selectedEdgeIds: Set<string> }`
    - Define props interface for passing selection to Canvas
    - Define props interface for passing selection to InspectorPanel (to be created)
  - [x] 2.3 Lift selection state from Canvas to DiagramsView
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Add useState for selectedNodeIds: `Set<string>` (initialize as empty Set)
    - Add useState for selectedEdgeIds: `Set<string>` (initialize as empty Set)
    - Remove selectedNodeId and selectedEdgeId local state from Canvas.tsx
  - [x] 2.4 Create selection callback handlers in DiagramsView
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Create handleNodeSelect(nodeId: string, isMultiSelect: boolean) function
    - Create handleEdgeSelect(edgeId: string, isMultiSelect: boolean) function
    - Create handleClearSelection() function
    - Implement toggle logic for multi-select (add if not present, remove if present)
    - Implement single-select logic (clear all, then add single item)
  - [x] 2.5 Update Canvas props interface to accept selection state
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add props: selectedNodeIds, selectedEdgeIds
    - Add props: onNodeSelect, onEdgeSelect, onClearSelection
    - Remove internal selection state management
  - [x] 2.6 Update Canvas mouse handlers for multi-select support
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Modify handleMouseDown to detect `e.ctrlKey || e.metaKey`
    - Call onNodeSelect(nodeId, isMultiSelect) when node clicked
    - Call onEdgeSelect(edgeId, isMultiSelect) when edge clicked
    - Call onClearSelection() when clicking empty canvas area
  - [x] 2.7 Update Canvas visual selection indicators for multi-select
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Update selection rectangle rendering to use selectedNodeIds.has(node.id)
    - Update edge selection indicator to use selectedEdgeIds.has(edge.id)
    - Show resize handles only on "primary" selected node (first in Set: `Array.from(selectedNodeIds)[0]`)
    - Ensure all selected items show selection indicators simultaneously
  - [x] 2.8 Ensure selection model tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify single-select works correctly
    - Verify multi-select with Ctrl+click works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Selection state is managed in DiagramsView component
- Single click selects single item, clearing previous selection
- Ctrl+click (or Cmd+click on Mac) toggles item in selection
- Click on empty canvas clears all selections
- Multiple nodes and edges can be selected simultaneously
- All selected items show visual selection indicators
- Resize handles appear only on primary (first) selected node
- The 5 tests written in 2.1 pass

**Files Modified:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/Canvas.tsx`

---

### Inspector Panel Component

#### Task Group 3: Inspector Panel UI Component [COMPLETED]
**Dependencies:** Task Groups 1, 2

- [x] 3.0 Complete Inspector Panel component
  - [x] 3.1 Write 6 focused tests for Inspector Panel component
    - Test collapsed state renders slim bar with expand chevron
    - Test expanded state renders full panel with controls
    - Test empty state message when no items selected
    - Test Font Size control updates selected items
    - Test Font Style toggles (Bold/Italic/Underline) work correctly
    - Test Text Alignment radio groups work correctly
  - [x] 3.2 Create InspectorPanel.module.css stylesheet
    - File: `frontend/src/components/DiagramsView/InspectorPanel.module.css`
    - Follow PalettePanel.module.css patterns for consistency
    - Panel styles: `.panel` (250px width), `.panelCollapsed` (30px width)
    - Header styles: `.header`, `.headerTitle`, `.toggleButton`
    - Content styles: `.sectionsContainer` with overflow-y: auto
    - Empty state: `.emptyState` with centered text, muted color (#999)
    - Control group styles: `.controlGroup`, `.controlGroupHeader`
    - Button styles: `.styleToggle`, `.styleToggleActive`, `.alignmentButton`, `.alignmentButtonActive`
    - Input styles: `.fontSizeInput`, `.fontSizeControls`
    - Use border-right (not border-left like PalettePanel since this is left-side)
  - [x] 3.3 Create InspectorPanel.tsx component skeleton
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Define InspectorPanelProps interface with:
      - isCollapsed: boolean
      - onToggleCollapse: () => void
      - selectedNodeIds: Set<string>
      - selectedEdgeIds: Set<string>
      - diagramId: string | null
      - nodes: DiagramNode[]
      - edges: DiagramEdge[]
    - Implement collapsed state rendering (slim bar with chevron >>)
    - Implement expanded state container structure
  - [x] 3.4 Implement empty state display
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Check if selectedNodeIds.size === 0 && selectedEdgeIds.size === 0
    - Render centered message: "Select a node or edge to edit its properties"
    - Use emptyState CSS class
  - [x] 3.5 Create helper functions for computing mixed values
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - getCommonFontSize(): returns number or null if mixed
    - getCommonFontWeight(): returns 'bold' | 'normal' | null if mixed
    - getCommonFontStyle(): returns 'italic' | 'normal' | null if mixed
    - getCommonTextDecoration(): returns 'underline' | 'none' | null if mixed
    - getCommonHAlign(): returns TextHorizontalAlign or null if mixed
    - getCommonVAlign(): returns TextVerticalAlign or null if mixed
    - Functions should iterate over selected nodes/edges and check consistency
  - [x] 3.6 Implement Font Size control group
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Section header: "Font Size" with separator
    - Decrease button [-] with tooltip "Decrease font size"
    - Numeric input field (3 chars wide, "px" suffix visible)
    - Increase button [+] with tooltip "Increase font size"
    - Handle mixed values: show empty input with placeholder "-"
    - Decrease: reduce by 1px, minimum 1 (DISABLE button at minimum)
    - Increase: increase by 1px, maximum 99 (DISABLE button at maximum)
    - Direct input: validate on blur, clamp to 1-99
    - Dispatch UPDATE_DIAGRAM_NODES/UPDATE_DIAGRAM_EDGES with text_font_size/label_font_size
  - [x] 3.7 Implement Font Styles control group
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Section header: "Font Styles"
    - Bold toggle [B] with tooltip "Bold (font-weight: bold)"
    - Italic toggle [I] with tooltip "Italic (font-style: italic)"
    - Underline toggle [U] with tooltip "Underline (text-decoration: underline)"
    - Toggle buttons: 28x28px, active state uses primary color (#1976D2)
    - Mixed values: show inactive/unchecked state
    - Toggle logic: if any selected items inactive, set all active; if all active, set all inactive
    - Update text_font_weight/label_font_weight for bold
    - Update text_font_style/label_font_style for italic
    - Update text_text_decoration/label_text_decoration for underline
  - [x] 3.8 Implement Text Alignment control group
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Section header: "Text Alignment"
    - Note: Only applies to nodes (not edges), but visible when any nodes selected (even in mixed selection)
    - Horizontal sub-group: L | C | R buttons (mutually exclusive)
    - Vertical sub-group: T | M | B buttons (mutually exclusive)
    - Tooltips: "Align left", "Align center", "Align right", "Align top", "Align middle", "Align bottom"
    - Active alignment highlighted with primary color
    - Mixed values: no button highlighted
    - Update text_h_align for horizontal (nodes only)
    - Update text_v_align for vertical (nodes only)
    - Show controls when selectedNodeIds.size > 0 (regardless of edge selection)
  - [x] 3.9 Ensure Inspector Panel component tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify all control groups render correctly
    - Verify state changes trigger appropriate callbacks
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Panel collapses to 30px with >> chevron pointing right
- Panel expands to 250px with << chevron pointing left and "Inspector" title
- Empty state shows when nothing selected
- Font Size controls work with increase/decrease/direct input
- Font Size buttons disabled at min (1) and max (99) boundaries
- Font Style toggles work for Bold, Italic, Underline
- Text Alignment controls work for H and V alignment (nodes only)
- Mixed values handled appropriately for all controls
- All controls have tooltips
- The 6 tests written in 3.1 pass

**Files Created:**
- `frontend/src/components/DiagramsView/InspectorPanel.tsx`
- `frontend/src/components/DiagramsView/InspectorPanel.module.css`

---

### Integration Layer

#### Task Group 4: Layout Integration and Canvas Rendering [COMPLETED]
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete integration layer
  - [x] 4.1 Write 4 focused tests for integration
    - Test three-panel layout renders correctly (Inspector | Canvas | Palette)
    - Test Inspector panel collapse state persists via context
    - Test node text decoration renders correctly in SVG
    - Test edge label text decoration renders correctly in SVG
  - [x] 4.2 Integrate InspectorPanel into DiagramsView layout
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Import InspectorPanel component
    - Add InspectorPanel BEFORE canvasContainer in mainContent div:
      ```tsx
      <div className={styles.mainContent}>
        <InspectorPanel ... />
        <div className={styles.canvasContainer}>...</div>
        <PalettePanel ... />
      </div>
      ```
    - Wire up isCollapsed prop from state.isInspectorPanelCollapsed
    - Wire up onToggleCollapse to dispatch TOGGLE_INSPECTOR_PANEL
    - Pass selectedNodeIds and selectedEdgeIds as props
    - Pass diagramId, nodes, and edges from current diagram
  - [x] 4.3 Create update handlers in DiagramsView for Inspector callbacks
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Note: InspectorPanel handles updates internally via useArchitectureDispatch
    - Update handlers are implemented within InspectorPanel component
    - DiagramsView passes selection state and diagram data as props
  - [x] 4.4 Update Canvas SVG node rendering for text decoration
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate node text rendering section (around lines 697-838)
    - Add textDecoration attribute to SVG text elements
    - Read from `node.text_text_decoration` with fallback to "none"
    - Apply to each tspan element in wrapped text
  - [x] 4.5 Update Canvas SVG edge label rendering for text decoration
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate edge label rendering section
    - Add textDecoration attribute to edge label SVG text element
    - Read from `edge.label_text_decoration` with fallback to "none"
  - [x] 4.6 Update DiagramsView.module.css for three-panel layout (if needed)
    - File: `frontend/src/components/DiagramsView/DiagramsView.module.css`
    - Verify mainContent flex layout accommodates Inspector panel
    - Ensure canvasContainer still uses flex: 1 to fill remaining space
    - No changes needed - flex layout already supports additional child
  - [x] 4.7 Ensure integration layer tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify three-panel layout renders correctly
    - Verify text decoration renders in SVG
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- DiagramsView shows three-panel layout: Inspector | Canvas | Palette
- Inspector panel collapse state managed via ArchitectureContext
- Changes from Inspector panel update selected nodes/edges
- Text decoration (underline) renders correctly on node labels
- Text decoration (underline) renders correctly on edge labels
- The 4 tests written in 4.1 pass

**Files Modified:**
- `frontend/src/components/DiagramsView/DiagramsView.tsx`
- `frontend/src/components/DiagramsView/DiagramsView.module.css` (if needed)
- `frontend/src/components/DiagramsView/Canvas.tsx`

---

### Testing Layer

#### Task Group 5: Test Review and Gap Analysis [COMPLETED]
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written by Task Group 1 (data model)
    - Review the 5 tests written by Task Group 2 (selection model)
    - Review the 6 tests written by Task Group 3 (Inspector Panel)
    - Review the 4 tests written by Task Group 4 (integration)
    - Total existing tests: 19 tests
  - [x] 5.2 Analyze test coverage gaps for Inspector Panel feature
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Suggested gap areas to consider:
      - End-to-end workflow: select node, change font size, verify JSON updates
      - End-to-end workflow: multi-select nodes, apply bold, verify all updated
      - Edge case: switching between single and multi-select preserves values
      - Edge case: alignment controls disabled when only edges selected
      - Persistence: styling changes survive save/load cycle
      - Edge case: deleting selected node/edge updates selection
      - Mixed values: multi-select with different font sizes shows "-"
    - Skip edge cases, performance tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 19-29 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 19-29 tests total)
- Critical user workflows for Inspector Panel feature are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## EXTENDED FEATURES (Task Groups 6-9)

The following task groups implement the extended Inspector Panel features:
1. Conditional alignment control visibility based on selection type
2. BUSINESS_USER text styling verification
3. Edge label text styling verification

---

### Extended Features - Alignment Visibility

#### Task Group 6: Alignment Control Visibility Logic [COMPLETED]
**Dependencies:** Task Groups 1-5 (base implementation complete)

- [x] 6.0 Complete conditional alignment visibility
  - [x] 6.1 Write 4 focused tests for alignment visibility logic
    - Test alignment controls visible when rectangular nodes are selected
    - Test alignment controls hidden when ONLY BUSINESS_USER nodes selected
    - Test alignment controls hidden when ONLY edges selected
    - Test alignment controls hidden when ONLY BUSINESS_USER + edges selected (no rectangular)
  - [x] 6.2 Create helper function to detect rectangular nodes in selection
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Create function `hasRectangularNodesInSelection(selectedNodeIds, nodes)`:
      - Iterate through selectedNodeIds
      - For each node, check if `node.entity_type !== 'BUSINESS_USER'`
      - Return true if ANY node is rectangular (not BUSINESS_USER)
      - Return false if all selected nodes are BUSINESS_USER or selection is empty
    - Example implementation:
      ```typescript
      function hasRectangularNodesInSelection(
        selectedNodeIds: Set<string>,
        nodes: DiagramNode[]
      ): boolean {
        for (const nodeId of selectedNodeIds) {
          const node = nodes.find(n => n.id === nodeId);
          if (node && node.entity_type !== 'BUSINESS_USER') {
            return true;
          }
        }
        return false;
      }
      ```
  - [x] 6.3 Update alignment control visibility condition
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Current logic (line 575): `{hasNodeSelection && (...alignment controls...)}`
    - Change to: `{showAlignmentControls && (...alignment controls...)}`
    - Add new variable:
      ```typescript
      const hasRectangularNodes = hasRectangularNodesInSelection(selectedNodeIds, nodes);
      const showAlignmentControls = hasRectangularNodes;
      ```
    - This ensures alignment controls are shown ONLY when at least one rectangular node is selected
  - [x] 6.4 Update alignment update handlers to filter for rectangular nodes only
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Modify `handleHAlignChange` to apply ONLY to rectangular nodes:
      ```typescript
      const handleHAlignChange = useCallback((align: TextHorizontalAlign) => {
        if (!diagramId) return;
        // Filter for rectangular nodes only
        const rectangularNodeIds = Array.from(selectedNodeIds).filter(nodeId => {
          const node = nodes.find(n => n.id === nodeId);
          return node && node.entity_type !== 'BUSINESS_USER';
        });
        if (rectangularNodeIds.length > 0) {
          dispatch({
            type: 'UPDATE_DIAGRAM_NODES',
            diagramId,
            nodeIds: rectangularNodeIds,
            updates: { text_h_align: align },
          });
        }
      }, [dispatch, diagramId, selectedNodeIds, nodes]);
      ```
    - Apply same pattern to `handleVAlignChange`
  - [x] 6.5 Ensure alignment visibility tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify alignment controls show/hide correctly based on selection
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Alignment controls appear when ANY rectangular node is in selection
- Alignment controls are hidden when ONLY BUSINESS_USER nodes are selected
- Alignment controls are hidden when ONLY edges are selected
- Alignment controls are hidden when ONLY BUSINESS_USER nodes AND edges are selected (no rectangular)
- In mixed selections, alignment changes ONLY affect rectangular nodes (not BUSINESS_USER)
- The 4 tests written in 6.1 pass

**Files Modified:**
- `frontend/src/components/DiagramsView/InspectorPanel.tsx`

**Files Created:**
- `frontend/src/__tests__/inspector-panel-extended-alignment.test.ts`

---

### Extended Features - BUSINESS_USER Styling

#### Task Group 7: BUSINESS_USER Text Styling Verification [COMPLETED]
**Dependencies:** Task Group 6

- [x] 7.0 Complete BUSINESS_USER text styling support
  - [x] 7.1 Write 4 focused tests for BUSINESS_USER text styling
    - Test BUSINESS_USER node text (below stick figure) renders with custom font size
    - Test BUSINESS_USER node text renders with bold font weight
    - Test BUSINESS_USER node text renders with italic font style
    - Test BUSINESS_USER node text renders with underline text decoration
  - [x] 7.2 Verify Canvas.tsx renders BUSINESS_USER text with all styling attributes
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate BUSINESS_USER text rendering section (lines 790-808)
    - Verified current implementation includes:
      - `fontSize={nodeFontSize}` - present at line 800
      - `fontWeight={nodeFontWeight}` - present at line 801
      - `fontStyle={nodeFontStyle}` - present at line 802
      - `textDecoration={nodeTextDecoration}` - present at line 803 (from Task 4.4)
    - No code changes needed - existing implementation is correct
  - [x] 7.3 Verify InspectorPanel applies font styles to BUSINESS_USER nodes
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Verified `updateSelectedNodes` function (lines 339-347) sends updates to ALL selected nodes
    - Font Size, Bold, Italic, Underline all apply to BUSINESS_USER nodes via:
      - handleFontSizeDecrease/Increase -> updateSelectedNodes({ text_font_size: newSizeStr })
      - handleBoldToggle -> updateSelectedNodes({ text_font_weight: newWeight })
      - handleItalicToggle -> updateSelectedNodes({ text_font_style: newStyle })
      - handleUnderlineToggle -> updateSelectedNodes({ text_text_decoration: newDecoration })
    - No code changes needed - existing implementation is correct
  - [x] 7.4 Create manual test scenario for BUSINESS_USER styling
    - Document test steps (included in test file comments):
      1. Add a BUSINESS_USER node to diagram
      2. Select the BUSINESS_USER node
      3. Verify Font Size and Font Styles controls are visible
      4. Verify Text Alignment controls are NOT visible
      5. Change font size using +/- buttons - verify text below stick figure updates
      6. Toggle Bold - verify text becomes bold
      7. Toggle Italic - verify text becomes italic
      8. Toggle Underline - verify text becomes underlined
      9. Save and reload - verify styles persist
  - [x] 7.5 Ensure BUSINESS_USER styling tests pass
    - Ran the 4 tests written in 7.1
    - All tests pass: 4 passed, 0 failed
    - Additional verification tests also pass: 3 passed, 0 failed

**Acceptance Criteria:**
- BUSINESS_USER node text (below stick figure) can be styled with Font Size - VERIFIED
- BUSINESS_USER node text can be styled with Bold/Italic/Underline - VERIFIED
- Alignment controls do NOT appear when only BUSINESS_USER nodes are selected - VERIFIED (Task 6)
- Styling changes persist through save/load - VERIFIED via model updates
- The 4 tests written in 7.1 pass - VERIFIED

**Files Created:**
- `frontend/src/__tests__/inspector-panel-business-user-styling.test.ts`

**Files Verified (no changes needed):**
- `frontend/src/components/DiagramsView/Canvas.tsx` - BUSINESS_USER text rendering includes all styling attributes
- `frontend/src/components/DiagramsView/InspectorPanel.tsx` - updateSelectedNodes applies to all nodes including BUSINESS_USER

---

### Extended Features - Edge Label Styling

#### Task Group 8: Edge Label Text Styling Verification [COMPLETED]
**Dependencies:** Task Group 7

- [x] 8.0 Complete edge label text styling support
  - [x] 8.1 Write 4 focused tests for edge label text styling
    - Test edge label text renders with custom font size
    - Test edge label text renders with bold font weight
    - Test edge label text renders with italic font style
    - Test edge label text renders with underline text decoration
  - [x] 8.2 Verify Canvas.tsx renders edge labels with all styling attributes
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Locate edge label rendering section (lines 931-944)
    - Verified current implementation includes:
      - `fontSize={labelFontSize}` - present at line 936
      - `fontWeight={isLabelSelected ? 'bold' : labelFontWeight}` - present at line 937 (with selection override)
      - `fontStyle={labelFontStyle}` - present at line 938
      - `textDecoration={labelTextDecoration}` - present at line 939 (from Task 4.5)
    - No code changes needed - existing implementation is correct
  - [x] 8.3 Verify InspectorPanel applies font styles to edges
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Verified `updateSelectedEdges` function (lines 349-357) sends updates with:
      - `label_font_size` for font size changes (lines 371-373, 383-385)
      - `label_font_weight` for bold toggle (lines 443-444)
      - `label_font_style` for italic toggle (lines 455-456)
      - `label_text_decoration` for underline toggle (lines 468-470)
    - No code changes needed - existing implementation is correct
  - [x] 8.4 Create manual test scenario for edge label styling
    - Document test steps (included in test file comments):
      1. Create an edge between two nodes with a label
      2. Click on the edge to select it
      3. Verify Font Size and Font Styles controls are visible
      4. Verify Text Alignment controls are NOT visible
      5. Change font size using +/- buttons - verify label text updates
      6. Toggle Bold - verify label becomes bold
      7. Toggle Italic - verify label becomes italic
      8. Toggle Underline - verify label becomes underlined
      9. Save and reload - verify styles persist
  - [x] 8.5 Ensure edge label styling tests pass
    - Ran the 4 tests written in 8.1
    - All tests pass: 4 passed, 0 failed
    - Additional verification tests also pass: 4 passed, 0 failed

**Acceptance Criteria:**
- Edge label text can be styled with Font Size - VERIFIED
- Edge label text can be styled with Bold/Italic/Underline - VERIFIED
- Alignment controls do NOT appear when only edges are selected - VERIFIED
- Styling changes persist through save/load - VERIFIED via model updates
- The 4 tests written in 8.1 pass - VERIFIED

**Files Created:**
- `frontend/src/__tests__/inspector-panel-edge-label-styling.test.ts`

**Files Verified (no changes needed):**
- `frontend/src/components/DiagramsView/Canvas.tsx` - Edge label rendering includes all styling attributes
- `frontend/src/components/DiagramsView/InspectorPanel.tsx` - updateSelectedEdges applies all label styling fields

---

### Extended Features - Integration Testing

#### Task Group 9: Integration Testing for Extended Features [COMPLETED]
**Dependencies:** Task Groups 6, 7, 8

- [x] 9.0 Complete integration testing for extended features
  - [x] 9.1 Write 6 focused integration tests for extended features
    - Test mixed selection (rectangular + BUSINESS_USER): alignment controls visible, alignment applies only to rectangular
    - Test mixed selection (rectangular + edges): alignment controls visible, alignment applies only to rectangular nodes
    - Test mixed selection (BUSINESS_USER + edges): alignment controls hidden, font styles apply to both
    - Test multi-select across all three types: rectangular + BUSINESS_USER + edge - verify correct behavior
    - Test font size change on mixed selection updates all items correctly
    - Test save/load preserves styling for all three target types
  - [x] 9.2 Document edge cases and expected behaviors
    - Created documentation in test file for:
      - Selection contains: [rectangular] -> Show: Font Size, Font Styles, Alignment
      - Selection contains: [BUSINESS_USER] -> Show: Font Size, Font Styles (NO Alignment)
      - Selection contains: [edge] -> Show: Font Size, Font Styles (NO Alignment)
      - Selection contains: [rectangular, BUSINESS_USER] -> Show: Font Size, Font Styles, Alignment (alignment only affects rectangular)
      - Selection contains: [rectangular, edge] -> Show: Font Size, Font Styles, Alignment (alignment only affects rectangular)
      - Selection contains: [BUSINESS_USER, edge] -> Show: Font Size, Font Styles (NO Alignment)
      - Selection contains: [rectangular, BUSINESS_USER, edge] -> Show: Font Size, Font Styles, Alignment (alignment only affects rectangular)
  - [x] 9.3 Run all extended feature tests
    - Ran tests from Task Groups 6, 7, 8, and 9
    - Task Group 6: 6 tests passed
    - Task Group 7: 4 core + 3 verification = 7 tests passed
    - Task Group 8: 4 core + 4 verification = 8 tests passed
    - Task Group 9: 6 tests passed
    - Extended features total: 27 tests passed
  - [x] 9.4 Run full feature test suite (base + extended)
    - Ran ALL Inspector Panel tests (Task Groups 1-9)
    - Base implementation: 29 tests passed
    - Extended features: 27 tests passed
    - Grand total: 56 tests passed, 0 failed
    - All critical workflows verified

**Acceptance Criteria:**
- All extended feature tests pass - VERIFIED (27 passed)
- All Inspector Panel tests pass - VERIFIED (56 total passed)
- Mixed selections behave correctly according to visibility rules - VERIFIED
- Styling changes work correctly for all three target types - VERIFIED
- Save/load persistence works for all target types - VERIFIED

**Files Created:**
- `frontend/src/__tests__/inspector-panel-extended-integration.test.ts`

**Files Modified:**
- `frontend/src/__tests__/run-inspector-panel-tests.ts` - Updated to include extended feature tests

---

## Execution Order

### Base Implementation (COMPLETED)
1. Task Group 1: Data Model Extensions and Context Actions
2. Task Group 2: Selection State Enhancement
3. Task Group 3: Inspector Panel UI Component
4. Task Group 4: Layout Integration and Canvas Rendering
5. Task Group 5: Test Review and Gap Analysis

### Extended Features (COMPLETED)
6. **Task Group 6: Alignment Control Visibility Logic** [COMPLETED]
   - Implements conditional show/hide for alignment controls
   - Core logic change in InspectorPanel.tsx
   - Estimated: 1-2 hours

7. **Task Group 7: BUSINESS_USER Text Styling Verification** [COMPLETED]
   - Verified existing implementation works for BUSINESS_USER text
   - No code changes needed - Canvas.tsx and InspectorPanel.tsx already correct
   - Tests created and passing: 4 core tests + 3 verification tests
   - Estimated: 1 hour

8. **Task Group 8: Edge Label Text Styling Verification** [COMPLETED]
   - Verified existing implementation works for edge labels
   - No code changes needed - Canvas.tsx and InspectorPanel.tsx already correct
   - Tests created and passing: 4 core tests + 4 verification tests
   - Estimated: 1 hour

9. **Task Group 9: Integration Testing for Extended Features** [COMPLETED]
   - End-to-end testing of all extended features
   - Documents edge cases and expected behaviors
   - 6 integration tests created and passing
   - Full test suite: 56 tests passing
   - Estimated: 1-2 hours

**Extended Features Total Estimated Time:** 4-6 hours

---

## File Summary

### Files Created (Extended Features)
| File | Task Group | Status |
|------|------------|--------|
| `frontend/src/__tests__/inspector-panel-extended-alignment.test.ts` | 6 | CREATED |
| `frontend/src/__tests__/inspector-panel-business-user-styling.test.ts` | 7 | CREATED |
| `frontend/src/__tests__/inspector-panel-edge-label-styling.test.ts` | 8 | CREATED |
| `frontend/src/__tests__/inspector-panel-extended-integration.test.ts` | 9 | CREATED |

### Files Modified (Extended Features)
| File | Task Group(s) | Status |
|------|---------------|--------|
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | 6 | COMPLETED |
| `frontend/src/__tests__/run-inspector-panel-tests.ts` | 9 | UPDATED |

### Files Already Created (Base Implementation)
| File | Task Group |
|------|------------|
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | 3 |
| `frontend/src/components/DiagramsView/InspectorPanel.module.css` | 3 |

### Files Already Modified (Base Implementation)
| File | Task Group(s) |
|------|---------------|
| `frontend/src/types/model.ts` | 1 |
| `frontend/src/contexts/ArchitectureContext.tsx` | 1 |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 2, 4 |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 2, 4 |

---

## Key Implementation Notes

### Alignment Visibility Logic
The core change for Task Group 6 is updating the alignment visibility condition:

**Current Implementation (line 575 in InspectorPanel.tsx):**
```typescript
{hasNodeSelection && (
  <div className={styles.controlGroup}>
    <div className={styles.controlGroupHeader}>Text Alignment</div>
    ...
  </div>
)}
```

**New Implementation:**
```typescript
// Add helper function
function hasRectangularNodesInSelection(
  selectedNodeIds: Set<string>,
  nodes: DiagramNode[]
): boolean {
  for (const nodeId of selectedNodeIds) {
    const node = nodes.find(n => n.id === nodeId);
    if (node && node.entity_type !== 'BUSINESS_USER') {
      return true;
    }
  }
  return false;
}

// In component
const hasRectangularNodes = hasRectangularNodesInSelection(selectedNodeIds, nodes);
const showAlignmentControls = hasRectangularNodes;

// In render
{showAlignmentControls && (
  <div className={styles.controlGroup}>
    <div className={styles.controlGroupHeader}>Text Alignment</div>
    ...
  </div>
)}
```

### Alignment Update Filtering
When applying alignment changes in mixed selections, filter to only rectangular nodes:

```typescript
const handleHAlignChange = useCallback((align: TextHorizontalAlign) => {
  if (!diagramId) return;
  const rectangularNodeIds = Array.from(selectedNodeIds).filter(nodeId => {
    const node = nodes.find(n => n.id === nodeId);
    return node && node.entity_type !== 'BUSINESS_USER';
  });
  if (rectangularNodeIds.length > 0) {
    dispatch({
      type: 'UPDATE_DIAGRAM_NODES',
      diagramId,
      nodeIds: rectangularNodeIds,
      updates: { text_h_align: align },
    });
  }
}, [dispatch, diagramId, selectedNodeIds, nodes]);
```

### Entity Type Reference
- **Rectangular nodes**: All entity types EXCEPT 'BUSINESS_USER'
  - APPLICATION, APP_COMPONENT, SERVICE, APPLICATION_POINT, BUSINESS_PROCESS, etc.
- **Non-rectangular nodes**: 'BUSINESS_USER' only
- **Edges**: diagram_edge entities with label_text

---

## Test Summary

### Base Implementation Tests (COMPLETED)
| Task Group | Test Count | Status |
|------------|------------|--------|
| Task Group 1: Data Model | 4 | PASS |
| Task Group 2: Selection Model | 5 | PASS |
| Task Group 3: Inspector Panel Component | 6 | PASS |
| Task Group 4: Integration | 4 | PASS |
| Task Group 5: Gap Tests | 10 | PASS |
| **Base Total** | **29** | **PASS** |

### Extended Features Tests (COMPLETED)
| Task Group | Test Count | Status |
|------------|------------|--------|
| Task Group 6: Alignment Visibility | 6 | PASS |
| Task Group 7: BUSINESS_USER Styling | 4 (+3 verification) = 7 | PASS |
| Task Group 8: Edge Label Styling | 4 (+4 verification) = 8 | PASS |
| Task Group 9: Extended Integration | 6 | PASS |
| **Extended Total** | **27** | **PASS** |

### Overall Test Summary
| Category | Test Count | Status |
|----------|------------|--------|
| Base Implementation | 29 | PASS |
| Extended Features | 27 | PASS |
| **Grand Total** | **56** | **PASS** |
