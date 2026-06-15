# Specification: Dashboard Increment 6 -- Polish + Loading/Error UX + Snapshot Test Coverage

## Goal

Improve the Dashboard's perceived quality and resilience by replacing the plain-text loading state with a full-page skeleton, making scope-change errors non-destructive (preserving previously loaded data), adding minor error-state polish, and introducing targeted snapshot tests -- all without new features, backend changes, or LLM integration.

## User Stories

- As a user, I want to see a structured skeleton layout while the dashboard loads so that the page feels responsive and I can anticipate where content will appear.
- As a user, I want scope-change errors to preserve my already-loaded dashboard data so that a transient failure does not destroy my current view.
- As a developer, I want targeted snapshot tests for the loading skeleton and success shell so that visual regressions are caught automatically.

## Specific Requirements

**Full-Page Loading Skeleton (Initial Load)**
- Replace the early-return loading branch at `DashboardView.tsx` lines 148-155 (the `if (loading)` block that renders `"Loading dashboard..."`) with a full-page skeleton component.
- The skeleton must render inside the same `<div className={styles.container} data-testid="dashboard-view">` wrapper to preserve test compatibility with existing `getByTestId('dashboard-view')` assertions.
- Skeleton layout must mirror the full dashboard structure: one header summary bar skeleton, a "Strategic Foundation" section heading placeholder, 4 skeleton cards in a `.strategicGrid` 4-column grid, a scope control bar skeleton, a "Detailed Definition & Delivery" section heading placeholder, a "Pre-Coding" subheading placeholder + 3 skeleton cards in `.detailGrid`, and a "Post-Coding" subheading placeholder + 3 skeleton cards in `.detailGrid`. Total: 10 skeleton cards + header bar + scope bar + 4 heading/subheading placeholders.
- Extract the skeleton as a separate `DashboardSkeleton` sub-component in a new file `frontend/src/components/DashboardView/DashboardSkeleton.tsx` to enable isolated testing and reuse.
- Add a `data-testid="dashboard-skeleton"` to the skeleton root wrapper so tests can assert skeleton presence/absence.
- Each skeleton card reuses the existing `.skeletonCard` / `.skeletonBar` / `.skeletonBarTitle` / `.skeletonBarMetric1` / `.skeletonBarMetric2` / `.skeletonBarMetric3` CSS classes from `DashboardView.module.css` lines 350-392.
- New CSS classes needed in `DashboardView.module.css`: `.skeletonHeaderBar` (single wide shimmer bar matching `.headerSummary` height/border-radius), `.skeletonScopeBar` (narrow shimmer bar matching `.scopeControlBar` height), and `.skeletonSectionHeading` (short shimmer bar ~120px wide, 14px tall, for section/subheading placeholders).

**Scope-Change Error Resilience**
- Add a new `scopeError` state variable (`const [scopeError, setScopeError] = useState<string | null>(null)`) in `DashboardView.tsx`, separate from the existing `error` state.
- In the `handleScopeChange` catch block (currently lines 124-128), replace `setError(message)` with `setScopeError(message)`. This prevents the full-page error early-return branch from triggering, so the header, strategic foundation cards, and scope bar all remain visible.
- Clear `scopeError` at the start of each new scope change: add `setScopeError(null)` at the top of `handleScopeChange`, alongside the existing `setScopeLoading(true)`.
- Render an inline error banner within the Detailed Definition & Delivery section when `scopeError` is truthy. Place it immediately after the "Detailed Definition & Delivery" `<h3>` heading and before the "Pre-Coding" subheading. The banner replaces the pre-coding and post-coding card grids (show the banner instead of skeleton cards or real cards).
- The inline error banner uses a new CSS class `.scopeErrorBanner` styled consistently with the existing `.errorState` (same colors: `background: #fff3f3`, `border: 1px solid #ffcdd2`, `color: #c62828`) but rendered inline (not an early-return). Include the error message text and a "Retry" button that calls `handleScopeChange(selectedScope)` to re-attempt the fetch with the currently selected scope.
- Add `data-testid="scope-error-banner"` to the inline error banner for test targeting.

**Error Visual Polish**
- In the full-page error state (lines 157-167), add a small error icon (Unicode `\u26A0` warning triangle or a simple `!` in a circle) before the error message `<span>` for visual emphasis.
- Add a `retrying` state variable (`const [retrying, setRetrying] = useState<boolean>(false)`). When the Retry button is clicked, set `retrying` to `true` before calling `fetchData()`, and reset it in the `finally` block of `fetchData`. While `retrying === true`, the Retry button should be `disabled` and show the text "Retrying..." instead of "Retry".
- Apply the same retrying/disabled pattern to the inline scope error banner's Retry button using the existing `scopeLoading` state (since a retry triggers `handleScopeChange` which already sets `scopeLoading`).

