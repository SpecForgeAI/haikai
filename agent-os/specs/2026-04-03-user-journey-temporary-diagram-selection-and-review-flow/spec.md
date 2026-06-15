# Specification: User Journey Temporary Diagram Selection and Review Flow

## Goal
Enable users to review generated temporary User Journey diagrams after the UX Designer save step by presenting a journey chooser in the diagram workspace, rendering swim-lane SVG diagrams in read-only mode, and supporting next/previous navigation across the fetched set -- all as ephemeral frontend state with no persistence.

## User Stories
- As a user who has just completed the UX Designer "Define User Journeys" save step, I want to see and browse the generated journey diagrams in the diagram workspace so that I can visually verify each journey's flow before future editing increments.
- As a user reviewing multiple generated journeys, I want next/previous navigation and a journey chooser so that I can efficiently move between journeys without re-running the conversation.

## Specific Requirements

**UserJourneyReviewContext (new React context)**
- Create a new `UserJourneyReviewContext` separate from `TemporaryDiagramContext`; do not extend or modify the existing ER temporary diagram context
- State shape: `active: boolean`, `projectId: string`, `sourceTaskId: string`, `journeys: UserJourneyDiagramDto[]`, `selectedIndex: number | null`, `loading: boolean`, `error: string | null`, `previousView: string`
- Expose actions: `activateReviewSession(projectId, sourceTaskId, journeys)`, `selectJourney(index)`, `selectNext()`, `selectPrevious()`, `returnToChooser()`, `closeReviewSession()`
- `selectNext` is a no-op at the last index; `selectPrevious` is a no-op at the first index (no circular navigation)
- `closeReviewSession` clears all state and dispatches `SET_VIEW` with the stored `previousView` to restore the user's prior view
- Context is purely in-memory and session-scoped; never persisted to any backend
- Provider must be placed in `App.tsx` provider hierarchy at the same level as `TemporaryDiagramProvider` so it survives view switches

**UserJourneyDiagramRenderer (new SVG component)**
- Create a new `UserJourneyDiagramRenderer` component that renders `UserJourneyDiagramDto` data as an SVG swim-lane diagram
- Follow the same SVG-in-canvas-container pattern as `TemporaryDiagramRenderer` (inline `<svg>` with grid background `<pattern>`, inside the canvas container div)
- Render: journey title (from `journey.name`), horizontal or vertical lane bands (per `render_hints.lane_axis`), step nodes positioned within their lanes (grouped by `laneId`), sequential edges connecting steps (from `edges` array), visual distinction for cross-lane edges (`is_cross_lane` flag)
- Respect `render_hints.flow_direction` (e.g., `LEFT_TO_RIGHT`) for step ordering within lanes
- Compute step positions deterministically from `order` and `laneId` since the DTO does not include explicit pixel coordinates; use lane order, step sequence order, and configurable spacing constants for layout
- Receive `UserJourneyDiagramDto` directly as a prop (not converted to `TemporaryArchitectureDiagram` format)
- Handle edge cases gracefully: empty steps array, empty lanes array, missing lane references on steps

**Frontend TypeScript interfaces for UserJourneyDiagramDto**
- Create TypeScript interfaces mirroring the backend Java record DTOs: `UserJourneyDiagramDto`, `UserJourneyDiagramJourneyDto`, `UserJourneyDiagramLaneDto`, `UserJourneyDiagramStepDto`, `UserJourneyDiagramEdgeDto`, `UserJourneyDiagramRenderHintsDto`
- Use snake_case field names matching the JSON `@JsonProperty` annotations from the backend (e.g., `diagram_type`, `lane_axis`, `flow_direction`, `from_step_id`, `to_step_id`, `is_cross_lane`, `user_role_name`, `parent_business_process_name`)
- Place in a new file under `frontend/src/types/`

