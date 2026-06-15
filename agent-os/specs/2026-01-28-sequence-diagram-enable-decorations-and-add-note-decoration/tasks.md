# Task Breakdown: Sequence Diagram - Enable Decorations and Add Note Decoration

## Overview
Total Tasks: 18
Scope: Frontend-only

This feature enables the existing decoration system (drag, resize, edit text, persist) for Sequence diagrams and introduces a new "Note" decoration type styled as a post-it note with a folded top-left corner. No backend changes or database migrations are required.

## Task List

### Frontend - Type System and Configuration Layer

#### Task Group 1: Note Decoration Type, Defaults, and Factory
**Dependencies:** None

- [x] 1.0 Complete Note decoration type registration and factory
  - [x] 1.1 Write 4 focused tests for Note type and factory
    - Test: `'NOTE'` is included in `DECORATION_TYPES` array
    - Test: `'NOTE'` is included in `SHAPE_DECORATION_TYPES` array
    - Test: `isShapeDecoration` returns true for a decoration with type `'NOTE'`
    - Test: `createShapeDecoration('NOTE', ...)` returns a shape decoration with correct defaults (background_color `#FFEB3B`, width 140, height 100)
  - [x] 1.2 Add `'NOTE'` to type unions and arrays
    - File: `frontend/src/types/model.ts`
    - Add `'NOTE'` to the `DecorationType` union type
    - Add `'NOTE'` to the `ShapeDecorationType` union type
    - Add `'NOTE'` to the `DECORATION_TYPES` array
    - Add `'NOTE'` to the `SHAPE_DECORATION_TYPES` array
  - [x] 1.3 Add NOTE entry to `DECORATION_DEFAULTS`
    - File: `frontend/src/config/defaults.ts`
    - Add `NOTE` key with: `background_color: '#FFEB3B'`, `line_color: '#000000'`, `line_weight: '3px'`, `text_h_align: 'CENTER'`, `text_v_align: 'MIDDLE'`, width `140`, height `100`
    - Match standard text defaults from BOX entry
  - [x] 1.4 Add `createNoteDecoration` factory function and switch case
    - File: `frontend/src/utils/decorationUtils.ts`
    - Add `createNoteDecoration` function following the pattern of `createDefaultBoxDecoration`
    - Add `'NOTE'` case to the `createShapeDecoration` switch statement calling `createNoteDecoration`
  - [x] 1.5 Ensure type and factory tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify NOTE type is recognized as a shape decoration
    - Verify factory produces correct default values

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `'NOTE'` is present in all relevant type unions and arrays
- `DECORATION_DEFAULTS.NOTE` has correct post-it styling defaults
- `createShapeDecoration('NOTE', ...)` produces a valid shape decoration
- `isShapeDecoration` type guard works for NOTE decorations

### Frontend - SVG Rendering Layer

#### Task Group 2: Note Shape SVG Rendering
**Dependencies:** Task Group 1

- [x] 2.0 Complete Note shape SVG rendering
  - [x] 2.1 Write 5 focused tests for Note rendering
    - Test: `renderNote` returns a `ShapeRenderResult` with valid pathData
    - Test: `renderNote` pathData contains a diagonal line for the top-left fold (from `(pos_x, pos_y+15)` to `(pos_x+15, pos_y)`)
    - Test: `renderNote` uses `#FFEB3B` fill by default
    - Test: `renderNote` uses stroke width 3 by default
    - Test: `renderShapeDecoration` routes `'NOTE'` type to `renderNote`
  - [x] 2.2 Add `renderNote` function
    - File: `frontend/src/utils/shapeRendering.ts`
    - Return `ShapeRenderResult` with pathData drawing a rectangle with triangular fold at top-left corner
    - Fold size: 15px; path goes from `(pos_x, pos_y+15)` diagonally to `(pos_x+15, pos_y)`, then across top, down right side, across bottom, back up to fold start
    - Fill: `shape.background_color` or default `#FFEB3B`
    - Stroke: `shape.line_color` or default `#000000`
    - StrokeWidth: parsed from `shape.line_weight` or default `3`
    - Text position: centered in body area, offset slightly down to account for fold
  - [x] 2.3 Add `'NOTE'` case to `renderShapeDecoration` switch
    - File: `frontend/src/utils/shapeRendering.ts`
    - Route to `renderNote` function
  - [x] 2.4 Add `'NOTE'` case to `renderShape` switch (if separate)
    - File: `frontend/src/utils/shapeRendering.ts`
    - Route to `renderNote` function if `renderShape` has a separate switch
  - [x] 2.5 Ensure rendering tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify SVG path includes fold geometry
    - Verify default styling values

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Note renders as a rectangle with a triangular fold at the top-left corner
- Fill is `#FFEB3B` (post-it yellow) by default
- Stroke is `#000000` with 3px weight by default
- Text is centered in the body area below the fold

