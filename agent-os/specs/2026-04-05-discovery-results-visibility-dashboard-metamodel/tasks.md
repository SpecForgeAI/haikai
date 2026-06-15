# Task Breakdown: Discovery Results Visibility (Dashboard + Meta-Model)

## Overview
Total Tasks: 43
Increment: 12 of 16 (Legacy/Current-State Discovery Capability)

This spec adds read-only visibility of discovery outputs across the Dashboard and Meta-Model views. It spans four layers: backend summary endpoint, gateway proxy routes, frontend API client, and frontend UI components (Dashboard discovery card, run detail view, candidate listing, and Meta-Model discovery-origin badges).

## Task List

### Backend Layer

#### Task Group 1: Backend Discovery Summary Endpoint and Cross-Project Mapping Query
**Dependencies:** None (builds on existing DiscoveryRun, DiscoveryCandidate, and DiscoveryCandidateEntityMapping JPA stacks from Increments 5, 7, 10, 11)

- [x] 1.0 Complete backend discovery summary endpoint and cross-project entity mapping query
  - [x] 1.1 Write 4-6 focused tests for the new backend endpoints
    - Test that the summary endpoint returns latest run info, candidate counts by status, entity mapping count, and coverage counts for a project with discovery data
    - Test that the summary endpoint returns a sensible empty/default response when no discovery runs exist for a project
    - Test that the cross-project entity mapping query returns all mappings across all runs for a project (not scoped to a single run)
    - Test that the cross-project entity mapping query returns an empty list when no mappings exist
    - Test that candidate count-by-status aggregation correctly groups proposed/accepted/rejected/merged counts
    - (Optional) Test that coverage count returns the number of distinct entity types with at least one mapping
  - [x] 1.2 Add `findByRunIdIn` method to `DiscoveryCandidateEntityMappingRepository`
    - New derived query: `List<DiscoveryCandidateEntityMappingEntity> findByRunIdIn(Collection<UUID> runIds)`
    - This enables fetching all mappings across all runs for a project in one query (given run IDs from the run repository)
  - [x] 1.3 Add cross-project query method to `DiscoveryCandidateEntityMappingService`
    - New method: `getByProjectRunIds(List<UUID> runIds)` that calls `findByRunIdIn` and maps to DTOs
    - This is the service-layer building block for both the summary endpoint and the origin-entities endpoint
  - [x] 1.4 Add `countByRunIdAndStatus` or equivalent aggregation queries to `DiscoveryCandidateRepository`
    - New derived query: `long countByRunIdAndStatus(UUID runId, String status)`
    - Enables per-status candidate counts for the summary response
  - [x] 1.5 Create `DiscoverySummaryDto` record
    - Fields: `latestRunId` (UUID), `latestRunStatus` (String), `latestRunCreatedAt` (String), `totalCandidates` (long), `candidateCountsByStatus` (Map<String, Long>), `entitiesSaved` (long), `entityTypeCoverage` (int)
    - Location: `model/dto/DiscoverySummaryDto.java`
    - Use `@JsonProperty` with snake_case names following the existing DTO convention
  - [x] 1.6 Create `DiscoverySummaryService`
    - New service class that composes `DiscoveryRunService`, `DiscoveryCandidateService`, and `DiscoveryCandidateEntityMappingService` to build a `DiscoverySummaryDto`
    - Logic: fetch latest run for project, count candidates by status for that run, count entity mappings across all runs, count distinct entity types from mappings
    - Return a null/empty DTO gracefully when no runs exist
  - [x] 1.7 Create `DiscoverySummaryController`
    - New `@RestController` at `/api/model/projects/{projectId}/discovery/summary`
    - Single `GET` endpoint returning `DiscoverySummaryDto`
    - Follows existing pattern from `DiscoveryRunController` (ConditionalOnProperty, RequiredArgsConstructor, Slf4j)
  - [x] 1.8 Add project-scoped entity origin endpoint to `DiscoveryCandidateEntityMappingController`
    - New `GET /api/model/projects/{projectId}/discovery/entity-origins` endpoint
    - Fetches all run IDs for the project, then fetches all mappings for those runs
    - Returns `List<DiscoveryCandidateEntityMappingDto>` (the existing DTO has entityType and entityId fields needed for badge matching)
    - This avoids requiring the frontend to know individual run IDs to look up origin data
  - [x] 1.9 Ensure backend tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify new repository methods, service logic, and controller endpoints function correctly
    - Do NOT run the entire backend test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `GET /api/model/projects/{projectId}/discovery/summary` returns correct aggregated metrics
