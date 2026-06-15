# Task Breakdown: User Journey Temporary Diagram Selection and Review Flow

## Overview
Total Tasks: 7 Task Groups, ~45 sub-tasks

This is a frontend-only React/TypeScript implementation. All work is within `frontend/src/`. No backend or gateway changes are required. The Vite `/api` catch-all proxy already routes to the architecture-model-service on port 8080.

## Task List

### Foundation Layer

#### Task Group 1: TypeScript Interfaces and API Client
**Dependencies:** None
**Stack:** Frontend TypeScript

This group establishes the data contract and network layer that all other groups depend on. The TypeScript interfaces mirror the backend Java record DTOs with snake_case field names matching the `@JsonProperty` annotations. The API client follows the existing `temporaryDiagramApi.ts` pattern.

- [x] 1.0 Complete TypeScript interfaces and API client
  - [x] 1.1 Write 4-6 focused tests for the API client function
    - Test successful fetch returning an array of `UserJourneyDiagramDto`
    - Test HTTP error response throws with status code in message
    - Test empty array response returns `[]` without error
    - Test `encodeURIComponent` is applied to projectId in the URL
    - Use Vitest with `vi.fn()` to mock `global.fetch`
    - Place tests in `frontend/src/api/__tests__/userJourneyDiagramApi.test.ts`
  - [x] 1.2 Create TypeScript interfaces for UserJourneyDiagramDto contract
    - Create new file: `frontend/src/types/userJourneyDiagram.ts`
    - Define `UserJourneyDiagramDto` with fields: `diagram_type: string`, `version: string`, `journey: UserJourneyDiagramJourneyDto`, `lanes: UserJourneyDiagramLaneDto[]`, `steps: UserJourneyDiagramStepDto[]`, `edges: UserJourneyDiagramEdgeDto[]`, `render_hints: UserJourneyDiagramRenderHintsDto`
    - Define `UserJourneyDiagramJourneyDto` with fields: `id`, `name`, `description`, `user_role_id`, `user_role_name`, `parent_business_process_id`, `parent_business_process_name` (all `string`)
    - Define `UserJourneyDiagramLaneDto` with fields: `id: string`, `name: string`, `order: number`
    - Define `UserJourneyDiagramStepDto` with fields: `id`, `journey_id`, `lane_id`, `process_activity_id`, `process_activity_name`, `name`, `description`, `business_user_id`, `business_user_name` (all `string`), `order: number`
    - Define `UserJourneyDiagramEdgeDto` with fields: `id: string`, `from_step_id: string`, `to_step_id: string`, `order: number`, `is_cross_lane: boolean`
    - Define `UserJourneyDiagramRenderHintsDto` with fields: `lane_axis: string`, `flow_direction: string`, `show_title: boolean`
    - All field names use snake_case matching the JSON `@JsonProperty` annotations from the backend DTOs
  - [x] 1.3 Create API client function for fetching temporary user journey diagrams
    - Create new file: `frontend/src/api/userJourneyDiagramApi.ts`
    - Follow the `temporaryDiagramApi.ts` pattern: `API_BASE` from `import.meta.env.VITE_API_BASE_URL ?? ''`, plain `fetch()`, error check on `res.ok`, typed return
    - Function signature: `fetchTemporaryUserJourneyDiagrams(projectId: string): Promise<UserJourneyDiagramDto[]>`
    - URL: `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/user-journey-diagrams/temporary`
    - Throw on non-ok status with descriptive error message including status code
  - [x] 1.4 Ensure API client tests pass
    - Run ONLY the tests written in 1.1
    - Verify fetch URL construction, success path, and error path

**Acceptance Criteria:**
- TypeScript interfaces compile without errors and match all backend DTO `@JsonProperty` field names exactly
- API client function follows the established `temporaryDiagramApi.ts` pattern
- All 4-6 API client tests pass
- Interfaces are exported and importable from `frontend/src/types/userJourneyDiagram.ts`

---

### State Management Layer

#### Task Group 2: UserJourneyReviewContext
**Dependencies:** Task Group 1 (uses `UserJourneyDiagramDto` type)
**Stack:** Frontend React Context

