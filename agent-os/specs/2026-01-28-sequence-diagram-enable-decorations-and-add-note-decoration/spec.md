# Specification: Sequence Diagram - Enable Decorations and Add Note Decoration

## Goal
Enable the existing decoration system (drag, resize, edit text, persist) for Sequence diagrams and introduce a new "Note" decoration type styled as a post-it note with a folded top-left corner.

## User Stories
- As a user, I want to place decorations (boxes, lines, notes, etc.) on a Sequence diagram so that I can annotate my sequence flows without affecting the deterministic layout.
- As a user, I want to add a "Note" decoration that looks like a post-it note so that I can highlight important information directly on the diagram.

## Specific Requirements

**Render decorations as overlay after SequenceDiagramRenderer**
- In `Canvas.tsx`, the Sequence diagram branch (line ~3128) currently only renders `<SequenceDiagramRenderer>` with no decorations
- After the `<SequenceDiagramRenderer>` element, render the decorations layer using the same `sortedElements` / `renderElement` pattern used in the General diagram branch
- Decorations must render on top of sequence elements (participants, messages, fragments) but use the same z-index ordering as General diagrams
- Selection indicators, resize handles, and drag interactions for decorations must work identically to General diagrams
- The decoration rendering code already exists in `Canvas.tsx` (`renderDecoration` function at line ~2795); reuse it directly

**Enable decoration interactions for Sequence diagrams in Canvas**
- Currently the decoration mouse event handlers (click-to-place, drag, resize) likely short-circuit or are unreachable when `isSequenceDiagram` is true
- Ensure all decoration gesture handling (add via click, select, drag-move, resize handles, text edit double-click, box-select, context menu) works when `isSequenceDiagram` is true
- The `decorationAddMode` state and `handleDecorationAddModeChange` in `DiagramsView.tsx` are already wired to `InspectorPanel` for all diagram types; no changes needed there

**Add "NOTE" to ShapeDecorationType enum and related arrays**
- In `frontend/src/types/model.ts`, add `'NOTE'` to the `DecorationType` union, the `ShapeDecorationType` union, the `DECORATION_TYPES` array, and the `SHAPE_DECORATION_TYPES` array
- The `ShapeDecoration` interface already has all needed fields (pos_x, pos_y, width, height, background_color, text, text_h_align, text_v_align, line_color, line_weight); no interface changes needed

**Add NOTE defaults to DECORATION_DEFAULTS**
- In `frontend/src/config/defaults.ts`, add a `NOTE` entry to `DECORATION_DEFAULTS` with: `background_color: '#FFEB3B'`, `line_color: '#000000'`, `line_weight: '3px'`, `text_h_align: 'CENTER'`, `text_v_align: 'MIDDLE'`, and standard text defaults matching BOX
- Default width/height should be 140x100 (reasonable post-it size)

**Add createNoteDecoration factory function**
- In `frontend/src/utils/decorationUtils.ts`, add a `createNoteDecoration` factory following the same pattern as `createDefaultBoxDecoration`
- Add a `'NOTE'` case to the `createShapeDecoration` switch statement
- The `isShapeDecoration` type guard will automatically work since NOTE is added to `SHAPE_DECORATION_TYPES`

**Render Note shape in shapeRendering.ts**
- In `frontend/src/utils/shapeRendering.ts`, add a `renderNote` function that returns a `ShapeRenderResult`
- The SVG path must draw a rectangle with a triangular fold at the top-left corner (e.g., a 15px fold where the top-left corner is replaced by a diagonal line from (pos_x, pos_y+15) to (pos_x+15, pos_y))
- Fill: `shape.background_color` or default `#FFEB3B`; stroke: `shape.line_color` or default `#000000`; strokeWidth: parsed from `line_weight` or default 3
- Text position centered in the body area (slightly offset down to account for the fold)
- Add `'NOTE'` case to `renderShapeDecoration` and `renderShape` switch statements

**Add Note to InspectorPanel palette**
- In `frontend/src/components/DiagramsView/InspectorPanel.tsx`, add a NOTE entry to the `DECORATION_PALETTE` array with label "Note", title "Add a note decoration", and an appropriate icon (a small SVG of a folded-corner rectangle)
- Add a `NOTE` entry to the `ShapeIcons` object used by the palette

**Persistence - no migration needed**
- Decorations for Sequence diagrams are already stored in `diagram.decorations` array (same as General diagrams)
- The `ArchitectureContext.tsx` reducer already initializes `decorations: []` for all diagrams and handles ADD_DECORATION, UPDATE_DECORATION, DELETE_DECORATION actions
- Backward compatibility: existing Sequence diagrams without decorations already default to `[]` via `diagram?.decorations || []`
- The backend model service already persists `decorations` as part of diagram typed content with no type-specific filtering

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**Canvas.tsx decoration rendering (line ~2795)**
- Contains `renderDecoration()` which handles all shape and line decoration rendering including selection indicators, resize handles, and text overlay
- For the Sequence diagram branch, add a call to render decorations after `<SequenceDiagramRenderer>` using the same function
- All gesture handling (mouseDown, mouseMove, mouseUp) for decorations is already implemented in Canvas

**decorationUtils.ts factory and type guard functions**
- `createShapeDecoration` is the central factory with a switch on ShapeDecorationType; add NOTE case
- `isShapeDecoration` checks against `SHAPE_DECORATION_TYPES` array; adding NOTE to the array makes it work automatically
- Hit testing (`findDecorationAtPoint`, `isPointInsideShapeDecoration`) works for all shapes via bounding box; no changes needed

**shapeRendering.ts render functions**
- Each shape type (OVAL, DIAMOND, etc.) has a dedicated render function returning `ShapeRenderResult` with pathData, fill, stroke, strokeWidth, strokeDasharray, textPosition
- `renderShapeDecoration` routes to the correct function via switch; add NOTE case
- Follow the same pattern for `renderNote`

**InspectorPanel.tsx decoration palette**
- `DECORATION_PALETTE` array defines all available shapes with type, label, title, icon
- `ShapeIcons` object provides SVG icon components for each type
- Adding NOTE follows the identical pattern as existing entries

**config/defaults.ts DECORATION_DEFAULTS**
- Central configuration object defining default styling for each decoration type
- `generateDecorationId` function generates unique IDs; works for any type string passed to it

## Out of Scope
- Sticky or fixed notes that anchor to specific sequence elements (participants, messages, fragments)
- New decoration styling controls or UI beyond the existing InspectorPanel palette and text editor
- Changes to export or print behavior beyond existing decoration handling
- Changes to sequence layout rules based on decorations (decorations are purely overlay)
- Database migration (existing storage handles decorations for all diagram types)
- Folded corner at top-right (UML standard); this spec uses top-left fold only
- Decoration-to-sequence-element connectors or association lines
- Note-specific color picker or font controls
- Rotation support for the Note decoration
- Any changes to the SequenceDiagramRenderer component itself