- `GET /api/model/projects/{projectId}/discovery/entity-origins` returns all mappings across runs for a project
- Empty/no-data cases return graceful empty responses (not errors)
- All new code follows existing ConditionalOnProperty/RequiredArgsConstructor/Slf4j patterns

---

### Gateway Layer

#### Task Group 2: Gateway Proxy Routes for Discovery Read Endpoints
**Dependencies:** Task Group 1

- [x] 2.0 Complete gateway discovery proxy routes
  - [x] 2.1 Write 5-8 focused tests for the new gateway routes
    - Test that `GET /api/v1/discovery/projects/:projectId/runs` proxies to the architecture-model-service list-runs endpoint and returns the response
    - Test that `GET /api/v1/discovery/projects/:projectId/runs/:runId` proxies to the architecture-model-service get-run endpoint
    - Test that `GET /api/v1/discovery/projects/:projectId/runs/:runId/candidates` proxies to the architecture-model-service list-candidates endpoint (with optional type/status query params forwarded)
    - Test that `GET /api/v1/discovery/projects/:projectId/runs/:runId/candidates/count` proxies to the count endpoint
    - Test that `GET /api/v1/discovery/projects/:projectId/summary` proxies to the new backend summary endpoint
    - Test that `GET /api/v1/discovery/projects/:projectId/entity-origins` proxies to the new backend entity-origins endpoint
    - Test that network failure to backend returns 503 with structured error (following existing pattern)
    - (Optional) Test that `GET /api/v1/discovery/projects/:projectId/runs/:runId/candidate-entity-mappings` proxies correctly
  - [x] 2.2 Add project-scoped read-only GET routes to `gateway/src/routes/discovery.ts`
    - `GET /projects/:projectId/runs` -- proxy to `GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/discovery/runs`
    - `GET /projects/:projectId/runs/:runId` -- proxy to `GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/discovery/runs/:runId`
    - `GET /projects/:projectId/runs/:runId/candidates` -- proxy to backend, forwarding `type` and `status` query params
    - `GET /projects/:projectId/runs/:runId/candidates/count` -- proxy to backend count endpoint
    - `GET /projects/:projectId/runs/:runId/candidate-entity-mappings` -- proxy to backend mappings endpoint
    - Follow the existing fetch-and-forward proxy pattern from the POST /runs and GET /runs/:runId handlers already in discovery.ts
    - Use `architectureModelServiceBaseUrl` from config (not `discoveryServiceBaseUrl`) since these read persisted data from the architecture-model-service
  - [x] 2.3 Add discovery summary proxy route
    - `GET /projects/:projectId/summary` -- proxy to `GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/discovery/summary`
    - Returns the `DiscoverySummaryDto` from the backend
  - [x] 2.4 Add discovery entity-origins proxy route
    - `GET /projects/:projectId/entity-origins` -- proxy to `GET {architectureModelServiceBaseUrl}/api/model/projects/:projectId/discovery/entity-origins`
    - Returns the list of entity mappings for badge display
  - [x] 2.5 Ensure all new routes use consistent error handling
    - Network errors: 503 with `{ error: { code: 503, message: 'Architecture model service unavailable' } }`
    - Unexpected errors: 500 with `{ error: { code: 500, message: 'Internal server error' } }`
    - Follow the exact try/catch nesting pattern from existing routes in discovery.ts
  - [x] 2.6 Ensure gateway tests pass
    - Run ONLY the 5-8 tests written in 2.1
    - Verify all proxy routes forward requests and responses correctly
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 5-8 tests written in 2.1 pass
- All 7 new GET routes proxy correctly to the architecture-model-service
- Query parameters (type, status) are forwarded transparently
- Error responses follow the established 503/500 pattern
- No mutation (POST/PUT/DELETE) routes are added in this increment

