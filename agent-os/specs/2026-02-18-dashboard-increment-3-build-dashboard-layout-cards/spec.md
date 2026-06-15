# Specification: Dashboard Increment 3 -- Build Dashboard Layout + Cards (Wired to Mock Summary Endpoint)

## Goal

Replace the placeholder DashboardView with a full 3-section layout (Header Summary, Strategic Foundation, Detailed Definition & Delivery) containing 10 metric cards, wired to the existing `GET /api/dashboard/summary` mock endpoint. This increment also updates the backend DTO to add missing card fields and removes `MetricCard.status`.

## User Stories

- As a user, I want to see a dashboard overview of my project so that I can quickly understand progress across strategic foundation, pre-coding, and post-coding areas.
- As a user, I want to click a card's action link so that I navigate directly to the relevant area of the application (Product & Delivery tabs, Architecture & Design view).

## Specific Requirements

**Backend DTO Updates (gateway types, frontend types, mock service)**
- Remove the `status` field from the `MetricCard` interface in both `gateway/src/types/dashboard.ts` and `frontend/src/types/dashboard.ts` so MetricCard has only `label` and `value`
- Update the `card()` helper function in `gateway/src/services/dashboardSummaryMockService.ts` to drop the third `status` parameter
- Add a `standards` field of type `MetricCard` to `StrategicFoundationSection` with sub-fields `companyStandards: MetricCard` and `productStandards: MetricCard` (use a new `StandardsMetrics` interface with these two fields)
- Add new fields to `DashboardHeader`: `initiativesCount: number`, `epicsCount: number`, `activeEpicsCount: number`, `storiesInProgressCount: number`, `lastUpdatedLabel: string`, `mode: string` (value "GREENFIELD" in mock)
- Restructure `DetailedDefinitionAndDeliverySection` to have `preCoding` and `postCoding` sub-objects; `preCoding` contains: `backlog: BacklogMetrics`, `detailedArchitecture: DetailedArchitectureMetrics`, `testingSuite: TestingSuiteMetrics`; `postCoding` contains: `implementation: MetricCard`, `verification: VerificationMetrics`, `summaryInsight: SummaryInsight`
- Define `BacklogMetrics` with fields: `epicsInScope`, `featuresCount`, `storiesCount`, `storiesWithAcceptanceCriteriaCount` (all `MetricCard`)
- Define `TestingSuiteMetrics` with fields: `endToEndTestCount`, `functionalTestCount` (all `MetricCard`)
- Define `VerificationMetrics` with fields: `storiesVerifiedCount`, `pendingReviewCount` (all `MetricCard`)
- Update `ProductDefinition` card type to include: `state: MetricCard`, `missionExists: MetricCard`, `lastUpdatedLabel: MetricCard`

**Restructure Roadmap and HLA Card Metrics**
- Roadmap card metrics: `state: MetricCard`, `initiativesCount: MetricCard`, `epicsCount: MetricCard`, `epicsCompletedCount: MetricCard`; replace the current single `roadmap: MetricCard` with a `RoadmapMetrics` interface containing these fields
- HLA card: keep existing `HighLevelArchitectureMetrics` but render only `applicationsCount`, `servicesCount`, `interfacesCount`, `dataStoresCount` (map from existing `applications`, `services`, `interfaces`, `dataStores` fields); drop `overall` from rendered display
- Update mock service `buildLargeStrategicFoundation()` and `buildSmallStrategicFoundation()` to populate all new standards, roadmap, and productDefinition fields
- Update mock service `buildLargeDetailedDefinitionAndDelivery()` and `buildSmallDetailedDefinitionAndDelivery()` to populate all new preCoding/postCoding fields
- Keep `summaryInsight.enabled = false` and `summaryInsight.message = null` in all mock variants
- Frontend types file `frontend/src/types/dashboard.ts` must mirror all gateway type changes exactly (camelCase, no transform)

