# Task Breakdown: User Journey Overview Parent-Child Diagram Linking

## Overview
Total Tasks: 34

This spec extends the Increment 13 User Journey Overview diagram with parent-child linking. Clicking an overview journey node navigates to its detailed child USER_JOURNEY diagram. No new endpoints or meta-model entities are created -- this is a projection-time enrichment on the backend and click/visual handling on the frontend.

Key constraint: `DiagramEntity` has no `updatedAt` field, so the AMBIGUOUS_RESOLVED tiebreaker uses alphabetically last diagram ID (`Collections.max` by `id`).

## Task List

### Backend: Data Access and DTO Extension

#### Task Group 1: Repository Query and DTO Contract
**Dependencies:** None

- [x] 1.0 Complete repository query method and DTO contract extension
  - [x] 1.1 Write 4 focused tests for the new repository method and DTO structure
    - Test `findByModelFileIdAndDiagramType` returns only USER_JOURNEY diagrams for a given modelFileId
    - Test `findByModelFileIdAndDiagramType` returns empty list when no diagrams of given type exist
    - Test `UserJourneyOverviewNodeLinkDto` serializes correctly with `@JsonProperty` annotations (linked_diagram_id, linked_diagram_name, link_status)
    - Test `UserJourneyOverviewNodeDto` includes `link` sub-record in JSON output and it is never null
  - [x] 1.2 Add `findByModelFileIdAndDiagramType` to `DiagramRepository`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/diagram/DiagramRepository.java`
    - Add Spring Data JPA derived query: `List<DiagramEntity> findByModelFileIdAndDiagramType(String modelFileId, String diagramType)`
    - Follows the existing `findByModelFileId(String)` pattern
  - [x] 1.3 Add nested `UserJourneyOverviewNodeLinkDto` sub-record to `UserJourneyOverviewNodeDto`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/UserJourneyOverviewNodeDto.java`
    - Add inner `public record UserJourneyOverviewNodeLinkDto` following the existing `UserJourneyOverviewNodeMetadataDto` nested sub-record pattern
    - Fields: `linked_diagram_id` (String, nullable, `@JsonProperty("linked_diagram_id")`), `linked_diagram_name` (String, nullable, `@JsonProperty("linked_diagram_name")`), `link_status` (String, non-null, `@JsonProperty("link_status")`)
    - Valid `link_status` values: `"LINKED"`, `"UNLINKED"`, `"AMBIGUOUS_RESOLVED"`
  - [x] 1.4 Add `link` field to `UserJourneyOverviewNodeDto` record constructor
    - Add `@JsonProperty("link") UserJourneyOverviewNodeLinkDto link` as the last parameter in the record constructor
    - The `link` field is always present (never null) with `link_status` always populated
  - [x] 1.5 Update existing `deriveNodes` call site to pass a link value for each node
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyOverviewDiagramProjectionService.java`
    - Temporarily pass a default UNLINKED link sub-record to each node constructor so existing code compiles
    - This will be replaced with real resolution logic in Task Group 2
  - [x] 1.6 Ensure Task Group 1 tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify `DiagramRepository` compiles with new method
    - Verify `UserJourneyOverviewNodeDto` serialization includes `link` sub-record
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `DiagramRepository` has the new `findByModelFileIdAndDiagramType` derived query method
- `UserJourneyOverviewNodeDto` includes a non-null `link` sub-record with `linked_diagram_id`, `linked_diagram_name`, `link_status`
- Existing projection service compiles with the updated node constructor (default UNLINKED)

---

### Backend: Projection Service Link Resolution

#### Task Group 2: Link Resolution Logic in Projection Service
**Dependencies:** Task Group 1

- [x] 2.0 Complete link resolution logic inside the projection service
  - [x] 2.1 Write 6 focused tests for link resolution behavior
    - Test zero matching child diagrams for a node produces UNLINKED status with null diagram fields
    - Test exactly one matching child diagram produces LINKED status with correct diagram id and name
    - Test multiple matching child diagrams produces AMBIGUOUS_RESOLVED, selecting the diagram with the alphabetically last ID (e.g., "diag-z" beats "diag-a")
    - Test diagrams with null `typedContentJson` are skipped during resolution (v1 diagrams)
    - Test diagrams with null `content` or null `sync` block in typedContentJson are skipped
    - Test link resolution uses the same `modelFileId` as the projection scope (no cross-project linking)
  - [x] 2.2 Inject `DiagramRepository` into `UserJourneyOverviewDiagramProjectionService`
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/UserJourneyOverviewDiagramProjectionService.java`
    - Add `private final DiagramRepository diagramRepository` field (the existing `@RequiredArgsConstructor` pattern handles injection)
    - Import `com.example.architecturemodel.repository.diagram.DiagramRepository`
  - [x] 2.3 Implement child diagram fetching and `source_user_journey_id` parsing
    - In `projectOverview()`, after `resolveModelFile(projectId)`, call `diagramRepository.findByModelFileIdAndDiagramType(modelFile.getId(), "USER_JOURNEY")`
    - For each candidate diagram, parse `typedContentJson` following the `UserJourneySyncService` pattern: `typedContentJson -> get("content") (Map) -> get("sync") (Map) -> get("source_user_journey_id") (String)`
    - Apply `@SuppressWarnings("unchecked")` on Map casts as in `UserJourneySyncService`
    - Skip diagrams where typedContentJson is null, content is null, sync block is null, or source_user_journey_id is null
    - Build `Map<String, List<DiagramEntity>>` keyed by `source_user_journey_id` for O(1) lookup
  - [x] 2.4 Implement deterministic resolution rule per node
    - Zero matches: create `UserJourneyOverviewNodeLinkDto(null, null, "UNLINKED")`
    - Exactly one match: create `UserJourneyOverviewNodeLinkDto(diagram.getId(), diagram.getName(), "LINKED")`
    - Multiple matches: select diagram with alphabetically last ID using `Collections.max(list, Comparator.comparing(DiagramEntity::getId))`, create link with `"AMBIGUOUS_RESOLVED"` status
    - Note: `DiagramEntity` has no `updatedAt` field, so ID-based tiebreaker is used
  - [x] 2.5 Pass resolution map into `deriveNodes` and populate each node's `link` sub-record
    - Add `Map<String, List<DiagramEntity>> childDiagramMap` parameter to `deriveNodes` method signature
    - Replace the temporary default UNLINKED link from task 1.5 with actual resolution logic
    - For each journey node, look up `childDiagramMap.getOrDefault(journey.getId(), List.of())` and apply the resolution rule from 2.4
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify link resolution produces correct status for all three cases (LINKED, UNLINKED, AMBIGUOUS_RESOLVED)
    - Verify defensive parsing skips v1 diagrams and malformed typed content
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- `DiagramRepository` is injected into the projection service
- `projectOverview()` fetches candidate USER_JOURNEY diagrams once per call
- Each node's `link` sub-record is populated with correct resolution status
- Diagrams with missing/null sync metadata are safely skipped
- AMBIGUOUS_RESOLVED selects the alphabetically last diagram ID