---

### Frontend API Client

#### Task Group 3: Frontend Discovery API Client
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend discovery API client
  - [x] 3.1 Write 3-5 focused tests for the API client functions
    - Test that `getDiscoveryRunSummary` fetches from the correct URL with projectId and returns typed response
    - Test that `getDiscoveryRuns` fetches the runs list for a project
    - Test that `getDiscoveryCandidates` fetches candidates for a run with optional type/status params
    - Test that `getDiscoveryOriginEntities` fetches entity-origin mappings for a project
    - Test that fetch failures (non-ok response) throw an appropriate error
  - [x] 3.2 Create TypeScript interfaces for discovery DTOs
    - `DiscoveryRunSummaryDto`: `latestRunId`, `latestRunStatus`, `latestRunCreatedAt`, `totalCandidates`, `candidateCountsByStatus`, `entitiesSaved`, `entityTypeCoverage`
    - `DiscoveryRunDto`: `id`, `project_id`, `status`, `current_step`, `config_snapshot`, `steps_payload`, `error_message`, `created_at`, `updated_at`
    - `DiscoveryCandidateDto`: `id`, `run_id`, `candidate_type`, `name`, `confidence`, `status`, `source_cluster_ids`, `data`, `synthesized_at`, `parent_candidate_id`
    - `DiscoveryCandidateEntityMappingDto`: `id`, `candidate_id`, `run_id`, `entity_type`, `entity_id`, `action`, `created_at`
    - Location: `frontend/src/api/discoveryApi.ts` (co-located with the API functions, following the dashboardApi.ts pattern)
  - [x] 3.3 Implement API client functions in `frontend/src/api/discoveryApi.ts`
    - `getDiscoveryRunSummary(projectId: string): Promise<DiscoveryRunSummaryDto>` -- calls `GET /api/v1/discovery/projects/:projectId/summary`
    - `getDiscoveryRuns(projectId: string): Promise<DiscoveryRunDto[]>` -- calls `GET /api/v1/discovery/projects/:projectId/runs`
    - `getDiscoveryRun(projectId: string, runId: string): Promise<DiscoveryRunDto>` -- calls `GET /api/v1/discovery/projects/:projectId/runs/:runId`
    - `getDiscoveryCandidates(projectId: string, runId: string, type?: string, status?: string): Promise<DiscoveryCandidateDto[]>` -- calls `GET /api/v1/discovery/projects/:projectId/runs/:runId/candidates` with optional query params
    - `getDiscoveryCandidateCount(projectId: string, runId: string): Promise<{ count: number }>` -- calls the count endpoint
    - `getDiscoveryOriginEntities(projectId: string): Promise<DiscoveryCandidateEntityMappingDto[]>` -- calls `GET /api/v1/discovery/projects/:projectId/entity-origins`
    - Use `GATEWAY_BASE` pattern from `dashboardApi.ts`: `const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? ''`
  - [x] 3.4 Ensure API client tests pass
    - Run ONLY the 3-5 tests written in 3.1
    - Verify URL construction and response parsing for all functions
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 3.1 pass
- All 6 API functions are exported and correctly typed
- URL patterns match the gateway routes from Task Group 2
- Error handling follows the same throw-on-non-ok pattern as dashboardApi.ts

---

### Frontend UI Components

#### Task Group 4: Dashboard Discovery Summary Card
**Dependencies:** Task Group 3