**DashboardView Component Rewrite**
- Replace the placeholder in `frontend/src/components/DashboardView/DashboardView.tsx` with a full data-driven layout
- Use `useProject()` from `frontend/src/contexts/ProjectContext.tsx` to obtain the active project; if `activeProject` is `null`, render centered empty-state text: "Select a project to view the dashboard." using the existing `.placeholder` CSS class pattern
- Use `useEffect` + `useState` to call `getDashboardSummary(activeProject.id)` from `frontend/src/api/dashboardApi.ts` on mount and when `activeProject.id` changes
- Maintain three state variables: `data: DashboardSummaryDto | null`, `loading: boolean`, `error: string | null`
- Show loading state: centered italic text "Loading dashboard..." styled using the `.loadingState` pattern from ProductPage.module.css
- Show error state: error banner with message and a "Retry" button that re-triggers the fetch; styled using the `.errorState` pattern from ProductPage.module.css

**Section 1: Header Summary**
- Render at the top of the dashboard as a non-card summary bar
- Display from `response.header`: `projectName` (as heading), `initiativesCount`, `epicsCount`, `activeEpicsCount`, `storiesInProgressCount`, `lastUpdatedLabel`
- Display `response.header.mode` as a subtle badge (e.g., "GREENFIELD")
- Display `response.scope.label` as scope context

**Section 2: Strategic Foundation (4 cards in responsive grid)**
- Render 4 cards in a CSS Grid with `grid-template-columns: repeat(4, 1fr)` and responsive collapse
- Product Definition card: render `state`, `missionExists`, `lastUpdatedLabel` metrics; action label "Open Product" navigates to Product & Delivery > Product tab
- Roadmap card: render `state`, `initiativesCount`, `epicsCount`, `epicsCompletedCount` metrics; action label "Open Roadmap" navigates to Product & Delivery > Roadmap tab
- Standards card: render `companyStandards`, `productStandards` metrics (show "Generated" / "Not Generated" as the value label); action label "View Standards" navigates to Product & Delivery > Product tab
- High-Level Architecture card: render `applications`, `services`, `interfaces`, `dataStores` metrics; action label "Open Architecture" navigates to Architecture & Design (metamodel)

**Section 3: Detailed Definition & Delivery**
- Render a section header "Detailed Definition & Delivery" with subtle "Pre-Coding" and "Post-Coding" subheadings dividing the two rows
- Pre-Coding row (3 cards in `repeat(3, 1fr)` grid): Backlog card (`epicsInScope`, `featuresCount`, `storiesCount`, `storiesWithAcceptanceCriteriaCount`; action "Open Backlog" navigates to backlog tab), Detailed Architecture card (`processActivities`, `interfaceEndpoints`, `logicalDataEntities`, `physicalDataEntities`; action "Open Architecture" navigates to metamodel), Testing Suite card (`endToEndTestCount`, `functionalTestCount`; action "Open Tests" navigates to implement tab)
- Post-Coding row (3 cards in `repeat(3, 1fr)` grid): Implementation card (`storiesDoneCount`, `storiesInProgressCount`, `epicsDoneCount`; action "Open Implement" navigates to implement tab), Verification card (`storiesVerifiedCount`, `pendingReviewCount`; action "Open Verification" navigates to implement tab), Summary Insight card (render "AI insights coming soon" with disabled/grayed-out appearance, no navigation action)

**Card Component Design**
- Each card renders: an emoji icon (v1 placeholder, one per card type such as a clipboard for Product Definition, a map for Roadmap, etc.), a title string, a primary action link/button, and up to 4 metric rows
- Metric rows render as compact pill-style label:value pairs (e.g., "Epics: 12", "Stories: 45")
- No status color indicators -- all cards use the same visual style with white background, border, and subtle shadow
- Cards use `data-testid` attributes for test targeting (e.g., `data-testid="card-product-definition"`, `data-testid="card-roadmap"`, etc.)
- Summary Insight card should have a distinct muted/disabled style to indicate it is not yet functional

**CSS Module Updates**
- Rewrite `frontend/src/components/DashboardView/DashboardView.module.css` to support the full layout
- Container: `display: flex; flex-direction: column; height: calc(100vh - 60px); overflow-y: auto; padding: 24px;`
- Section heading styles with `font-size: 16px; font-weight: 600; color: #333;` and subheadings with `font-size: 13px; font-weight: 500; color: #666;`
- Card styles based on `.formCard` pattern: `background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);`
- Strategic Foundation grid: `display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;` with `@media (max-width: 1200px)` collapse to `repeat(2, 1fr)` and `@media (max-width: 600px)` collapse to `1fr`
- Pre-Coding and Post-Coding grids: `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;` with similar responsive breakpoints
- Card action link/button: styled as text link with `color: #1976D2; font-size: 12px; font-weight: 500; cursor: pointer;`
- Metric pill: `display: inline-flex; font-size: 12px; color: #555; background: #f5f5f5; padding: 2px 8px; border-radius: 10px; margin: 2px;`
- Loading, error, and empty states reuse existing pattern classes (`.loadingState`, `.errorState`, `.placeholder`)