---

### Frontend: TypeScript Types and Renderer Extension

#### Task Group 3: TypeScript Type Extension
**Dependencies:** Task Group 1 (DTO contract must be finalized)

- [x] 3.0 Complete frontend TypeScript type extension
  - [x] 3.1 Write 3 focused tests for TypeScript type compatibility
    - Test that a `UserJourneyOverviewNodeDto` object with `link` sub-interface type-checks correctly for LINKED status
    - Test that a `UserJourneyOverviewNodeDto` object without `link` field (pre-increment-14 saved overview) is accepted (link is optional)
    - Test that `link_status` literal union type rejects invalid values at compile time (type assertion test)
  - [x] 3.2 Add `UserJourneyOverviewNodeLinkDto` interface to `userJourneyOverviewDiagram.ts`
    - File: `frontend/src/types/userJourneyOverviewDiagram.ts`
    - Fields: `linked_diagram_id: string | null`, `linked_diagram_name: string | null`, `link_status: 'LINKED' | 'UNLINKED' | 'AMBIGUOUS_RESOLVED'`
    - Place in a new section between Node Metadata and Node sections
  - [x] 3.3 Add optional `link` field to `UserJourneyOverviewNodeDto` interface
    - Add `link?: UserJourneyOverviewNodeLinkDto` to the `UserJourneyOverviewNodeDto` interface
    - Must be optional (`?`) so pre-existing saved overviews without the field are treated as UNLINKED
    - Update `UserJourneyOverviewContent` in `typedContent.ts` if the node type import path changes
  - [x] 3.4 Ensure Task Group 3 tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify type compatibility for linked, unlinked, and missing-link scenarios
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- `UserJourneyOverviewNodeLinkDto` interface exists with correct fields and literal union type
- `UserJourneyOverviewNodeDto` has optional `link` field
- Backward compatibility: pre-existing saved overviews without `link` field compile and pass type checks

