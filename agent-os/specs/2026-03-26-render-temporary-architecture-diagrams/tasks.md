# Task Breakdown: Render Temporary Architecture Diagrams in Frontend (Increment 4)

## Overview
Total Tasks: 38

This increment implements the frontend rendering pipeline for temporary architecture diagrams:
fetching from the backend, rendering as read-only ER diagrams in the Diagrams view (with a
temporary/preview banner), and providing a "View Diagram" entry point from the chat panel.

## Task List

### API Client Layer

#### Task Group 1: Frontend API Client for Temporary Diagrams
**Dependencies:** None

- [x] 1.0 Complete API client for fetching temporary diagrams
  - [x] 1.1 Write 4 focused tests for the API client
    - Test 1: `fetchTemporaryDiagram` constructs the correct URL `/api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` and returns the validated `TemporaryArchitectureDiagram` from `diagram_payload`
    - Test 2: `fetchTemporaryDiagram` throws a descriptive error when the HTTP response is not ok (e.g., 404, 500)
    - Test 3: `fetchTemporaryDiagram` throws a validation error when `diagram_payload` fails the `isTemporaryArchitectureDiagram()` type guard
    - Test 4: `fetchTemporaryDiagram` throws a validation error when `diagram_payload` passes the type guard but fails `isValidERDiagram()` (e.g., `diagram_kind` is not `'ER'`)
  - [x] 1.2 Create `frontend/src/api/temporaryDiagramApi.ts`
    - Follow the `modelApi.ts` pattern: `const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''` and plain `fetch()`
    - Define `TemporaryDiagramResponseDto` interface matching the backend DTO fields: `id`, `temporary_diagram_id`, `project_id`, `diagram_payload`, `created_at`, `updated_at`
    - Implement `fetchTemporaryDiagram(projectId: string, temporaryDiagramId: string): Promise<TemporaryArchitectureDiagram>`
    - Call `GET /api/projects/{projectId}/temporary-diagrams/{temporaryDiagramId}` (routed through existing Vite `/api/` proxy to architecture-model-service on port 8080 -- no new gateway route needed)
    - Parse response JSON, extract `diagram_payload`
    - Validate using `isTemporaryArchitectureDiagram()` and `isValidERDiagram()` from `temporaryArchitectureDiagramValidation.ts`
    - Throw descriptive errors for HTTP failures and validation failures
  - [x] 1.3 Ensure API client tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify URL construction, response parsing, and validation error paths

**Acceptance Criteria:**
- The 4 tests pass
- `fetchTemporaryDiagram` correctly fetches, parses, validates, and returns the `TemporaryArchitectureDiagram` from `diagram_payload`
- Descriptive errors are thrown for network failures and validation failures
- No new gateway routes or Vite proxy changes required

---

### Renderer Component

#### Task Group 2: TemporaryDiagramRenderer -- ER Node Rendering
**Dependencies:** None (uses only the `TemporaryArchitectureDiagram` contract types which already exist)