**Test Updates for Existing Broken Tests**
- `dashboard-increment-3-dashboardview.test.tsx` Test 2 (line 162-168): Currently asserts `screen.getByText('Loading dashboard...')`. This will break because the loading text no longer exists. Update this test to instead assert `screen.getByTestId('dashboard-skeleton')` is in the document and that `screen.queryByTestId('header-summary')` is NOT in the document.
- `dashboard-increment-4-gap-fill.test.tsx` Gap 1 (lines 148-178): Currently asserts that after a scope-change error the scope selector is NOT in the document (`expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument()`). With the new behavior, the scope selector remains visible. Update this test to assert: (a) `screen.getByTestId('scope-error-banner')` is in the document, (b) `screen.getByTestId('scope-selector')` IS in the document, (c) strategic foundation cards remain visible, and (d) the error message text is displayed within the scope error banner.
- `dashboard-increment-4-gap-fill.test.tsx` Gap 2 (lines 180-223): Currently asserts skeleton cards are replaced by the full-page error state after rejection. Update to assert that skeleton cards are replaced by the inline `scope-error-banner` instead, and that the strategic cards and scope selector remain in the DOM.

**New Test File: DashboardView.test.tsx**
- Create `frontend/src/__tests__/DashboardView.test.tsx` following the component-based naming convention.
- Use the same mock setup pattern as all existing dashboard test files: `vi.mock` for `ProjectContext`, `ArchitectureContext`, `PersonaPanelContext`, `dashboardApi`, and the CSS module with `Proxy` identity mapping; `sampleDto` fixture; dynamic `import()` of `DashboardView` in `beforeEach`.
- Include targeted snapshot tests: (1) render with `loading === true` and snapshot the `dashboard-skeleton` testid element's `innerHTML`, (2) render with successful data and snapshot the `dashboard-view` testid element's outer structure (not full innerHTML -- use a targeted container query).
- Include behavioral tests: (3) scope-change error preserves header and strategic cards, (4) scope-change error shows inline banner with Retry, (5) clicking inline Retry re-triggers scope fetch, (6) retrying state disables the Retry button on full-page error.

**New Test File: DashboardSkeleton.test.tsx**
- Create `frontend/src/__tests__/DashboardSkeleton.test.tsx` if the skeleton is extracted as its own component.
- Test that the skeleton renders the correct number of skeleton cards (10 total: 4 in strategic grid + 3 pre-coding + 3 post-coding).
- Test that the skeleton includes header bar, scope bar, and section heading placeholder elements.
- Include one snapshot test of the full skeleton output for regression detection.

## Visual Design

No visual mockups were provided. The skeleton layout must visually mirror the existing dashboard structure using the established shimmer animation and skeleton card CSS already in `DashboardView.module.css`.

## Existing Code to Leverage

**Skeleton card CSS classes (`DashboardView.module.css` lines 350-392)**
- `.skeletonCard`, `.skeletonBar`, `.skeletonBarTitle`, `.skeletonBarMetric1`, `.skeletonBarMetric2`, `.skeletonBarMetric3`, and `@keyframes shimmer` are fully implemented and already used for scope-change skeleton cards.
- Reuse these identically for all 10 skeleton cards in the initial-load skeleton. No modifications needed to existing classes.
- New classes (`.skeletonHeaderBar`, `.skeletonScopeBar`, `.skeletonSectionHeading`) should follow the same `.skeletonBar` pattern (same gradient, same shimmer animation) but with different width/height dimensions.

**Error state CSS (`DashboardView.module.css` lines 64-91)**
- `.errorState` and `.errorState button` provide the red error banner styling (background `#fff3f3`, border `#ffcdd2`, text color `#c62828`, red button with white text).
- The new `.scopeErrorBanner` class should replicate these colors and layout but be used inline within the dashboard body rather than as an early-return replacement.

**Scope-change skeleton rendering pattern (`DashboardView.tsx` lines 328-348, 414-434)**
- The existing `scopeLoading ? (skeleton) : (real cards)` ternary pattern in the pre-coding and post-coding sections demonstrates the skeleton card markup.
- The initial-load skeleton should use the same card markup structure but include all sections (header + strategic + scope bar + detail).

**Toast component (`frontend/src/components/common/Toast.tsx` and `Toast.module.css`)**
- Globally positioned (`position: fixed; bottom: 20px; left: 50%`) with auto-dismiss and slide-up animation.
- NOT suitable for the inline scope-error banner because it overlays the entire viewport rather than appearing inline within a specific dashboard section. Use a locally rendered inline banner instead.
- Could optionally be used as a secondary notification alongside the inline banner, but this is not required.

**Test mock pattern (all existing dashboard test files)**
- All 8 existing test files use the identical mock setup: `vi.mock` for `ProjectContext` (returns `mockActiveProject`), `ArchitectureContext` (returns `mockDispatch`), `PersonaPanelContext` (returns `mockOpenPanel`), `dashboardApi` (delegates to `mockGetDashboardSummary`), and the CSS module (Proxy identity mapping).
- The `sampleDto` fixture is duplicated across each test file. The new `DashboardView.test.tsx` should follow the same duplication pattern for consistency (do not attempt to extract a shared fixture file, as that would change multiple existing files).

## Out of Scope

- Accessibility overhaul (ARIA attributes, screen reader improvements, focus management)
- Responsive or mobile layout redesign
- New animations or transitions beyond the existing shimmer keyframes
- New dashboard cards, metrics, or sections
- Backend or API contract changes (no gateway or MCP-server modifications)
- Polling, auto-refresh, or WebSocket-based live updates
- Consolidating or renaming existing increment-based test files (the 8 existing test files remain as-is)
- Changes to the existing scope-change skeleton behavior (bottom 6 cards only, strategic stays visible)
- Extracting a shared test fixture file across dashboard test files
- Changes to the Toast component or its CSS
