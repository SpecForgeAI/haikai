# Specification: Discovery Results Visibility (Dashboard + Meta-Model)

## Goal
Expose discovery run outputs in a read-only manner across the Dashboard (high-level summary card) and Meta-Model view (entity-level "Discovered" badge), so users can understand what was discovered and build trust in the pipeline before refinement workflows are added.

## User Stories
- As a product owner, I want to see the latest discovery run status and summary counts on the Dashboard so that I can quickly tell whether discovery has produced useful results without navigating away.
- As an architect, I want to drill into a discovery run's detail view and see its candidates so that I can inspect what the pipeline proposed and understand its confidence levels.
- As an architect, I want to see a "Discovered" indicator on entities in the Meta-Model grid that originated from discovery so that I can distinguish organically-created entities from discovery-sourced ones.

## Specific Requirements

**Dashboard discovery summary card**
- Add a new card inside the Strategic Foundation > Technical sub-section of the existing DashboardView, following the same card pattern (cardHeader with icon/title/action button, cardMetrics with renderMetric pills)
- The card shows the latest discovery run's status (PENDING, RUNNING, COMPLETED, FAILED, CANCELLED) and key counts: total candidates generated, entities saved, and entities skipped/marked for review
- If no discovery runs exist for the project, the card renders a disabled/empty state similar to the Summary Insight card's "AI insights coming soon" pattern
- The "Open" action button on the card navigates to a discovery run detail view (see next requirement)
- Data is fetched from a new gateway endpoint and included in the dashboard data flow; fetching should be non-blocking (errors produce a graceful fallback, not a broken dashboard)

**Discovery run detail view**
- A new lightweight component rendered within the existing DashboardView layout (not a new top-level route), shown when the user clicks "Open" on the discovery card or navigates to view run history
- Displays a list of all historical runs for the project (most recent first) with status, creation date, and high-level counts per run
- Selecting a run shows its detail: phase progression (steps_payload from DiscoveryRunDto), current_step, error_message if failed, and count-based summary metrics (candidates generated, entities saved)
- From the run detail, the user can navigate to the candidate listing for that run
- A back/close affordance returns the user to the normal Dashboard layout

**Candidate listing within run detail**
- Shows candidates for the selected run in a simple read-only table: name, candidate_type, confidence, status (proposed/accepted/rejected/merged or whatever the pipeline produces), and synthesized_at
- No inline editing, no approval buttons, no status-change affordances -- strictly read-only display
- Rows should display the parent_candidate_id relationship visually (e.g., indentation or a parent reference label) when present
- The candidate count endpoint is used for the summary metric; the full list endpoint populates the table

**Discovery-origin badge on Meta-Model entities**
- In the Grid component, entities that have a corresponding entry in the candidate-entity-mapping table display a small "Discovered" badge/tag next to their name
- The badge is a lightweight visual indicator (text tag or small icon) that links back to the originating discovery run detail view
- Badge data is fetched via a new endpoint that returns entity IDs with discovery origin for the current project, keyed by entity_type and entity_id
- Fetching badge data is non-blocking; if the endpoint fails or returns empty, no badges are shown and no errors surface

**Summary metrics endpoint**
- A new project-scoped gateway read endpoint that returns count-based discovery summary metrics for the Dashboard card: latest run status, candidate counts by status, entity mapping counts, and basic coverage (number of distinct entity types with at least one saved entity from discovery)
- All counts are simple integers -- no percentages, ratios, or quality scores
- Follows the existing dashboardSummary route pattern: projectId as a required query parameter, returns a typed DTO

**Gateway read-only proxy routes for discovery data**
- New GET routes in the gateway discovery router that proxy to the existing backend controllers: list runs, get run by ID, list candidates for a run, count candidates, and list candidate-entity-mappings for a run
- The existing gateway discovery.ts already has POST /runs and GET /runs/:runId proxying to the discovery-service; new routes should proxy to the architecture-model-service backend controllers (which hold the persisted data) using the same fetch-and-forward pattern
- A new GET route for the discovery summary metrics endpoint (can be computed in the gateway from multiple backend calls, similar to how dashboardSummary.ts assembles data from multiple sources)
- A new GET route that returns discovery-origin entity IDs for a project (queries candidate-entity-mappings across all runs for the project)