- [x] 2.0 Complete ER node rendering in TemporaryDiagramRenderer
  - [x] 2.1 Write 5 focused tests for ER node rendering
    - Test 1: Renders the correct number of ERD node `<rect>` elements for a diagram with 3 nodes
    - Test 2: Renders node header text (`display_name`) bold and centered within `ERD_HEADER_HEIGHT` (30px) band
    - Test 3: Renders attribute rows from the `compartments` array (find `compartment_kind === 'ATTRIBUTES'`), formatted as `"PK attr_name : VARCHAR(255)"` when metadata is present
    - Test 4: Renders a node with empty/missing `compartments` as header-only (no crash, no attribute rows)
    - Test 5: Sorts nodes by `z_index` ascending (nulls treated as 0) before rendering
  - [x] 2.2 Create `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx`
    - Define props interface: `{ diagram: TemporaryArchitectureDiagram; zoom: number }`
    - Follow the dedicated renderer pattern from `SequenceDiagramRenderer.tsx` / `ActivityDiagramRenderer.tsx` -- produce SVG elements directly, no synthetic native `DiagramNode[]`/`DiagramEdge[]` fabrication
    - Check `diagram.diagram_kind === 'ER'`; render a warning message for unsupported diagram kinds
    - Component does NOT perform meta-model lookups; all data is self-contained
  - [x] 2.3 Implement ER node rendering
    - Sort nodes by `z_index` ascending (treat `undefined`/`null` as 0)
    - For each node, render an ERD-style class-box following the SVG structure from `Canvas.tsx` lines 2399-2462:
      - Outer `<rect>` at `node.pos_x`, `node.pos_y`, `node.width`, `node.height` with `appConfig.node.borderWidth` (2px) stroke, `rx={0}` (square corners for ERD)
      - Header section: `node.display_name` bold, centered within top `ERD_HEADER_HEIGHT` (30px) band
      - Divider `<line>` at `y = node.pos_y + ERD_HEADER_HEIGHT`
      - Attribute rows: find compartment with `compartment_kind === 'ATTRIBUTES'`, iterate items at `ERD_ATTRIBUTE_ROW_HEIGHT` (20px) intervals, left-aligned with 8px x-padding
    - Use constants from `erdUtils.ts`: `ERD_HEADER_HEIGHT`, `ERD_ATTRIBUTE_ROW_HEIGHT`
    - Use `getEntityColor(node.semantic_type)` from `rendering.ts` for node fill/stroke colors (returns `{ background: '#FFF3E0', border: '#F57C00' }` for `LOGICAL_DATA_ENTITY` and `PHYSICAL_DATA_ENTITY`)
  - [x] 2.4 Implement attribute formatting
    - Format each compartment item: `display_name : data_type` when `metadata.data_type` is present
    - Prefix with `"PK "` for `metadata.is_primary_key`, `"FK "` for `metadata.is_foreign_key` (both prefixes if both are true)
    - Handle missing `compartments`, empty `items`, and missing `metadata` gracefully (no crash)
  - [x] 2.5 Ensure ER node rendering tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify SVG output structure and visual fidelity

**Acceptance Criteria:**
- The 5 tests pass
- Nodes render as ERD class-boxes with header, divider, and attribute rows
- Attribute formatting matches `"PK attr_name : VARCHAR(255)"` pattern
- Missing/empty compartments handled gracefully (header-only rendering)
- Z-index ordering respected
- Colors match existing ER node rendering (`getEntityColor()`)

---

#### Task Group 3: TemporaryDiagramRenderer -- ER Edge Rendering
**Dependencies:** Task Group 2

- [x] 3.0 Complete ER edge rendering in TemporaryDiagramRenderer
  - [x] 3.1 Write 4 focused tests for ER edge rendering
    - Test 1: Renders a polyline from `edge_points` sorted by `sequence_order` ascending
    - Test 2: Renders correct UML symbols for a COMPOSITION edge (filled diamond at source, no symbol at target, solid line) by verifying `getEREdgeSymbols` integration
    - Test 3: Renders `source_label` and `target_label` as `<text>` elements at their `pos_x`/`pos_y` coordinates when present
    - Test 4: Skips rendering an edge with empty or missing `edge_points` (no crash)
  - [x] 3.2 Implement edge polyline rendering
    - Sort `edge_points` by `sequence_order` ascending
    - Render as SVG `<polyline>` with points string derived from sorted coordinates
    - Skip edges with empty or missing `edge_points` gracefully
  - [x] 3.3 Integrate ER edge symbol utilities
    - Call `getEREdgeSymbols(edge.relationship_type as LogicalERRelationship)` from `erEdgeSymbols.ts` at the renderer boundary
    - Handle `undefined` `relationship_type` gracefully (defaults to ASSOCIATION -- no symbols, solid line)
    - Use `getSymbolRenderData()` and `calculateEdgeAngle()` to render UML endpoint symbols (hollow triangles, filled/hollow diamonds, open arrows)
    - Derive stroke-dasharray from `getEREdgeStrokeDasharray(lineStyle)` for dashed/solid lines
  - [x] 3.4 Implement edge label rendering
    - Render `source_label.text` at `source_label.pos_x`/`source_label.pos_y` when `edge.source_label` is present
    - Render `target_label.text` at `target_label.pos_x`/`target_label.pos_y` when `edge.target_label` is present
    - Use the nested object structure from the temporary contract (NOT the native flat field pattern)
  - [x] 3.5 Ensure ER edge rendering tests pass
    - Run ONLY the 4 tests written in 3.1

