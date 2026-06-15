# Specification: User Journey Native Diagram Type and Renderer

## Goal
Register `USER_JOURNEY` as a first-class diagram type in the diagram type registry and integrate the existing `UserJourneyDiagramRenderer` into the Canvas.tsx dispatch chain so that User Journey diagrams can be rendered natively within the diagram workspace alongside all other diagram types, with auto-sized SVG content and deterministic layout.

## User Stories
- As a user viewing a generated User Journey diagram, I want it to render inside the standard diagram workspace (with zoom/pan controls) so that I have a consistent experience across all diagram types.
- As a user creating a new diagram, I want `User Journey` excluded from the creation dropdown so that I am not offered a type that must be generated from meta-model data rather than created manually.

## Specific Requirements

**Register USER_JOURNEY in the DiagramType registry**
- Add `'USER_JOURNEY'` to the `DiagramType` union type in `diagramType.ts`
- Add `'USER_JOURNEY'` to the `ALL_DIAGRAM_TYPES` array
- Add `USER_JOURNEY: 'User Journey'` to the `DIAGRAM_TYPE_LABELS` record
- Add `user_journey: 'USER_JOURNEY'` and `'user journey': 'USER_JOURNEY'` entries to `DIAGRAM_TYPE_MAP` for case-insensitive normalization
- The `normalizeDiagramType`, `isDiagramType`, and `getDiagramType` functions require no changes since they are driven by the map

**Introduce CREATABLE_DIAGRAM_TYPES for NewDiagramModal filtering**
- Define a new exported constant `CREATABLE_DIAGRAM_TYPES` in `diagramType.ts` that contains all diagram types except `USER_JOURNEY`
- Update `NewDiagramModal.tsx` to iterate `CREATABLE_DIAGRAM_TYPES` instead of `ALL_DIAGRAM_TYPES` when rendering the type `<select>` dropdown (line 166)
- This is preferred over a filter predicate because it is explicit, easily extensible for future non-creatable types, and requires a single import change

**Add USER_JOURNEY dispatch branch in Canvas.tsx**
- Add a new boolean `isUserJourneyDiagram` check alongside the existing `isActivityDiagram`, `isStateDiagram`, `isUIWorkflowDiagram` checks (near line 708), using `getDiagramType(diagram) === 'USER_JOURNEY'`
- Add a new conditional branch in the renderer dispatch chain (after `isUIWorkflowDiagram` and before the General fallback, near line 3496) that renders the `UserJourneyDiagramRenderer`
- Import `UserJourneyDiagramRenderer` at the top of Canvas.tsx following the same pattern as `ActivityDiagramRenderer`, `StateDiagramRenderer`, etc.

**Adapt UserJourneyDiagramRenderer props for Canvas context**
- The renderer currently accepts `{ diagram: UserJourneyDiagramDto; zoom: number }` and returns a `<g>` element -- this pattern already fits the Canvas SVG container
- Canvas.tsx must source the `UserJourneyDiagramDto` data from the diagram's stored data (not from `UserJourneyReviewContext`) -- add a prop or adapter that converts the native `Diagram` object's embedded journey data into a `UserJourneyDiagramDto`
- The renderer component must accept an optional `onContentBounds` callback prop (or equivalent mechanism) so it can report its computed content dimensions to the parent for auto-sizing
- The `zoom` prop is already accepted; Canvas.tsx should pass its `zoom` state value

**Auto-size SVG viewBox based on content bounds**
- The `computeLayout` function already calculates all lane and step positions deterministically; extract or expose a `computeContentBounds` utility that returns `{ width: number; height: number }` from the layout results
- Content bounds should be computed as the maximum x+width and y+height across all lane rects and step positions, plus a padding margin
- When rendering in the Canvas context, override the fixed `appConfig.canvas.defaultWidth/defaultHeight` dimensions with the computed content bounds for the SVG `width`, `height`, and `viewBox` attributes
- When rendering in the journey review context (DiagramsView.tsx), continue using the existing fixed-size SVG container to avoid breaking Increment 6

**Preserve journey review flow compatibility**
- The existing `UserJourneyReviewContext` flow in `DiagramsView.tsx` (line ~3601) must continue to work without modification
- The renderer must remain a stateless `<g>`-returning component usable in both the journey review SVG and the Canvas SVG
- All 7 existing tests in `UserJourneyDiagramRenderer.test.tsx` must continue to pass after changes

