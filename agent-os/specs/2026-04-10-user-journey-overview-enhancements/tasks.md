# Task Breakdown: User Journey Overview Diagram Enhancements

## Overview
Total Tasks: 42 sub-tasks across 5 task groups

This spec delivers three enhancements:
1. **Auto-derive BusinessPoint/ApplicationPoint relationships** from activity step data during the MCP save pipeline (`userJourneysService.ts`)
2. **Summary sentence** on the overview diagram showing journey/process/step/app counts
3. **Related colleagues navigation line** above the overview diagram title with click-to-navigate

## Task List

### MCP Save Pipeline (Backend - TypeScript)

#### Task Group 1: Auto-derive BusinessPoint and ApplicationPoint Entities and Relationships
**Dependencies:** None
**Files:** `mcp-server/src/services/userJourneysService.ts`

This task group adds derivation logic to the `save_user_journeys` pipeline in `userJourneysService.ts`. The logic is inserted after the Step 7 merge phase (after `user_journey_links` merge, line 846) and before Step 8 `ensureAbbreviations` (line 849). It operates on the fully merged `base.metaModel.entities` and `base.metaModel.relationships` objects.

- [x] 1.0 Complete auto-derivation of BusinessPoints, ApplicationPoints, and relationships in the user journeys save pipeline
  - [x] 1.1 Write 6 focused tests for the derivation logic
    - Test 1: After saving user journeys with activity steps, verify BUSINESS_PROCESS-kind BusinessPoints are created with `bpt_{businessProcessId}` IDs in `entities.business_points`
    - Test 2: After saving, verify PROCESS_ACTIVITY-kind BusinessPoints are created with `bpt_{processActivityId}` IDs, including both `business_process_id` and `process_activity_id` fields populated
    - Test 3: After saving, verify APPLICATION-kind ApplicationPoints are auto-created for activity steps whose `application_id` has no existing ApplicationPoint, with correct shape and `generateId('apt-')` ID
    - Test 4: After saving, verify `business_user_business_points` relationships are created linking each journey's `primary_business_user_id` to the derived BusinessPoints (composite dedup key: `business_user_id, business_point_id`)
    - Test 5: After saving, verify `application_point_business_points` relationships are created linking each step's ApplicationPoint to both the PROCESS_ACTIVITY and BUSINESS_PROCESS BusinessPoints (composite dedup key: `application_point_id, business_point_id`)
    - Test 6: Verify idempotency -- re-saving the same journeys does not create duplicate entities or relationships (all dedup checks work correctly on already-populated arrays)
  - [x] 1.2 Implement BusinessPoint auto-creation from activity steps
    - After the Step 7 merge block (line 846 in `userJourneysService.ts`), iterate over `base.metaModel.entities.activity_steps` for the merged journeys
    - For each activity step, look up its `process_activity_id` in `entities.process_activities` to resolve the parent `business_process_id`
    - Create a BUSINESS_PROCESS-kind BusinessPoint with `id: bpt_{businessProcessId}`, using the JSON shape from the spec: `{ id, name, description: null, kind: 'BUSINESS_PROCESS', business_process_id, process_activity_id: null, tags: null, valid_from: null, valid_to: null }`
    - Create a PROCESS_ACTIVITY-kind BusinessPoint with `id: bpt_{processActivityId}`, including both `business_process_id` and `process_activity_id` populated
    - Deduplicate against the full `entities.business_points` array -- skip if a BusinessPoint with the same ID already exists
    - Resolve entity names from the corresponding `business_processes` and `process_activities` entities
    - Use `ensureArray()` helper for safe array access, matching existing patterns
  - [x] 1.3 Implement ApplicationPoint auto-creation from activity steps
    - For each activity step with an `application_id`, look up an existing APPLICATION-kind ApplicationPoint in `entities.application_points` whose `application_id` matches
    - If no such ApplicationPoint exists, auto-create one with `id: generateId('apt-')`, `kind: 'APPLICATION'`, `application_id` set from the step, and `name` derived from the matching application entity's name
    - Use the JSON shape from the spec: `{ id, name, description: null, kind: 'APPLICATION', application_id, application_component_id: null, service_id: null, interface_id: null, target_type: null, target_ref_id: null, point_type: null, tags: null, valid_from: null, valid_to: null }`
    - Deduplicate by checking `entities.application_points` for any entry with matching `application_id` and `kind === 'APPLICATION'`
  - [x] 1.4 Implement BusinessUser-to-BusinessPoint relationship creation
    - For each journey in the merged model, find the journey's `primary_business_user_id`
    - Collect all activity steps belonging to that journey (matching `user_journey_id`)
    - For each unique `process_activity_id` and its parent `business_process_id`, create `business_user_business_points` relationships linking the business user to both the PROCESS_ACTIVITY-kind and BUSINESS_PROCESS-kind BusinessPoints
    - Composite dedup key: `(business_user_id, business_point_id)` -- skip if a relationship with the same pair already exists in `relationships.business_user_business_points`
    - Relationship shape: `{ id: generateId('bubp-'), business_user_id, business_point_id, description: null, tags: null, valid_from: null, valid_to: null }`
  - [x] 1.5 Implement ApplicationPoint-to-BusinessPoint relationship creation
    - For each activity step, link the step's ApplicationPoint (looked up or auto-created in 1.3) to the BusinessPoints for the step's `process_activity_id` (PROCESS_ACTIVITY kind) and `business_process_id` (BUSINESS_PROCESS kind)
    - Composite dedup key: `(application_point_id, business_point_id)` -- skip if a relationship with the same pair already exists in `relationships.application_point_business_points`
    - Relationship shape: `{ id: generateId('apbp-'), application_point_id, business_point_id, description: null, tags: null, valid_from: null, valid_to: null }`
  - [x] 1.6 Handle edge case: activity steps with no parent business process
    - When a `process_activity` has no `business_process_id` (null/undefined), fall back to looking up the "Unassigned" business process in `entities.business_processes`
    - If an "Unassigned" business process exists, use its ID for the BusinessPoint's `business_process_id`; otherwise skip the BUSINESS_PROCESS-kind BusinessPoint creation for that step
    - This is consistent with the existing journey save pipeline pattern for unassigned processes
  - [x] 1.7 Update the save response summary to include auto-derived counts
    - Extend the `autoCreatedEntities` section of the response summary to include counts for `businessPoints`, `applicationPoints`, `businessUserBusinessPointRelationships`, and `applicationPointBusinessPointRelationships`
    - These counts help callers (the agent) understand what was derived
  - [x] 1.8 Ensure auto-derivation tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all entity and relationship arrays are populated correctly
    - Verify dedup and idempotency behavior
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 1.1 pass
- After saving user journeys with activity steps, `entities.business_points` contains both BUSINESS_PROCESS and PROCESS_ACTIVITY-kind BusinessPoints with correct `bpt_` IDs
- `entities.application_points` contains APPLICATION-kind ApplicationPoints for all referenced applications
- `relationships.business_user_business_points` links each journey's business user to derived BusinessPoints
- `relationships.application_point_business_points` links each step's ApplicationPoint to its BusinessPoints
- Re-saving the same data does not create duplicates (idempotent)
- The `bpt_` ID convention matches the existing pattern in `usersInteractionsService.ts`

