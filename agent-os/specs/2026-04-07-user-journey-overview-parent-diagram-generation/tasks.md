# Task Breakdown: User Journey Overview Parent Diagram Generation

## Overview
Total Tasks: 42

This spec introduces a new generated parent diagram type (USER_JOURNEY_OVERVIEW) that deterministically projects a role-centric overview from existing Business Architecture entities. It spans a backend projection service and REST endpoint (Java/Spring Boot), frontend type registration and DTO interfaces, a new API client, a Business User selector entry point, an overview review context and banner, a native SVG swimlane renderer, Canvas.tsx integration, and a save-as-diagram flow. No gateway changes or new meta-model entities are required.

## Task List

### Backend Projection & API

#### Task Group 1: Overview DTO Records
**Dependencies:** None

- [x] 1.0 Complete backend DTO records for the overview diagram contract
  - [x] 1.1 Write 4 focused tests for the overview DTO records
    - Test 1: `UserJourneyOverviewDiagramDto` record round-trip -- instantiate with all fields, verify getters return correct values
    - Test 2: `UserJourneyOverviewDiagramDto` JSON serialization produces correct snake_case keys (`diagram_type`, `version`, `overview`, `lanes`, `nodes`, `edges`, `render_hints`)
    - Test 3: `UserJourneyOverviewNodeDto` metadata sub-object serializes correctly (`step_count`, `application_count`, `relationship_in_count`, `relationship_out_count`)
    - Test 4: `UserJourneyOverviewRenderHintsDto` serializes with correct field names (`lane_axis`, `flow_direction`, `show_title`, `show_lane_headers`, `show_node_description`, `show_relationship_labels`)
  - [x] 1.2 Create `UserJourneyOverviewDiagramDto.java` in `model.dto.diagram` package
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewDiagramDto.java`
    - Java record with `@JsonProperty` annotations
    - Fields: `diagram_type` (String), `version` (String), `overview` (UserJourneyOverviewHeaderDto), `lanes` (List), `nodes` (List), `edges` (List), `render_hints` (UserJourneyOverviewRenderHintsDto)
  - [x] 1.3 Create `UserJourneyOverviewHeaderDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewHeaderDto.java`
    - Java record: `business_user_id`, `business_user_name`, `title`
  - [x] 1.4 Create `UserJourneyOverviewLaneDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewLaneDto.java`
    - Java record: `id`, `name`, `order`
  - [x] 1.5 Create `UserJourneyOverviewNodeDto.java` with metadata sub-record
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewNodeDto.java`
    - Java record: `id`, `lane_id`, `name`, `description`, `primary_business_user_id`, `primary_business_user_name`, `parent_business_process_id`, `parent_business_process_name`, `metadata` (sub-record with `step_count`, `application_count`, `relationship_in_count`, `relationship_out_count`)
  - [x] 1.6 Create `UserJourneyOverviewEdgeDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewEdgeDto.java`
    - Java record: `id`, `source_node_id`, `target_node_id`, `relationship_type`, `label`, `description`
  - [x] 1.7 Create `UserJourneyOverviewRenderHintsDto.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewRenderHintsDto.java`
    - Java record: `lane_axis`, `flow_direction`, `show_title`, `show_lane_headers`, `show_node_description`, `show_relationship_labels`
  - [x] 1.8 Ensure DTO record tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify JSON serialization produces correct snake_case keys
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- All DTO records compile and instantiate correctly
- JSON serialization produces snake_case field names matching the contract v1
- Metadata sub-record on the node DTO serializes as a nested object

---

#### Task Group 2: Projection Service
**Dependencies:** Task Group 1

