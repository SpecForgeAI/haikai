# Specification: User Journey Overview Parent Diagram Generation

## Goal
Introduce a new generated parent diagram type (USER_JOURNEY_OVERVIEW) that deterministically projects a role-centric overview from existing Business Architecture entities -- USER_JOURNEY nodes grouped by Business Process lanes, connected by USER_JOURNEY_LINK edges -- with native SVG rendering, temporary review flow, and save-as-diagram capability.

## User Stories
- As an architect, I want to generate a zoomed-out overview diagram for a selected Business User role so that I can see all of that role's journeys grouped by Business Process with their inter-journey relationships at a glance.
- As an architect, I want to preview the generated overview before saving so that I can decide whether the current model state produces a useful diagram worth persisting.

## Specific Requirements

**Backend Projection Service**
- New `UserJourneyOverviewDiagramProjectionService` class, stateless and deterministic, annotated with `@ConditionalOnProperty` matching the existing pattern
- Input: projectId + businessUserId; resolves model file via `ModelFileRepository.findByProjectId`
- Fetches USER_JOURNEY records where `primaryBusinessUserId` equals the selected business user, using `UserJourneyRepository.findByModelFileId` then filtering in-memory
- Derives lanes: one per unique `parentBusinessProcessId`, alphabetical by Business Process name, with an "Unassigned" lane last for journeys with null parent
- Derives nodes: one per included USER_JOURNEY, sorted alphabetically by name within each lane; metadata includes step_count (from `ActivityStepRepository`), application_count (distinct application_id from activity steps), relationship_in_count and relationship_out_count (computed from filtered link set)
- Fetches USER_JOURNEY_LINK records via `UserJourneyLinkRepository.findByModelFileId`, then filters to only links where both source and target journey IDs are in the selected role's journey set
- Returns a `UserJourneyOverviewDiagramDto` matching the recommended contract v1 (diagram_type, version, overview header, lanes, nodes, edges, render_hints)
- Returns an empty but valid diagram structure (header populated, empty lanes/nodes/edges arrays) for zero-journey scenarios rather than an error

**Backend REST Endpoint**
- New `UserJourneyOverviewDiagramController` with `@RequestMapping("/api/projects/{projectId}/user-journey-overview-diagrams")`
- GET `/temporary?businessUserId={businessUserId}` returns the generated `UserJourneyOverviewDiagramDto`
- Annotated with `@ConditionalOnProperty` matching `UserJourneyDiagramController` pattern
- Project-scoped, stateless, read-only

**Frontend Diagram Type Registration**
- Add `USER_JOURNEY_OVERVIEW` to the `DiagramType` union, `ALL_DIAGRAM_TYPES`, `DIAGRAM_TYPE_LABELS` (label: "User Journey Overview"), `DIAGRAM_TYPE_MAP` (keys: `user_journey_overview` and `user journey overview`), and `normalizeDiagramType` support
- Do NOT add to `CREATABLE_DIAGRAM_TYPES` -- this type is generated only, never manually created
- Add `USER_JOURNEY_OVERVIEW` to `DiagramTypedContentType` union and `TYPED_DIAGRAM_TYPES` array
- Add `UserJourneyOverviewContent` to the `TypedContentEnvelope.content` union and a `createDefaultUserJourneyOverviewContent` factory function

**Frontend TypeScript DTO Interfaces**
- New file (e.g., `frontend/src/types/userJourneyOverviewDiagram.ts`) with interfaces mirroring the backend contract v1
- `UserJourneyOverviewDiagramDto` (top-level): diagram_type, version, overview (header), lanes, nodes, edges, render_hints
- `UserJourneyOverviewHeaderDto`: business_user_id, business_user_name, title
- `UserJourneyOverviewLaneDto`: id, name, order
- `UserJourneyOverviewNodeDto`: id, lane_id, name, description, primary_business_user_id, primary_business_user_name, parent_business_process_id, parent_business_process_name, metadata sub-object (step_count, application_count, relationship_in_count, relationship_out_count)
- `UserJourneyOverviewEdgeDto`: id, source_node_id, target_node_id, relationship_type, label, description
- `UserJourneyOverviewRenderHintsDto`: lane_axis, flow_direction, show_title, show_lane_headers, show_node_description, show_relationship_labels

**Frontend API Client**
- New `fetchTemporaryUserJourneyOverviewDiagram(projectId: string, businessUserId: string)` function following the `userJourneyDiagramApi.ts` pattern (plain fetch with `API_BASE`, Vite proxy)
- Calls GET `/api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}`
- Returns `Promise<UserJourneyOverviewDiagramDto>`

**Frontend Entry Point and Business User Selector**
- User action in the existing diagram workspace (button or menu option labeled "Generate Journey Overview" or similar)
- Business User selector dropdown populated from `state.model.metaModel.business_users` for the current project
- On selection and confirm: calls `fetchTemporaryUserJourneyOverviewDiagram`, then activates the overview review session
- Loading and error states handled inline (spinner during fetch, toast on error)