**Frontend API client for fetching temporary journey diagrams**
- Create a new function `fetchTemporaryUserJourneyDiagrams(projectId: string): Promise<UserJourneyDiagramDto[]>` that calls `GET /api/projects/{projectId}/user-journey-diagrams/temporary`
- Follow the existing `temporaryDiagramApi.ts` pattern: use `fetch()` with `API_BASE` env variable, throw on non-ok status
- The Vite `/api` catch-all proxy already routes to the architecture-model-service on port 8080; no new gateway routes are needed

**Chat save completion to diagram workspace handoff**
- After the `save-artifact` call succeeds for the UX Designer user-journeys task (`ux-designer--users-interactions`), add post-save logic that calls `fetchTemporaryUserJourneyDiagrams(projectId)`
- The `TASK_ARTIFACT_MAP` entry for `ux-designer--users-interactions` already exists; the new logic hooks into the post-save success path in `useChatThread.confirmArtifact` or the `onArtifactSaved` callback
- Follow the `handleViewTemporaryDiagram` pattern in `UnifiedChatPanel`: capture `currentView` as `previousView`, call `activateReviewSession`, then dispatch `SET_VIEW: 'diagrams'`
- The fetch call happens in the frontend after save success; the result count determines the next action

**Conditional auto-load behavior based on journey count**
- Zero journeys returned: show an informational empty-state message in the chat conversation (e.g., "No user journey diagrams were generated."); do NOT navigate to the diagram workspace
- Exactly one journey returned: auto-navigate to diagram workspace and load the single journey directly into review mode with `selectedIndex: 0` (skip the chooser)
- Two or more journeys returned: navigate to diagram workspace and show the journey chooser component with `selectedIndex: null`

**Journey chooser component**
- Lives in the diagram workspace area as a lightweight inline component (not a modal, not embedded in the chat thread)
- Displays a list/card view of generated journeys; each entry shows: journey name (`journey.name`), primary user role name (`journey.user_role_name`), parent business process name (`journey.parent_business_process_name`), step count (derived from `steps.length`)
- Selecting a journey calls `selectJourney(index)` which transitions from the chooser view to the single-journey diagram review view
- Shown when `UserJourneyReviewContext.active === true && selectedIndex === null`

**Review mode banner and navigation controls in DiagramsView toolbar Row 1**
- When a journey diagram is displayed (review session active and `selectedIndex !== null`), Row 1 shows: "Preview" badge (matching existing temporary diagram banner styling), journey name text, "Previous" button (disabled on first journey), "Next" button (disabled on last journey), position indicator text (e.g., "2 of 5"), "Back to List" button (hidden if only one journey in session), "Close Review" button
- Toolbar Row 2 (editing controls) is hidden in review mode, matching existing temporary diagram mode behavior
- Inspector panel (left) is hidden in review mode
- Palette/editor panel (right) is hidden in review mode
- Zoom controls remain visible and functional

**Read-only review mode**
- No node selection, drag-to-move, resize, edge editing, waypoint manipulation, palette panel, inspector panel, or decoration tools
- No save/persist action for the rendered diagram
- Zoom and pan controls remain functional (passive viewport operations)

**Next/previous navigation**
- Navigation uses the already-fetched `journeys` array in memory; no re-fetch on next/previous
- Ordering is the array order from the API response (no client-side re-sorting)
- "Next" disabled when `selectedIndex === journeys.length - 1`; "Previous" disabled when `selectedIndex === 0`

**Close behavior and state cleanup**
- "Close Review" calls `closeReviewSession()` which clears all ephemeral review state and dispatches `SET_VIEW` with the stored `previousView`
- Returns the user to their prior app view (typically Dashboard with the UX Designer chat thread intact)
- The completion chip from the save step remains visible in the chat thread

