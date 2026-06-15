# Specification: User Journey Overview Diagram Enhancements

## Goal
Enrich the User Journey Overview Diagram with three improvements: (1) auto-derive BusinessPoint and ApplicationPoint relationships from activity step data during the MCP save pipeline, (2) render a summary sentence on the overview diagram showing counts of journeys/processes/steps/apps, and (3) show a navigational line of related colleague names (based on shared BusinessPoints) above the diagram title with click-to-navigate support.

## User Stories
- As an architecture modeler, I want BusinessPoint and ApplicationPoint relationships to be automatically created from activity step data when I save user journeys, so that the meta-model accurately reflects which users interact with which business processes and applications without manual relationship creation.
- As a stakeholder reviewing an overview diagram, I want to see a summary sentence and a list of related colleagues so that I can quickly understand the scope of a user's involvement and navigate to peer overview diagrams.

## Specific Requirements

**Auto-derive BusinessPoint entities from activity steps**
- Add derivation logic in `userJourneysService.ts` after the Step 7 merge phase (after `user_journey_links` merge on line 846) and before Step 8 `ensureAbbreviations` (line 849)
- For each activity step in the merged `entities.activity_steps`, look up the step's `process_activity_id` and find the corresponding process activity entity in `entities.process_activities` to get its `business_process_id`
- Create a BUSINESS_PROCESS-kind BusinessPoint with ID `bpt_{businessProcessId}` (matching the existing pattern in `usersInteractionsService.ts` lines 228-242), if one does not already exist in `entities.business_points`
- Create a PROCESS_ACTIVITY-kind BusinessPoint with ID `bpt_{processActivityId}` for each unique process activity referenced by activity steps, with both `business_process_id` and `process_activity_id` populated
- Deduplicate against the full `entities.business_points` array (global per project scope), skipping creation if a BusinessPoint with the same ID already exists
- BusinessPoint JSON shape: `{ id, name, description: null, kind, business_process_id, process_activity_id: null|id, tags: null, valid_from: null, valid_to: null }`

**Auto-derive ApplicationPoint entities from activity steps**
- For each activity step, look up an existing APPLICATION-kind ApplicationPoint in `entities.application_points` whose `application_id` matches the step's `application_id`
- If no such ApplicationPoint exists, auto-create one with ID generated via `generateId('apt-')`, kind `'APPLICATION'`, `application_id` set to the step's application_id, and name derived from the application entity's name
- ApplicationPoint JSON shape: `{ id, name, description: null, kind: 'APPLICATION', application_id, application_component_id: null, service_id: null, interface_id: null, target_type: null, target_ref_id: null, point_type: null, tags: null, valid_from: null, valid_to: null }`
- Deduplicate by checking existing `entities.application_points` for any entry with matching `application_id` and `kind === 'APPLICATION'`

**Auto-derive BusinessUser-to-BusinessPoint relationships**
- For each journey in the merged model, find the journey's `primary_business_user_id` and all activity steps belonging to that journey
- For each unique `process_activity_id` and its parent `business_process_id` found in those steps, create `business_user_business_points` relationships linking the business user to the PROCESS_ACTIVITY-kind and BUSINESS_PROCESS-kind BusinessPoints
- Composite dedup key: `(business_user_id, business_point_id)` -- skip if a relationship with the same pair already exists in `relationships.business_user_business_points`
- Relationship JSON shape: `{ id: generateId('bubp-'), business_user_id, business_point_id, description: null, tags: null, valid_from: null, valid_to: null }`

**Auto-derive ApplicationPoint-to-BusinessPoint relationships**
- For each activity step, link the step's ApplicationPoint (looked up or auto-created above) to the BusinessPoint for the step's `process_activity_id` (PROCESS_ACTIVITY kind) and `business_process_id` (BUSINESS_PROCESS kind)
- Composite dedup key: `(application_point_id, business_point_id)` -- skip if a relationship with the same pair already exists in `relationships.application_point_business_points`
- Relationship JSON shape: `{ id: generateId('apbp-'), application_point_id, business_point_id, description: null, tags: null, valid_from: null, valid_to: null }`

