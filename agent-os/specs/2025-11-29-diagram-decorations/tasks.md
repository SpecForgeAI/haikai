# Task Breakdown: Diagram Decorations

## Overview
Total Tasks: 5 Task Groups, 35+ Sub-tasks

This feature adds purely visual decoration elements (BOX and LINE) to diagrams that are separate from the architecture meta-model. These decorations support grouping boxes, annotation text, and labelled lines.

## Files to Modify/Create

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/types/model.ts` | Modify | Add Decoration types and update Diagram interface |
| `frontend/src/utils/rendering.ts` | Modify | Add decoration rendering utilities |
| `frontend/src/utils/decorationUtils.ts` | Create | New utility file for decoration-specific logic |
| `frontend/src/components/DiagramsView/Canvas.tsx` | Modify | Add decoration rendering, selection, and interaction |
| `frontend/src/components/DiagramsView/DecorationsPanel.tsx` | Create | New bottom panel component for decoration tools |
| `frontend/src/components/DiagramsView/DecorationsPanel.module.css` | Create | Styles for decorations panel |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | Modify | Integrate DecorationsPanel and decoration selection state |
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | Modify | Add decoration style controls |
| `frontend/src/contexts/ArchitectureContext.tsx` | Modify | Add decoration reducer actions |
| `frontend/src/config/defaults.ts` | Modify | Add decoration default styling constants |
| `frontend/src/__tests__/decoration-types.test.ts` | Create | Type definition tests |
| `frontend/src/__tests__/decoration-rendering.test.ts` | Create | Rendering utility tests |
| `frontend/src/__tests__/decoration-panel.test.ts` | Create | Panel component tests |
| `frontend/src/__tests__/decoration-interactions.test.ts` | Create | Selection and editing tests |
| `frontend/src/__tests__/decoration-inspector.test.ts` | Create | Inspector integration tests |

---

## Task List

### Data Model Layer

#### Task Group 1: Type Definitions and State Management
**Dependencies:** None

- [x] 1.0 Complete data model layer for decorations
  - [x] 1.1 Write 4-6 focused tests for decoration type definitions
    - Test BoxDecoration interface structure validation
    - Test LineDecoration interface structure validation
    - Test Decoration union type discrimination
    - Test Diagram interface with decorations array
    - Test default value generation for new decorations
    - Test decoration ID generation uniqueness
    - File: `frontend/src/__tests__/decoration-types.test.ts`
  - [x] 1.2 Add decoration type definitions to model.ts
    - Add `DecorationHAlign` type: `'LEFT' | 'CENTER' | 'RIGHT'`
    - Add `DecorationVAlign` type: `'TOP' | 'MIDDLE' | 'BOTTOM'`
    - Add `LineStyle` type: `'SOLID' | 'DASHED' | 'DOTTED'`
    - Add `ArrowType` type: `'NONE' | 'ARROW'`
    - Add `DecorationBase` interface with shared properties
    - Add `BoxDecoration` interface extending DecorationBase
    - Add `LineDecoration` interface extending DecorationBase
    - Add `Decoration` union type
    - Reference: Spec section "TypeScript Interfaces"
    - File: `frontend/src/types/model.ts`
  - [x] 1.3 Update Diagram interface to include decorations array
    - Add `decorations: Decoration[]` field
    - Ensure backward compatibility (empty array default)
    - File: `frontend/src/types/model.ts`
  - [x] 1.4 Add decoration constants to defaults.ts
    - Add default z-index values (BOX: 50, LINE: 120)
    - Add default BOX styling (background, border, text)
    - Add default LINE styling (stroke, arrows, text)
    - Add minimum dimensions for BOX decorations
    - File: `frontend/src/config/defaults.ts`
  - [x] 1.5 Add reducer actions for decorations in ArchitectureContext.tsx
    - Add `ADD_DECORATION` action
    - Add `UPDATE_DECORATION` action
    - Add `DELETE_DECORATION` action
    - Add `UPDATE_DECORATIONS` action (batch update)
    - Implement reducers with proper immutable state updates
    - Follow existing patterns from `UPDATE_DIAGRAM_NODE` etc.
    - File: `frontend/src/contexts/ArchitectureContext.tsx`
  - [x] 1.6 Add `selectedDecorationIds: Set<string>` to DiagramsView state
    - Add state declaration in DiagramsView.tsx
    - Add selection callback handlers
    - Clear decoration selection when diagram changes
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 1.7 Ensure data model tests pass
    - Run ONLY the tests written in 1.1
    - Verify type definitions compile correctly
    - Verify reducer actions work with test data

**Acceptance Criteria:**
- Decoration types compile without TypeScript errors
- Diagram interface accepts decorations array
- Reducer actions correctly add, update, and delete decorations
- Selection state tracks decoration IDs
- JSON load/save preserves decoration data

---

### Rendering Layer

#### Task Group 2: Canvas Rendering for Decorations
**Dependencies:** Task Group 1

- [x] 2.0 Complete canvas rendering layer for decorations
  - [x] 2.1 Write 4-6 focused tests for decoration rendering utilities
    - Test `renderBoxDecoration()` output with various styles
    - Test `renderLineDecoration()` output with polyline points
    - Test text rendering inside BOX with alignment
    - Test label position calculation for LINE (midpoint default)
    - Test z-index ordering with nodes and edges
    - Test line style (SOLID, DASHED, DOTTED) rendering
    - File: `frontend/src/__tests__/decoration-rendering.test.ts`
  - [x] 2.2 Create decorationUtils.ts utility file
    - Add `generateDecorationId()` function
    - Add `createDefaultBoxDecoration()` function
    - Add `createDefaultLineDecoration()` function
    - Add `calculateLineLabelPosition()` for midpoint calculation
    - Add `isPointInsideBoxDecoration()` hit testing
    - Add `isPointNearLineDecoration()` hit testing
    - Add `getBoxHandlePositions()` for 8 resize handles
    - File: `frontend/src/utils/decorationUtils.ts`
  - [x] 2.3 Add decoration rendering functions to rendering.ts
    - Add `renderBoxDecoration()` SVG generation
    - Add `renderLineDecoration()` SVG generation
    - Add `getDecorationStrokeStyle()` for line styling
    - Handle text_h_align and text_v_align for BOX text
    - Handle arrow_start and arrow_end for LINE
    - File: `frontend/src/utils/rendering.ts`
  - [x] 2.4 Integrate decoration rendering into Canvas.tsx
    - Add decoration rendering layer between grid and nodes
    - Sort decorations by z_index for proper layering
    - Render BOX decorations (z_index < 100 by default)
    - Render LINE decorations (z_index > 110 by default)
    - Use `getDisplayDecoration()` pattern for preview during drag
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
  - [x] 2.5 Implement z-ordering logic
    - BOX decorations default z_index: 50 (below nodes at 100)
    - LINE decorations default z_index: 120 (above edges at 110)
    - Sort all elements by z_index before rendering
    - Handle custom z_index values per decoration
  - [x] 2.6 Ensure rendering tests pass
    - Run ONLY the tests written in 2.1
    - Verify decorations render correctly on canvas
    - Verify z-ordering behaves as expected

**Acceptance Criteria:**
- BOX decorations render with correct background, border, and text
- LINE decorations render as polylines with correct styling
- Text alignment works correctly for BOX decorations
- Labels render at correct position for LINE decorations
- Arrow heads render correctly for LINE decorations
- Z-ordering places BOX below nodes and LINE above edges

---

### UI Components Layer

#### Task Group 3: Bottom Decorations Panel
**Dependencies:** Task Group 1

- [x] 3.0 Complete decorations panel UI component
  - [x] 3.1 Write 4-6 focused tests for DecorationsPanel component
    - Test panel toggle (collapsed/expanded state)
    - Test "Add Box" button click enters add mode
    - Test "Add Line" button click enters add mode
    - Test text editor visibility (single decoration selected)
    - Test text editor hides when no decoration selected
    - Test text input updates decoration in real-time
    - File: `frontend/src/__tests__/decoration-panel.test.ts`
  - [x] 3.2 Create DecorationsPanel.tsx component structure
    - Add collapsed state with toggle button at bottom edge
    - Add expanded state with header and close button
    - Follow existing panel patterns (PalettePanel, InspectorPanel)
    - File: `frontend/src/components/DiagramsView/DecorationsPanel.tsx`
  - [x] 3.3 Create DecorationsPanel.module.css styles
    - Style collapsed tab at bottom of canvas
    - Style expanded panel sections
    - Style Add Box and Add Line buttons
    - Style Decoration Text editor section
    - Match existing application design system
    - File: `frontend/src/components/DiagramsView/DecorationsPanel.module.css`
  - [x] 3.4 Implement "Add Decorations" section
    - Add "Add Box" button with icon
    - Add "Add Line" button with icon
    - Track active add mode state (null | 'BOX' | 'LINE')
    - Highlight active button when in add mode
    - Pass mode state up to Canvas for gesture handling
  - [x] 3.5 Implement "Decoration Text" editor section
    - Show only when exactly one decoration is selected
    - Hide when zero, multiple, or non-decoration items selected
    - Populate with current decoration's text value
    - Update decoration text in real-time on input change
    - Use textarea for multi-line editing capability
  - [x] 3.6 Integrate DecorationsPanel into DiagramsView.tsx
    - Add panel below canvas container
    - Pass decoration add mode state
    - Pass selected decoration for text editing
    - Connect to dispatch for decoration updates
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 3.7 Ensure panel component tests pass
    - Run ONLY the tests written in 3.1
    - Verify panel toggle works
    - Verify text editor updates decoration

**Acceptance Criteria:**
- Panel collapses/expands with click on toggle
- "Add Box" and "Add Line" buttons enter respective modes
- Active mode is visually indicated
- Text editor appears only for single decoration selection
- Text changes update decoration in real-time
- Panel integrates seamlessly with existing canvas layout

---

### Interaction Layer

#### Task Group 4: Selection and Editing Interactions
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete decoration interaction handling
  - [x] 4.1 Write 4-6 focused tests for decoration interactions
    - Test click-to-select decoration
    - Test Ctrl+click for multi-select
    - Test box-select includes decorations
    - Test BOX drag move
    - Test BOX resize via handles
    - Test LINE drag move (entire line)
    - File: `frontend/src/__tests__/decoration-interactions.test.ts`
  - [x] 4.2 Add decoration selection logic to Canvas.tsx
    - Extend `findNodeAtPoint()` pattern for decorations
    - Add `findDecorationAtPoint()` function
    - Check BOX bounds with `isPointInsideBoxDecoration()`
    - Check LINE proximity with `isPointNearLineDecoration()`
    - Update hit testing priority order
  - [x] 4.3 Implement BOX decoration gesture handling in Canvas.tsx
    - Add mode handling for "Add Box" gesture (click-drag)
    - On mouse down: record start point
    - On mouse move: show preview rectangle
    - On mouse up: create decoration with geometry from gesture
    - Auto-select newly created decoration
    - Revert to neutral mode after creation
  - [x] 4.4 Implement LINE decoration gesture handling in Canvas.tsx
    - Add mode handling for "Add Line" gesture (click-click)
    - First click: record start point, show preview
    - Second click: create decoration with two-point line_points
    - Auto-select newly created decoration
    - Revert to neutral mode after creation
  - [x] 4.5 Implement BOX move and resize interactions
    - Add BOX drag state similar to node drag
    - Implement 8 resize handles (corners + edges)
    - Use existing `calculateResize()` pattern
    - Show selection outline and handles when selected
    - Dispatch UPDATE_DECORATION on drag end
  - [x] 4.6 Implement LINE move and point-drag interactions
    - Add LINE drag state for moving entire line
    - Show control points when LINE is selected
    - Allow dragging individual control points
    - Update line_points on point drag
    - Dispatch UPDATE_DECORATION on drag end
  - [x] 4.7 Extend box-select to include decorations
    - Update `handleMouseUp()` box-select logic
    - Add `isDecorationInsideRect()` check
    - Include matching decorations in bulk selection
    - Update `onBulkSelect()` to handle decoration IDs
  - [x] 4.8 Ensure interaction tests pass
    - Run ONLY the tests written in 4.1
    - Verify selection works correctly
    - Verify move and resize work correctly

**Acceptance Criteria:**
- Click selects individual decoration
- Ctrl+click adds to selection
- Box-select rectangle captures decorations
- BOX can be moved by dragging interior
- BOX can be resized via 8 handles
- LINE can be moved by dragging
- LINE control points can be dragged to reshape

---

### Inspector Integration Layer

#### Task Group 5: Inspector Panel Style Controls
**Dependencies:** Task Groups 1, 4

- [x] 5.0 Complete inspector panel integration for decorations
  - [x] 5.1 Write 4-6 focused tests for decoration inspector integration
    - Test font controls apply to BOX text
    - Test font controls apply to LINE label
    - Test background colour applies to BOX only
    - Test line styling applies to BOX border
    - Test line styling applies to LINE stroke
    - Test arrow controls apply to LINE only
    - File: `frontend/src/__tests__/decoration-inspector.test.ts`
  - [x] 5.2 Extend InspectorPanel to detect decoration selection
    - Add `selectedDecorationIds` prop
    - Add `decorations` prop for decoration data
    - Determine if selection contains decorations
    - Update helper functions to include decorations
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
  - [x] 5.3 Implement font controls for decorations
    - Apply font size to decoration text
    - Apply font weight (bold) to decoration text
    - Apply font style (italic) to decoration text
    - Apply text colour to decoration text
    - Handle mixed selection (nodes + edges + decorations)
  - [x] 5.4 Implement colour controls for decorations
    - Background colour: Apply to BOX.background_color
    - Background colour: Ignore for LINE (no fill)
    - Line colour: Apply to BOX.line_color (border)
    - Line colour: Apply to LINE.line_color (stroke)
    - Text colour: Apply to decoration text_color
  - [x] 5.5 Implement line style controls for decorations
    - Line style (SOLID/DASHED/DOTTED) for BOX border
    - Line style for LINE stroke
    - Line weight for both BOX and LINE
  - [x] 5.6 Implement alignment controls for BOX decorations
    - Horizontal alignment (LEFT/CENTER/RIGHT)
    - Vertical alignment (TOP/MIDDLE/BOTTOM)
    - Show alignment controls only when BOX is selected
    - Apply to text_h_align and text_v_align properties
  - [x] 5.7 Implement arrow controls for LINE decorations
    - Arrow start (NONE/ARROW)
    - Arrow end (NONE/ARROW)
    - Show arrow controls only when LINE is selected
    - Disable/ignore for BOX decorations
  - [x] 5.8 Pass decoration selection to InspectorPanel from DiagramsView
    - Add selectedDecorationIds prop
    - Add decorations array prop
    - Connect update handlers for decorations
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
  - [x] 5.9 Ensure inspector integration tests pass
    - Run ONLY the tests written in 5.1
    - Verify style controls update decorations
    - Verify control visibility based on selection type

**Acceptance Criteria:**
- Font controls update decoration text styling
- Background colour updates BOX fill (ignored for LINE)
- Line colour updates BOX border and LINE stroke
- Line style updates both BOX border and LINE stroke
- Alignment controls appear and work for BOX
- Arrow controls appear and work for LINE
- Multi-selection applies compatible styles to all items

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 4-6 tests from Task Group 1 (types/state)
    - Review 4-6 tests from Task Group 2 (rendering)
    - Review 4-6 tests from Task Group 3 (panel UI)
    - Review 4-6 tests from Task Group 4 (interactions)
    - Review 4-6 tests from Task Group 5 (inspector)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for decorations feature
    - Identify critical user workflows lacking coverage
    - Focus ONLY on gaps related to this spec's feature
    - Prioritize end-to-end decoration workflows
    - Do NOT assess entire application test coverage
  - [x] 6.3 Write up to 8 additional strategic tests
    - End-to-end: Create BOX, add text, style, save/load
    - End-to-end: Create LINE with arrows, add label
    - Integration: Decoration selection with nodes/edges
    - Integration: Delete decoration via keyboard
    - Persistence: Decorations round-trip in JSON
    - Edge case: Empty decorations array handling
    - Edge case: LINE with single point (error case)
    - Edge case: BOX with zero dimensions (error case)
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to decorations feature
    - Expected total: approximately 28-38 tests
    - Do NOT run entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical user workflows are covered
- No more than 8 additional tests added
- Testing focused exclusively on decorations feature

**Completion Notes (Task Group 6):**
- Reviewed all 5 existing test files from Task Groups 1-5
- Existing tests define approximately 130+ test cases across:
  - decoration-types.test.ts (~21 tests - Jest style)
  - decoration-rendering.test.ts (~29 tests - Jest style)
  - decoration-panel.test.ts (18 tests - runnable with tsx)
  - decoration-interactions.test.ts (~28 tests - Jest style)
  - decoration-inspector.test.ts (~35 tests - Jest style)
- Identified 8 critical gaps in test coverage
- Created decoration-integration-gaps.test.ts with 15 strategic tests covering:
  - End-to-end BOX workflow (create, style, render, persist)
  - End-to-end LINE workflow (arrows, labels, persist)
  - Mixed selection handling (nodes + edges + decorations)
  - Delete decoration handling
  - JSON persistence round-trip
  - Empty decorations array handling
  - LINE with single/empty points edge cases
  - BOX with zero/negative dimensions edge cases
- Runnable tests executed: 33 tests passed (18 panel + 15 gap tests)
- File: `frontend/src/__tests__/decoration-integration-gaps.test.ts`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Definitions and State Management**
   - Foundation for all other work
   - No external dependencies

2. **Task Group 2: Canvas Rendering**
   - Depends on type definitions from Task Group 1
   - Enables visual verification of decorations

3. **Task Group 3: Bottom Decorations Panel**
   - Depends on type definitions from Task Group 1
   - Can run in parallel with Task Group 2

4. **Task Group 4: Selection and Editing Interactions**
   - Depends on Task Groups 1, 2, 3
   - Core user interaction implementation

5. **Task Group 5: Inspector Panel Integration**
   - Depends on Task Groups 1, 4
   - Styling and property editing

6. **Task Group 6: Test Review and Gap Analysis**
   - Final validation step
   - Depends on all previous groups

---

## Notes

### Existing Code Patterns to Follow

**Type Definitions (model.ts):**
- Follow existing `DiagramNode` and `DiagramEdge` patterns
- Use optional properties with sensible defaults
- Include both position and styling properties

**Reducer Actions (ArchitectureContext.tsx):**
- Follow `UPDATE_DIAGRAM_NODE` pattern for decoration updates
- Use immutable state updates with spread operators
- Handle edge cases (decoration not found, diagram not found)

**Canvas Rendering (Canvas.tsx):**
- Follow node rendering pattern with `getDisplayNode()` for previews
- Use SVG groups with proper z-ordering
- Implement drag state similar to `dragState` and `edgeDragState`

**Inspector Panel (InspectorPanel.tsx):**
- Follow existing helper functions for computing mixed values
- Use callback patterns for update handlers
- Conditionally show controls based on selection type

### JSON Persistence

Decorations are saved as part of each diagram in the JSON structure:
```json
{
  "diagrams": [{
    "id": "d1",
    "decorations": [...]
  }]
}
```

On load, ensure `decorations` defaults to empty array if missing.

### Out of Scope (Per Spec)

- Complex LINE shapes beyond simple polylines
- Decoration grouping/nesting
- Decoration templates or presets
- Copy/paste decorations across diagrams
- Undo/redo for decoration operations
- Decoration-to-node snapping
- Multi-line text editing
- Decoration rotation