This group creates the new React context that manages the ephemeral review session state. It follows the `TemporaryDiagramContext` architectural pattern but with richer state for multi-item navigation. The context is purely in-memory and session-scoped.

- [x] 2.0 Complete UserJourneyReviewContext
  - [x] 2.1 Write 6-8 focused tests for UserJourneyReviewContext
    - Test `activateReviewSession` sets `active: true`, stores projectId, sourceTaskId, journeys array, and sets `selectedIndex: null`
    - Test `selectJourney(index)` updates `selectedIndex` to the given index
    - Test `selectNext` advances index by 1; is a no-op at the last index (no circular wrap)
    - Test `selectPrevious` decrements index by 1; is a no-op at index 0 (no circular wrap)
    - Test `returnToChooser` sets `selectedIndex` back to `null`
    - Test `closeReviewSession` clears all state (`active: false`, empty journeys, null selectedIndex, clears error)
    - Test `previousView` is stored on activation and available for restoration on close
    - Test initial state is inactive with empty defaults
    - Place tests in `frontend/src/contexts/__tests__/UserJourneyReviewContext.test.tsx`
    - Use Vitest with `renderHook` from `@testing-library/react`
  - [x] 2.2 Create UserJourneyReviewContext with provider and state management
    - Create new file: `frontend/src/contexts/UserJourneyReviewContext.tsx`
    - Follow the `TemporaryDiagramContext.tsx` pattern: `createContext`, `useState`/`useCallback`, Provider component
    - State shape interface `UserJourneyReviewState`: `active: boolean`, `projectId: string`, `sourceTaskId: string`, `journeys: UserJourneyDiagramDto[]`, `selectedIndex: number | null`, `loading: boolean`, `error: string | null`, `previousView: string`
    - Context type interface exposing state and actions: `activateReviewSession(projectId, sourceTaskId, journeys)`, `selectJourney(index)`, `selectNext()`, `selectPrevious()`, `returnToChooser()`, `closeReviewSession()`
    - `selectNext` is a no-op when `selectedIndex === journeys.length - 1`
    - `selectPrevious` is a no-op when `selectedIndex === 0`
    - `closeReviewSession` clears all state fields back to initial defaults
    - Context is purely in-memory; no backend persistence
  - [x] 2.3 Create convenience hooks for consuming the context
    - `useUserJourneyReviewContext()` -- returns the full context (throws if outside provider)
    - `useActivateJourneyReview()` -- returns just the activation function (analogous to `useActivateTemporaryDiagram`)
    - Follow the same hook pattern as `TemporaryDiagramContext.tsx` lines 100-121
  - [x] 2.4 Wire UserJourneyReviewProvider into App.tsx provider hierarchy
    - Import `UserJourneyReviewProvider` in `frontend/src/App.tsx`
    - Place at the same level as `TemporaryDiagramProvider` so it survives view switches
    - Wrap around or alongside the existing `TemporaryDiagramProvider` inside `PendingActionProvider`
  - [x] 2.5 Ensure UserJourneyReviewContext tests pass
    - Run ONLY the tests written in 2.1
    - Verify all state transitions, boundary behaviors, and cleanup logic

**Acceptance Criteria:**
- All 6-8 context tests pass
- Provider is correctly wired in `App.tsx` provider hierarchy
- Context survives view switches (tested by verifying state persists across `SET_VIEW` dispatches)
- `selectNext`/`selectPrevious` boundary behavior enforced (no circular navigation)
- `closeReviewSession` fully clears all state

---

### Rendering Layer

#### Task Group 3: UserJourneyDiagramRenderer (SVG Swim-Lane)
**Dependencies:** Task Group 1 (uses `UserJourneyDiagramDto` and related types)
**Stack:** Frontend React SVG Component

This group creates the new SVG renderer that renders `UserJourneyDiagramDto` data as a swim-lane diagram. It follows the same SVG-in-canvas-container pattern as `TemporaryDiagramRenderer` but produces swim-lane layout instead of ER class-box layout. Step positions are computed deterministically from `order` and `laneId` since the DTO does not include explicit pixel coordinates.