**Summary sentence on overview diagram**
- Derive four counts from the overview DTO data on the frontend (in the renderer or in the enrichment callback): A = `nodes.length` (journey count), B = `lanes.length` excluding lanes with id `'unassigned'` (business process count), C = sum of all `node.metadata.step_count` values, D = count of unique application IDs across all nodes' `metadata.applications` arrays
- Render the sentence: `"{business_user_name} is involved in {A} User Journeys across {B} Business Processes, {C} Activity Steps and {D} Applications"`
- Place below the title text and above the lane/column headers in the SVG, using the same font family as the title but at a smaller font size (approximately 13-14px)
- Add a new layout constant (e.g., `SUMMARY_HEIGHT = 24`) and shift lane/column `baseY` downward by that amount when the summary is rendered
- Guard with `showTitle` render hint: only show the summary when the title is also shown

**Related colleagues navigation line**
- Add a new optional field `related_colleagues` to the `UserJourneyOverviewDiagramDto` (or compute it on the frontend from meta-model data) containing an array of `{ business_user_id, business_user_name, has_overview: boolean }`
- Computation: from `relationships.business_user_business_points`, find all `business_point_id` values linked to the current `business_user_id`; then find all OTHER `business_user_id` values linked to any of those same `business_point_id` values; resolve their names from `entities.business_users`
- Determine `has_overview` for each colleague by checking whether any `entities.user_journeys` has that colleague's ID as `primary_business_user_id`
- Render above the title in the SVG as a horizontal line: "Related: {Name1}, {Name2}, ..." with clickable names styled in blue with underline and pointer cursor when `has_overview` is true, and plain gray text when false
- Clicking a colleague name with `has_overview: true` invokes the same fetch mechanism (`fetchTemporaryUserJourneyOverviewDiagram`) with the colleague's `business_user_id`, replacing the current overview
- Add a new prop `onColleagueClick?: (businessUserId: string) => void` to `UserJourneyOverviewDiagramRendererProps` and wire it from Canvas.tsx/DiagramsView.tsx
- Add a layout constant (e.g., `COLLEAGUES_HEIGHT = 28`) and shift title and everything below it downward when colleagues line is rendered
- When no related colleagues exist, render "No related colleagues defined yet" in gray italic text at the same position

**Compute related colleagues on the frontend**
- Prefer frontend computation from `state.model.metaModel` data to avoid backend changes, consistent with the existing app-enrichment pattern in Canvas.tsx and DiagramsView.tsx
- The enrichment should occur at the same point where `enrichOverviewWithApps` is called, extending that function or adding a parallel enrichment step
- Pass the enriched data through the existing `overviewData` prop to the renderer

**Backend projection service changes (if needed)**
- If the implementer prefers backend computation for the summary or colleagues data, extend `UserJourneyOverviewDiagramDto` with optional `summary` and `related_colleagues` fields
- Extend `UserJourneyOverviewProjectionService.projectOverview()` to query `BusinessUserBusinessPointRepository` and `BusinessPointRepository` to resolve the colleague graph
- Extend `UserJourneyOverviewHeaderDto` or add a new sub-DTO for the summary sentence data
- This approach is optional; frontend-only computation is acceptable and may be simpler

