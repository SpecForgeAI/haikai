# Spec Requirements: Dashboard Increment 6 -- Polish + Loading/Error UX + Snapshot Test Coverage

## Initial Description

Improve Dashboard UX quality and stability by adding consistent loading skeletons, friendly error handling with retry, and basic automated test coverage (snapshots + key interactions). No new features, no backend changes, no LLM.

## Requirements Discussion

### First Round Questions

**Q1:** Initial load skeleton vs. current "Loading dashboard..." text: The scope-change skeleton cards already exist (Increment 4). I assume the main gap is replacing the plain "Loading dashboard..." text on initial page load with a full-page skeleton that mirrors the dashboard structure (header bar skeleton + 4 strategic card skeletons + scope bar + 6 detail card skeletons). Is that the intended scope, or did you also want to rework the existing scope-change skeletons?
**Answer:** Yes -- replace the initial "Loading dashboard..." with a full-page skeleton matching the dashboard structure. Keep the scope-change skeleton behavior as already decided (only bottom 6 cards skeleton).

**Q2:** Error state behavior on scope change: Currently, when a scope-change fetch fails, the error replaces the ENTIRE dashboard (all data is lost, user sees only the error message + Retry). I assume you want to change this so that scope-change errors show an inline error banner/toast while preserving the previously loaded dashboard data. Is that correct, or should the full-page error replacement remain?
**Answer:** Yes -- on scope-change fetch failure, preserve the previously loaded data and show an inline error banner/toast for the bottom section only (Strategic stays visible).

**Q3:** Error state visual treatment: The current error state is a simple red banner with text and a Retry button. Should we add: (a) an error icon, (b) a more descriptive/friendly message wrapper, (c) a loading spinner on the Retry button during re-fetch? Or is the current error banner styling sufficient and you only want the behavioral change from question 2?
**Answer:** Keep styling broadly the same; minor polish only (optional small error icon and a spinner/disabled state on Retry is fine, but no redesign).

**Q4:** Snapshot test scope: Should these be (a) full-component snapshots of each major visual state, or (b) targeted snapshots of specific sub-sections? Option (a) tends to be brittle with large components; option (b) is more maintainable.
**Answer:** Use (b) -- targeted snapshots for key subcomponents/states (loading skeleton block, success dashboard shell) and rely on explicit assertions for the rest to avoid brittleness.

**Q5:** Test file organization: The codebase currently has 8 separate dashboard test files split by increment. Should the new snapshot tests go into a single new file (e.g., `dashboard-increment-6-snapshots.test.tsx`), or should they be consolidated with the existing test files?
**Answer:** Organize tests by component: `DashboardView.test.tsx` for state/interaction tests; optionally a `DashboardSkeleton.test.tsx` if skeleton is its own component (avoid a special "increment" test file).

**Q6:** Loading skeleton for strategic foundation section: Currently, the 4 strategic foundation cards are always shown instantly (no skeleton during initial load OR scope change). Should the initial load skeleton include placeholder skeletons for the strategic foundation row too, since no data exists yet during the initial fetch?
**Answer:** Yes -- initial load skeleton covers ALL sections (header + 4 strategic cards + scope bar + 6 detail cards).

**Q7:** Is there anything explicitly OUT OF SCOPE?
**Answer:** Accessibility overhaul, responsive/mobile redesign, animations, new cards/metrics, any backend or API contract changes, and any polling/auto-refresh.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Skeleton cards during scope change - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (lines 328-348, 414-434)
- Feature: Skeleton CSS with shimmer animation - Path: `frontend/src/components/DashboardView/DashboardView.module.css` (lines 350-392, classes: `.skeletonCard`, `.skeletonBar`, `.skeletonBarTitle`, `.skeletonBarMetric1/2/3`, `@keyframes shimmer`)
- Feature: Toast notification component - Path: `frontend/src/components/common/Toast.tsx` (reusable error/success toast with auto-dismiss, slide-up animation, fixed position bottom center)
- Feature: Toast styles - Path: `frontend/src/components/common/Toast.module.css`
- Feature: Existing error state styling - Path: `frontend/src/components/DashboardView/DashboardView.module.css` (lines 64-91, classes: `.errorState`, `.errorState button`)
- Feature: Test mock pattern - Path: `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` (canonical example of mock setup, DTO fixture, and test structure used across all dashboard test files)

### Follow-up Questions

No follow-up questions were needed. All answers were sufficiently detailed and no ambiguities or contradictions were found between the answers and the codebase analysis.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files found in `planning/visuals/` after mandatory bash check.

## Requirements Summary

### Functional Requirements

- **FR1: Full-page loading skeleton on initial load.** Replace the current "Loading dashboard..." plain text (early-return branch at DashboardView.tsx lines 148-155) with a full-page skeleton that mirrors the complete dashboard structure: header summary bar skeleton, "Strategic Foundation" section heading + 4 skeleton cards in 4-column grid, scope control bar skeleton, "Detailed Definition & Delivery" section heading + "Pre-Coding" subheading + 3 skeleton cards, "Post-Coding" subheading + 3 skeleton cards. Total: 10 skeleton cards + header bar + scope bar + section headings.