---

### Frontend: Renderer Click Handling and Visual Cues

#### Task Group 4: Overview Renderer Interaction Layer
**Dependencies:** Task Group 3

- [x] 4.0 Complete renderer click handling and visual cue implementation
  - [x] 4.1 Write 5 focused tests for renderer interactions and visual cues
    - Test that `onNodeClick` callback is invoked with the correct node data when a node is clicked
    - Test that linked nodes (LINKED status) render with `fill="#1976D2"` and `textDecoration="underline"` on the name text element
    - Test that unlinked nodes retain default styling (`fill="#333"`, no underline, default cursor)
    - Test that AMBIGUOUS_RESOLVED nodes receive the same visual treatment as LINKED nodes (blue + underline + pointer)
    - Test that nodes without `link` field (backward compat) render with default/unlinked styling
  - [x] 4.2 Add `onNodeClick` callback prop to `UserJourneyOverviewDiagramRendererProps`
    - File: `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx`
    - Add `onNodeClick?: (node: UserJourneyOverviewNodeDto) => void` to the props interface
    - Destructure `onNodeClick` in the component function
  - [x] 4.3 Pass `onNodeClick` into `renderNode` helper and add click handler
    - Add `onNodeClick` as a parameter to the `renderNode` function signature
    - On the node `<g>` element: add `onClick` handler that calls `onNodeClick(node)` if provided
    - Set `cursor: 'pointer'` style on the `<g>` when node has `link?.link_status` of `'LINKED'` or `'AMBIGUOUS_RESOLVED'`
    - Set `cursor: 'default'` for unlinked or missing-link nodes
  - [x] 4.4 Apply visual cues for linked nodes in `renderNode`
    - When `node.link?.link_status` is `'LINKED'` or `'AMBIGUOUS_RESOLVED'`:
      - Node name `<text>` element: `fill="#1976D2"` (blue) instead of `#333`
      - Node name `<text>` element: `textDecoration="underline"`
    - When `node.link?.link_status` is `'UNLINKED'` or `node.link` is undefined:
      - Retain default styling: `fill="#333"`, no underline, default cursor
    - This matches the existing `linkedDiagramId` convention in `Canvas.tsx` (line ~2546-2551)
  - [x] 4.5 Update `renderNode` call site in the main component to pass `onNodeClick`
    - In the `nodes.map()` rendering block, pass `onNodeClick` to each `renderNode(node, pos, showNodeDescription, onNodeClick)` call
  - [x] 4.6 Ensure Task Group 4 tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify click handlers fire correctly
    - Verify visual cue styling matches spec for linked, unlinked, and backward-compat cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 4.1 pass