- [x] 3.0 Complete UserJourneyDiagramRenderer
  - [x] 3.1 Write 5-7 focused tests for UserJourneyDiagramRenderer
    - Test renders journey title text from `journey.name` when `render_hints.show_title` is true
    - Test renders correct number of lane bands based on `lanes` array
    - Test renders step nodes within their correct lanes (grouped by `laneId`)
    - Test renders edges connecting sequential steps (from `edges` array)
    - Test visually distinguishes cross-lane edges (`is_cross_lane: true` vs `false`)
    - Test handles empty steps array gracefully (no crash, shows empty state)
    - Test handles empty lanes array gracefully (no crash)
    - Place tests in `frontend/src/components/DiagramsView/__tests__/UserJourneyDiagramRenderer.test.tsx`
    - Use Vitest with `@testing-library/react` `render()` and SVG element queries
  - [x] 3.2 Define layout constants and position computation logic
    - Create new file or section within the renderer: configurable spacing constants for lane width/height, step node dimensions, inter-step spacing, lane header size, canvas padding
    - Implement deterministic position computation: given `lanes` (sorted by `order`), `steps` (grouped by `laneId`, sorted by `order`), and `render_hints.lane_axis` / `flow_direction`, compute pixel positions for each lane band and step node
    - For `lane_axis: "VERTICAL"` with `flow_direction: "LEFT_TO_RIGHT"`: lanes are vertical columns, steps flow left-to-right within each lane
    - Handle the case where a step references a non-existent `laneId` gracefully (skip or render in a fallback position)
  - [x] 3.3 Implement lane rendering as SVG bands
    - Render each lane as a colored rectangular band (horizontal or vertical depending on `lane_axis`)
    - Include lane name label in the lane header area
    - Use alternating background fills or subtle borders to visually distinguish lanes
    - Support both `lane_axis: "VERTICAL"` and `lane_axis: "HORIZONTAL"` orientations
  - [x] 3.4 Implement step node rendering
    - Render each step as a rounded rectangle SVG node within its assigned lane
    - Display step `name` as the primary label inside the node
    - Optionally show `process_activity_name` or `business_user_name` as secondary text
    - Position based on the deterministic layout computed in 3.2
  - [x] 3.5 Implement edge rendering between steps
    - Render edges as SVG `<line>` or `<path>` elements connecting from-step to to-step
    - Use `from_step_id` and `to_step_id` to look up computed step positions
    - Add arrowhead markers for flow direction
    - Apply visual distinction for cross-lane edges (`is_cross_lane: true`): different stroke style (e.g., dashed) or color
    - Order edges by `order` field
  - [x] 3.6 Assemble the full renderer component
    - Create new file: `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx`
    - Props interface: `{ diagram: UserJourneyDiagramDto; zoom: number }`
    - Follow `TemporaryDiagramRenderer` pattern: receive typed data as prop, produce `<g>` elements with SVG primitives
    - Compose lane bands, step nodes, edges, and optional title into a single SVG group
    - Do NOT convert to `TemporaryArchitectureDiagram` format; render directly from `UserJourneyDiagramDto`
  - [x] 3.7 Ensure renderer tests pass
    - Run ONLY the tests written in 3.1
    - Verify SVG elements render correctly for lanes, steps, edges, and title

**Acceptance Criteria:**
- All 5-7 renderer tests pass
- Swim-lane diagram renders correctly with lanes, steps, and edges
- Layout is deterministic based on `order`, `laneId`, and `render_hints`
- Cross-lane edges are visually distinguished from within-lane edges
- Empty steps/lanes handled gracefully without crashes
- Component receives `UserJourneyDiagramDto` directly (no format conversion)

---

### UI Integration Layer

#### Task Group 4: Journey Chooser Component
**Dependencies:** Task Groups 1 and 2 (uses types and context)
**Stack:** Frontend React Component

This group creates the journey chooser -- a lightweight inline component that lives in the diagram workspace area. It displays a list/card view of generated journeys and allows the user to select one for review.