**Acceptance Criteria:**
- The 4 tests pass
- Edge polylines render correctly from sorted `edge_points`
- UML relationship symbols render correctly via existing `erEdgeSymbols.ts` utilities
- Edge labels render at specified positions
- Missing `edge_points` handled gracefully (edge skipped)
- `undefined` `relationship_type` defaults to ASSOCIATION (no symbols, solid line)

---

### DiagramsView Integration

#### Task Group 4: Temporary Diagram State Management and DiagramsView Integration
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete DiagramsView integration for temporary diagram mode
  - [x] 4.1 Write 5 focused tests for DiagramsView temporary diagram integration
    - Test 1: When `temporaryDiagramState.active` is true and `data` is loaded, `TemporaryDiagramRenderer` is rendered instead of the normal Canvas
    - Test 2: When in temporary diagram mode, PalettePanel, InspectorPanel, DiagramSelector, editing toolbar, and context menus are hidden/suppressed
    - Test 3: The temporary diagram banner displays the diagram name from `TemporaryArchitectureDiagram.name` and includes a close/back action
    - Test 4: Clicking the close/back action clears `temporaryDiagramState` and returns to normal diagram view
    - Test 5: When the API fetch fails, an error state is displayed with the error message and a close action
  - [x] 4.2 Add temporary diagram state to DiagramsView
    - Add `useState` for `temporaryDiagramState: { active: boolean; projectId: string; temporaryDiagramId: string; data: TemporaryArchitectureDiagram | null; loading: boolean; error: string | null }`
    - Default state: `{ active: false, projectId: '', temporaryDiagramId: '', data: null, loading: false, error: null }`
  - [x] 4.3 Implement API fetch trigger on temporary diagram activation
    - Add a `useEffect` that fires when `temporaryDiagramState.active` becomes true and `temporaryDiagramState.data` is null
    - Set `loading: true`, call `fetchTemporaryDiagram(projectId, temporaryDiagramId)` from the API client (Task Group 1)
    - On success: set `data` with the validated `TemporaryArchitectureDiagram`, `loading: false`
    - On error: set `error` with the error message, `loading: false`
  - [x] 4.4 Implement conditional rendering for temporary diagram mode
    - When `temporaryDiagramState.active` is true:
      - Hide: DiagramSelector, PalettePanel, InspectorPanel, editing toolbar (Row 2), DecorationsPanel, period selector, element context menus, resize handles, all mutation affordances
      - Keep: zoom controls (reuse existing zoom +/- and "Fit to View" buttons)
      - Show: TemporaryDiagramRenderer (when `data` is loaded), loading spinner (when `loading`), error state (when `error`)
    - Render `TemporaryDiagramRenderer` within an SVG container with pan and zoom enabled
      - Reuse the existing SVG viewBox transform approach or wrap in a container with the same pan/zoom machinery the Canvas uses
  - [x] 4.5 Implement temporary diagram banner/indicator
    - Create a banner component (inline in DiagramsView or as a separate small component)
    - Display "Temporary Diagram" or "Preview" label prominently
    - Show the diagram name from `temporaryDiagramState.data.name`
    - Include a "Back to Diagrams" or close button that clears `temporaryDiagramState` (sets `active: false`, clears data/error)
    - Position non-intrusively above the SVG canvas (e.g., inside `headerBar` replacing the normal toolbar content)
  - [x] 4.6 Implement error and loading states
    - Loading state: show a loading indicator while `temporaryDiagramState.loading` is true
    - Error state: show the error message from `temporaryDiagramState.error` with a "Close" or "Back to Diagrams" action
    - Unsupported diagram kind: if the fetched diagram has `diagram_kind !== 'ER'`, display a message indicating only ER diagrams are supported
  - [x] 4.7 Expose a mechanism for external components to activate temporary diagram mode
    - Expose a callback or setter (e.g., via a shared context, a ref, or a window-level event) that external components (like the chat panel) can use to set `temporaryDiagramState.active = true` with `projectId` and `temporaryDiagramId`
    - This mechanism must work in conjunction with dispatching `SET_VIEW` with `'diagrams'` to navigate to the Diagrams view
    - Consider using the existing `ArchitectureContext` dispatch pattern or a lightweight React context specifically for temporary diagram activation
  - [x] 4.8 Ensure DiagramsView integration tests pass
    - Run ONLY the 5 tests written in 4.1