## Visual Design
No visual mockups provided. Reference the existing `UserJourneyOverviewDiagramRenderer.tsx` layout:
- The diagram renders as SVG with a title at the top, column-based lanes below, journey nodes inside lanes, and edges connecting nodes
- The summary sentence should appear as a single line of text between the title and the lane headers, in a lighter weight and smaller size than the title (approximately 13-14px, fill #555)
- The colleagues navigation line should appear above the title, using the same horizontal baseline approach, with clickable names styled like the linked node names (blue #1976D2, underline, pointer cursor) and non-clickable names in gray (#888)
- Vertical spacing: colleagues line -> ~8px gap -> title -> ~4px gap -> summary sentence -> ~8px gap -> lane headers

## Existing Code to Leverage

**`usersInteractionsService.ts` BusinessPoint creation pattern (lines 228-263)**
- Creates BUSINESS_PROCESS-kind BusinessPoints with `id: bpt_{bpId}` convention and builds `business_user_business_points` relationships from `userRefs`
- The same ID convention (`bpt_`) and JSON shape should be replicated for both BUSINESS_PROCESS and PROCESS_ACTIVITY kinds in the user journeys pipeline
- The merge strategy (push to `ensureArray(entities, 'business_points')`) should be adapted to include dedup checking since the user journeys pipeline operates on an already-merged model

**`userJourneysService.ts` save pipeline structure (lines 406-896)**
- The derivation logic should be inserted after Step 7 merge (line 846) and before Step 8 `ensureAbbreviations` (line 849), operating on the fully merged `entities` and `relationships` objects
- Uses `ensureArray()` helper for safe array access and `findEntityByName()`/`findEntityByAbbreviation()` for lookups
- The `generateId()` utility and `createEmptyModelShell()` establish the entity array names used in the JSON model

**`UserJourneyOverviewDiagramRenderer.tsx` layout computation (lines 360-514)**
- The `computeLayout()` function calculates `titleOffset`, `baseY`, and `baseX` which must be extended to account for new summary and colleagues vertical space
- The `renderTitle()` function (lines 579-593) provides the pattern for rendering additional text elements at computed positions
- The `CANVAS_PADDING_TOP`, `TITLE_HEIGHT`, and `LANE_HEADER_HEIGHT` constants control vertical positioning and should be supplemented with new constants for summary and colleagues heights

**`UserJourneyOverviewDiagramProjectionService.java` (lines 77-163)**
- Stateless projection that queries repositories and builds the DTO; can be extended to include colleague and summary data if backend approach is chosen
- Already injects `BusinessUserRepository` and `ActivityStepRepository` which are needed for colleague resolution
- Would need additional injection of `BusinessUserBusinessPointRepository` and `BusinessPointRepository` for colleague graph traversal

**`DiagramsView.tsx` overview enrichment pattern (lines 1096-1119)**
- `enrichOverviewWithApps()` demonstrates the frontend meta-model enrichment pattern: reads `state.model.metaModel.entities` to cross-reference activity steps with applications
- The same pattern should be used to compute summary counts and related colleagues from `state.model.metaModel.relationships.business_user_business_points` and `state.model.metaModel.entities.business_users`

## Out of Scope
- Modifying the `save_users_interactions` pipeline in `usersInteractionsService.ts` -- that pipeline already creates BUSINESS_PROCESS-kind BusinessPoints; this spec only adds derivation to the `save_user_journeys` pipeline
- Creating new backend REST endpoints for colleague navigation -- reuse the existing `fetchTemporaryUserJourneyOverviewDiagram` API
- Adding search or filtering to the colleagues list
- Persisting the summary sentence or colleagues data in saved diagram content -- these are computed at render time
- Adding colleague navigation to saved/static overview diagrams (only the temporary/live-projected overview supports navigation)
- Modifying the individual User Journey diagram renderer or its save pipeline
- Adding tooltips or hover effects to the summary sentence or colleague names
- Creating new database migration scripts -- the BusinessPoint and ApplicationPoint entities and relationship tables already exist
- Adding unit tests for the backend projection service changes (tests for the MCP pipeline derivation logic and frontend rendering are in scope)
- Handling the edge case where a process activity has no parent business process -- fall back to the "Unassigned" business process for the BusinessPoint's `business_process_id`, consistent with the existing journey save pipeline pattern
