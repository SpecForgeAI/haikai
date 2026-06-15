# Spec Requirements: User Journey Temporary Diagram Selection and Review Flow

## Initial Description

Add the UI and orchestration flow that lets a user review multiple generated temporary User Journey diagrams one at a time after the UX Designer save step, choose which journey to inspect, load its temporary diagram into the existing diagram canvas context, and move through the set journey-by-journey.

Increment 5 generates deterministic temporary diagram JSON for each persisted USER_JOURNEY, but there is no user-facing way to choose among multiple journeys and inspect them. The UX Designer workflow needs a practical review loop: user finishes spreadsheet + clarification + save, system generates temporary diagrams for all journeys, user selects one journey, user sees the generated diagram, user later edits/saves it in subsequent increments. This increment introduces the selection/review mechanics but does not yet persist edited diagrams as real diagram artifacts.

## Requirements Discussion

### First Round Questions

**Q1:** The existing `TemporaryDiagramContext` currently holds a single `{ projectId, temporaryDiagramId }` request and the `DiagramsView` fetches one diagram at a time via `fetchTemporaryDiagram(projectId, temporaryDiagramId)`. The new flow needs to manage a list of journeys with selection and next/previous navigation. I assume we should create a new, separate context (e.g., `UserJourneyReviewContext`) rather than extending the existing `TemporaryDiagramContext`, since the existing one is purpose-built for single ER diagram activation and has a different lifecycle. Is that correct, or should we extend the existing context to support multi-diagram review sessions?
**Answer:** Create a new separate UserJourneyReviewContext for this multi-diagram review session; do not overload the existing TemporaryDiagramContext that is purpose-built for single ER temporary diagrams.

**Q2:** The `UserJourneyDiagramDto` contract from the Increment 5 endpoint is structurally different from `TemporaryArchitectureDiagram` (which has nodes/edges/compartments for ER diagrams). The UserJourney contract has journeys, lanes, steps, edges, and render_hints -- essentially a swim-lane flow diagram, not an ER class-box diagram. The existing `TemporaryDiagramRenderer` only supports `diagram_kind === 'ER'`. I assume this increment needs a new `UserJourneyDiagramRenderer` component that renders the swim-lane/flow layout based on the `UserJourneyDiagramDto` contract (lanes as horizontal or vertical bands, steps as nodes within lanes, edges connecting sequential steps). Is that correct, and should the rendering approach follow the SVG-in-canvas pattern used by the existing `TemporaryDiagramRenderer` (inline SVG with grid background)?
**Answer:** Yes, create a new UserJourneyDiagramRenderer for this increment, following the same broad "render into the diagram workspace/canvas" pattern but tailored to the UserJourneyDiagramDto swimlane/title/steps/edges structure rather than trying to force it through the ER renderer.

**Q3:** Currently the `UnifiedChatPanel` exists in `DashboardView`, `MetaModelView`, and `ProductBacklogPage`, but NOT in `DiagramsView`. The existing temporary diagram activation flow works by having the chat panel (in DashboardView) call `activateTemporaryDiagram()` which sets context state, then dispatches `SET_VIEW: 'diagrams'` to navigate to DiagramsView, where the diagram request is consumed. For this new flow, the user runs `@UX Designer > Define User Journeys` in the chat, completes the save step, then needs to review diagrams. I assume the trigger point remains the same pattern -- the chat panel (in Dashboard or MetaModel view) detects the save completion, fetches the list of generated journeys, and then navigates the user to the diagram review experience. Is that correct? Or should the journey chooser and review experience live within the chat panel area (inline in the conversation) rather than navigating away to DiagramsView?
**Answer:** Follow the existing overall pattern: chat/save completion should hand off into the diagram workspace for review, not keep the full chooser/review experience inline inside the chat panel.

**Q4:** The raw idea mentions "single journey auto-opens without chooser." I assume that when the backend returns exactly one `UserJourneyDiagramDto`, we skip the journey list/chooser UI entirely and directly load that single journey's diagram into the canvas review mode. If zero journeys are returned, we show an empty state message in the chat conversation. Is that correct?
**Answer:** Correct: exactly one returned journey should auto-load directly into review mode, and zero journeys should produce a clear empty-state message rather than opening review mode.