### Frontend - Canvas Decoration Overlay for Sequence Diagrams

#### Task Group 3: Enable Decoration Rendering and Interactions on Sequence Diagrams
**Dependencies:** Task Group 1

- [x] 3.0 Complete decoration overlay for Sequence diagrams
  - [x] 3.1 Write 4 focused tests for Sequence diagram decoration rendering
    - Test: Sequence diagram renders decoration overlay layer after SequenceDiagramRenderer
    - Test: decorations render on top of sequence elements (correct z-index ordering)
    - Test: decoration click-to-place works when `isSequenceDiagram` is true
    - Test: decoration drag-move works when `isSequenceDiagram` is true
  - [x] 3.2 Add decoration rendering after SequenceDiagramRenderer in Canvas.tsx
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - In the Sequence diagram branch (around line ~3128), after `<SequenceDiagramRenderer>`, render the decorations layer
    - Reuse the existing `sortedElements` / `renderElement` pattern from the General diagram branch
    - Reuse the existing `renderDecoration` function (around line ~2795)
    - Decorations must render on top of sequence elements using the same z-index ordering as General diagrams
  - [x] 3.3 Enable decoration gesture handlers for Sequence diagrams
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Ensure decoration mouse event handlers (click-to-place, drag, resize, text edit double-click, box-select, context menu) are not short-circuited when `isSequenceDiagram` is true
    - Selection indicators and resize handles must work identically to General diagrams
    - The `decorationAddMode` state is already wired from `DiagramsView.tsx` to `InspectorPanel` for all diagram types
  - [x] 3.4 Ensure decoration overlay tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify decorations render after sequence elements
    - Verify gesture handlers function for Sequence diagrams

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Decorations render as an overlay after the SequenceDiagramRenderer
- All decoration interactions work on Sequence diagrams: click-to-place, select, drag, resize, text edit, context menu
- Sequence elements (participants, messages, fragments) remain unaffected by decorations
- Existing General diagram decoration behavior is unchanged

### Frontend - Inspector Panel Palette

#### Task Group 4: Add Note to InspectorPanel Decoration Palette
**Dependencies:** Task Group 1

- [x] 4.0 Complete Note palette entry in InspectorPanel
  - [x] 4.1 Write 3 focused tests for Note in palette
    - Test: `DECORATION_PALETTE` array contains an entry with type `'NOTE'`
    - Test: Note palette entry has label "Note" and title "Add a note decoration"
    - Test: `ShapeIcons.NOTE` renders an SVG icon (folded-corner rectangle)
  - [x] 4.2 Add NOTE entry to `DECORATION_PALETTE` array
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Add entry with `type: 'NOTE'`, `label: 'Note'`, `title: 'Add a note decoration'`
    - Follow the same pattern as existing palette entries
  - [x] 4.3 Add NOTE SVG icon to `ShapeIcons` object
    - File: `frontend/src/components/DiagramsView/InspectorPanel.tsx`
    - Create a small SVG icon depicting a folded-corner rectangle
    - Use a simple path: rectangle body with diagonal fold at top-left corner
  - [x] 4.4 Ensure palette tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify Note appears in palette
    - Verify icon renders