- [x] 4.0 Complete Journey Chooser component
  - [x] 4.1 Write 4-6 focused tests for JourneyChooser
    - Test renders a card/list entry for each journey in the provided array
    - Test each entry displays: journey name, primary user role name (`user_role_name`), parent business process name (`parent_business_process_name`), step count (derived from `steps.length`)
    - Test clicking a journey entry calls `selectJourney(index)` with the correct index
    - Test handles empty journeys array gracefully (shows appropriate empty state)
    - Test renders without errors when journeys have minimal/missing optional fields
    - Place tests in `frontend/src/components/DiagramsView/__tests__/JourneyChooser.test.tsx`
  - [x] 4.2 Create JourneyChooser component
    - Create new file: `frontend/src/components/DiagramsView/JourneyChooser.tsx`
    - Props: `{ journeys: UserJourneyDiagramDto[]; onSelectJourney: (index: number) => void }`
    - Render a list/card view within the diagram workspace area (not a modal)
    - Each card shows: journey name (`journey.name`), user role name (`journey.user_role_name`), parent business process name (`journey.parent_business_process_name`), step count (`steps.length`)
    - Include a header indicating this is a journey review selection (e.g., "Select a User Journey to Review")
    - Style consistently with existing diagram workspace aesthetics
  - [x] 4.3 Ensure JourneyChooser tests pass
    - Run ONLY the tests written in 4.1

**Acceptance Criteria:**
- All 4-6 chooser tests pass
- Each journey card displays the four required fields (name, user role, business process, step count)
- Selecting a journey fires the callback with the correct array index
- Empty array state handled gracefully

---

#### Task Group 5: Review Mode Banner and Navigation Controls
**Dependencies:** Task Groups 2 and 3 (uses context state and renders alongside the diagram renderer)
**Stack:** Frontend React Component

This group creates the review mode toolbar banner with navigation controls that appears in DiagramsView toolbar Row 1 when a journey diagram is being reviewed. It follows the existing temporary diagram banner pattern but adds next/previous navigation.

- [x] 5.0 Complete review mode banner and navigation
  - [x] 5.1 Write 5-7 focused tests for JourneyReviewBanner
    - Test renders "Preview" badge matching existing temporary diagram banner styling
    - Test renders journey name text from the selected journey's `journey.name`
    - Test "Previous" button is disabled when `selectedIndex === 0`
    - Test "Next" button is disabled when `selectedIndex === journeys.length - 1`
    - Test position indicator shows correct text (e.g., "2 of 5")
    - Test "Back to List" button is hidden when only one journey exists in the session
    - Test "Close Review" button calls the close handler
    - Place tests in `frontend/src/components/DiagramsView/__tests__/JourneyReviewBanner.test.tsx`
  - [x] 5.2 Create JourneyReviewBanner component
    - Create new file: `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx`
    - Props: selected journey data, selectedIndex, total journey count, and callback handlers (`onPrevious`, `onNext`, `onReturnToChooser`, `onCloseReview`)
    - Render in toolbar Row 1: "Preview" badge, journey name, "Previous" button (disabled on first), "Next" button (disabled on last), position indicator (e.g., "2 of 5"), "Back to List" button (hidden if total === 1), "Close Review" button
    - Follow the styling pattern from existing temporary diagram banner in DiagramsView lines ~3067-3109
  - [x] 5.3 Ensure banner tests pass
    - Run ONLY the tests written in 5.1

**Acceptance Criteria:**
- All 5-7 banner tests pass
- Next/Previous buttons correctly disabled at boundaries
- Position indicator text is accurate
- "Back to List" hidden for single-journey sessions
- Styling consistent with existing temporary diagram banner

---

### Orchestration Layer

#### Task Group 6: DiagramsView Integration and Chat-to-Diagram Handoff
**Dependencies:** Task Groups 1-5 (all components must be available)
**Stack:** Frontend React Integration

This group wires everything together: the conditional rendering in DiagramsView to detect the review session and render either the chooser or diagram, the post-save handoff from the chat panel, and the view restoration on close. This is the most integration-heavy group.