**Q5:** For the journey chooser UI, the raw idea suggests "modal, side panel, or inline card" with fields: journey name, primary role, parent business process, step count. I notice the `UserJourneyDiagramJourneyDto` already provides `name`, `userRoleName`, and `parentBusinessProcessName`, and step count can be derived from the steps array. I assume the chooser should be a lightweight inline component (not a modal) displayed within the diagram workspace area -- similar to how the existing "Preview" banner and temporary diagram canvas work, but with a list view before a specific journey is selected. Is that the right direction, or do you prefer a modal overlay or a panel within the chat thread?
**Answer:** The chooser should live in the diagram workspace area as a lightweight review-state component (not a modal and not embedded in the chat thread), so it feels like part of the diagram review flow.

**Q6:** The raw idea states "No permanent diagram save in this increment" and "No editing interactions beyond review/load behavior." I assume the rendered diagram is completely read-only -- no node selection, no drag, no edge editing, no palette panel, no inspector panel (matching the existing temporary diagram mode pattern where these panels are hidden). The only interactions are: zoom, pan (if supported), next/previous journey, return to list, and close review mode. Is that correct?
**Answer:** Correct: this increment is fully read-only in the canvas/workspace sense -- no editing, no palette, no inspector editing, no node drag; only review navigation plus normal viewport interactions like zoom/pan if those already exist in temporary-view mode.

**Q7:** For the "next/previous" navigation, I assume the ordering is deterministic and based on the order returned by the `GET /temporary` endpoint (which returns `List<UserJourneyDiagramDto>`). When the user clicks "Next," we load the next journey from the already-fetched list without re-calling the API. When they reach the last journey, "Next" is disabled (not circular). Is that the expected behavior?
**Answer:** Correct: use the already-fetched list order from the API response, navigate within that in memory, and disable Next/Previous appropriately at the ends (no circular navigation).

**Q8:** After the user closes the review mode (exits the journey review session), I assume they should return to whichever view they were on before (likely Dashboard with the chat thread showing the UX Designer conversation), and all ephemeral review state should be cleaned up. The completion chip from the save-artifact should already be visible in the chat thread. Is that correct, or should closing review mode return to a specific view?
**Answer:** Yes: closing review mode should return the user to the prior normal app view/workspace context, clear all ephemeral review-session state, and leave the UX Designer chat thread intact.