---

### Frontend Types and Shared Contracts

#### Task Group 2: Extend TypeScript Types for Overview Enhancements
**Dependencies:** None (can run in parallel with Task Group 1)
**Files:** `frontend/src/types/userJourneyOverviewDiagram.ts`

- [x] 2.0 Complete TypeScript type extensions for overview enhancements
  - [x] 2.1 Write 3 focused tests for type correctness
    - Test 1: Verify `UserJourneyOverviewDiagramDto` accepts optional `related_colleagues` field with the correct shape
    - Test 2: Verify `RelatedColleagueDto` interface has `business_user_id`, `business_user_name`, and `has_overview` fields
    - Test 3: Verify `UserJourneyOverviewDiagramRendererProps` accepts optional `onColleagueClick` callback prop
  - [x] 2.2 Add `RelatedColleagueDto` interface
    - Define in `userJourneyOverviewDiagram.ts`: `{ business_user_id: string; business_user_name: string; has_overview: boolean }`
  - [x] 2.3 Extend `UserJourneyOverviewDiagramDto` with optional fields
    - Add `related_colleagues?: RelatedColleagueDto[]` to the top-level DTO interface
    - This field will be populated by the frontend enrichment logic (not from the backend projection)
  - [x] 2.4 Ensure type tests pass
    - Run ONLY the 3 tests written in 2.1

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- `RelatedColleagueDto` interface is exported and usable
- `UserJourneyOverviewDiagramDto` accepts the new optional field
- No breaking changes to existing type consumers

---

### Frontend Enrichment Logic