- [x] 6.0 Complete DiagramsView integration and chat handoff
  - [x] 6.1 Write 4-6 focused tests for the integration flow
    - Test: when `UserJourneyReviewContext.active === true && selectedIndex === null`, DiagramsView renders the JourneyChooser component
    - Test: when `UserJourneyReviewContext.active === true && selectedIndex !== null`, DiagramsView renders the UserJourneyDiagramRenderer with the selected journey
    - Test: when `UserJourneyReviewContext.active === false`, DiagramsView renders the normal diagram editing workspace (existing behavior unchanged)
    - Test: toolbar Row 2 (editing controls), inspector panel (left), and palette/editor panel (right) are hidden when review session is active
    - Test: zoom controls remain visible and functional during review mode
    - Place tests in `frontend/src/components/DiagramsView/__tests__/DiagramsViewJourneyReview.test.tsx`
  - [x] 6.2 Add conditional rendering in DiagramsView for journey review mode
    - DiagramsView reads `UserJourneyReviewContext` via the `useUserJourneyReviewContext()` hook
    - When `active && selectedIndex === null`: render `JourneyChooser` with the journeys array and `selectJourney` callback
    - When `active && selectedIndex !== null`: render `JourneyReviewBanner` in toolbar Row 1 and `UserJourneyDiagramRenderer` in the canvas area (inside the SVG container with grid background pattern, reusing the pattern from lines ~3568-3593)
    - When `!active`: render the normal diagram editing workspace (no changes to existing behavior)
    - Implement as separate sub-components to avoid further bloating DiagramsView.tsx (~3660 lines)
  - [x] 6.3 Hide editing panels in review mode
    - Extend the existing condition that hides left/right panels during temporary diagram mode (DiagramsView lines ~3641-3642) to also hide panels during journey review
    - Hide toolbar Row 2 (editing controls) when review session is active, matching existing temporary diagram mode behavior
    - Ensure zoom controls remain visible and functional
  - [x] 6.4 Wire close behavior with view restoration
    - `closeReviewSession()` in the context clears all ephemeral state
    - After clearing state, dispatch `SET_VIEW` with the stored `previousView` to restore the user's prior view
    - Requires the context's `closeReviewSession` to either accept a dispatch function or the `DiagramsView` component handles the dispatch after calling `closeReviewSession`
    - The completion chip from the save step remains visible in the chat thread (no changes needed)
  - [x] 6.5 Implement chat save completion to diagram workspace handoff
    - In the post-save success path for the `ux-designer--users-interactions` task (the `TASK_ARTIFACT_MAP` entry for user journeys), add logic to call `fetchTemporaryUserJourneyDiagrams(projectId)`
    - Follow the `handleViewTemporaryDiagram` pattern from `UnifiedChatPanel.tsx` line ~638: capture `currentView` as `previousView`, call `activateReviewSession`, then dispatch `SET_VIEW: 'diagrams'`
    - Hook into `useChatThread.confirmArtifact` or the `onArtifactSaved` callback's success path
  - [x] 6.6 Implement conditional auto-load behavior based on journey count
    - Zero journeys returned: show an informational empty-state message in the chat conversation (e.g., "No user journey diagrams were generated."); do NOT navigate to diagram workspace
    - Exactly one journey returned: call `activateReviewSession` with `selectedIndex: 0` pre-set (or call `activateReviewSession` then immediately `selectJourney(0)`), then dispatch `SET_VIEW: 'diagrams'` -- this skips the chooser
    - Two or more journeys returned: call `activateReviewSession` with `selectedIndex: null`, then dispatch `SET_VIEW: 'diagrams'` -- this shows the chooser
  - [x] 6.7 Implement failure handling
    - HTTP error from `GET /temporary`: show an error message in the chat conversation (do not navigate to review mode); set `error` on context state
    - Malformed journey data or renderer error: wrap `UserJourneyDiagramRenderer` in an error boundary or try-catch; show a per-journey error state within the diagram canvas area with a message and option to navigate to another journey or close
    - Zero journeys returned is a valid non-error case handled by the empty-state message in 6.6
    - On close/cleanup, all ephemeral state is cleared regardless of error state
  - [x] 6.8 Ensure integration tests pass
    - Run ONLY the tests written in 6.1
    - Verify conditional rendering, panel hiding, and zoom controls

**Acceptance Criteria:**
- All 4-6 integration tests pass
- DiagramsView correctly switches between chooser, diagram review, and normal editing modes
- Editing panels hidden in review mode; zoom controls remain
- Post-save handoff correctly fetches diagrams and activates the appropriate mode (0, 1, or many journeys)
- Close behavior restores previous view and clears all state
- Error handling covers HTTP errors and malformed data without crashing