- [x] 4.0 Complete Dashboard discovery summary card
  - [x] 4.1 Write 3-5 focused tests for the discovery card in DashboardView
    - Test that the discovery card renders within the Strategic Foundation > Technical sub-section with correct title and icon
    - Test that the card displays latest run status and key metrics (total candidates, entities saved, entity type coverage) when summary data is available
    - Test that the card renders a disabled/empty state (similar to Summary Insight "AI insights coming soon" pattern) when no discovery runs exist
    - Test that the "Open" action button is present and triggers the expected navigation/state change to show the run detail view
    - (Optional) Test that discovery data fetch failure does not break the rest of the Dashboard (non-blocking fetch)
  - [x] 4.2 Add discovery summary data fetching to DashboardView
    - Add a new state variable: `discoveryData: DiscoveryRunSummaryDto | null`
    - Fetch via `getDiscoveryRunSummary(activeProject.id)` in the existing `fetchData` callback
    - Fetch in parallel with the existing `getDashboardSummary` call (non-blocking: catch errors and set discoveryData to null on failure)
    - Do NOT fail the entire dashboard if the discovery fetch fails
  - [x] 4.3 Add the Discovery Summary card to the Technical sub-section in DashboardView
    - Place it after the Test Strategy card within the Technical `subSectionGroup`
    - Card structure follows the existing pattern: `styles.card`, `styles.cardHeader` (icon, title, "Open" button), `styles.cardMetrics` (renderMetric pills)
    - Metrics to display: "Status: [latestRunStatus]", "Candidates: [totalCandidates]", "Entities Saved: [entitiesSaved]", "Coverage: [entityTypeCoverage] types"
    - data-testid: `card-discovery-summary`
  - [x] 4.4 Implement the disabled/empty state for the discovery card
    - When `discoveryData` is null or `latestRunId` is null, render the card with `styles.cardDisabled` class
    - Show "Discovery results coming soon" text in the `styles.disabledText` div (matching the Summary Insight empty-state pattern)
    - The "Open" button should be absent or disabled in the empty state
  - [x] 4.5 Wire the "Open" button to show the discovery run detail view
    - Add local state: `showDiscoveryDetail: boolean` (default false)
    - The "Open" button sets `showDiscoveryDetail` to true
    - When `showDiscoveryDetail` is true, render the `DiscoveryRunDetailView` component instead of (or overlaid on) the normal dashboard content
    - Pass `projectId` and a `onClose` callback that sets `showDiscoveryDetail` back to false
  - [x] 4.6 Ensure discovery card tests pass
    - Run ONLY the 3-5 tests written in 4.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 4.1 pass
- Discovery card appears in Strategic Foundation > Technical sub-section
- Card shows metrics when data is available, disabled state when no data
- Discovery data fetch failure does not break the dashboard
- "Open" button transitions to the run detail view

---

#### Task Group 5: Discovery Run Detail View and Candidate Listing
**Dependencies:** Task Groups 3, 4