#### Task Group 3: Frontend Data Enrichment for Summary and Colleagues
**Dependencies:** Task Group 2
**Files:** `frontend/src/components/DiagramsView/DiagramsView.tsx`, `frontend/src/components/DiagramsView/Canvas.tsx`

This task group implements the frontend computation of summary counts and related colleagues from meta-model data, extending the existing `enrichOverviewWithApps` pattern.

- [x] 3.0 Complete frontend enrichment logic for summary and colleagues data
  - [x] 3.1 Write 5 focused tests for enrichment logic
    - Test 1: Verify summary counts are correctly computed -- A = nodes.length, B = lanes excluding 'unassigned', C = sum of step_count, D = unique application IDs across all nodes' metadata.applications arrays
    - Test 2: Verify related colleagues are computed from `business_user_business_points` relationships -- find all business_point_ids for the current user, then find all OTHER business_user_ids linked to those same points
    - Test 3: Verify `has_overview` is true for colleagues that have at least one user_journey with matching `primary_business_user_id`
    - Test 4: Verify when no related colleagues exist, the enriched data contains an empty `related_colleagues` array
    - Test 5: Verify enrichment is idempotent -- enriching already-enriched data does not duplicate or corrupt values
  - [x] 3.2 Implement summary count computation in `enrichOverviewWithApps` (or a new parallel function)
    - Compute the four counts from the enriched overview data:
      - A = `dto.nodes.length` (journey count)
      - B = `dto.lanes.filter(l => l.id !== 'unassigned').length` (business process count)
      - C = sum of all `node.metadata.step_count` values
      - D = count of unique application IDs across all nodes' `metadata.applications` arrays
    - Store these counts on the DTO in a format accessible to the renderer (e.g., as properties on the `overview` header or as a new `summary` sub-object on the DTO)
    - The summary sentence string itself can be composed in the renderer or pre-composed here
  - [x] 3.3 Implement related colleagues computation from meta-model data
    - Read `state.model.metaModel.relationships.business_user_business_points` to find all `business_point_id` values linked to the current overview's `business_user_id` (from `dto.overview.business_user_id`)
    - Find all OTHER `business_user_id` values linked to any of those same `business_point_id` values
    - Resolve colleague names from `state.model.metaModel.entities.business_users`
    - Determine `has_overview` for each colleague by checking whether any `entities.user_journeys` has that colleague's ID as `primary_business_user_id`
    - Return array of `{ business_user_id, business_user_name, has_overview }` sorted alphabetically by name
  - [x] 3.4 Apply enrichment in DiagramsView.tsx at all overview render sites
    - Extend the `enrichOverviewWithApps` callback (or create a new `enrichOverviewFull` callback) to include both summary and colleagues computation
    - Apply at line 4180 (journey review overview), line 4233 (standalone overview review), and any other sites that call `enrichOverviewWithApps`
    - Pass `state.model.metaModel` data as input for the colleague computation
  - [x] 3.5 Apply enrichment in Canvas.tsx at the saved-diagram render site
    - Extend the inline enrichment block at lines 3642-3657 in Canvas.tsx to include the same summary and colleagues computation
    - Access `state.model.metaModel.relationships.business_user_business_points` and `entities.business_users` / `entities.user_journeys` for colleague resolution
  - [x] 3.6 Ensure enrichment tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify correct counts and colleague resolution

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Overview DTOs passed to the renderer include computed summary counts and related_colleagues data
- Enrichment works consistently across all three render sites (Canvas saved diagram, DiagramsView journey review, DiagramsView standalone overview review)
- Colleague computation correctly traverses the business_user -> business_point -> other_business_user graph

---

### Frontend Renderer

#### Task Group 4: Overview Diagram Renderer - Summary Sentence and Colleagues Navigation
**Dependencies:** Task Groups 2 and 3
**Files:** `frontend/src/components/DiagramsView/UserJourneyOverviewDiagramRenderer.tsx`, `frontend/src/components/DiagramsView/DiagramsView.tsx`, `frontend/src/components/DiagramsView/Canvas.tsx`

This task group extends the SVG renderer to display the summary sentence and colleagues navigation line, and wires up click-to-navigate for colleague names.