- [x] 2.0 Complete backend projection service for overview diagram generation
  - [x] 2.1 Write 6 focused tests for the projection service
    - Test 1: Given a business user with 3 journeys across 2 business processes, verify the projected DTO has 2 lanes (alphabetical by BP name), 3 nodes (alphabetical within lanes), and correct lane assignments
    - Test 2: Given a business user with journeys where some have null `parentBusinessProcessId`, verify an "Unassigned" lane is created and placed last
    - Test 3: Given a business user with 2 journeys connected by a USER_JOURNEY_LINK, verify 1 edge is returned with correct source/target node IDs, relationship_type, and label
    - Test 4: Given a business user with 0 matching journeys, verify an empty but valid diagram structure is returned (header populated, empty lanes/nodes/edges arrays)
    - Test 5: Verify node metadata is computed correctly -- step_count from ActivityStepRepository, application_count as distinct application IDs from activity steps, relationship_in_count and relationship_out_count from filtered link set
    - Test 6: Given USER_JOURNEY_LINKs where one end is a journey NOT belonging to the selected business user, verify that link is excluded from edges
  - [x] 2.2 Create `UserJourneyOverviewDiagramProjectionService.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyOverviewDiagramProjectionService.java`
    - Annotations: `@Service`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`, `@RequiredArgsConstructor`, `@Slf4j`
    - Inject: `UserJourneyRepository`, `UserJourneyLinkRepository`, `BusinessUserRepository`, `BusinessProcessRepository`, `ActivityStepRepository`, `ApplicationRepository`, `ModelFileRepository`
    - Follow pattern from: `UserJourneyDiagramProjectionService.java`
  - [x] 2.3 Implement `projectOverview(UUID projectId, String businessUserId)` method
    - Resolve model file via `ModelFileRepository.findByProjectId`
    - Fetch all USER_JOURNEY records via `UserJourneyRepository.findByModelFileId`, filter in-memory where `primaryBusinessUserId` equals the selected business user
    - Resolve business user name via `BusinessUserRepository.findById`
    - Build overview header DTO with business_user_id, business_user_name, and title ("[Business User Name] Journey Overview")
    - Return empty valid structure if zero matching journeys
  - [x] 2.4 Implement lane derivation logic
    - One lane per unique `parentBusinessProcessId`
    - Resolve lane names via batch `BusinessProcessRepository.findAllById`
    - Sort alphabetically by Business Process name
    - "Unassigned" lane (id = "unassigned") placed last for journeys with null parentBusinessProcessId
  - [x] 2.5 Implement node derivation with metadata
    - One node per included USER_JOURNEY, sorted alphabetically by name within each lane
    - Metadata: `step_count` from `ActivityStepRepository.findByUserJourneyId` (batch load), `application_count` as count of distinct applicationId from those steps
    - Metadata: `relationship_in_count` and `relationship_out_count` computed from the filtered link set per node
  - [x] 2.6 Implement edge derivation from USER_JOURNEY_LINK
    - Fetch all links via `UserJourneyLinkRepository.findByModelFileId`
    - Filter to only links where BOTH sourceUserJourneyId and targetUserJourneyId are in the selected role's journey ID set
    - Map each filtered link to `UserJourneyOverviewEdgeDto` with source_node_id, target_node_id, relationship_type, label, description
  - [x] 2.7 Assemble final `UserJourneyOverviewDiagramDto` with static render hints
    - Render hints: lane_axis = "VERTICAL", flow_direction = "LEFT_TO_RIGHT", show_title = true, show_lane_headers = true, show_node_description = true, show_relationship_labels = true
    - diagram_type = "USER_JOURNEY_OVERVIEW", version = "1.0"
  - [x] 2.8 Ensure projection service tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify deterministic output for identical inputs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Projection produces correct lanes, nodes, edges, and metadata from test data
- Empty but valid structure returned for zero-journey scenarios
- Links are correctly filtered to only include edges within the selected role's journey set
- Lane ordering is alphabetical by BP name with "Unassigned" last

---

#### Task Group 3: REST Controller
**Dependencies:** Task Group 2

- [x] 3.0 Complete backend REST controller for overview diagram endpoint
  - [x] 3.1 Write 3 focused tests for the controller
    - Test 1: GET `/api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={id}` returns 200 with the projected DTO
    - Test 2: GET with a business user that has no journeys returns 200 with empty valid structure (not 404)
    - Test 3: GET with missing `businessUserId` query parameter returns 400 Bad Request
  - [x] 3.2 Create `UserJourneyOverviewDiagramController.java`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/UserJourneyOverviewDiagramController.java`
    - Annotations: `@RestController`, `@ConditionalOnProperty(name = "app.features.include-database", havingValue = "true", matchIfMissing = true)`, `@RequestMapping("/api/projects/{projectId}/user-journey-overview-diagrams")`, `@RequiredArgsConstructor`, `@Slf4j`
    - Inject: `UserJourneyOverviewDiagramProjectionService`
    - Follow pattern from: `UserJourneyDiagramController.java`
  - [x] 3.3 Implement `getTemporaryOverviewDiagram` endpoint
    - `@GetMapping("/temporary")` with `@PathVariable UUID projectId` and `@RequestParam String businessUserId`
    - Delegates to `projectionService.projectOverview(projectId, businessUserId)`
    - Returns `ResponseEntity.ok(dto)`
  - [x] 3.4 Ensure controller tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify HTTP status codes and response bodies
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- Endpoint responds with correct JSON contract
- Missing businessUserId parameter returns appropriate error
- Controller follows existing `ConditionalOnProperty` pattern