**Navigation Implementation**
- Import `useArchitectureDispatch` from `frontend/src/contexts/ArchitectureContext.tsx` to get the `dispatch` function
- For cards navigating to Product & Delivery tabs: (1) call `dispatch({ type: 'SET_VIEW', payload: 'product' })`, then (2) call `window.history.pushState({}, '', '?tab=<tabName>')` where `<tabName>` matches the ProductView URL param (`product`, `roadmap`, `backlog`, `implement`); this follows the exact pattern used in `ProductView.tsx` `updateUrl()` function
- For cards navigating to Architecture & Design: call `dispatch({ type: 'SET_VIEW', payload: 'metamodel' })` only (no URL param needed)
- Summary Insight card: no click handler, no navigation
- Create a helper function `navigateTo(dispatch, view, tab?)` to encapsulate the dispatch + pushState logic, keeping DashboardView clean

## Existing Code to Leverage

**DashboardView placeholder (Increment 1)**
- Located at `frontend/src/components/DashboardView/DashboardView.tsx` and `DashboardView.module.css`
- Replace the placeholder JSX and CSS entirely, but preserve the `data-testid="dashboard-view"` attribute on the outer container and the `.container` CSS class height pattern `calc(100vh - 60px)`

**DashboardSummaryDto types and API client (Increment 2)**
- Gateway types at `gateway/src/types/dashboard.ts` and frontend types at `frontend/src/types/dashboard.ts` define the current DTO shape; these files will be modified to add new fields and remove `MetricCard.status`
- API client at `frontend/src/api/dashboardApi.ts` provides `getDashboardSummary(projectId, scope?)` which returns `Promise<DashboardSummaryDto>`; the DashboardView will call this function directly with no changes needed to the client itself
- Mock service at `gateway/src/services/dashboardSummaryMockService.ts` provides `buildMockDashboardSummary()` with scope-variant data; update the `card()` helper and section builders to match new type shapes

**ProductPage.module.css patterns**
- `.formCard` pattern (`background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px`) should be replicated for dashboard card styling
- `.loadingState` pattern (centered, italic, `color: #888; font-size: 13px`) should be replicated for the dashboard loading state
- `.errorState` pattern (`background: #fff3f3; border: 1px solid #ffcdd2; color: #c62828`) should be replicated for the dashboard error state

**ArchitectureContext view switching pattern**
- `useArchitectureDispatch()` returns `dispatch` which accepts `{ type: 'SET_VIEW', payload: 'product' | 'metamodel' | 'diagrams' | 'dashboard' }`
- The TopBar.tsx dispatches view changes via `dispatch({ type: 'SET_VIEW', payload: view })` at line 242; dashboard card actions should follow this same pattern
- ProductView.tsx `updateUrl(tab, workItemId?)` uses `window.history.pushState` with `?tab=xxx` query params; dashboard navigation to ProductView tabs must replicate this URL manipulation so ProductView's `parseTabFromUrl()` picks up the correct tab on mount

**ProjectContext hooks**
- `useProject()` from `frontend/src/contexts/ProjectContext.tsx` returns `ProjectDto | null`; when non-null, `activeProject.id` provides the `projectId` string needed for the API call
- The pattern of checking `activeProject` for null and showing an empty-state message is established in ProductPage.tsx (conditional rendering based on `projectId`)

## Out of Scope

- Scope selector UI dropdown (planned for Increment 4)
- Persona chat panel/drawer attached to the dashboard (planned for Increment 5)
- Any LLM-generated insight text or real AI insight rendering (Summary Insight card shows "coming soon" only)
- Auto-refresh or polling for dashboard data updates
- Mobile-specific responsive redesign beyond basic column collapse
- Card animation or transition effects
- Any real data aggregation or computation from the database (all data remains mock)
- Status color indicators, badges, or traffic-light styling on cards (MetricCard.status is removed)
- Changes to the gateway route handler (`gateway/src/routes/dashboardSummary.ts`) or server registration
- Changes to the existing `getDashboardSummary` API client function signature
