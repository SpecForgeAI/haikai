# Requirements: User Journey Overview Diagram Enhancements

## Enhancement 1: Auto-derive Business Point Relationships from Activity Steps

### Placement in Save Pipeline
- Add the auto-derivation logic at the end of the merge phase in `userJourneysService.ts` (after step 7 merge, before step 8 abbreviations), following the same patterns as `usersInteractionsService.ts`. Use the cleanest approach that fits the existing pipeline.

### BusinessPoint Creation Conventions
- Use `bpt_{id}` convention for all BusinessPoint IDs, matching the existing pattern:
  - `bpt_{businessProcessId}` for BUSINESS_PROCESS kind (already exists)
  - `bpt_{processActivityId}` for PROCESS_ACTIVITY kind (new)

### ApplicationPoint Lookup & Auto-creation
- Look up APPLICATION-kind ApplicationPoint whose `application_id` matches the activity step's `application_id`
- If no such ApplicationPoint exists, **auto-create** one (following the derived ApplicationPoint pattern)

### Deduplication
- **Global per project** scope: check the entire model's relationship arrays, not just the current save batch
- Skip creating if a relationship with the same composite key already exists

### Idempotency
- Follow the **upsert** pattern: check if a relationship with the same composite key exists, skip/update rather than append on re-save

### Relationships Created
- **BusinessUser <-> BusinessPoint**: Link the journey's primary business user to each BusinessPoint derived from their activity steps' business processes and process activities
- **ApplicationPoint <-> BusinessPoint**: Link each activity step's application (via its ApplicationPoint) to the BusinessPoint for the step's parent process activity/business process

## Enhancement 2: Summary Sentence on Overview Diagram

### Data Source
- Derive counts from **meta-model counts** (the existing overview DTO data):
  - A = count of nodes in the overview (all journeys for this business user)
  - B = count of lanes (unique business processes, excluding the "Unassigned" lane)
  - C = sum of all `step_count` values across all nodes
  - D = count of unique applications across ALL activity steps for this user's journeys

### Computation Location
- **Whatever is easiest** — frontend derivation from enriched overview data is acceptable, or backend if cleaner. Implementer decides.

### Sentence Format
- "A [User name] is involved in [A] User Journeys across [B] Business Processes, [C] Activity Steps and [D] Applications"

### Visual Style
- **Same style** as existing title but smaller font size
- Rendered below the title and above the lane/column headers

## Enhancement 3: Related Colleagues Navigation

### Definition of Related Colleague
- Find all `business_point_ids` linked to the current `business_user_id` via `business_user_business_points` relationships
- Find all OTHER `business_user_ids` linked to any of those same `business_point_ids`
- Display their `business_user.name` values

### Interactivity
- **Clickable if an overview diagram exists** for that colleague
- Clicking navigates to the colleague's overview diagram (calling the same projection endpoint with the colleague's business user ID)
- Non-clickable (plain text) if no overview exists for that colleague

### Placement
- **Above the title** of the overview diagram

### Data Source
- **Whatever is easiest and consistent** with existing patterns — backend projection service or frontend meta-model traversal. Implementer decides.

### Edge Case: No Related Colleagues
- Show **"No related colleagues defined yet"** message

## General Scope Decisions

### Scope
- Implementer decides the precise scope boundaries based on what makes sense
- The existing `save_users_interactions` pipeline may or may not need changes — use judgment
- Focus on the three enhancements described above
- Follow existing patterns and conventions throughout

## Visual Assets
- No visual mockups provided
- Reference the existing `UserJourneyOverviewDiagramRenderer.tsx` for layout patterns

## Existing Code References
- `usersInteractionsService.ts` BusinessPoint creation pattern (lines 228-263) — model for derivation logic
- `UserJourneyOverviewDiagramProjectionService.java` — extending the DTO contract
- `UserJourneyOverviewDiagramRenderer.tsx` — layout computation for new visual elements