**Acceptance Criteria:**
- The 3 tests written in 4.1 pass
- Note appears in the decoration palette in InspectorPanel
- Note palette entry has correct label, title, and icon
- Clicking Note palette entry activates decoration add mode for NOTE type

### Testing - Integration and Gap Analysis

#### Task Group 5: Test Review and Integration Testing
**Dependencies:** Task Groups 1, 2, 3, 4 (all completed)

- [x] 5.0 Review existing tests and fill critical gaps
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests from Task Group 1 (type and factory)
    - Review the 5 tests from Task Group 2 (SVG rendering)
    - Review the 4 tests from Task Group 3 (Canvas overlay)
    - Review the 3 tests from Task Group 4 (palette)
    - Total existing tests: 16 tests
  - [x] 5.2 Analyze test coverage gaps for this feature
    - Identify critical user workflows lacking coverage
    - Focus on end-to-end flow: palette click, place on Sequence diagram, persist, reload
    - Focus on backward compatibility with existing Sequence diagrams (no decorations)
  - [x] 5.3 Write up to 8 additional integration tests if needed
    - Test: end-to-end flow - click Note in palette, place on Sequence diagram, verify renders as post-it shape
    - Test: place a BOX decoration on a Sequence diagram (existing type works on Sequence)
    - Test: existing Sequence diagram with no decorations loads without error (backward compat)
    - Test: decoration persists after save and reload on Sequence diagram
    - Test: drag-move a Note decoration on Sequence diagram updates position
    - Test: resize a Note decoration on Sequence diagram updates dimensions
    - Test: double-click Note decoration opens text editor
    - Test: Note decoration renders with correct fold geometry and post-it yellow fill on canvas
  - [x] 5.4 Run all feature-specific tests
    - Run all decoration-on-sequence and Note-related tests
    - Expected total: approximately 16-24 tests
    - Verify all pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-24 tests total)
- End-to-end workflow from palette to rendered Note on Sequence diagram is covered
- Backward compatibility with existing Sequence diagrams is verified
- Existing General diagram decoration behavior has no regressions

## Execution Order

Recommended implementation sequence:

**Phase 1 (Foundation):**
- Task Group 1: Note Decoration Type, Defaults, and Factory (start first - other groups depend on it)

**Phase 2 (Parallel):**
- Task Group 2: Note Shape SVG Rendering (depends on Group 1)
- Task Group 3: Canvas Decoration Overlay for Sequence Diagrams (depends on Group 1)
- Task Group 4: InspectorPanel Palette (depends on Group 1)

**Phase 3 (Sequential):**
- Task Group 5: Integration Testing (requires Groups 1-4 complete)

## File Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/types/model.ts` | 1 | Add `'NOTE'` to DecorationType, ShapeDecorationType unions and arrays |
| `frontend/src/config/defaults.ts` | 1 | Add NOTE entry to DECORATION_DEFAULTS |
| `frontend/src/utils/decorationUtils.ts` | 1 | Add createNoteDecoration factory, NOTE case in createShapeDecoration switch |
| `frontend/src/utils/shapeRendering.ts` | 2 | Add renderNote function, NOTE cases in renderShapeDecoration and renderShape switches |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 3 | Add decoration overlay rendering after SequenceDiagramRenderer, enable gesture handlers for Sequence diagrams |
| `frontend/src/components/DiagramsView/InspectorPanel.tsx` | 4 | Add NOTE to DECORATION_PALETTE array and ShapeIcons object |

## Notes

- **No backend changes required** - decorations already persist for all diagram types
- **No migration required** - existing `diagram.decorations` storage handles all types
- **Backward compatible** - existing Sequence diagrams default to `decorations: []`
- **No changes to SequenceDiagramRenderer** - decorations are a separate overlay layer
- Task Groups 2, 3, and 4 can be developed in parallel once Group 1 is complete
