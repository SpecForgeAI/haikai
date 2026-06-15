# Spec Requirements: User Journey Native Diagram Type and Renderer

## Initial Description

Introduce a new native diagram type called "User Journey" and implement its first deterministic renderer in the existing diagram workspace, using the temporary diagram JSON contract as the source model. The renderer will display User Journey diagrams generated as part of the Increment 6 review flow, rendering swimlanes (horizontal bands representing actors or phases), activity step boxes within lanes, edges between steps (including cross-lane edges), and a title area. The diagram is read-only in this context with no editing interactions. The renderer must be deterministic (same input always produces same visual layout), data-driven (all layout derived from input contract), and extensible (future increments can add editing without full rewrite). It must integrate into the existing diagram workspace loading pipeline and coexist with all existing diagram type renderers without conflict.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea describes a "Renderer Input Contract" with fields like `lane.label`, `lane.actor`, `step.issues[]`, `edge.label`, `edge.cross_lane`, and `render_hints.step_width/step_height/lane_height/padding`. However, the existing `UserJourneyDiagramDto` (from Increment 5) in `userJourneyDiagram.ts` has a different field structure: `lane.name` (not `label`), no `actor` field, no `issues` on steps, `edge.is_cross_lane` (not `cross_lane`), no `edge.label`, and `render_hints` with `lane_axis/flow_direction/show_title` instead of sizing values. Which contract is authoritative?
**Answer:** Treat the existing backend UserJourneyDiagramDto produced by Increment 5 as authoritative for Increment 7 and adapt the renderer to that contract rather than introducing a new/modified contract now.

**Q2:** There is already a working `UserJourneyDiagramRenderer.tsx` from Increment 6 with a layout engine (both vertical and horizontal lane axes), sub-renderers for title/lanes/steps/edges, cross-lane edge styling, orphan step handling, and 7 passing tests. Should the native renderer replace this component, extend it, or be a completely separate component?
**Answer:** Use option (b): extend the existing UserJourneyDiagramRenderer so it can serve both the review flow and the native diagram-workspace context, avoiding duplicate rendering logic.

**Q3:** The raw idea calls for registering `user-journey` as a new entry in the diagram type registry. Currently the User Journey diagrams are rendered through a completely separate path (the `UserJourneyReviewContext` flow), bypassing the normal `Canvas.tsx` dispatch chain. Should the new native type integrate into the Canvas.tsx renderer dispatch (alongside Sequence, Activity, State, UI_Workflow), or should it remain a parallel rendering path?
**Answer:** Yes, USER_JOURNEY should plug into the shared Canvas.tsx diagramType dispatch chain so it becomes a real native diagram type within the common canvas/toolbar infrastructure.

**Q4:** If we register `User_Journey` in the `DiagramType` registry, it will appear in the `NewDiagramModal` type dropdown (since it iterates `ALL_DIAGRAM_TYPES`). Since creating persistent User Journey diagrams is out of scope, should we exclude `User_Journey` from the New Diagram type selector?
**Answer:** Exclude User Journey from manual creation in the New Diagram modal for now; it should be generated from meta-model data rather than created blank by hand in this increment.

**Q5:** The raw idea specifies "Issues" as annotations/badges on steps with `info/warning/error` severity levels. The existing `UserJourneyDiagramStepDto` has no `issues` field. Is the issues feature in scope for this increment?
**Answer:** Yes, issues/pain-points display is out of scope for Increment 7 if the current DTO does not carry those fields; do not invent placeholder rendering for them yet.

**Q6:** The existing renderer uses simple SVG `<line>` elements for edges with straight-line connections. For this increment, are straight-line edges acceptable, or do you want orthogonal (right-angle) edge routing?
**Answer:** Straight-line sequential edges are sufficient for v1; do not introduce orthogonal/routed edge complexity in this increment.

**Q7:** The existing renderer currently handles both HORIZONTAL and VERTICAL lane axes. Should we support both orientations or only horizontal lanes with left-to-right flow?
**Answer:** Yes, support only the current v1 orientation implied by renderHints: horizontal swimlanes stacked vertically with left-to-right flow.

**Q8:** The raw idea mentions the canvas should "auto-size to fit all lanes and steps." The existing journey review SVG container uses `appConfig.canvas.defaultWidth/defaultHeight` as fixed dimensions. Should the native renderer calculate and set its own SVG viewBox dimensions based on actual content bounds?
**Answer:** Auto-size the SVG/viewBox based on content so the diagram fits its generated structure deterministically, while still allowing the existing workspace pan/zoom behavior if available.