**Acceptance Criteria:**
- The 5 tests pass
- Temporary diagram mode renders `TemporaryDiagramRenderer` in place of normal Canvas
- All editing affordances (palette, inspector, toolbar, context menus, drag/resize) are hidden
- Pan and zoom remain functional
- Banner displays diagram name and includes close action
- Loading and error states render correctly
- External activation mechanism works for the chat panel entry point

---

### Chat Panel Entry Point

#### Task Group 5: Chat Panel "View Diagram" Link
**Dependencies:** Task Group 4

- [x] 5.0 Complete chat panel entry point for viewing temporary diagrams
  - [x] 5.1 Write 4 focused tests for the chat panel "View Diagram" link
    - Test 1: When an assistant message contains a `` ```json:temporaryArchitectureDiagram `` code block, a "View Diagram" link/button is rendered within the message bubble
    - Test 2: When an assistant message does NOT contain the code block, no "View Diagram" link is rendered
    - Test 3: Clicking the "View Diagram" link extracts `diagram.id` from the parsed JSON payload
    - Test 4: Clicking the "View Diagram" link dispatches `SET_VIEW` with `'diagrams'` and activates temporary diagram mode with the correct `projectId` and `temporaryDiagramId`
  - [x] 5.2 Implement code block detection in MessageBubble
    - In `frontend/src/components/UnifiedChat/MessageBubble.tsx`, add a helper function to detect the `` ```json:temporaryArchitectureDiagram `` code block in `message.content`
    - Use the same regex pattern as the backend: `/```json:temporaryArchitectureDiagram\s*\n([\s\S]*?)\n```/`
    - Parse the JSON content and extract `diagram.id` (the `id` field on the `TemporaryArchitectureDiagram`)
    - Handle parse failures gracefully (do not show the link if JSON is malformed)
  - [x] 5.3 Render "View Diagram" link/button
    - When the code block is detected and successfully parsed, render a clickable "View Diagram" link or button below or within the message content
    - Style consistently with existing message bubble actions (follow the pattern of existing action buttons in MessageBubble)
  - [x] 5.4 Implement click handler for navigation
    - On click, dispatch `SET_VIEW` with `'diagrams'` via `useArchitectureDispatch()` to navigate to the Diagrams view
    - Activate temporary diagram mode by calling the mechanism exposed in Task 4.7, passing:
      - `projectId` from the active project context (obtain via `useArchitecture()` or the project context that provides the current project ID)
      - `temporaryDiagramId` set to the `diagram.id` extracted from the parsed payload
    - The DiagramsView will detect the activation, trigger the API fetch (Task 4.3), and render the diagram
  - [x] 5.5 Add `onViewTemporaryDiagram` callback prop to MessageBubble
    - Add a new optional prop `onViewTemporaryDiagram?: (temporaryDiagramId: string) => void` to `MessageBubbleProps`
    - The click handler in 5.4 calls this prop with the extracted diagram ID
    - The parent component (`UnifiedChatPanel` or `ChatThread`) handles the actual navigation dispatch and temporary diagram activation
    - This follows the existing pattern where MessageBubble delegates actions to parent via callback props (e.g., `onConfirmArtifact`, `onActionClick`)
  - [x] 5.6 Wire up the callback in the parent chat component
    - In `UnifiedChatPanel.tsx` (or wherever `MessageBubble` is rendered), implement the `onViewTemporaryDiagram` handler
    - The handler dispatches `SET_VIEW` with `'diagrams'` via `architectureDispatch`
    - The handler activates temporary diagram mode via the mechanism from Task 4.7
  - [x] 5.7 Ensure chat panel tests pass
    - Run ONLY the 4 tests written in 5.1