- **FR2: Scope-change error resilience.** When `handleScopeChange` fetch fails, preserve the previously loaded dashboard data (header, strategic foundation cards, scope bar all remain visible). Show an inline error notification for the bottom section (Detailed D&D) only. Do NOT set the global `error` state that triggers full-page error replacement. Requires a new `scopeError` state variable separate from the existing `error` state. The inline error should include the error message and a way to retry or dismiss.

- **FR3: Initial load error behavior unchanged.** The existing full-page error state (red banner + Retry button) remains for initial fetch failures where no stale data exists. No changes to this path except optional minor polish (small error icon, spinner/disabled state on Retry button during re-fetch).

- **FR4: Minor error state polish (optional).** Small error icon next to error message text. Spinner or disabled state on the Retry button while a re-fetch is in progress to prevent double-clicks and indicate activity.

- **FR5: Scope-change skeleton behavior unchanged.** The existing scope-change skeleton (bottom 6 cards only, strategic foundation stays visible) remains as-is. No changes to the `scopeLoading` rendering logic for pre-coding and post-coding sections.

- **FR6: Targeted snapshot tests.** Add targeted `toMatchSnapshot()` tests for key subcomponent states: loading skeleton block output, success dashboard shell structure. Use explicit behavioral assertions (not snapshots) for other states to avoid brittleness.

- **FR7: Component-based test file organization.** New tests go in `DashboardView.test.tsx` for state/interaction coverage. If the skeleton is extracted as its own component, it gets a separate `DashboardSkeleton.test.tsx`. Do not create increment-named test files.

### Reusability Opportunities

- **Skeleton CSS classes:** Existing `.skeletonCard`, `.skeletonBar`, `.skeletonBarTitle`, `.skeletonBarMetric1/2/3`, and `@keyframes shimmer` in `DashboardView.module.css` can be reused directly for the initial-load skeleton cards. New CSS classes needed only for header bar skeleton, scope bar skeleton, and section heading skeletons.
- **Toast component:** `frontend/src/components/common/Toast.tsx` could be reused for the scope-change error notification. However, it is globally positioned (fixed bottom center), not inline within a section. The spec writer should evaluate whether to use the existing Toast as-is or create a small inline error banner within the Detailed D&D section.
- **Test mock pattern:** All 7 existing dashboard test files use an identical mock setup pattern (vi.mock for ProjectContext, ArchitectureContext, PersonaPanelContext, dashboardApi, CSS module; Proxy identity mapping for CSS; sampleDto fixture; dynamic import in beforeEach). The new `DashboardView.test.tsx` should follow this same pattern.
- **Skeleton component extraction:** The initial-load skeleton could be extracted as a separate `DashboardSkeleton` component to improve testability and reusability. This is optional but would enable a cleaner separation and a dedicated `DashboardSkeleton.test.tsx`.

### Scope Boundaries

**In Scope:**
- Replace "Loading dashboard..." text with full-page skeleton (all sections)
- Scope-change error resilience (preserve data, inline error for bottom section)
- Optional minor error state polish (icon, retry spinner)
- Targeted snapshot tests for loading skeleton and success dashboard shell
- New `DashboardView.test.tsx` test file with component-based organization
- New skeleton-specific CSS classes for header bar, scope bar, and section headings
- New `scopeError` state variable in DashboardView to separate scope errors from initial load errors

**Out of Scope:**
- Accessibility overhaul
- Responsive/mobile layout redesign
- Animation changes or additions (beyond existing shimmer)
- New dashboard cards or metrics
- Backend or API contract changes
- Polling or auto-refresh functionality
- Consolidating/renaming existing increment-based test files
- Changes to the existing scope-change skeleton behavior (bottom 6 cards only)

### Technical Considerations

- **State management change:** A new `scopeError` state variable is needed alongside the existing `error` state. The `handleScopeChange` catch block must set `scopeError` instead of `error` to avoid triggering the full-page error early-return branch.
- **Skeleton rendering location:** The loading skeleton replaces the early-return `if (loading)` branch. It must render inside the same `container` div with `data-testid="dashboard-view"` to maintain test compatibility.
- **CSS reuse:** The existing `.skeletonCard` and `.skeletonBar` classes already match the `.card` layout dimensions. New classes needed only for non-card elements (header bar, scope bar, section headings).
- **Toast vs inline banner:** The existing Toast component is fixed-position and globally scoped. If the requirement is truly "inline for the bottom section only," a small inline error banner within the Detailed D&D section may be more appropriate than the global Toast. The spec writer should make this call.
- **Test file coexistence:** The new `DashboardView.test.tsx` will coexist with the 7 existing increment-based test files. No renaming or consolidation of old files is in scope.
- **Snapshot test targets:** Snapshots should target the skeleton block output and the success dashboard shell structure. These are relatively stable subtrees. Avoid snapshotting the full 489-line component output, which would be extremely brittle.
- **Existing test that will need updating:** The increment 3 test "renders loading state while fetch is in progress" currently asserts `screen.getByText('Loading dashboard...')`. This assertion will break when the loading text is replaced with a skeleton. This test must be updated to assert the skeleton structure instead. Similarly, increment 4 gap-fill test "Gap 1" asserts `screen.queryByTestId('scope-selector')` is not in the document after a scope-change error -- this behavior will change since the dashboard now preserves data on scope errors.