**Frontend discovery API client**
- A new discoveryApi.ts file in frontend/src/api/ exporting typed fetch functions for: getDiscoveryRunSummary, getDiscoveryRuns, getDiscoveryRun, getDiscoveryCandidates, getDiscoveryCandidateCount, and getDiscoveryOriginEntities
- Uses the same GATEWAY_BASE pattern as dashboardApi.ts
- TypeScript interfaces for the response DTOs live alongside the API functions or in a dedicated types file

**Backend discovery summary query endpoint**
- A new GET endpoint on the backend (architecture-model-service) that returns aggregated discovery summary data for a project: latest run info, candidate count by status, entity mapping count, and coverage counts
- This avoids the gateway needing to make multiple sequential calls to assemble the summary
- Follows the existing controller/service/repository pattern from DiscoveryRunController and DiscoveryCandidateController

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**DashboardView.tsx -- card and section layout pattern**
- The Dashboard already renders cards within sub-section groups (Strategic Foundation > Technical) using styles.card, styles.cardHeader, styles.cardMetrics, and the renderMetric helper
- The disabled card pattern (styles.cardDisabled with fallback text) from the Summary Insight card should be reused for the empty/no-runs state
- The navigateTo helper demonstrates how to dispatch SET_VIEW and push history state for in-app navigation
- The fetchData/useCallback/useEffect data-loading pattern with cache and error handling should be followed for discovery data

**DiscoveryRunController.java and DiscoveryCandidateController.java -- existing backend endpoints**
- GET /api/model/projects/{projectId}/discovery/runs already lists all runs for a project ordered by creation time descending
- GET /api/model/projects/{projectId}/discovery/runs/{runId}/candidates already supports optional type and status query filters, and /count returns the count
- These existing endpoints serve the data needed for the run detail and candidate listing views; the gateway just needs proxy routes to reach them

**DiscoveryCandidateEntityMappingController.java -- provenance data**
- GET /api/model/projects/{projectId}/discovery/runs/{runId}/candidate-entity-mappings returns mappings between candidates and canonical entities
- The entityType and entityId fields in DiscoveryCandidateEntityMappingDto are the keys needed to match against Grid rows and display "Discovered" badges
- A new cross-run query (by projectId rather than runId) is needed to power the badge lookup efficiently

**gateway/src/routes/discovery.ts -- proxy route pattern**
- The existing discovery router demonstrates the fetch-and-forward proxy pattern: extract params, build URL to backend, call fetch with headers, parse response, forward status and body
- Error handling returns 503 for network failures and 500 for unexpected errors
- New read-only GET routes should follow this same structure but target the architecture-model-service base URL instead of discoveryServiceBaseUrl

**Grid.tsx -- entity row rendering**
- The Grid component renders entity rows with cells derived from column configs; the "Discovered" badge should be injected adjacent to the entity name cell
- The Grid receives entityType as a prop, which maps directly to the entityType field in DiscoveryCandidateEntityMappingDto for matching

## Out of Scope
- Editing, approving, or rejecting candidates (no mutation affordances in the UI)
- Manual correction or editing of discovery-sourced entities
- Re-running or triggering discovery from the UI
- Deep evidence graph visualization (atoms, relationships, clusters)
- DecisionTask inspection UI
- Log-based enrichment or AST enrichment features
- Language/version-specific analyzer packs
- Advanced filtering, searching, or sorting UX on the candidate listing (basic table presentation only)
- Percentage-based quality metrics or analytics dashboards
- A standalone top-level Discovery page or new navigation entry (all visibility is embedded within existing Dashboard and Meta-Model views)