**DiagramsView conditional rendering**
- `DiagramsView` reads `UserJourneyReviewContext` to detect when the user journey review session is active
- When active with `selectedIndex === null`: render the journey chooser component
- When active with `selectedIndex !== null`: render the `UserJourneyDiagramRenderer` with the selected journey's data
- When not active: render the normal diagram editing workspace (existing behavior unchanged)
- Journey review mode rendering should be implemented as separate sub-components to avoid further bloating the already-large `DiagramsView.tsx` (~3660 lines)

**Failure handling**
- HTTP error from `GET /temporary`: show an error message in the chat conversation (do not navigate to review mode)
- Malformed journey data or renderer error: show a per-journey error state within the diagram canvas area with a message and option to navigate to another journey or close
- Zero journeys returned is a valid non-error case handled by the empty-state message
- On close/cleanup, all ephemeral state is cleared regardless of error state

## Visual Design
No visual mockups were provided.

## Existing Code to Leverage

**TemporaryDiagramContext (`frontend/src/contexts/TemporaryDiagramContext.tsx`)**
- Lightweight React context with `useState`, `useCallback`, and a Provider pattern for external activation of diagram mode
- The new `UserJourneyReviewContext` should follow this same architectural pattern but with richer state (multi-item list, navigation index, loading/error)
- The `useActivateTemporaryDiagram` convenience hook pattern should be replicated for the new context

**TemporaryDiagramRenderer (`frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`)**
- SVG rendering approach: receives typed diagram data, produces `<g>` elements with nodes and edges as SVG primitives
- The new `UserJourneyDiagramRenderer` should follow this same component structure but render swim-lane layout instead of ER class-box layout
- The existing grid background pattern (`<defs><pattern>`) and canvas container wrapping in `DiagramsView` lines ~3568-3593 should be reused for the journey diagram canvas

**DiagramsView temporary diagram mode (`frontend/src/components/DiagramsView/DiagramsView.tsx`)**
- Lines ~652-688: `TemporaryDiagramState` interface and `initialTemporaryDiagramState` provide the template for local state shape
- Lines ~3067-3109: Conditional banner rendering in toolbar Row 1 (Preview badge, diagram name, close button) -- this pattern should be replicated for journey review mode with additional navigation controls
- Lines ~3530-3593: Conditional canvas rendering (loading state, error state, SVG container) -- reuse this same branching pattern for journey review
- Lines ~3641-3642: Hiding left/right panels when temporary mode is active -- extend this condition to also hide panels during journey review

**handleViewTemporaryDiagram in UnifiedChatPanel (`frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` line ~638)**
- Chat-to-diagram activation bridge: captures `activeProject.id`, dispatches `SET_VIEW: 'diagrams'`, calls context activation
- The new post-save handler should follow this same two-step pattern: activate context state, then dispatch view navigation

**temporaryDiagramApi.ts (`frontend/src/api/temporaryDiagramApi.ts`)**
- API client pattern: `API_BASE` from `import.meta.env`, `fetch()` with `encodeURIComponent`, error checking on `res.ok`, typed return
- The new `fetchTemporaryUserJourneyDiagrams` function should follow this exact same pattern
- The Vite proxy catch-all on `/api` already routes to port 8080, confirmed in `vite.config.ts` line 75

## Out of Scope
- Persisting temporary diagrams as saved diagram artifacts
- Editing, saving, or modifying User Journey diagrams (node drag, edge editing, inspector changes)
- Changes to the spreadsheet import or save pipeline
- Full native renderer/editor implementation for User Journey diagram type
- Changes to other persona flows (only the post-save integration point for UX Designer is touched)
- Bulk review dashboard
- Rendering polish (shadows, animations, transitions)
- New gateway proxy routes (the Vite `/api` catch-all already handles the endpoint)
- Any changes to the existing ER temporary diagram flow (`TemporaryDiagramContext`, `TemporaryDiagramRenderer`, existing temporary diagram mode in DiagramsView)
- Any modifications to the UX Designer persona's conversation logic itself
- Native User Journey diagram type registration in the diagram type picker
