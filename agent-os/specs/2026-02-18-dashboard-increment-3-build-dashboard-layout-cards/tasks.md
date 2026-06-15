# Task Breakdown: Dashboard Increment 3 -- Build Dashboard Layout + Cards

## Overview
Total Tasks: 3 Task Groups, ~28 sub-tasks

This increment replaces the placeholder DashboardView with a full 3-section layout (Header Summary, Strategic Foundation, Detailed Definition & Delivery) containing 10 metric cards, wired to the existing `GET /api/dashboard/summary` mock endpoint. It also updates the backend DTO to add new card fields and removes `MetricCard.status`.

No visual assets were provided for this spec.

## Task List

### Backend + Types Layer

#### Task Group 1: DTO Type Updates, Mock Service Updates, and Existing Test Fixes
**Dependencies:** None

This task group covers all backend-side changes: gateway types, frontend types (mirror), mock service data population, and updating existing Increment 2 tests that will break due to the DTO shape change. The frontend UI (Task Group 2) depends on these types being correct first.

**Files to modify:**
- `gateway/src/types/dashboard.ts`
- `frontend/src/types/dashboard.ts`
- `gateway/src/services/dashboardSummaryMockService.ts`
- `gateway/src/__tests__/dashboardSummary.test.ts` (existing Increment 2 tests -- update for new DTO shape)
- `frontend/src/__tests__/dashboardApi.test.ts` (existing Increment 2 tests -- update `sampleSummaryDto` fixture)