---

### Frontend Types & API Client

#### Task Group 4: TypeScript Interfaces, Diagram Type Registration, and API Client
**Dependencies:** Task Group 1 (DTO contract must be finalized)

- [x] 4.0 Complete frontend type system and API client for overview diagrams
  - [x] 4.1 Write 5 focused tests for types, registration, and API client
    - Test 1: `USER_JOURNEY_OVERVIEW` is in `ALL_DIAGRAM_TYPES` but NOT in `CREATABLE_DIAGRAM_TYPES`
    - Test 2: `normalizeDiagramType('user_journey_overview')` and `normalizeDiagramType('user journey overview')` both return `'USER_JOURNEY_OVERVIEW'`
    - Test 3: `DIAGRAM_TYPE_LABELS['USER_JOURNEY_OVERVIEW']` equals `'User Journey Overview'`
    - Test 4: `USER_JOURNEY_OVERVIEW` is in `TYPED_DIAGRAM_TYPES` and `isDiagramTypedContentType('USER_JOURNEY_OVERVIEW')` returns true
    - Test 5: `fetchTemporaryUserJourneyOverviewDiagram` calls correct URL with projectId and businessUserId query parameter (mock fetch)
  - [x] 4.2 Add `USER_JOURNEY_OVERVIEW` to `diagramType.ts`
    - File: `frontend/src/types/diagramType.ts`
    - Add `'USER_JOURNEY_OVERVIEW'` to `DiagramType` union
    - Add to `ALL_DIAGRAM_TYPES` array (but NOT to `CREATABLE_DIAGRAM_TYPES`)
    - Add to `DIAGRAM_TYPE_LABELS`: `USER_JOURNEY_OVERVIEW: 'User Journey Overview'`
    - Add to `DIAGRAM_TYPE_MAP`: `user_journey_overview: 'USER_JOURNEY_OVERVIEW'` and `'user journey overview': 'USER_JOURNEY_OVERVIEW'`
  - [x] 4.3 Create `userJourneyOverviewDiagram.ts` TypeScript interfaces
    - File: `frontend/src/types/userJourneyOverviewDiagram.ts`
    - `UserJourneyOverviewDiagramDto`: diagram_type, version, overview (header), lanes, nodes, edges, render_hints
    - `UserJourneyOverviewHeaderDto`: business_user_id, business_user_name, title
    - `UserJourneyOverviewLaneDto`: id, name, order
    - `UserJourneyOverviewNodeDto`: id, lane_id, name, description, primary_business_user_id, primary_business_user_name, parent_business_process_id, parent_business_process_name, metadata (sub-interface with step_count, application_count, relationship_in_count, relationship_out_count)
    - `UserJourneyOverviewEdgeDto`: id, source_node_id, target_node_id, relationship_type, label, description
    - `UserJourneyOverviewRenderHintsDto`: lane_axis, flow_direction, show_title, show_lane_headers, show_node_description, show_relationship_labels
  - [x] 4.4 Add `USER_JOURNEY_OVERVIEW` to `typedContent.ts`
    - File: `frontend/src/types/typedContent.ts`
    - Add `'USER_JOURNEY_OVERVIEW'` to `DiagramTypedContentType` union
    - Add to `TYPED_DIAGRAM_TYPES` array
    - Add `UserJourneyOverviewContent` interface (matching `UserJourneyOverviewDiagramDto` shape: overview, lanes, nodes, edges, render_hints, diagram_type, version)
    - Add to `TypedContentEnvelope.content` union
    - Add `createDefaultUserJourneyOverviewContent()` factory function returning empty arrays and default render hints
    - Add `case 'USER_JOURNEY_OVERVIEW'` to `createDefaultTypedContent` switch
  - [x] 4.5 Create `userJourneyOverviewDiagramApi.ts` API client
    - File: `frontend/src/api/userJourneyOverviewDiagramApi.ts`
    - `fetchTemporaryUserJourneyOverviewDiagram(projectId: string, businessUserId: string): Promise<UserJourneyOverviewDiagramDto>`
    - Calls GET `/api/projects/{projectId}/user-journey-overview-diagrams/temporary?businessUserId={businessUserId}`
    - Uses `API_BASE` pattern from `userJourneyDiagramApi.ts`
    - Throws Error on non-ok response
  - [x] 4.6 Ensure frontend type and API client tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- `USER_JOURNEY_OVERVIEW` is registered in all required type maps and arrays