**Q9:** Is there anything that should be explicitly excluded from this increment that might be tempting to include? For example: rendering quality polish (shadows, animations), gateway proxy routes for the Increment 5 endpoints, changes to the existing ER temporary diagram flow, or modifications to the UX Designer persona's conversation logic itself?
**Answer:** Explicitly exclude rendering polish work, new gateway proxy routes unless absolutely required for minimal wiring, any changes to the existing ER temporary diagram flow, and any further modifications to the UX Designer conversation logic itself.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Temporary Diagram Context (single ER diagram activation) - Path: `frontend/src/contexts/TemporaryDiagramContext.tsx`
- Feature: Temporary Diagram Renderer (ER SVG rendering) - Path: `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`
- Feature: Temporary Diagram API client - Path: `frontend/src/api/temporaryDiagramApi.ts`
- Feature: Temporary diagram mode in DiagramsView (state, banner, conditional rendering, close handler) - Path: `frontend/src/components/DiagramsView/DiagramsView.tsx` (lines ~650-930 for state, ~3060-3660 for rendering)
- Feature: handleViewTemporaryDiagram in UnifiedChatPanel (chat-to-diagram activation bridge) - Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (line ~638)
- Feature: CompletionChip (post-save rendering in chat thread) - Path: `frontend/src/components/UnifiedChat/CompletionChip.tsx`
- Feature: UserJourneyDiagramController (Increment 5 backend endpoints) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/UserJourneyDiagramController.java`
- Feature: UserJourneyDiagramDto and related DTOs (diagram contract) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyDiagramDto.java`
- Feature: UserJourneyDiagramProjectionService (stateless projection from DB) - Path: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyDiagramProjectionService.java`
- Feature: TemporaryArchitectureDiagram type definitions - Path: `frontend/src/types/temporaryArchitectureDiagram.ts`
- Feature: ArchitectureContext SET_VIEW dispatch for view switching - Path: `frontend/src/contexts/ArchitectureContext.tsx`
- Feature: App.tsx provider hierarchy and view routing - Path: `frontend/src/App.tsx`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were submitted.

## Requirements Summary

### Functional Requirements

#### Overview and Motivation
- After the UX Designer "Define User Journeys" task completes its save-artifact step, the system must fetch all generated temporary User Journey diagrams from the Increment 5 backend endpoint and present them to the user for review.
- The review flow bridges the gap between persisting journey data and eventually editing/saving journey diagrams in future increments.
- This is a read-only review flow; no diagram persistence or editing occurs.

#### User Experience Flow
1. User runs `@UX Designer` > "Define User Journeys" in the chat panel (DashboardView or MetaModelView).
2. User completes the spreadsheet interpretation, clarification, and save steps.
3. Save-artifact completes successfully; completion chip rendered in chat thread.
4. System calls `GET /api/projects/{projectId}/user-journey-diagrams/temporary` to fetch all generated journey diagram contracts.
5. **Zero journeys returned:** Show a clear empty-state message in the chat conversation (do not navigate to diagram workspace).
6. **Exactly one journey returned:** Auto-navigate to diagram workspace and load the single journey diagram directly into review mode (skip chooser).
7. **Multiple journeys returned:** Navigate to diagram workspace and show the journey chooser component within the diagram workspace area.
8. User selects a journey from the chooser.
9. Selected journey's diagram renders in the diagram canvas area using the new UserJourneyDiagramRenderer.
10. Diagram is clearly labeled as temporary/generated (banner with "Preview" badge, journey name).
11. User can navigate: Next journey, Previous journey, Return to chooser list, Close review mode.
12. Next/Previous navigation uses the already-fetched list in memory (no re-fetch). Next is disabled on the last journey; Previous is disabled on the first.
13. Close review mode returns the user to their prior app view, clears all ephemeral review state, and leaves the chat thread intact.

#### Data Loading
- Primary endpoint: `GET /api/projects/{projectId}/user-journey-diagrams/temporary` returns `List<UserJourneyDiagramDto>`.
- Single-journey endpoint (available if needed): `GET /api/projects/{projectId}/user-journey-diagrams/{userJourneyId}/temporary` returns `UserJourneyDiagramDto`.
- All journey data is fetched once after save completion and held in ephemeral frontend state. Navigation within the set is purely in-memory.

#### Journey Chooser Component
- Lives in the diagram workspace area (not a modal, not in the chat thread).
- Displays a list/card view of generated journeys.
- Each journey entry shows: journey name, primary user role name (`userRoleName`), parent business process name (`parentBusinessProcessName`), step count (derived from `steps.length`).
- Selecting a journey transitions from the chooser view to the single-journey diagram review view.

#### Diagram Rendering
- New `UserJourneyDiagramRenderer` component renders the `UserJourneyDiagramDto` swim-lane/flow structure as SVG.
- Rendering covers: journey title, lanes (horizontal or vertical bands per `render_hints.lane_axis`), steps positioned within their lanes, sequential edges connecting steps, cross-lane edge indicators.
- Follows the same SVG-in-canvas-container pattern as the existing `TemporaryDiagramRenderer` (inline SVG element with grid background inside the canvas container div).
- The renderer receives the `UserJourneyDiagramDto` data directly (not converted to `TemporaryArchitectureDiagram` format).

#### Review Mode Banner and Controls
- When a journey diagram is displayed, the toolbar Row 1 shows:
  - "Preview" badge (matching existing temporary diagram banner styling).
  - Journey name text.
  - "Previous" button (disabled when viewing first journey).
  - "Next" button (disabled when viewing last journey).
  - Current position indicator (e.g., "2 of 5").
  - "Back to List" button (returns to the journey chooser; hidden if the session has only one journey).
  - "Close Review" button (exits review mode entirely).
- Toolbar Row 2 (editing controls) is hidden in review mode (matching existing temporary diagram mode behavior).
- Inspector panel (left) is hidden.
- Palette/editor panel (right) is hidden.
- Zoom controls remain visible and functional.

#### State Model
- New `UserJourneyReviewContext` provides ephemeral, frontend/session-scoped state.
- State shape:
  - `active: boolean` -- whether the review session is active.
  - `projectId: string` -- the project UUID.
  - `sourceTaskId: string` -- the originating task identifier (for traceability).
  - `journeys: UserJourneyDiagramDto[]` -- the full array of fetched journey diagram contracts.
  - `selectedIndex: number | null` -- index into `journeys` of the currently viewed journey, or null when in chooser view.
  - `loading: boolean` -- whether the initial fetch is in progress.
  - `error: string | null` -- error from the fetch or null.
  - `previousView: string` -- the `currentView` value before entering review mode, for restoration on close.
- Context exposes:
  - `activateReviewSession(projectId, sourceTaskId, journeys)` -- called after fetch; sets the session active.
  - `selectJourney(index)` -- selects a journey by index (transitions from chooser to diagram view).
  - `selectNext()` -- advances to the next journey (no-op if at end).
  - `selectPrevious()` -- moves to the previous journey (no-op if at start).
  - `returnToChooser()` -- sets `selectedIndex` to null (returns to chooser view).
  - `closeReviewSession()` -- clears all state, restores previous view.
- This context is NOT persisted to any backend. It is purely in-memory and session-scoped.

#### Integration Points
- **Chat panel save completion -> fetch -> activate:** After the `save-artifact` call succeeds for the `user-journeys` artifact type, the frontend calls the Increment 5 `GET /temporary` endpoint. Based on the result count (0, 1, or many), it either shows an empty-state message in chat, or activates the review session and navigates to DiagramsView.
- **Context activation bridge:** Similar to the existing `handleViewTemporaryDiagram` pattern in `UnifiedChatPanel`, a new handler triggers the review session activation and dispatches `SET_VIEW: 'diagrams'`.
- **DiagramsView consumption:** `DiagramsView` reads the `UserJourneyReviewContext` to detect when the user journey review session is active and renders the appropriate UI (chooser or diagram) instead of the normal diagram editing workspace.
- **View restoration on close:** The `closeReviewSession` handler dispatches `SET_VIEW` with the stored `previousView` value to return the user to their prior context.

#### Read-Only Constraints
- No node selection, no drag-to-move, no resize.
- No edge editing, no waypoint manipulation.
- No palette panel, no inspector panel, no decoration tools.
- No save/persist action for the rendered diagram.
- Zoom and pan controls remain functional (they are passive viewport operations).

#### Failure Handling
- If the `GET /temporary` endpoint returns an HTTP error, show an error message in the chat conversation (do not navigate to review mode).
- If a specific journey's data is malformed or the renderer encounters an error, show a per-journey error state within the diagram canvas area with a clear message and the option to navigate to another journey or close.
- On close/cleanup, all ephemeral state is cleared regardless of error state.
- Zero journeys returned is a valid (non-error) case: show a clear empty-state informational message.

### Reusability Opportunities
- The existing temporary diagram mode pattern in `DiagramsView` (conditional banner rendering, hiding panels, close handler, canvas container) should be studied and reused structurally for the journey review mode rendering branch.
- The `handleViewTemporaryDiagram` pattern in `UnifiedChatPanel` provides the template for the new chat-to-review-session activation bridge.
- The `TemporaryDiagramContext` architecture (lightweight context with request/clear pattern) informs the design of `UserJourneyReviewContext`, though the new context is richer (multi-item, navigation state).
- The SVG rendering approach in `TemporaryDiagramRenderer` (inline SVG with grid pattern, no Canvas element) should be followed for `UserJourneyDiagramRenderer`.
- The `UserJourneyDiagramDto` and related DTO types from the backend define the rendering contract and should be mirrored as TypeScript interfaces in the frontend.

### Scope Boundaries

**In Scope:**
- New `UserJourneyReviewContext` (React context + provider) for ephemeral multi-journey review session state.
- New `UserJourneyDiagramRenderer` component that renders `UserJourneyDiagramDto` as SVG swim-lane diagrams.
- New frontend TypeScript interfaces mirroring the `UserJourneyDiagramDto` backend contract.
- New frontend API client function to call `GET /api/projects/{projectId}/user-journey-diagrams/temporary`.
- Journey chooser component in the diagram workspace area.
- Review mode banner with navigation controls (Next, Previous, Back to List, Close Review, position indicator).
- Integration hook: after `user-journeys` save-artifact completion, fetch diagrams and activate review session.
- Conditional rendering in `DiagramsView` for the journey review mode (chooser view and diagram view).
- Provider wiring in `App.tsx` for the new context.
- Zero-journey empty state message in chat.
- Single-journey auto-load behavior.
- Clean state teardown on close with view restoration.

**Out of Scope:**
- Persisting temporary diagrams as saved diagram artifacts.
- Editing, saving, or modifying User Journey diagrams.
- Changes to the spreadsheet import or save pipeline.
- Full native renderer/editor implementation for User Journey diagram type.
- Changes to other persona flows (only the post-save integration point for UX Designer is touched).
- Bulk review dashboard.
- Rendering polish (shadows, animations, transitions).
- New gateway proxy routes (unless absolutely required for minimal endpoint wiring).
- Any changes to the existing ER temporary diagram flow (`TemporaryDiagramContext`, `TemporaryDiagramRenderer`, existing temporary diagram mode in DiagramsView).
- Any modifications to the UX Designer persona's conversation logic itself.
- Native User Journey diagram type registration in the diagram type picker.

### Technical Considerations
- The Increment 5 endpoints (`/api/projects/{projectId}/user-journey-diagrams/temporary`) are served by the architecture-model-service on port 8080. The existing Vite `/api/` catch-all proxy should route these requests without new gateway routes, but this needs verification during implementation.
- The `UserJourneyDiagramDto` contract has a different structure than `TemporaryArchitectureDiagram`. The new renderer must handle: `journey` (metadata), `lanes` (swim lanes with order), `steps` (positioned within lanes by `laneId`), `edges` (sequential flow connections with `is_cross_lane` flag), and `render_hints` (axis and direction).
- The `render_hints` specify `lane_axis: "VERTICAL"` and `flow_direction: "LEFT_TO_RIGHT"`. The renderer should respect these hints for layout direction.
- `DiagramsView` is already large (~3660 lines). The new journey review mode should be implemented as separate sub-components where possible, with `DiagramsView` containing only the conditional rendering switch (similar to how it delegates to `TemporaryDiagramRenderer` today).
- The `UserJourneyReviewContext` provider must be placed in the `App.tsx` provider hierarchy at a level that survives view switches (alongside `TemporaryDiagramProvider`).
- Step count for the chooser is derived from `dto.steps.length` on the frontend.
- Journey ordering for next/previous is the array order from the API response (no client-side re-sorting).

### Acceptance Criteria
1. After a successful `user-journeys` save-artifact, the system calls `GET /api/projects/{projectId}/user-journey-diagrams/temporary`.
2. If zero journeys are returned, an informational empty-state message appears in the chat conversation; no navigation to diagram workspace occurs.
3. If exactly one journey is returned, the system auto-navigates to the diagram workspace and loads that journey's diagram directly into review mode (no chooser shown).
4. If multiple journeys are returned, the system navigates to the diagram workspace and displays the journey chooser component.
5. The journey chooser displays each journey's name, primary user role, parent business process, and step count.
6. Selecting a journey from the chooser loads its temporary diagram into the canvas area via `UserJourneyDiagramRenderer`.
7. The diagram is labeled as temporary/generated with a "Preview" badge and the journey name in the toolbar banner.
8. Next/Previous navigation buttons work correctly, loading the adjacent journey from the in-memory list without re-fetching.
9. Next is disabled when viewing the last journey; Previous is disabled when viewing the first journey.
10. A position indicator (e.g., "2 of 5") is visible during single-journey review.
11. "Back to List" returns to the journey chooser (hidden when only one journey exists).
12. "Close Review" exits review mode, clears all ephemeral state, and restores the user's previous app view.
13. The diagram canvas is fully read-only: no node selection, drag, edge editing, palette, or inspector.
14. Zoom controls remain functional during review mode.
15. No temporary diagram is persisted as a saved diagram artifact.
16. The existing saved diagram workflows are completely unaffected.
17. The existing ER temporary diagram flow is completely unaffected.
18. Other persona flows (non-UX Designer) are completely unaffected.

### Testing Requirements

**Frontend Unit Tests:**
- `UserJourneyReviewContext`: activation, selection, next/previous boundary behavior, return to chooser, close/cleanup, previous view restoration.
- `UserJourneyDiagramRenderer`: renders journey title, lanes, steps within correct lanes, edges between steps, cross-lane edges, handles empty steps/lanes gracefully, respects render hints.
- Journey chooser component: renders journey list with correct fields, selection triggers callback, handles empty list.
- Review mode banner/navigation: Next/Previous enable/disable states, position indicator text, Back to List visibility, Close handler invocation.
- API client function: successful fetch, HTTP error handling, empty array response.

**Integration Tests:**
- Save-artifact for `user-journeys` triggers the fetch of temporary diagrams.
- Successful fetch with multiple journeys activates review session and navigates to DiagramsView.
- Successful fetch with one journey auto-loads into review mode.
- Successful fetch with zero journeys shows empty state without navigation.
- Closing review mode restores previous view and clears state.

**Regression Tests:**
- Existing ER temporary diagram activation and rendering is unaffected.
- Existing diagram selection and editing workflows are unaffected.
- Existing persona conversation flows are unaffected.
- Normal DiagramsView rendering (no review session active) is unchanged.