- [x] 1.0 Complete backend DTO updates, mock service, and existing test fixes
  - [x] 1.1 Write 4-6 focused tests for the updated DTO shape and mock service
    - Test that `MetricCard` has only `label` and `value` (no `status` field) by asserting a mock response card object lacks `status`
    - Test that `buildMockDashboardSummary()` returns the new `strategicFoundation.standards` field with `companyStandards` and `productStandards` sub-fields
    - Test that `buildMockDashboardSummary()` returns `detailedDefinitionAndDelivery.preCoding` and `postCoding` sub-objects with correct nested fields (`backlog`, `detailedArchitecture`, `testingSuite` under preCoding; `implementation`, `verification`, `summaryInsight` under postCoding)
    - Test that `strategicFoundation.productDefinition` contains `state`, `missionExists`, `lastUpdatedLabel` MetricCard fields
    - Test that `strategicFoundation.roadmap` is a `RoadmapMetrics` object with `state`, `initiativesCount`, `epicsCount`, `epicsCompletedCount`
    - Test that `header` contains new fields: `initiativesCount`, `epicsCount`, `activeEpicsCount`, `storiesInProgressCount`, `lastUpdatedLabel`, `mode`
    - Write these tests in a new file: `gateway/src/__tests__/dashboardSummary-increment3.test.ts`
  - [x] 1.2 Update `MetricCard` interface -- remove `status` field
    - In `gateway/src/types/dashboard.ts`: remove `status: 'healthy' | 'at_risk' | 'needs_attention' | 'not_started'` from `MetricCard`, leaving only `label: string` and `value: number`
    - In `frontend/src/types/dashboard.ts`: apply the same removal
    - Update the JSDoc comment on `MetricCard` to remove the status reference
  - [x] 1.3 Add new interfaces to gateway types
    - `StandardsMetrics`: `{ companyStandards: MetricCard; productStandards: MetricCard }`
    - `BacklogMetrics`: `{ epicsInScope: MetricCard; featuresCount: MetricCard; storiesCount: MetricCard; storiesWithAcceptanceCriteriaCount: MetricCard }`
    - `TestingSuiteMetrics`: `{ endToEndTestCount: MetricCard; functionalTestCount: MetricCard }`
    - `VerificationMetrics`: `{ storiesVerifiedCount: MetricCard; pendingReviewCount: MetricCard }`
    - `RoadmapMetrics`: `{ state: MetricCard; initiativesCount: MetricCard; epicsCount: MetricCard; epicsCompletedCount: MetricCard }`
    - `ProductDefinitionMetrics`: `{ state: MetricCard; missionExists: MetricCard; lastUpdatedLabel: MetricCard }`
    - Add all in `gateway/src/types/dashboard.ts`
  - [x] 1.4 Update existing interfaces in gateway types
    - `DashboardHeader`: add `initiativesCount: number`, `epicsCount: number`, `activeEpicsCount: number`, `storiesInProgressCount: number`, `lastUpdatedLabel: string`, `mode: string`
    - `StrategicFoundationSection`: change `productDefinition` from `MetricCard` to `ProductDefinitionMetrics`; change `roadmap` from `MetricCard` to `RoadmapMetrics`; add `standards: StandardsMetrics`; move `summaryInsight` out (it stays in Strategic Foundation but note that the D&D section's summaryInsight moves to `postCoding`)
    - `DetailedDefinitionAndDeliverySection`: restructure to contain `preCoding: { backlog: BacklogMetrics; detailedArchitecture: DetailedArchitectureMetrics; testingSuite: TestingSuiteMetrics }` and `postCoding: { implementation: MetricCard; verification: VerificationMetrics; summaryInsight: SummaryInsight }`; remove the old flat `requirements`, `detailedArchitecture`, `implementation`, `summaryInsight` fields
    - Define `PreCodingSection` and `PostCodingSection` as named interfaces for clarity
  - [x] 1.5 Mirror all type changes to frontend types
    - Copy all new interfaces and updated interfaces from `gateway/src/types/dashboard.ts` to `frontend/src/types/dashboard.ts` exactly (camelCase, no transforms)
    - Ensure both files export the same set of types
  - [x] 1.6 Update mock service `card()` helper and section builders
    - Update `card(label, value)` to drop the third `status` parameter (2-arg signature only)
    - Update all existing `card(...)` calls throughout the file to remove the status argument
    - Update `buildLargeStrategicFoundation()` and `buildSmallStrategicFoundation()` to populate: `productDefinition` as `ProductDefinitionMetrics` (with `state`, `missionExists`, `lastUpdatedLabel`); `roadmap` as `RoadmapMetrics` (with `state`, `initiativesCount`, `epicsCount`, `epicsCompletedCount`); new `standards` field with `companyStandards` and `productStandards`
    - Update `buildLargeDetailedDefinitionAndDelivery()` and `buildSmallDetailedDefinitionAndDelivery()` to return `preCoding` / `postCoding` structure; `preCoding.backlog` with 4 MetricCard fields; `preCoding.testingSuite` with 2 MetricCard fields; `postCoding.verification` with 2 MetricCard fields; keep `postCoding.summaryInsight` as `DISABLED_INSIGHT`
    - Update `buildMockDashboardSummary()` header construction to include `initiativesCount`, `epicsCount`, `activeEpicsCount`, `storiesInProgressCount`, `lastUpdatedLabel`, `mode: 'GREENFIELD'`
    - Update the import list at the top of the mock service to include all new types
  - [x] 1.7 Update existing Increment 2 gateway tests for new DTO shape
    - In `gateway/src/__tests__/dashboardSummary.test.ts`:
      - Test 1 (shape test): update assertions for `strategicFoundation` to check for `productDefinition.state`, `roadmap.state`, `standards.companyStandards`; update `detailedDefinitionAndDelivery` assertions to check `preCoding.backlog`, `preCoding.detailedArchitecture`, `postCoding.implementation`, `postCoding.summaryInsight`; remove assertions for old flat `requirements` / `implementation` fields
      - Test 3 (ENTIRE_PRODUCT values): update value assertions to reference new nested paths (e.g., `strategicFoundation.productDefinition.state.value` instead of `strategicFoundation.productDefinition.value`)
      - Test 4 (NEXT_5_EPICS values): same path updates as Test 3
      - Test 6 (summaryInsight): update path from `detailedDefinitionAndDelivery.summaryInsight` to `detailedDefinitionAndDelivery.postCoding.summaryInsight`
      - Gap Tests 1-2 (QTR/CUSTOM values): update value assertion paths similarly
      - Remove any assertions that check for `status` field on MetricCards
  - [x] 1.8 Update existing Increment 2 frontend API test fixture
    - In `frontend/src/__tests__/dashboardApi.test.ts`:
      - Update `sampleSummaryDto` to match the new DTO shape: remove `status` from all MetricCard objects; restructure `strategicFoundation.productDefinition` as `ProductDefinitionMetrics`; restructure `strategicFoundation.roadmap` as `RoadmapMetrics`; add `strategicFoundation.standards`; restructure `detailedDefinitionAndDelivery` into `preCoding`/`postCoding`; add new `header` fields
      - Update Test 3 (parsed JSON test) assertions to reference new paths (e.g., `result.detailedDefinitionAndDelivery.preCoding.backlog` instead of `result.detailedDefinitionAndDelivery.requirements`)
  - [x] 1.9 Ensure all backend and existing tests pass
    - Run the 4-6 new tests written in 1.1: `npx jest --testPathPattern="dashboardSummary-increment3" --config gateway/jest.config.ts`
    - Run the updated Increment 2 gateway tests: `npx jest --testPathPattern="dashboardSummary.test" --config gateway/jest.config.ts`
    - Run the updated Increment 2 frontend API tests: `npx vitest run src/__tests__/dashboardApi.test.ts` (from frontend directory)
    - Verify all pass with no TypeScript compilation errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `MetricCard` has only `label` and `value` in both gateway and frontend type files
- All new interfaces (`StandardsMetrics`, `BacklogMetrics`, `TestingSuiteMetrics`, `VerificationMetrics`, `RoadmapMetrics`, `ProductDefinitionMetrics`, `PreCodingSection`, `PostCodingSection`) exist in both type files
- `DashboardHeader` includes all 6 new fields
- `DetailedDefinitionAndDeliverySection` uses `preCoding`/`postCoding` sub-objects
- `StrategicFoundationSection` includes `standards`, updated `productDefinition`, and updated `roadmap`
- Mock service populates all new fields with plausible mock values for both large and small scope variants
- `card()` helper takes only 2 arguments (label, value)
- All existing Increment 2 tests pass after being updated for the new DTO shape
- All new Increment 3 backend tests pass
- Gateway and frontend type files are exact mirrors

---

### Frontend UI Layer

#### Task Group 2: DashboardView Component + CSS Module Rewrite
**Dependencies:** Task Group 1 (the component imports and renders the updated DTO types)

This task group covers the full DashboardView component rewrite and CSS module. This is a single component with a single CSS module -- it is intentionally kept as one task group rather than split, since the component and styles are tightly coupled.

**Files to modify:**
- `frontend/src/components/DashboardView/DashboardView.tsx` (rewrite)
- `frontend/src/components/DashboardView/DashboardView.module.css` (rewrite)

**Files to reference (read-only):**
- `frontend/src/contexts/ProjectContext.tsx` (for `useProject()`)
- `frontend/src/contexts/ArchitectureContext.tsx` (for `useArchitectureDispatch()`)
- `frontend/src/api/dashboardApi.ts` (for `getDashboardSummary()`)
- `frontend/src/components/ProductView/ProductPage.module.css` (for `.formCard`, `.loadingState`, `.errorState` patterns)
- `frontend/src/components/ProductView/ProductView.tsx` (for `updateUrl()` / `pushState` navigation pattern)
- `frontend/src/components/TopBar/TopBar.tsx` (for `SET_VIEW` dispatch pattern)

- [x] 2.0 Complete DashboardView component and CSS module rewrite
  - [x] 2.1 Write 6-8 focused tests for the DashboardView component
    - Write tests in a new file: `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
    - Test 1: When `useProject()` returns null, renders empty-state text "Select a project to view the dashboard." with `data-testid="dashboard-view"`
    - Test 2: When loading (before fetch resolves), renders "Loading dashboard..." text
    - Test 3: When fetch fails, renders error message and a "Retry" button
    - Test 4: When data loads successfully, renders the header section with project name from `header.projectName` and scope label from `scope.label`
    - Test 5: When data loads successfully, renders all 4 Strategic Foundation cards with correct `data-testid` attributes (`card-product-definition`, `card-roadmap`, `card-standards`, `card-hla`)
    - Test 6: When data loads successfully, renders all 6 Detailed D&D cards with correct `data-testid` attributes (`card-backlog`, `card-detailed-architecture`, `card-testing-suite`, `card-implementation`, `card-verification`, `card-summary-insight`)
    - Test 7: Clicking a card action link (e.g., "Open Roadmap") dispatches `SET_VIEW` with `'product'` via the mocked `useArchitectureDispatch`
    - Test 8: Summary Insight card renders with disabled/muted appearance and "AI insights coming soon" text
    - Mock `useProject()`, `useArchitectureDispatch()`, `getDashboardSummary()`, and `window.history.pushState` as needed
  - [x] 2.2 Rewrite DashboardView.module.css with full layout styles
    - Container: `display: flex; flex-direction: column; height: calc(100vh - 60px); overflow-y: auto; padding: 24px;` (preserve `data-testid="dashboard-view"` compatible `.container` class)
    - Keep existing `.placeholder` class for empty-state styling
    - Add `.loadingState` class: centered, italic, `color: #888; font-size: 13px;` (replicate pattern from ProductPage.module.css)
    - Add `.errorState` class: `background: #fff3f3; border: 1px solid #ffcdd2; color: #c62828; padding: 12px; border-radius: 6px;` with retry button styling
    - Section heading: `.sectionHeading` with `font-size: 16px; font-weight: 600; color: #333; margin: 24px 0 12px 0;`
    - Subheading: `.subheading` with `font-size: 13px; font-weight: 500; color: #666; margin: 16px 0 8px 0;`
    - Header summary bar: `.headerSummary` with flex layout for project name, stats, mode badge, scope label
    - Mode badge: `.modeBadge` with subtle background (e.g., `background: #e8f5e9; color: #2e7d32; padding: 2px 8px; border-radius: 4px; font-size: 11px;`)
    - Header stat items: `.headerStat` with compact label-value display
    - Strategic Foundation grid: `.strategicGrid` with `display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;`
    - Pre-Coding / Post-Coding grids: `.detailGrid` with `display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;`
    - Card: `.card` based on `.formCard` pattern -- `background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);`
    - Card title: `.cardTitle` with `font-size: 14px; font-weight: 600; color: #333;`
    - Card icon: `.cardIcon` with `font-size: 18px; margin-right: 8px;`
    - Card action link: `.cardAction` with `color: #1976D2; font-size: 12px; font-weight: 500; cursor: pointer; background: none; border: none; padding: 0;`
    - Metric pill: `.metricPill` with `display: inline-flex; font-size: 12px; color: #555; background: #f5f5f5; padding: 2px 8px; border-radius: 10px; margin: 2px;`
    - Disabled card: `.cardDisabled` with `opacity: 0.5; pointer-events: none;` (for Summary Insight)
    - Responsive breakpoints: `@media (max-width: 1200px)` -- `.strategicGrid` collapses to `repeat(2, 1fr)`, `.detailGrid` collapses to `repeat(2, 1fr)`; `@media (max-width: 600px)` -- both grids collapse to `1fr`
  - [x] 2.3 Implement DashboardView component data fetching and state management
    - Import `useProject` from `frontend/src/contexts/ProjectContext.tsx`
    - Import `useArchitectureDispatch` from `frontend/src/contexts/ArchitectureContext.tsx`
    - Import `getDashboardSummary` from `frontend/src/api/dashboardApi.ts`
    - Import `DashboardSummaryDto` from `frontend/src/types/dashboard.ts`
    - Declare state: `data: DashboardSummaryDto | null`, `loading: boolean` (init `true`), `error: string | null`
    - If `activeProject` is null, render empty-state: `<div className={styles.placeholder}>Select a project to view the dashboard.</div>`
    - `useEffect` on `[activeProject?.id]`: set loading=true, error=null; call `getDashboardSummary(activeProject.id)`; on success set data + loading=false; on error set error message + loading=false
    - Create a `fetchData()` function inside the component so the Retry button can call it
    - If loading, render: `<div className={styles.loadingState}>Loading dashboard...</div>`
    - If error, render: `<div className={styles.errorState}><span>{error}</span><button onClick={fetchData}>Retry</button></div>`
    - Preserve `data-testid="dashboard-view"` on the outer container div
  - [x] 2.4 Implement Section 1: Header Summary bar
    - Render at top of dashboard (inside the container, before the card sections)
    - Display `data.header.projectName` as an h2 heading
    - Display `data.header.mode` as a badge (`.modeBadge` class), e.g., "GREENFIELD"
    - Display `data.scope.label` as scope context text
    - Display header stats: `initiativesCount` ("Initiatives"), `epicsCount` ("Epics"), `activeEpicsCount` ("Active Epics"), `storiesInProgressCount` ("Stories In Progress")
    - Display `data.header.lastUpdatedLabel` as a "Last updated" line
    - Display `data.header.generatedAt` formatted as readable date (optional, can show raw ISO or format with `new Date(...).toLocaleDateString()`)
  - [x] 2.5 Implement `navigateTo` helper function
    - Create a helper function: `function navigateTo(dispatch: ArchitectureDispatch, view: string, tab?: string)`
    - When `view === 'product'` and `tab` is provided: call `dispatch({ type: 'SET_VIEW', payload: 'product' })` then `window.history.pushState({}, '', '?tab=' + tab)`
    - When `view === 'metamodel'`: call `dispatch({ type: 'SET_VIEW', payload: 'metamodel' })` only
    - Define this function inside `DashboardView.tsx` (not exported, component-local utility)
  - [x] 2.6 Implement Section 2: Strategic Foundation cards (4 cards)
    - Render section heading "Strategic Foundation"
    - Use `.strategicGrid` CSS class for the 4-column grid
    - **Product Definition card** (`data-testid="card-product-definition"`): icon (clipboard emoji or similar), title "Product Definition", metrics from `data.strategicFoundation.productDefinition` (`state`, `missionExists`, `lastUpdatedLabel`), action "Open Product" calls `navigateTo(dispatch, 'product', 'product')`
    - **Roadmap card** (`data-testid="card-roadmap"`): icon (map emoji), title "Roadmap", metrics from `data.strategicFoundation.roadmap` (`state`, `initiativesCount`, `epicsCount`, `epicsCompletedCount`), action "Open Roadmap" calls `navigateTo(dispatch, 'product', 'roadmap')`
    - **Standards card** (`data-testid="card-standards"`): icon (shield/checkmark emoji), title "Standards", metrics from `data.strategicFoundation.standards` (`companyStandards`, `productStandards` -- render value as "Generated" / "Not Generated" based on `value > 0`), action "View Standards" calls `navigateTo(dispatch, 'product', 'product')`
    - **High-Level Architecture card** (`data-testid="card-hla"`): icon (building emoji), title "High-Level Architecture", metrics from `data.strategicFoundation.highLevelArchitecture` (render `applications`, `services`, `interfaces`, `dataStores` -- skip `overall`), action "Open Architecture" calls `navigateTo(dispatch, 'metamodel')`
  - [x] 2.7 Implement Section 3: Detailed Definition & Delivery (6 cards)
    - Render section heading "Detailed Definition & Delivery"
    - Render subheading "Pre-Coding"
    - Use `.detailGrid` CSS class for the 3-column grid
    - **Backlog card** (`data-testid="card-backlog"`): icon (list emoji), title "Backlog", metrics from `data.detailedDefinitionAndDelivery.preCoding.backlog` (`epicsInScope`, `featuresCount`, `storiesCount`, `storiesWithAcceptanceCriteriaCount`), action "Open Backlog" calls `navigateTo(dispatch, 'product', 'backlog')`
    - **Detailed Architecture card** (`data-testid="card-detailed-architecture"`): icon (diagram emoji), title "Detailed Architecture", metrics from `data.detailedDefinitionAndDelivery.preCoding.detailedArchitecture` (`processActivities`, `interfaceEndpoints`, `logicalDataEntities`, `physicalDataEntities` -- skip `overall`), action "Open Architecture" calls `navigateTo(dispatch, 'metamodel')`
    - **Testing Suite card** (`data-testid="card-testing-suite"`): icon (test tube emoji), title "Testing Suite", metrics from `data.detailedDefinitionAndDelivery.preCoding.testingSuite` (`endToEndTestCount`, `functionalTestCount`), action "Open Tests" calls `navigateTo(dispatch, 'product', 'implement')`
    - Render subheading "Post-Coding"
    - Use `.detailGrid` CSS class for second 3-column grid
    - **Implementation card** (`data-testid="card-implementation"`): icon (rocket emoji), title "Implementation", metrics from `data.detailedDefinitionAndDelivery.postCoding.implementation` (render `label` and `value` -- this is a single MetricCard, display it as the primary metric), action "Open Implement" calls `navigateTo(dispatch, 'product', 'implement')`
    - **Verification card** (`data-testid="card-verification"`): icon (check emoji), title "Verification", metrics from `data.detailedDefinitionAndDelivery.postCoding.verification` (`storiesVerifiedCount`, `pendingReviewCount`), action "Open Verification" calls `navigateTo(dispatch, 'product', 'implement')`
    - **Summary Insight card** (`data-testid="card-summary-insight"`): icon (lightbulb emoji), title "Summary Insight", text "AI insights coming soon", no action link, apply `.cardDisabled` class for muted/disabled appearance
  - [x] 2.8 Ensure DashboardView component tests pass
    - Run ONLY the 6-8 tests written in 2.1: `npx vitest run src/__tests__/dashboard-increment-3-dashboardview.test.tsx` (from frontend directory)
    - Verify all pass with no TypeScript compilation errors
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- DashboardView renders empty-state when no project is selected
- DashboardView shows loading state during fetch, error state on failure with working Retry button
- Header summary bar displays project name, mode badge, scope label, and all stat counts
- All 4 Strategic Foundation cards render with correct metrics and action links
- All 6 Detailed D&D cards render (3 pre-coding, 3 post-coding) with correct metrics and action links
- Summary Insight card appears disabled/muted with "AI insights coming soon" text
- All card action links dispatch correct `SET_VIEW` actions and (where applicable) update the URL with `pushState`
- CSS grids are responsive: 4-col and 3-col at desktop, 2-col at 1200px, 1-col at 600px
- All 10 cards have correct `data-testid` attributes
- Outer container preserves `data-testid="dashboard-view"`
- Metric values render as compact pill-style label:value pairs
- Cards use consistent white/bordered styling with no status color indicators

---

### Testing Layer

#### Task Group 3: Test Review and Gap Analysis
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1 and 2
    - Review the 4-6 tests written by Task Group 1 (gateway DTO shape + mock service in `dashboardSummary-increment3.test.ts`)
    - Review the updated Increment 2 gateway tests (`dashboardSummary.test.ts` -- ~11 tests)
    - Review the updated Increment 2 frontend API tests (`dashboardApi.test.ts` -- 4 tests)
    - Review the 6-8 tests written by Task Group 2 (DashboardView component in `dashboard-increment-3-dashboardview.test.tsx`)
    - Total existing tests: approximately 25-29 tests across the feature
  - [x] 3.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Dashboard Increment 3 feature requirements
    - Do NOT assess entire application test coverage
    - Prioritize: navigation actions actually calling the right dispatch/pushState, error-then-retry flow, data re-fetch when project changes, mock service scope-variant correctness with new fields
  - [x] 3.3 Write up to 10 additional strategic tests maximum
    - Write tests in a new file: `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx` (for frontend gaps) and/or `gateway/src/__tests__/dashboardSummary-increment3-gap.test.ts` (for backend gaps)
    - Focus on integration points and end-to-end workflows, such as:
      - Clicking "Retry" after an error re-triggers the fetch and renders data on success
      - When `activeProject` changes from one project to another, the component re-fetches with the new project ID
      - ENTIRE_PRODUCT scope mock data populates all new preCoding/postCoding fields with larger values
      - Standards card renders "Generated" vs "Not Generated" labels correctly based on metric values
      - Navigation helper `navigateTo` calls both `dispatch` and `pushState` with correct arguments for a product tab navigation
      - Navigation helper `navigateTo` calls only `dispatch` (no `pushState`) for metamodel navigation
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests
  - [x] 3.4 Run all feature-specific tests
    - Run all tests related to Dashboard Increment 3:
      - `gateway/src/__tests__/dashboardSummary.test.ts` (updated Increment 2 gateway tests)
      - `gateway/src/__tests__/dashboardSummary-increment3.test.ts` (new Increment 3 gateway tests)
      - `gateway/src/__tests__/dashboardSummary-increment3-gap.test.ts` (gap tests, if created)
      - `frontend/src/__tests__/dashboardApi.test.ts` (updated Increment 2 frontend API tests)
      - `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` (new component tests)
      - `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx` (gap tests, if created)
      - `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx` (Increment 1 tests -- verify they still pass or update if broken by the rewrite)
    - Expected total: approximately 30-39 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 30-39 tests total)
- Critical user workflows for the dashboard feature are covered: data fetching, rendering, navigation, error handling, retry, project switching
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on Dashboard Increment 3 feature requirements
- Existing Increment 1 dashboard tests still pass (or are updated if the placeholder rewrite broke them)

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Backend DTO + Mock Service + Test Fixes** -- Must come first. The frontend component imports and renders these types. The existing Increment 2 tests will fail immediately after the type changes, so they must be updated in the same task group to keep the build green.

2. **Task Group 2: DashboardView Component + CSS** -- Depends on Task Group 1. This is the bulk of the work: one component file and one CSS module. The component consumes the updated DTO types, fetches data, renders 3 sections with 10 cards, and implements navigation actions.

3. **Task Group 3: Test Gap Analysis** -- Depends on Task Groups 1 and 2. Reviews all tests written so far, identifies gaps in critical workflows, and adds up to 10 targeted tests.