- [x] 5.0 Complete discovery run detail view and candidate listing
  - [x] 5.1 Write 4-6 focused tests for the run detail and candidate listing components
    - Test that the run detail view renders a list of historical runs (most recent first) with status, date, and counts
    - Test that selecting a run displays its detail: current_step, steps_payload phases, error_message (if failed), and candidate/entity counts
    - Test that the candidate listing table renders rows with name, candidate_type, confidence, status, and synthesized_at
    - Test that candidate rows with a parent_candidate_id display a visual parent reference (indentation or label)
    - Test that the back/close affordance returns to the normal Dashboard layout
    - (Optional) Test that empty candidate list shows a "No candidates" message
  - [x] 5.2 Create `DiscoveryRunDetailView` component
    - Location: `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`
    - Props: `projectId: string`, `onClose: () => void`
    - Fetches `getDiscoveryRuns(projectId)` on mount to populate the run history list
    - Displays runs in a simple list/table: status badge, created_at date, and summary count (candidate count fetched per run or from summary)
    - Selecting a run fetches `getDiscoveryRun(projectId, runId)` for detailed data
    - Shows the selected run's detail panel: status, current_step, steps_payload as a phase progression list, error_message if status is FAILED
    - Includes a "View Candidates" button that shows the candidate listing for the selected run
    - Includes a "Back to Dashboard" or close (X) button that calls `onClose`
  - [x] 5.3 Create `DiscoveryCandidateTable` component
    - Location: `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
    - Props: `projectId: string`, `runId: string`
    - Fetches `getDiscoveryCandidates(projectId, runId)` on mount
    - Renders a simple read-only HTML table with columns: Name, Type, Confidence, Status, Synthesized At
    - Rows with `parent_candidate_id !== null` display an indentation or "Parent: [parent name]" label
    - No inline editing, no approval buttons, no status-change controls -- strictly read-only
  - [x] 5.4 Style the run detail and candidate listing components
    - Add CSS module: `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`
    - Follow the existing DashboardView styling patterns (card layout, metric pills, section containers)
    - Run list items should have status-colored badges (green for COMPLETED, red for FAILED, yellow for RUNNING, gray for PENDING/CANCELLED)
    - Candidate table should be a clean, minimal read-only table
  - [x] 5.5 Integrate DiscoveryRunDetailView into DashboardView
    - When `showDiscoveryDetail` is true, render `<DiscoveryRunDetailView projectId={activeProject.id} onClose={() => setShowDiscoveryDetail(false)} />`
    - This replaces the normal dashboard content area (or renders as an overlay within the container)
    - Ensure the UnifiedChatPanel remains visible alongside the detail view (same dashboardLayout flex parent)
  - [x] 5.6 Ensure run detail and candidate listing tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- Run list shows all historical runs ordered by creation time descending
- Selecting a run shows its detail (phases, status, error, counts)
- Candidate table displays all candidates with correct columns
- Parent-child relationship is visually indicated
- Back/close returns to normal Dashboard view

---

#### Task Group 6: Meta-Model Discovery-Origin Badges
**Dependencies:** Task Group 3

- [x] 6.0 Complete Meta-Model discovery-origin badges on Grid entities
  - [x] 6.1 Write 3-4 focused tests for discovery-origin badge rendering
    - Test that entities matching an origin mapping display a "Discovered" badge next to their name
    - Test that entities without a matching origin mapping do not display a badge
    - Test that badge data fetch failure results in no badges shown (non-blocking, no errors surfaced)
    - (Optional) Test that clicking the badge navigates to or references the originating discovery run
  - [x] 6.2 Create a custom hook `useDiscoveryOrigins` for fetching and caching origin data
    - Location: `frontend/src/hooks/useDiscoveryOrigins.ts`
    - Accepts `projectId: string | undefined`
    - Calls `getDiscoveryOriginEntities(projectId)` on mount/projectId change
    - Returns a lookup structure: `Map<string, Set<string>>` keyed by entityType, values are Sets of entityId strings
    - Handles errors gracefully: logs a warning and returns an empty map (non-blocking)
    - Caches results to avoid re-fetching on every Grid render
  - [x] 6.3 Integrate `useDiscoveryOrigins` into the Grid's parent (MetaModelView or Grid itself)
    - Call `useDiscoveryOrigins(projectId)` at the appropriate level where the Grid is rendered
    - Pass the origin lookup map as a new optional prop to the Grid component: `discoveryOrigins?: Map<string, Set<string>>`
    - The Grid checks if `discoveryOrigins?.get(entityType)?.has(entity.id)` for each row
  - [x] 6.4 Render the "Discovered" badge in Grid entity rows
    - When a row's entity ID is found in the discoveryOrigins map for the current entityType, render a small `<span className={styles.discoveredBadge}>Discovered</span>` adjacent to the entity name cell
    - Badge styling: small text tag, distinct color (e.g., light blue/purple background), positioned inline next to the entity name
    - Add CSS class `discoveredBadge` to `Grid.module.css`
    - Badge is purely visual in this increment (optional: make it a link to the discovery run detail view in a future increment)
  - [x] 6.5 Ensure discovery-origin badge tests pass
    - Run ONLY the 3-4 tests written in 6.1
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 6.1 pass
- Entities with discovery origin show a "Discovered" badge next to their name in the Grid
- Entities without discovery origin show no badge
- Badge data fetch failure is silent (no errors, no badges)
- Badge does not interfere with existing Grid editing or drag-and-drop functionality

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4-6 backend tests from Task Group 1
    - Review the 5-8 gateway tests from Task Group 2
    - Review the 3-5 API client tests from Task Group 3
    - Review the 3-5 Dashboard discovery card tests from Task Group 4
    - Review the 4-6 run detail and candidate listing tests from Task Group 5
    - Review the 3-4 discovery-origin badge tests from Task Group 6
    - Total existing tests: approximately 22-34 tests
  - [x] 7.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end user workflows that lack test coverage
    - Focus ONLY on gaps related to discovery visibility feature requirements
    - Prioritize: (1) Dashboard card shows data after full fetch flow, (2) Run detail navigation round-trip, (3) Badge rendering with real origin data structure
    - Do NOT assess entire application test coverage
  - [x] 7.3 Write up to 10 additional strategic tests maximum
    - Focus on integration-level scenarios that cross component boundaries
    - Example gaps to consider: Dashboard fetch-error resilience (discovery fails but dashboard still renders), run detail view with a FAILED run showing error_message, candidate table with mixed parent/child hierarchy, badge lookup with multiple entity types
    - Do NOT write exhaustive edge-case tests or performance tests
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, and 7.3)
    - Expected total: approximately 32-44 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 32-44 tests total)
- Critical user workflows for this feature are covered: view summary on Dashboard, drill into run detail, inspect candidates, see badges on Grid entities
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Backend Layer** (Task Group 1) -- New summary endpoint and cross-project entity origin query. No dependencies; builds on existing JPA stacks from prior increments.
2. **Gateway Layer** (Task Group 2) -- Proxy routes to expose the backend endpoints through the gateway. Depends on Task Group 1 for the backend endpoints to proxy to.
3. **Frontend API Client** (Task Group 3) -- Typed fetch functions for all discovery read endpoints. Depends on Task Group 2 for the gateway routes.
4. **Dashboard Discovery Card** (Task Group 4) -- Summary card in DashboardView. Depends on Task Group 3 for the API client.
5. **Run Detail View and Candidate Listing** (Task Group 5) -- Drill-down views from the Dashboard card. Depends on Task Groups 3 and 4.
6. **Meta-Model Discovery-Origin Badges** (Task Group 6) -- "Discovered" badges on Grid entities. Depends on Task Group 3 for the API client. Can be parallelized with Task Groups 4 and 5.
7. **Test Review and Gap Analysis** (Task Group 7) -- Review all tests and fill critical gaps. Depends on all previous groups.

```
Task Group 1 (Backend)
    |