- TypeScript interfaces mirror the backend DTO contract v1 exactly
- API client calls the correct endpoint URL with query parameter
- `USER_JOURNEY_OVERVIEW` is NOT in `CREATABLE_DIAGRAM_TYPES`

---

### Frontend Review Flow & Entry Point

#### Task Group 5: Overview Review Context, Banner, and Business User Selector Entry Point
**Dependencies:** Task Group 4

- [x] 5.0 Complete overview review flow and generation entry point
  - [x] 5.1 Write 5 focused tests for the review context and entry point
    - Test 1: `activateOverviewReview` sets active to true and stores the DTO, projectId, and previousView
    - Test 2: `markOverviewSaved` sets the saved flag to true
    - Test 3: `closeOverviewReview` resets state to initial (active = false, dto = null)
    - Test 4: `OverviewReviewBanner` renders Preview badge, business user name in title, summary text (journey count and BP count), Save as Diagram button, and Close/Discard button
    - Test 5: Business User selector dropdown populates from `state.model.metaModel.business_users` and the Generate button calls `fetchTemporaryUserJourneyOverviewDiagram` then activates review
  - [x] 5.2 Create `UserJourneyOverviewReviewContext.tsx`
    - File: `frontend/src/contexts/UserJourneyOverviewReviewContext.tsx`
    - State interface: `active` (boolean), `projectId` (string), `overviewDiagram` (UserJourneyOverviewDiagramDto | null), `saved` (boolean), `previousView` (string)
    - Actions: `activateOverviewReview(projectId, dto, previousView)`, `markOverviewSaved()`, `closeOverviewReview()`
    - Provider component with `useState` and `useCallback` pattern
    - Export `useUserJourneyOverviewReviewContext()` hook
    - Follow simplified pattern from `UserJourneyReviewContext.tsx` (single diagram, no multi-item navigation)
  - [x] 5.3 Register `UserJourneyOverviewReviewProvider` in the app provider tree
    - File: `frontend/src/App.tsx` (or equivalent provider wrapper)
    - Add `UserJourneyOverviewReviewProvider` at the same level as `UserJourneyReviewProvider`
  - [x] 5.4 Create `OverviewReviewBanner.tsx` component
    - File: `frontend/src/components/DiagramsView/OverviewReviewBanner.tsx`
    - Props: the overview review context state (or consume via hook)
    - Renders: "Preview" badge, "[Business User Name] Journey Overview" title, compact summary (e.g., "12 journeys across 4 business processes"), "Save as Diagram" button, "Discard" / "Close" button
    - "Save as Diagram" calls the save handler (passed as prop or via context)
    - "Discard" calls `closeOverviewReview` and restores previous view
    - Follow styling from `JourneyReviewBanner.tsx` (Preview badge, button layout)
    - Omit Previous/Next/Back to List navigation controls (single diagram, not multi)
  - [x] 5.5 Add "Generate Journey Overview" entry point in DiagramsView
    - Add a button or menu option in the existing diagram workspace toolbar area
    - On click: show Business User selector dropdown populated from `state.model.metaModel.business_users`
    - On confirm: call `fetchTemporaryUserJourneyOverviewDiagram(projectId, businessUserId)`
    - Show loading spinner during fetch, toast on error
    - On success: call `activateOverviewReview(projectId, dto, currentView)` and switch view to diagrams if needed
  - [x] 5.6 Ensure review flow tests pass
    - Run ONLY the 5 tests written in 5.1
    - Verify context state transitions work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 5.1 pass