---

### Testing Layer

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4-6 API client tests (Task 1.1)
    - Review the 6-8 context tests (Task 2.1)
    - Review the 5-7 renderer tests (Task 3.1)
    - Review the 4-6 chooser tests (Task 4.1)
    - Review the 5-7 banner tests (Task 5.1)
    - Review the 4-6 integration tests (Task 6.1)
    - Total existing tests: approximately 28-40 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus on integration points: save completion triggering fetch, fetch result count determining behavior, navigation flow from chooser to diagram and back
    - Check that regression safety is covered: existing ER temporary diagram flow unaffected, normal DiagramsView rendering unchanged
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Priority 1: End-to-end flow test -- save-artifact success with multiple journeys triggers fetch, activates review session, navigates to DiagramsView
    - Priority 2: End-to-end flow test -- save-artifact success with exactly one journey auto-loads into review mode (skips chooser)
    - Priority 3: End-to-end flow test -- save-artifact success with zero journeys shows empty-state message in chat, does not navigate
    - Priority 4: Close review session restores previous view and clears all state
    - Priority 5: Regression -- existing ER temporary diagram activation still works when UserJourneyReviewContext is also in the provider tree
    - Priority 6: Navigation round-trip -- select journey from chooser, navigate next/previous, return to chooser, close
    - Add only what is needed to fill genuine gaps; do NOT write all 10 if fewer suffice
    - Place in `frontend/src/components/DiagramsView/__tests__/userJourneyReviewFlow.test.tsx` or alongside relevant component test files
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3)
    - Expected total: approximately 34-50 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34-50 tests total)
- Critical user workflows for this feature are covered (save-to-review handoff, zero/one/many journey branching, navigation, close/cleanup)
- No more than 10 additional tests added beyond those written in groups 1-6
- Testing focused exclusively on this spec's feature requirements
- Existing ER temporary diagram flow regression covered

---

## Execution Order

Recommended implementation sequence:

```
1. Task Group 1: TypeScript Interfaces and API Client
   (Foundation -- types and network layer used by everything else)

2. Task Group 2: UserJourneyReviewContext
   (State management -- depends on types from Group 1)

3. Task Group 3: UserJourneyDiagramRenderer (SVG Swim-Lane)
   (Rendering -- depends on types from Group 1; independent of Group 2)

4. Task Group 4: Journey Chooser Component
   (UI -- depends on types from Group 1; lightweight component)

5. Task Group 5: Review Mode Banner and Navigation Controls
   (UI -- depends on context awareness from Group 2)

6. Task Group 6: DiagramsView Integration and Chat-to-Diagram Handoff
   (Orchestration -- wires Groups 1-5 together; heaviest integration work)

7. Task Group 7: Test Review and Gap Analysis
   (Testing -- validates the complete feature end-to-end)
```

**Note:** Task Groups 3 and 4 can be implemented in parallel since they are independent of each other (both depend only on Group 1's types). Task Group 5 can also begin in parallel with Groups 3-4 as it primarily depends on Group 2's context interface.

## Key Files Created

| File | Task Group | Purpose |
|------|-----------|---------|
| `frontend/src/types/userJourneyDiagram.ts` | 1 | TypeScript interfaces mirroring backend DTOs |
| `frontend/src/api/userJourneyDiagramApi.ts` | 1 | API client for `GET /temporary` endpoint |
| `frontend/src/contexts/UserJourneyReviewContext.tsx` | 2 | React context for ephemeral review session state |
| `frontend/src/components/DiagramsView/UserJourneyDiagramRenderer.tsx` | 3 | SVG swim-lane diagram renderer |
| `frontend/src/components/DiagramsView/JourneyChooser.tsx` | 4 | Journey selection list/card component |
| `frontend/src/components/DiagramsView/JourneyReviewBanner.tsx` | 5 | Toolbar banner with navigation controls |

## Key Files Modified

| File | Task Group | Change |
|------|-----------|--------|
| `frontend/src/App.tsx` | 2 | Add `UserJourneyReviewProvider` to provider hierarchy |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 6 | Conditional rendering for journey review mode, panel hiding |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (or related chat hook) | 6 | Post-save handoff logic for `ux-designer--users-interactions` task |