**Acceptance Criteria:**
- The 4 tests pass
- Assistant messages with `` ```json:temporaryArchitectureDiagram `` code blocks show a "View Diagram" link
- Clicking the link navigates to Diagrams view and activates temporary diagram mode
- Messages without the code block show no link
- Malformed JSON in the code block is handled gracefully (no link shown)

---

### Testing

#### Task Group 6: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests from Task Group 1 (API client)
    - Review the 5 tests from Task Group 2 (ER node rendering)
    - Review the 4 tests from Task Group 3 (ER edge rendering)
    - Review the 5 tests from Task Group 4 (DiagramsView integration)
    - Review the 4 tests from Task Group 5 (chat panel entry point)
    - Total existing tests: 22 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize integration points: API client -> DiagramsView fetch -> renderer display
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - Integration: Full flow from `temporaryDiagramState` activation through API fetch to rendered SVG output
      - Edge rendering with different `relationship_type` values (GENERALIZATION, AGGREGATION, DEPENDENCY)
      - Unsupported `diagram_kind` (non-ER) displays a warning message
      - Attribute formatting edge cases: both PK and FK flags set, missing `data_type`, missing `metadata` entirely
      - Pan/zoom behavior in temporary diagram mode
      - Multiple activations: activating a second temporary diagram while one is already displayed
      - Banner close action: verify state is fully cleared and normal diagram view is restored
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests, accessibility tests, and edge cases unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 22-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-32 tests total)
- Critical user workflows for this feature are covered: fetch -> validate -> render -> navigate from chat
- No more than 10 additional tests added when filling in gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: API Client** -- No dependencies; establishes the data fetching layer
2. **Task Group 2: ER Node Rendering** -- No dependencies (uses only existing types); can be built in parallel with Task Group 1
3. **Task Group 3: ER Edge Rendering** -- Depends on Task Group 2 (builds on the TemporaryDiagramRenderer component)
4. **Task Group 4: DiagramsView Integration** -- Depends on Task Groups 1, 2, 3; wires everything together in the main view
5. **Task Group 5: Chat Panel Entry Point** -- Depends on Task Group 4; adds the navigation trigger from the chat panel
6. **Task Group 6: Test Review and Gap Analysis** -- Depends on all prior groups; verifies end-to-end coverage

**Parallel opportunities:** Task Groups 1 and 2 can be developed simultaneously since they have no dependencies on each other.

---

## Key File References

| File | Role |
|---|---|
| `frontend/src/api/temporaryDiagramApi.ts` | NEW -- API client for fetching temporary diagrams |
| `frontend/src/components/DiagramsView/TemporaryDiagramRenderer.tsx` | NEW -- Dedicated SVG renderer for ER temporary diagrams |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | MODIFIED -- Add temporary diagram state, conditional rendering, banner |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | MODIFIED -- Add code block detection and "View Diagram" link |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | MODIFIED -- Wire `onViewTemporaryDiagram` callback to dispatch navigation |
| `frontend/src/types/temporaryArchitectureDiagram.ts` | EXISTING -- Contract types (Increment 1, unchanged) |
| `frontend/src/types/temporaryArchitectureDiagramValidation.ts` | EXISTING -- Validation helpers (unchanged) |
| `frontend/src/utils/erEdgeSymbols.ts` | EXISTING -- ER edge symbol utilities (reused, unchanged) |
| `frontend/src/utils/erdUtils.ts` | EXISTING -- ERD constants and formatAttribute (reused, unchanged) |
| `frontend/src/utils/rendering.ts` | EXISTING -- `getEntityColor()` (reused, unchanged) |
| `frontend/src/config/defaults.ts` | EXISTING -- `appConfig.node.borderWidth`, entity colors (reused, unchanged) |
| `frontend/src/contexts/ArchitectureContext.tsx` | EXISTING -- `SET_VIEW` dispatch, `AppState` (may need minor extension for temp diagram activation) |
| `frontend/src/api/modelApi.ts` | EXISTING -- API client pattern reference (unchanged) |
| `architecture-model-service/.../TemporaryDiagramController.java` | EXISTING -- Backend GET endpoint (unchanged) |
| `gateway/src/routes/chatV2.ts` | EXISTING -- Server-side extraction of `json:temporaryArchitectureDiagram` code block (unchanged) |