- Review context correctly manages single-diagram review lifecycle
- Banner displays correct summary information and action buttons
- Business User selector populates from meta-model data
- Fetch + review activation flow works end-to-end in isolation

---

### Frontend SVG Renderer & Canvas Integration

#### Task Group 6: Overview Diagram Renderer
**Dependencies:** Task Group 4 (TypeScript interfaces must exist)

- [x] 6.0 Complete native SVG renderer for overview diagrams
  - [x] 6.1 Write 4 focused tests for the renderer
    - Test 1: Renderer renders correct number of lane bands and lane header labels for a multi-lane overview DTO
    - Test 2: Renderer renders correct number of journey node rectangles with name labels
    - Test 3: Renderer renders edge lines with arrowhead markers between connected nodes
    - Test 4: Renderer renders empty diagram message when DTO has zero lanes and zero nodes
  - [x] 6.2 Create `UserJourneyOverviewDiagramRenderer.tsx`
    - File: `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx`
    - Props: `overviewData: UserJourneyOverviewDiagramDto`, `onContentBounds?: (bounds: { width: number; height: number }) => void`
    - SVG-based component following `UserJourneyDiagramRenderer.tsx` structure
  - [x] 6.3 Implement `computeLayout` function for overview diagrams
    - Deterministic layout computation (no manual positioning)
    - Horizontal swimlane bands stacked vertically (one per Business Process lane)
    - Journey nodes flowing left-to-right within each lane, sorted alphabetically by name
    - Lane headers on the left side using rotated text
    - Returns computed positions for lanes, nodes, and edge waypoints
  - [x] 6.4 Implement lane rendering sub-component
    - Alternating lane background fills using existing `LANE_COLORS` pattern
    - Lane header background using `LANE_HEADER_BG` pattern
    - Rotated lane header text on left side
  - [x] 6.5 Implement node rendering sub-component
    - Rounded rectangle with journey name as primary label
    - Description as secondary text (truncated to fit)
    - Compact metadata badges for `step_count` and `application_count`
    - Use existing visual constants: fill colors (`STEP_FILL`), stroke colors (`STEP_STROKE`), font sizes, corner radii
  - [x] 6.6 Implement edge rendering sub-component
    - Directed edges using waypoint/polyline approach with generated waypoints
    - Arrowhead markers (SVG `<marker>` / `<defs>` pattern)
    - Edge labels displayed along the path (relationship label from DTO)
    - Use existing `EDGE_COLOR` constant
  - [x] 6.7 Implement title rendering and empty state
    - Title at top: "[Business User Name] Journey Overview" from `overview.title`
    - Empty diagram message for zero-lane/zero-node scenarios
  - [x] 6.8 Implement `computeContentBounds` and `onContentBounds` callback
    - Compute total SVG content bounds from computed layout
    - Call `onContentBounds` callback with `{ width, height }` for parent auto-sizing
    - Follow same pattern as `UserJourneyDiagramRenderer`
  - [x] 6.9 Ensure renderer tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify SVG elements render correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 6.1 pass
- Renderer produces valid SVG with correct lane, node, and edge counts
- Layout is deterministic (same input always produces same output)
- Visual constants are reused from existing renderer (no new design language)
- Empty state renders a message instead of blank SVG