**Error and edge-case handling**
- Empty lanes + empty steps: render the existing "no lanes or steps to display" message (already implemented)
- Orphan steps (lane_id references a non-existent lane): place at a deterministic fallback position (already implemented in `computeLayout`)
- Edges referencing non-existent steps: skip silently by returning null (already implemented in `renderEdge`)
- Missing or malformed `render_hints`: default to `lane_axis: 'HORIZONTAL'`, `flow_direction: 'LEFT_TO_RIGHT'`, `show_title: true`

**Unit and integration tests**
- Add tests verifying `USER_JOURNEY` is present in `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, and normalizes correctly
- Add a test verifying `USER_JOURNEY` is NOT present in `CREATABLE_DIAGRAM_TYPES`
- Add a test verifying `NewDiagramModal` does not render a `User Journey` option in its type dropdown
- Add a Canvas.tsx integration test verifying that when `diagram.diagram_type === 'USER_JOURNEY'`, the `UserJourneyDiagramRenderer` is dispatched (following the pattern of existing renderer dispatch tests)
- Add a test for the auto-sizing content bounds computation

## Visual Design
No visual assets were provided.

## Existing Code to Leverage

**DiagramType registry (`frontend/src/types/diagramType.ts`)**
- Contains the `DiagramType` union type, `ALL_DIAGRAM_TYPES` array, `DIAGRAM_TYPE_LABELS` record, `DIAGRAM_TYPE_MAP` lookup, and `normalizeDiagramType()` function
- The new `USER_JOURNEY` type follows the exact same pattern as `UI_SCREEN` (underscore-cased, added to all four structures)
- The `CREATABLE_DIAGRAM_TYPES` constant should be defined here adjacent to `ALL_DIAGRAM_TYPES`

**Canvas.tsx dispatch chain (`frontend/src/components/DiagramsView/Canvas.tsx`)**
- Lines ~708-717 define boolean flags (`isActivityDiagram`, `isStateDiagram`, `isSequenceDiagram`, `isUIWorkflowDiagram`) using `diagram.diagram_type` or `getDiagramType(diagram)`
- Lines ~3462-3506 use these flags in a ternary chain to conditionally render the matching specialized renderer component
- Lines ~117-124 import each specialized renderer; the new import for `UserJourneyDiagramRenderer` follows this same pattern

**UserJourneyDiagramRenderer (`frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`)**
- Fully functional SVG swim-lane renderer returning a `<g>` element with deterministic layout, sub-renderers for title/lanes/steps/edges, cross-lane edge styling, and orphan step handling
- The `computeLayout` function is the key layout engine; its outputs (lane rects, step positions) already contain all the information needed to compute content bounds for auto-sizing
- Needs minimal extension: an optional content-bounds reporting mechanism and render-hints defaults

**NewDiagramModal (`frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx`)**
- Line 166 iterates `ALL_DIAGRAM_TYPES` to populate the type dropdown; changing the import to `CREATABLE_DIAGRAM_TYPES` is the only modification needed
- No structural or logic changes required beyond the import swap

**Journey review flow (`frontend/src/components/DiagramsView/DiagramsView.tsx` and `frontend/src/contexts/UserJourneyReviewContext.tsx`)**
- DiagramsView.tsx line ~3601 renders the UserJourneyDiagramRenderer inside a fixed-size SVG when `journeyReview.active` is true
- This rendering path is completely separate from the Canvas.tsx dispatch and must remain untouched

## Out of Scope
- Modifying the `UserJourneyDiagramDto` contract (no new fields such as issues, actor, edge labels, or sizing hints)
- Issues or pain-point badges on steps (the DTO does not carry these fields)
- Vertical lane axis support (only horizontal lanes with left-to-right flow)
- Orthogonal or routed edge paths (straight lines only)
- Drag-to-reorder steps or lanes
- Inline editing of any diagram elements
- Export-to-PNG/image functionality specific to User Journey
- Manual swimlane editing or creation
- Branching or conditional flow representation
- Persistence of User Journey diagrams to the backend store
- Manual creation of User Journey diagrams via NewDiagramModal
- Bespoke styling or visual polish beyond clear and consistent rendering