**Q9:** Is there anything explicitly out of scope beyond what's listed in the raw idea?
**Answer:** Explicitly exclude drag-to-reorder, inline editing, export-to-PNG/image, manual swimlane editing, branching/conditional flows, advanced edge routing, and any bespoke styling/polish work beyond making the native renderer clear and consistent.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Existing UserJourneyDiagramRenderer (Increment 6) - Path: `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`
- Feature: UserJourneyDiagramRenderer tests - Path: `frontend/src/components/DiagramsView/__tests__/UserJourneyDiagramRenderer.test.tsx`
- Feature: UserJourneyDiagramDto contract - Path: `frontend/src/types/userJourneyDiagram.ts`
- Feature: TemporaryDiagramRenderer (similar SVG-in-g-tag pattern) - Path: `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`
- Feature: DiagramType registry (union type, constants, normalization) - Path: `frontend/src/types/diagramType.ts`
- Feature: Canvas.tsx diagram type dispatch chain (lines ~700-720 for type checks, lines ~3462-3506 for conditional rendering) - Path: `frontend/src/components/DiagramsView/Canvas.tsx`
- Feature: DiagramsView.tsx journey review rendering path (lines ~3601 for journey review SVG container) - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx`
- Feature: NewDiagramModal (iterates ALL_DIAGRAM_TYPES, may need filtering) - Path: `frontend/src/components/DiagramsView/modals/NewDiagramModal.tsx`
- Feature: UserJourneyReviewContext (journey review session state) - Path: `frontend/src/contexts/UserJourneyReviewContext.tsx`
- Feature: JourneyChooser (journey selection list) - Path: `frontend/src/components/DiagramsView/JourneyChooser.tsx`
- Feature: JourneyReviewBanner (journey review banner/navigation) - Path: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx`
- Feature: ActivityDiagramRenderer (reference for how a specialized renderer integrates with Canvas) - Path: `frontend/src/components/DiagramsView/ActivityDiagramRenderer.tsx`
- Feature: StateDiagramRenderer (another reference for Canvas dispatch pattern) - Path: `frontend/src/components/DiagramsView/StateDiagramRenderer.tsx`
- Feature: DiagramSelector (diagram selection/creation flow) - Path: `frontend/src/components/DiagramsView/DiagramSelector.tsx`
- Feature: App config (canvas defaults) - Path: `frontend/src/config/defaults.ts`
- Feature: DiagramsView CSS Module - Path: `frontend/src/components/DiagramsView/DiagramsView.module.css`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were found in the `planning/visuals/` directory.

## Requirements Summary

### Functional Requirements
- Register `USER_JOURNEY` as a new entry in the `DiagramType` union type, `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS`, `DIAGRAM_TYPE_MAP`, and `normalizeDiagramType()` in `diagramType.ts`
- Extend the existing `UserJourneyDiagramRenderer.tsx` to serve as the native renderer within the Canvas.tsx dispatch chain (in addition to its current usage in the journey review flow)
- Integrate `USER_JOURNEY` into the Canvas.tsx conditional renderer dispatch alongside Sequence, Activity, State, and UI_Workflow
- The renderer consumes the existing `UserJourneyDiagramDto` contract from `userJourneyDiagram.ts` as-is (no contract modifications)
- Render horizontal swimlanes stacked vertically with left-to-right step flow (single orientation)
- Render title area from `journey.name` when `render_hints.show_title` is true
- Render lanes as horizontal bands with lane name labels in a left-hand header cell
- Render steps as boxes within their corresponding lanes, displaying step name and optionally business_user_name
- Render edges as straight-line arrows between steps, with visual distinction for cross-lane edges (different color, dashed line)
- Auto-size the SVG viewBox based on actual content bounds (number of lanes, steps per lane) rather than using fixed canvas dimensions
- Allow existing workspace zoom controls to work with the auto-sized content
- Display error/empty state when input data is missing required fields (no lanes, no steps)
- Handle orphan steps (referencing non-existent lane_id) gracefully
- Handle edges referencing non-existent steps gracefully (skip silently)
- Layout must be deterministic: same input always produces identical visual output
- The renderer must produce output consistent with the native tool visual language (not resembling Mermaid or external SVG output)
- Exclude `USER_JOURNEY` from the NewDiagramModal type selector dropdown (filter it out of the creation flow)
- The Increment 6 journey review flow must continue to work with the extended renderer
- Clean unmount with no residual state when the diagram is cleared or replaced