- `onNodeClick` callback prop exists on the renderer and fires with node data
- Linked nodes (LINKED, AMBIGUOUS_RESOLVED) show blue text, underline, pointer cursor
- Unlinked nodes and nodes without `link` field show default styling
- No regressions to existing overview rendering

---

### Frontend: Wiring Click Handlers in DiagramsView and Canvas

#### Task Group 5: Navigation Wiring in Review Mode and Saved Mode
**Dependencies:** Task Group 4

- [x] 5.0 Complete navigation wiring in both overview rendering paths
  - [x] 5.1 Write 6 focused tests for navigation wiring behavior
    - Test that clicking a LINKED node in overview review mode calls `overviewReview.closeOverviewReview()` and dispatches `SELECT_DIAGRAM` with correct diagram ID
    - Test that clicking an UNLINKED node in overview review mode triggers toast with message "No linked child diagram saved yet" and type "info"
    - Test that clicking a LINKED node on a saved overview in Canvas dispatches `SELECT_DIAGRAM` with correct diagram ID
    - Test that clicking an UNLINKED node on a saved overview in Canvas triggers the unlinked-node feedback callback
    - Test that clicking a node with missing `link` field (backward compat) triggers unlinked behavior (toast/feedback)
    - Test that AMBIGUOUS_RESOLVED nodes navigate the same as LINKED nodes in both rendering paths
  - [x] 5.2 Wire `onNodeClick` in overview review mode (DiagramsView.tsx)
    - File: `frontend/src/components/DiagramsView/DiagramsView.tsx`
    - In the `overviewReview.active` rendering branch (around line 3867), pass `onNodeClick` callback to `UserJourneyOverviewDiagramRenderer`
    - Callback logic: if `node.link?.link_status` is `'LINKED'` or `'AMBIGUOUS_RESOLVED'`, call `overviewReview.closeOverviewReview()` then `dispatch({ type: 'SELECT_DIAGRAM', payload: node.link.linked_diagram_id })`
    - If `'UNLINKED'` or link is missing, call `setToastState({ visible: true, message: 'No linked child diagram saved yet', type: 'info' })`
    - Both `dispatch` and `setToastState` are already in scope at the DiagramsView component level
  - [x] 5.3 Add `onUnlinkedNodeClick` callback prop to Canvas component
    - File: `frontend/src/components/DiagramsView/Canvas.tsx`
    - Add optional `onUnlinkedNodeClick?: () => void` prop to Canvas component props
    - This bridges the toast feedback from DiagramsView into Canvas since Canvas does not have direct access to `setToastState`
  - [x] 5.4 Wire `onNodeClick` in saved overview mode (Canvas.tsx)
    - In the `isUserJourneyOverviewDiagram` rendering branch (around line 3639), pass `onNodeClick` callback to `UserJourneyOverviewDiagramRenderer`
    - Callback logic: if `node.link?.link_status` is `'LINKED'` or `'AMBIGUOUS_RESOLVED'`, call `dispatch({ type: 'SELECT_DIAGRAM', payload: node.link.linked_diagram_id })` and scroll to top (following `handleLinkedTextClick` pattern at line ~2424-2434)
    - For unlinked/missing-link nodes, call `onUnlinkedNodeClick?.()` to delegate toast to DiagramsView
  - [x] 5.5 Wire `onUnlinkedNodeClick` from DiagramsView to Canvas
    - In DiagramsView where Canvas is rendered, pass `onUnlinkedNodeClick={() => setToastState({ visible: true, message: 'No linked child diagram saved yet', type: 'info' })}`
    - This ensures consistent toast behavior across both review mode and saved mode
  - [x] 5.6 Ensure Task Group 5 tests pass
    - Run ONLY the 6 tests written in 5.1
    - Verify navigation dispatches correctly in both rendering paths
    - Verify toast feedback for unlinked nodes in both paths
    - Verify backward compatibility for nodes without `link` field
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 5.1 pass
- Clicking a linked node in review mode closes review and navigates to the child diagram
- Clicking a linked node on a saved overview navigates to the child diagram and scrolls to top
- Clicking an unlinked node (or node without `link` field) shows info toast in both paths
- AMBIGUOUS_RESOLVED behaves identically to LINKED for navigation purposes