---

#### Task Group 7: Canvas.tsx Integration and Save Flow
**Dependencies:** Task Groups 5, 6

- [x] 7.0 Complete Canvas integration and save-as-diagram flow
  - [x] 7.1 Write 4 focused tests for Canvas integration and save flow
    - Test 1: `isUserJourneyOverviewDiagram` flag is true when `getDiagramType(diagram)` returns `'USER_JOURNEY_OVERVIEW'`
    - Test 2: `extractUserJourneyOverviewDiagram` correctly extracts `UserJourneyOverviewDiagramDto` from `diagram.typedContent.content`
    - Test 3: `extractUserJourneyOverviewDiagram` returns null for non-overview diagrams
    - Test 4: Save flow creates a Diagram object with correct `diagram_type: 'USER_JOURNEY_OVERVIEW'`, `typedContent` envelope with `type: 'USER_JOURNEY_OVERVIEW'`, `version: 1`, and full overview DTO as content
  - [x] 7.2 Add `extractUserJourneyOverviewDiagram` helper function to Canvas.tsx
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Extract `UserJourneyOverviewDiagramDto` from `diagram.typedContent.content`
    - Follow exact pattern from `extractUserJourneyDiagram`: check both typed and untyped content, validate with type guard
    - Add `isUserJourneyOverviewDiagramDto` type guard function
  - [x] 7.3 Add `isUserJourneyOverviewDiagram` flag and conditional rendering branch
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add `const isUserJourneyOverviewDiagram = getDiagramType(diagram) === 'USER_JOURNEY_OVERVIEW'` alongside existing `isUserJourneyDiagram`
    - Add canvas width/height handling for overview diagrams (using overview content bounds, same pattern as journey bounds)
    - Add conditional rendering branch after `isUserJourneyDiagram` block, before General fallback
    - Dispatch to `UserJourneyOverviewDiagramRenderer` with extracted overview data
    - Pass `onContentBounds` callback for auto-sizing
  - [x] 7.4 Wire overview review rendering in DiagramsView
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - When `overviewReviewContext.active` is true, render `OverviewReviewBanner` in toolbar area
    - Pass overview DTO to Canvas as a temporary (unsaved) diagram for rendering
    - Read-only mode: no editing allowed during review
  - [x] 7.5 Implement `handleSaveOverviewDiagram` in DiagramsView
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - Build `TypedContentEnvelope` with `type: 'USER_JOURNEY_OVERVIEW'`, `version: 1`, `content` containing full overview DTO snapshot
    - Create Diagram object: `id` via `generatePrefixedId('diag')`, `diagram_type: 'USER_JOURNEY_OVERVIEW'`, `name` from overview title, `typedContent` envelope
    - Dispatch `ADD_DIAGRAM` to state
    - Call `markOverviewSaved()` on context
    - Show success toast
    - Follow pattern from `handleSaveJourneyDiagram`
  - [x] 7.6 Ensure Canvas integration and save flow tests pass
    - Run ONLY the 4 tests written in 7.1
    - Verify rendering dispatch and save flow work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 7.1 pass
- Canvas correctly identifies and renders USER_JOURNEY_OVERVIEW diagrams (both from review and from saved state)
- Extract helper correctly pulls overview data from typed content
- Save flow creates properly structured Diagram with correct type and content envelope
- Saved overview diagrams render from their stored snapshot on reopen

---

### Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 4 tests written by Task Group 1 (backend DTO records)
    - Review the 6 tests written by Task Group 2 (projection service)
    - Review the 3 tests written by Task Group 3 (REST controller)
    - Review the 5 tests written by Task Group 4 (frontend types, registration, API client)
    - Review the 5 tests written by Task Group 5 (review context, banner, entry point)
    - Review the 4 tests written by Task Group 6 (SVG renderer)
    - Review the 4 tests written by Task Group 7 (Canvas integration, save flow)
    - Total existing tests: 31 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - Identify critical integration points lacking coverage
    - Focus ONLY on gaps related to the overview diagram feature
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end user workflow: generate overview -> review -> save -> reopen from saved
  - [x] 8.3 Write up to 10 additional strategic tests maximum
    - Potential gap: End-to-end flow -- fetch temporary overview, verify rendering dispatches to UserJourneyOverviewDiagramRenderer, save, verify reopened diagram uses extracted snapshot
    - Potential gap: Overview with many lanes -- verify lane ordering remains alphabetical with Unassigned last
    - Potential gap: Overview with cross-lane edges -- verify edges render between nodes in different lanes
    - Potential gap: Business User selector shows correct users from meta-model state
    - Potential gap: Discard flow -- verify closing review restores previous view and does not persist diagram
    - Potential gap: Banner summary text computes correct journey count and business process count from DTO
    - Potential gap: Projection service handles journeys with zero activity steps (step_count = 0, application_count = 0)
    - Potential gap: TypedContentEnvelope round-trip -- create overview content, serialize, deserialize, verify structure
    - Do NOT write more than 10 additional tests
    - Skip edge cases, performance tests, and accessibility tests
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to the overview diagram feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3)
    - Expected total: approximately 31-41 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-41 tests total)
- Critical user workflow (generate -> review -> save -> reopen) is covered
- No more than 10 additional tests added when filling in gaps
- Testing focused exclusively on the overview diagram feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Backend DTO Records (Task Group 1)** -- Java record DTOs defining the contract. No dependencies. Establishes the data shape used by all other layers.
2. **Backend Projection Service (Task Group 2)** -- Stateless service generating overview DTO from DB entities. Depends on Group 1 (DTO records must exist).
3. **Backend REST Controller (Task Group 3)** -- HTTP endpoint exposing the projection. Depends on Group 2 (service must exist).
4. **Frontend Types, Registration, and API Client (Task Group 4)** -- TypeScript interfaces, diagram type registration, and fetch function. Depends on Group 1 (contract must be finalized). Can start in parallel with Groups 2-3.
5. **Frontend Review Flow and Entry Point (Task Group 5)** -- Overview review context, banner, and Business User selector. Depends on Group 4 (types and API client must exist).
6. **Frontend SVG Renderer (Task Group 6)** -- Native SVG swimlane renderer. Depends on Group 4 (TypeScript interfaces must exist). Can run in parallel with Group 5.
7. **Canvas Integration and Save Flow (Task Group 7)** -- Canvas.tsx dispatch, review wiring, and save-as-diagram. Depends on Groups 5 and 6 (review context and renderer must exist).
8. **Test Review and Gap Analysis (Task Group 8)** -- Review all tests from Groups 1-7, fill critical gaps. Depends on Groups 1-7 (all code must be written).

## Key Files Modified or Created

| File | Task Group | Change Type |
|------|-----------|-------------|
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewDiagramDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewHeaderDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewLaneDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewNodeDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewEdgeDto.java` | 1 | New file |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewRenderHintsDto.java` | 1 | New file |
| `architecture-model-service/.../service/UserJourneyOverviewDiagramProjectionService.java` | 2 | New file |
| `architecture-model-service/.../controller/UserJourneyOverviewDiagramController.java` | 3 | New file |
| `frontend/src/types/diagramType.ts` | 4 | Modify (add USER_JOURNEY_OVERVIEW to union, arrays, maps) |
| `frontend/src/types/userJourneyOverviewDiagram.ts` | 4 | New file |
| `frontend/src/types/typedContent.ts` | 4 | Modify (add to union, array, content type, factory) |
| `frontend/src/api/userJourneyOverviewDiagramApi.ts` | 4 | New file |
| `frontend/src/contexts/UserJourneyOverviewReviewContext.tsx` | 5 | New file |
| `frontend/src/App.tsx` | 5 | Modify (add provider) |
| `frontend/src/components/DiagramsView/OverviewReviewBanner.tsx` | 5 | New file |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 5, 7 | Modify (entry point, review wiring, save handler) |
| `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx` | 6 | New file |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 7 | Modify (add flag, extract helper, rendering branch) |