- [x] 4.0 Complete renderer enhancements for summary and colleagues display
  - [x] 4.1 Write 8 focused tests for renderer enhancements
    - Test 1: Verify summary sentence text element is rendered below the title when `showTitle` is true, containing the expected counts format
    - Test 2: Verify summary sentence is NOT rendered when `showTitle` is false (guarded by `showTitle` render hint)
    - Test 3: Verify related colleagues line is rendered above the title with "Related: Name1, Name2, ..." format
    - Test 4: Verify colleague names with `has_overview: true` are rendered as clickable (blue #1976D2, underline, pointer cursor)
    - Test 5: Verify colleague names with `has_overview: false` are rendered as plain gray text (#888)
    - Test 6: Verify clicking a clickable colleague name invokes the `onColleagueClick` callback with the correct `business_user_id`
    - Test 7: Verify "No related colleagues defined yet" message is rendered in gray italic when no colleagues exist
    - Test 8: Verify layout computation correctly shifts baseY downward to account for SUMMARY_HEIGHT and COLLEAGUES_HEIGHT, so lanes and nodes do not overlap the new text elements
  - [x] 4.2 Add new layout constants for summary and colleagues heights
    - Add `SUMMARY_HEIGHT = 24` constant
    - Add `COLLEAGUES_HEIGHT = 28` constant
    - Add `SUMMARY_FONT_SIZE = 13` constant
    - Add `COLLEAGUES_FONT_SIZE = 13` constant
  - [x] 4.3 Extend `computeLayout()` to account for new vertical space
    - Modify the `titleOffset` calculation to include `COLLEAGUES_HEIGHT` when colleagues data is present (or always reserve the space for consistency)
    - Add `SUMMARY_HEIGHT` to the vertical offset when `showTitle` is true
    - Shift `baseY` downward so that lane headers and nodes are pushed below the new text elements
    - Update the function signature to accept flags/data indicating whether summary and colleagues should be rendered
    - Vertical spacing order: `CANVAS_PADDING_TOP -> colleagues line -> 8px gap -> title -> 4px gap -> summary sentence -> 8px gap -> lane headers`
  - [x] 4.4 Implement `renderColleaguesLine()` sub-renderer
    - Render above the title position in the SVG
    - Format: "Related: {Name1}, {Name2}, ..." as a horizontal line of text
    - For colleagues with `has_overview: true`: render with `fill="#1976D2"`, `textDecoration="underline"`, `cursor="pointer"`, and attach an `onClick` handler that calls `onColleagueClick(colleague.business_user_id)`
    - For colleagues with `has_overview: false`: render with `fill="#888"`, no underline, default cursor
    - Use `<text>` elements with appropriate `x` positioning to lay out names horizontally (use `<tspan>` elements within a single `<text>` or multiple `<text>` elements with computed x-offsets)
    - When no related colleagues exist, render "No related colleagues defined yet" in gray italic at the same position
    - Add `data-testid="overview-colleagues-line"` for testing
  - [x] 4.5 Implement `renderSummary()` sub-renderer
    - Render below the title and above the lane/column headers
    - Compose the sentence: `"{business_user_name} is involved in {A} User Journeys across {B} Business Processes, {C} Activity Steps and {D} Applications"`
    - Style: same font-family as the title, font size 13-14px, `fill="#555"`, normal weight
    - Guard with `showTitle` render hint -- only render when `showTitle` is true
    - Add `data-testid="overview-summary"` for testing
  - [x] 4.6 Add `onColleagueClick` prop to the renderer component
    - Extend `UserJourneyOverviewDiagramRendererProps` with `onColleagueClick?: (businessUserId: string) => void`
    - Pass the callback through to `renderColleaguesLine()` for click handler wiring
  - [x] 4.7 Integrate new sub-renderers into the main component JSX
    - In the main return block of the component (around line 896), add the colleagues line rendering call before the title
    - Add the summary sentence rendering call after the title and before the lanes
    - Ensure the rendering order is: defs -> colleagues line -> title -> summary -> lanes -> edges -> nodes
  - [x] 4.8 Wire `onColleagueClick` in DiagramsView.tsx
    - At all three `<UserJourneyOverviewDiagramRenderer>` render sites (journey review ~line 4179, standalone overview review ~line 4232, and the overview selector flow), pass an `onColleagueClick` prop
    - The handler should call `fetchTemporaryUserJourneyOverviewDiagram` with the colleague's `business_user_id` and replace the current overview with the result
    - In the journey review context: update `journeyReview` state with the new overview data
    - In the standalone overview review context: update `overviewReview` state with the new overview data
  - [x] 4.9 Wire `onColleagueClick` in Canvas.tsx
    - At the saved-diagram render site (~line 3659), pass an `onColleagueClick` prop
    - Since saved diagrams use the static Canvas view, the handler should trigger a temporary overview fetch for the clicked colleague and navigate to the overview review flow
    - Alternatively, show a toast indicating that colleague navigation requires the live projection mode (acceptable fallback per spec scope -- colleague navigation on saved/static diagrams is out of scope)
  - [x] 4.10 Ensure renderer tests pass
    - Run ONLY the 8 tests written in 4.1
    - Verify visual elements are correctly positioned
    - Verify click handlers are wired

**Acceptance Criteria:**
- The 8 tests written in 4.1 pass
- Summary sentence renders below the title with correct counts and the specified format
- Colleagues line renders above the title with clickable/non-clickable names styled correctly
- Clicking a clickable colleague name triggers overview navigation for that colleague
- "No related colleagues defined yet" renders when the array is empty
- Layout correctly accounts for new vertical space -- no overlapping of text, title, summary, and lane headers
- Summary sentence is guarded by the `showTitle` render hint

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 6 tests written by Task Group 1 (MCP pipeline derivation)
    - Review the 3 tests written by Task Group 2 (TypeScript types)
    - Review the 5 tests written by Task Group 3 (frontend enrichment)
    - Review the 8 tests written by Task Group 4 (renderer enhancements)
    - Total existing tests: 22 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Check that the full pipeline flow (save journeys -> derivation -> overview enrichment -> render) has at least one integration-level test
    - Check that the colleague navigation click-through workflow is tested
    - Focus ONLY on gaps related to these three enhancements
  - [x] 5.3 Write up to 10 additional strategic tests maximum to fill gaps
    - Potential gap: Integration test verifying that after `save_user_journeys` creates BusinessPoints, the frontend enrichment correctly resolves colleagues from those relationships
    - Potential gap: Edge case where a business user has no activity steps (empty journey) -- verify no errors and empty/default outputs
    - Potential gap: Colleague navigation round-trip -- clicking a colleague fetches their overview, and clicking back navigates to the original user's overview
    - Potential gap: Summary sentence with zero values (0 apps, 0 processes) renders gracefully
    - Potential gap: Large number of colleagues (>10) renders without layout overflow issues
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests and accessibility tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 22-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22-32 tests total)
- Critical user workflows for these three enhancements are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 (MCP Pipeline)** and **Task Group 2 (Types)** -- these have no dependencies and can execute in parallel
   - Task Group 1 adds the backend derivation logic that creates the BusinessPoint/ApplicationPoint entities and relationships that the frontend will later consume
   - Task Group 2 defines the TypeScript interfaces that the frontend enrichment and renderer will use
2. **Task Group 3 (Frontend Enrichment)** -- depends on Task Group 2 for types
   - Implements the meta-model traversal logic that computes summary counts and resolves colleague data
3. **Task Group 4 (Renderer)** -- depends on Task Groups 2 and 3
   - Extends the SVG renderer with visual elements and click interactions
   - Wires the `onColleagueClick` prop through DiagramsView.tsx and Canvas.tsx
4. **Task Group 5 (Test Review)** -- depends on all prior groups
   - Reviews coverage and fills critical gaps

```
Task Group 1 (MCP Pipeline) --------\
                                      +---> Task Group 3 (Enrichment) ---> Task Group 4 (Renderer) ---> Task Group 5 (Tests)
Task Group 2 (Types) ---------------/
```

## Key Implementation Notes

- **ID Convention**: BusinessPoint IDs use the `bpt_{entityId}` convention matching `usersInteractionsService.ts` lines 228-242. This is critical for dedup across the two pipelines.
- **Insertion Point**: The derivation logic in `userJourneysService.ts` goes between line 846 (`base.metaModel.relationships.user_journey_links = mergedLinks`) and line 849 (`ensureAbbreviations(base)`), operating on the fully merged `base.metaModel` object.
- **Three Render Sites**: The overview renderer is used in three places: Canvas.tsx (saved diagrams), DiagramsView.tsx journey review mode, and DiagramsView.tsx standalone overview review mode. All three must receive enriched data and the `onColleagueClick` prop.
- **Frontend-First for Colleagues**: The spec prefers frontend computation from `state.model.metaModel` data, consistent with the existing `enrichOverviewWithApps` pattern. No backend projection changes are required.
- **Out of Scope**: No new database migrations, no changes to `usersInteractionsService.ts`, no new backend REST endpoints, no colleague navigation on saved/static diagrams.