**Frontend Overview Review Flow**
- New `UserJourneyOverviewReviewContext` (simpler than `UserJourneyReviewContext` -- single diagram, no multi-item navigation or chooser)
- State: active flag, projectId, the fetched `UserJourneyOverviewDiagramDto`, saved flag, previousView for restoration
- Actions: activateOverviewReview, markOverviewSaved, closeOverviewReview
- New `OverviewReviewBanner` component rendering in the toolbar area: Preview badge, "[Business User Name] Journey Overview" title, compact summary text (e.g., "12 journeys across 4 business processes"), Save as Diagram button, Discard/Close button
- Read-only rendering in review mode; no editing

**Frontend Native SVG Renderer**
- New `UserJourneyOverviewDiagramRenderer` component modeled after `UserJourneyDiagramRenderer`
- Horizontal swimlane bands stacked vertically (one per Business Process lane), with lane headers on the left side using rotated text
- Journey nodes flowing left-to-right within each lane, sorted by alphabetical name order
- Node visual: rounded rectangle with journey name as primary label, description as secondary text (truncated), compact metadata badges for step_count and application_count
- Use the same visual constants/language as the existing renderer (fill colors, stroke colors, font sizes, corner radii, lane alternating colors, lane header background)
- Directed edges rendered using the existing waypoint/polyline approach with generated waypoints and arrowhead markers; edge labels displayed along the path
- Deterministic layout computation (computeLayout function) with no manual positioning
- `computeContentBounds` and `onContentBounds` callback for parent auto-sizing
- Empty diagram message for zero-lane/zero-node scenarios
- Title rendered at top: "[Business User Name] Journey Overview"

**Canvas.tsx Integration**
- New `isUserJourneyOverviewDiagram` flag checking `getDiagramType(diagram) === 'USER_JOURNEY_OVERVIEW'`
- New conditional rendering branch in the existing chain (after USER_JOURNEY, before General fallback) dispatching to `UserJourneyOverviewDiagramRenderer`
- New `extractUserJourneyOverviewDiagram` helper function extracting `UserJourneyOverviewDiagramDto` from `diagram.typedContent.content`, following the same pattern as `extractUserJourneyDiagram`

**Save Flow**
- Save action creates a standard Diagram entry: `id` via `generatePrefixedId('diag')`, `diagram_type: 'USER_JOURNEY_OVERVIEW'`, `typedContent` envelope with `type: 'USER_JOURNEY_OVERVIEW'`, `version: 1`, `content` containing the full overview DTO snapshot
- Dispatches `ADD_DIAGRAM` to state, matching `handleSaveJourneyDiagram` pattern
- After save, marks review as saved and closes or shows toast
- Saved overview diagrams render from their stored snapshot; no re-projection from model data on reopen

## Visual Design
No visual assets provided. The renderer should follow the existing visual language established by `UserJourneyDiagramRenderer` (SVG swimlane layout, alternating lane backgrounds, lane header styling, node fill/stroke/font conventions, arrowhead markers).

## Existing Code to Leverage

**UserJourneyDiagramRenderer.tsx (child journey SVG renderer)**
- Direct template for the overview renderer: same SVG swimlane pattern, `computeLayout` approach, lane/node/edge sub-renderer structure, `computeContentBounds` with `onContentBounds` callback
- Adapt for Business Process lanes (instead of Application lanes) and journey nodes (instead of step nodes); reuse visual constants (LANE_COLORS, LANE_HEADER_BG, STEP_FILL, STEP_STROKE, EDGE_COLOR, font sizes)

**UserJourneyReviewContext.tsx and JourneyReviewBanner.tsx (child journey review flow)**
- Pattern for the overview review context, but simplified: single diagram instead of multi-journey list with chooser/navigator
- Banner styling (Preview badge, Save as Diagram button, Close Review button) can be reused directly; omit Previous/Next/Back to List navigation controls

**handleSaveJourneyDiagram in DiagramsView.tsx (save pattern)**
- Exact save-to-state pattern: build `TypedContentEnvelope`, construct `Diagram` object with `generatePrefixedId`, dispatch `ADD_DIAGRAM`, show success toast
- Overview save follows the same flow with `USER_JOURNEY_OVERVIEW` type and overview content

**UserJourneyDiagramProjectionService.java (backend projection)**
- Architectural pattern for the new overview projection service: stateless, `@ConditionalOnProperty`, repository-based entity fetching, deterministic DTO construction, batch entity loading for efficiency
- Overview projection queries different entity sets (UserJourney filtered by role, UserJourneyLink filtered by both-ends membership) and produces a different DTO shape

**Canvas.tsx dispatch chain and extractUserJourneyDiagram helper**
- Exact integration pattern: add a new diagram type flag, a new conditional branch in the rendering chain, and a new extract helper function following the same `typedContent.content` extraction and type-guard validation pattern

## Out of Scope
- Parent-to-child diagram linking/navigation (linkedDiagramId wiring to child USER_JOURNEY diagrams)
- Any diagram-link auto-assignment to child USER_JOURNEY diagrams
- New meta-model entities or relationships beyond those already existing
- Workbook/XLSX import/export changes
- Bidirectional diagram/model sync or one-way sync/refresh for saved overview diagrams
- Manual creation of blank USER_JOURNEY_OVERVIEW diagrams via the New Diagram modal
- Editing of overview node/edge semantics in the canvas after generation
- Export/print functionality for overview diagrams
- Performance optimization work beyond normal reasonable data sizes
- Manual layout editing or advanced graph-routing optimization for the overview diagram
- Triggering overview generation from Dashboard or chat/AI-assisted flow