Task Group 2 (Gateway)
    |
Task Group 3 (Frontend API Client)
    |
    +---------------------------+
    |                           |
Task Group 4 (Dashboard Card)  Task Group 6 (Meta-Model Badges)
    |                           |
Task Group 5 (Run Detail View)  |
    |                           |
    +---------------------------+
    |
Task Group 7 (Test Review)
```

## Key Files to Create or Modify

### New Files
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/DiscoverySummaryDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/DiscoverySummaryService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoverySummaryController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/DiscoveryEntityOriginsController.java`
- `frontend/src/api/discoveryApi.ts`
- `frontend/src/api/discoveryApi.test.ts`
- `frontend/src/hooks/useDiscoveryOrigins.ts`
- `frontend/src/components/DashboardView/DiscoveryRunDetailView.tsx`
- `frontend/src/components/DashboardView/DiscoveryRunDetailView.module.css`
- `frontend/src/components/DashboardView/DiscoveryCandidateTable.tsx`
- `gateway/src/routes/__tests__/discovery.test.ts`

### Modified Files
- `architecture-model-service/.../repository/entity/DiscoveryCandidateEntityMappingRepository.java` (add findByRunIdIn)
- `architecture-model-service/.../repository/entity/DiscoveryCandidateRepository.java` (add countByRunIdAndStatus)
- `architecture-model-service/.../service/DiscoveryCandidateEntityMappingService.java` (add cross-project query)
- `gateway/src/routes/discovery.ts` (add 7 new GET routes)
- `frontend/src/components/DashboardView/DashboardView.tsx` (add discovery card, detail view toggle, discovery data fetch)
- `frontend/src/components/Grid/Grid.tsx` (add discoveryOrigins prop and badge rendering)
- `frontend/src/components/Grid/Grid.module.css` (add discoveredBadge class)