---

### Testing: Review and Gap Analysis

#### Task Group 6: Test Review and Critical Gap Fill
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4 tests written by Task Group 1 (repository query and DTO contract)
    - Review the 6 tests written by Task Group 2 (link resolution logic)
    - Review the 3 tests written by Task Group 3 (TypeScript type extension)
    - Review the 5 tests written by Task Group 4 (renderer interactions and visual cues)
    - Review the 6 tests written by Task Group 5 (navigation wiring)
    - Total existing tests: 24 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to parent-child diagram linking feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize: full projection-to-click flow, backward compatibility edge cases, empty diagram scenarios
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - Add maximum of 10 new tests to fill identified critical gaps
    - Potential gap areas:
      - Backend: projection service produces correct `link` sub-records end-to-end (not just resolution logic in isolation)
      - Backend: `projectOverview()` for a business user with zero journeys still returns valid empty DTO (regression)
      - Frontend: renderer correctly handles a mix of LINKED, UNLINKED, and AMBIGUOUS_RESOLVED nodes in the same diagram
      - Frontend: click handler works correctly when overview has edges and linked nodes simultaneously
      - Integration: saved overview loaded from Canvas correctly passes link data through `extractUserJourneyOverviewDiagram` into renderer
    - Do NOT write exhaustive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 24-34 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-34 tests total)
- Critical user workflows for parent-child diagram linking are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Backward compatibility confirmed: pre-increment-14 saved overviews render without errors

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** -- Repository Query and DTO Contract (backend data access layer, no dependencies)
2. **Task Group 2** -- Link Resolution Logic (backend projection service, depends on Group 1)
3. **Task Group 3** -- TypeScript Type Extension (frontend types, depends on Group 1 DTO contract)
4. **Task Group 4** -- Renderer Click Handling and Visual Cues (frontend renderer, depends on Group 3)
5. **Task Group 5** -- Navigation Wiring in DiagramsView and Canvas (frontend integration, depends on Group 4)
6. **Task Group 6** -- Test Review and Critical Gap Fill (all groups complete)

Note: Task Groups 2 and 3 can be executed in parallel since they have no direct dependency on each other (both depend only on Task Group 1). Task Group 2 is backend-only and Task Group 3 is frontend-only.

## Key Files Modified

| File | Task Group | Change Summary |
|------|-----------|----------------|
| `architecture-model-service/.../repository/diagram/DiagramRepository.java` | 1 | Add `findByModelFileIdAndDiagramType` query method |
| `architecture-model-service/.../model/dto/diagram/UserJourneyOverviewNodeDto.java` | 1 | Add nested `UserJourneyOverviewNodeLinkDto` sub-record and `link` field |
| `architecture-model-service/.../service/UserJourneyOverviewDiagramProjectionService.java` | 1, 2 | Inject `DiagramRepository`, implement link resolution in `projectOverview()` and `deriveNodes()` |
| `frontend/src/types/userJourneyOverviewDiagram.ts` | 3 | Add `UserJourneyOverviewNodeLinkDto` interface, add optional `link` field to node DTO |
| `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx` | 4 | Add `onNodeClick` prop, click handlers, visual cues (blue text, underline, pointer cursor) |
| `frontend/src/components/DiagramsView/DiagramsView.tsx` | 5 | Wire `onNodeClick` in review mode, wire `onUnlinkedNodeClick` to Canvas |
| `frontend/src/components/DiagramsView/Canvas.tsx` | 5 | Add `onUnlinkedNodeClick` prop, wire `onNodeClick` in saved overview mode |