### Reusability Opportunities
- The existing `UserJourneyDiagramRenderer.tsx` is the primary starting point -- extend rather than rewrite
- The existing 7 tests in `UserJourneyDiagramRenderer.test.tsx` should continue to pass
- The `TemporaryDiagramRenderer.tsx` SVG-in-g-tag pattern provides a reference for how specialized renderers integrate
- The Canvas.tsx dispatch chain pattern (isSequenceDiagram/isActivityDiagram/isStateDiagram/isUIWorkflowDiagram) provides the exact integration pattern to follow
- The `diagramType.ts` registration pattern (union type + constants + map + normalizer) provides the exact pattern for adding a new type
- The `NewDiagramModal.tsx` iteration over `ALL_DIAGRAM_TYPES` needs a filtering mechanism (either a separate array of creatable types, or a filter predicate)

### Scope Boundaries

**In Scope:**
- DiagramType registry extension with `USER_JOURNEY`
- Canvas.tsx dispatch integration for `USER_JOURNEY`
- Extending UserJourneyDiagramRenderer for Canvas context (may need props adaptation)
- Auto-sizing SVG viewBox based on content bounds
- Excluding `USER_JOURNEY` from NewDiagramModal creation flow
- Horizontal-lanes-with-left-to-right-flow orientation only
- Straight-line edge rendering
- Error state rendering for invalid/incomplete input
- Deterministic layout from input data
- Unit tests for new/changed functionality
- Integration test verifying Canvas dispatch loads and renders USER_JOURNEY type
- Continued compatibility with Increment 6 journey review flow

**Out of Scope:**
- Modifying the `UserJourneyDiagramDto` contract (no new fields like issues, actor, edge labels, sizing hints)
- Issues/pain-points badges on steps (DTO does not carry these fields)
- Vertical lane axis support (only horizontal lanes with L-to-R flow)
- Orthogonal or routed edge paths (straight lines only)
- Drag-to-reorder steps or lanes
- Inline editing of any diagram elements
- Export-to-PNG/image specific to User Journey
- Manual swimlane editing
- Branching or conditional flows
- Advanced edge routing around obstacles
- Bespoke styling/polish beyond clear and consistent rendering
- Persistence of User Journey diagrams to backend store
- Manual creation of User Journey diagrams via NewDiagramModal

### Technical Considerations
- The `DiagramType` union type must be extended: add `'USER_JOURNEY'` to the union, `ALL_DIAGRAM_TYPES` array, `DIAGRAM_TYPE_LABELS` record, and `DIAGRAM_TYPE_MAP` lookup
- A mechanism to distinguish "creatable" diagram types from "all registered" diagram types is needed for the NewDiagramModal filtering (e.g., a `CREATABLE_DIAGRAM_TYPES` subset array, or adding USER_JOURNEY after the modal's iteration source)
- Canvas.tsx needs a new `isUserJourneyDiagram` check (following the pattern of `isActivityDiagram`, `isStateDiagram`, etc.) and a new branch in the conditional renderer chain
- The existing renderer returns a `<g>` element and is designed to be placed inside a parent SVG -- this pattern works for both the journey review SVG container and the Canvas.tsx SVG
- The renderer's props interface (`UserJourneyDiagramRendererProps`) currently takes `diagram: UserJourneyDiagramDto` and `zoom: number` -- Canvas.tsx may need to pass `diagram` from a different source than the journey review context
- Auto-sizing requires the renderer (or a layout utility) to compute total content bounds and expose them so the parent SVG can set appropriate `width`, `height`, and `viewBox` attributes
- The `UserJourneyReviewContext` flow and the native Canvas dispatch are two separate entry points for the same renderer -- both must continue to work
- Existing tests (7 in UserJourneyDiagramRenderer.test.tsx) must remain green after changes
- Frontend tests use Vitest with `vi.mock()` patterns
- CSS Modules are the standard styling approach; the existing renderer uses inline SVG styling constants which is consistent with other diagram renderers (ActivityDiagramRenderer, StateDiagramRenderer, etc.)
