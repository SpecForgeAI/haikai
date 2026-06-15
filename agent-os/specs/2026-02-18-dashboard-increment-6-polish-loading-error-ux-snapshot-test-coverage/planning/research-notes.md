# Research Notes: Dashboard Increment 6 -- Polish + Loading/Error UX + Snapshot Test Coverage

## Raw Idea Summary

The raw idea is intentionally terse:

> Improve Dashboard UX quality and stability by adding consistent loading skeletons, friendly error handling with retry, and basic automated test coverage (snapshots + key interactions). No new features, no backend changes, no LLM.

Three pillars are mentioned:
1. Consistent loading skeletons
2. Friendly error handling with retry
3. Snapshot + interaction test coverage

---

## Research Findings

### Key Files

| Area | File | Purpose |
|------|------|---------|
| Component | `frontend/src/components/DashboardView/DashboardView.tsx` | Main dashboard component (489 lines) |
| Styles | `frontend/src/components/DashboardView/DashboardView.module.css` | All dashboard CSS including skeleton classes (393 lines) |
| API | `frontend/src/api/dashboardApi.ts` | `getDashboardSummary()` fetch function |
| Types | `frontend/src/types/dashboard.ts` | `DashboardSummaryDto`, `ScopeType`, all metric interfaces |
| Tests | `frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx` | Inc 1 tests (3 tests: testid, empty state, CSS class) |
| Tests | `frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx` | Inc 1 navigation wiring (TopBar, App.tsx routing -- 11 tests) |
| Tests | `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` | Inc 3 core tests (8 tests: states, cards, navigation, disabled card) |
| Tests | `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx` | Inc 3 gap tests (6 tests: retry, re-fetch, standards, navigation, stats) |
| Tests | `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx` | Inc 4 scope tests (8 tests: selector, skeleton, scope change, data update) |
| Tests | `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx` | Inc 4 gap tests (2 tests: scope error, skeleton clearing) |
| Tests | `frontend/src/__tests__/DashboardView.personaPanel.test.tsx` | Inc 5 persona wiring (6 tests: card-to-panel mapping) |
| Tests | `frontend/src/__tests__/PersonaHelperPanel.test.tsx` | PersonaHelperPanel unit tests (9 tests) |
| Tests | `frontend/src/__tests__/PersonaPanelContext.test.tsx` | Context state tests (4 tests) |
| Tests | `frontend/src/__tests__/dashboardApi.test.ts` | API client tests (4 tests) |
| Shared | `frontend/src/components/common/Toast.tsx` | Existing Toast component (success/error) |
| Shared | `frontend/src/components/common/Toast.module.css` | Toast styles (fixed position, slide-up animation) |
| Shared | `frontend/src/components/EmptyState/NoProjectEmptyState.tsx` | Reusable empty-state component |

### Existing Patterns in Other Views

- **MetaModelView** (`frontend/src/components/MetaModelView/MetaModelView.tsx`): Does NOT have explicit loading/error states. It renders directly from context state with no async fetch.
- **ProductPage** (`frontend/src/components/ProductView/ProductPage.tsx`): Also has no loading/error states -- it simply conditionally renders chat panels.
- **Toast** (`frontend/src/components/common/Toast.tsx`): Existing reusable toast for success/error notifications. Has auto-dismiss, slide-up animation. Not used in Dashboard currently.
- **NoProjectEmptyState** (`frontend/src/components/EmptyState/NoProjectEmptyState.tsx`): Reusable empty-state with import buttons. Not applicable to Dashboard (different UX).
- **No shared skeleton component exists** -- the Dashboard's skeleton cards are local to `DashboardView.module.css`.

---

## Already Implemented (from prior increments)

After thorough code analysis, the following items from the raw idea are **already implemented** in DashboardView.tsx:

### 1. Loading State (Initial Page Load)
- **Already exists**: Lines 149-155 render `<div className={styles.loadingState}>Loading dashboard...</div>` when `loading === true`.
- **CSS exists**: `.loadingState` class in DashboardView.module.css (lines 49-57) -- centered, italic, gray text.
- **Test exists**: Increment 3 Test 2 verifies "Loading dashboard..." renders.

### 2. Error State with Retry Button
- **Already exists**: Lines 159-167 render an error banner with `{error}` message and a `<button onClick={fetchData}>Retry</button>`.
- **CSS exists**: `.errorState` class with red background (#fff3f3), red border, red text (#c62828), and red retry button with hover state.
- **Tests exist**: Increment 3 Test 3 verifies error message + Retry button. Gap Test 1 verifies retry re-fetches and succeeds. Gap Test 2 (Inc 4) verifies scope error shows error state.

### 3. Skeleton Cards During Scope Change
- **Already exists**: Lines 328-348 and 414-434 render 6 skeleton card placeholders (3 for pre-coding, 3 for post-coding) when `scopeLoading === true`.
- **CSS exists**: `.skeletonCard`, `.skeletonBar`, `.skeletonBarTitle`, `.skeletonBarMetric1/2/3` classes with shimmer animation (`@keyframes shimmer`).
- **Tests exist**: Inc 4 Test 5 verifies 6 skeleton cards render during scope loading. Inc 4 Test 6 verifies strategic foundation cards remain visible.

### 4. No-Project Empty State
- **Already exists**: Lines 138-146 render "Select a project to view the dashboard." when `!activeProject`.
- **CSS exists**: `.placeholder` class.
- **Tests exist**: Inc 1 Test 2, Inc 3 Test 1.

### 5. Comprehensive Behavioral Tests
- **Already exist**: 8 test files with a total of **61 tests** covering:
  - Empty state, loading state, error state (3 states fully tested)
  - All 10 card data-testids verified
  - Navigation dispatch + pushState for all card actions
  - Scope selector default value, scope change API calls, disabled during loading
  - Skeleton cards during scope loading and clearing after error
  - Persona panel wiring for all 4 persona types
  - Standards card "Generated"/"Not Generated" logic
  - Header stats rendering
  - Retry flow (error -> retry -> success)
  - Project change re-fetch

---

## Genuinely New Work Needed

Based on the gap between what the raw idea describes and what already exists, the **truly new work** falls into these categories:

### A. Loading Skeleton for Initial Page Load (NOT scope change)
- **Current state**: Initial load shows plain text "Loading dashboard..." (no skeleton).
- **Scope change**: Already has skeleton cards.
- **Gap**: Replace the plain "Loading dashboard..." text with a full-page skeleton layout that mirrors the dashboard structure (header skeleton + 4 strategic cards skeletons + scope bar skeleton + 6 detail card skeletons). This would provide a consistent skeleton experience for BOTH initial load AND scope change.

### B. Enhanced Error State UX
- **Current state**: Error replaces the entire dashboard with a small error banner. The user loses all context.
- **Potential improvements**:
  - Show error as a dismissible banner/toast at the top while preserving stale data (if any)
  - Add a friendlier error message with an icon
  - Show error inline within the section that failed (scope change error could show inline rather than replacing the whole page)
  - Add a loading spinner on the retry button while re-fetching
- **Gap**: The scope-change error path (lines 124-128 of `handleScopeChange`) sets `error` which triggers the full-page error state, discarding all previously rendered data. This could be improved to show an inline error while preserving the existing dashboard content.

### C. Snapshot Tests
- **Current state**: No `__snapshots__` directory exists. All 61 tests are behavioral (assertion-based).
- **Gap**: Add snapshot tests for each visual state:
  - Empty state (no project)
  - Loading state (initial skeleton)
  - Success state (full dashboard with data)
  - Error state (error banner + retry)
  - Scope loading state (skeleton cards in detail section)
  - Disabled card (Summary Insight)

### D. Test Coverage Gaps (if any remain)
- **Current state**: Coverage is extensive but may have minor gaps:
  - No test for the "No dashboard data available." guard (line 173 -- data is null after successful load, edge case)
  - No snapshot tests at all
  - The `renderMetric` helper function is tested indirectly but not in isolation
  - No test for CSS animation/shimmer (not testable in JSDOM, acknowledged)

---

## Clarifying Questions

Based on your idea for Dashboard Increment 6, I have some clarifying questions:

1. **Initial load skeleton vs. current "Loading dashboard..." text**: The scope-change skeleton cards already exist (Increment 4). I assume the main gap is replacing the plain "Loading dashboard..." text on initial page load with a full-page skeleton that mirrors the dashboard structure (header bar skeleton + 4 strategic card skeletons + scope bar + 6 detail card skeletons). Is that the intended scope, or did you also want to rework the existing scope-change skeletons?

2. **Error state behavior on scope change**: Currently, when a scope-change fetch fails, the error replaces the ENTIRE dashboard (all data is lost, user sees only the error message + Retry). I assume you want to change this so that scope-change errors show an inline error banner/toast while preserving the previously loaded dashboard data. Is that correct, or should the full-page error replacement remain?

3. **Error state visual treatment**: The current error state is a simple red banner with text and a Retry button. Should we add: (a) an error icon, (b) a more descriptive/friendly message wrapper (e.g., "Something went wrong loading your dashboard. Please try again."), (c) a loading spinner on the Retry button during re-fetch? Or is the current error banner styling sufficient and you only want the behavioral change from question 2?

4. **Snapshot test scope**: I assume "snapshot tests" means Vitest inline snapshots or file-based `.snap` snapshots using `toMatchSnapshot()`. Should these be: (a) full-component snapshots of each major visual state (empty, loading, success, error, scope-loading), or (b) targeted snapshots of specific sub-sections (header, individual card, error banner)? Option (a) tends to be brittle with large components; option (b) is more maintainable.

5. **Test file organization**: The codebase currently has 8 separate dashboard test files split by increment. Should the new snapshot tests go into a single new file (e.g., `dashboard-increment-6-snapshots.test.tsx`), or should they be consolidated with the existing test files?

6. **Loading skeleton for strategic foundation section**: Currently, the 4 strategic foundation cards are always shown instantly (no skeleton during initial load OR scope change -- they persist even during scope loading). Should the initial load skeleton include placeholder skeletons for the strategic foundation row too, since no data exists yet during the initial fetch?

7. **Is there anything explicitly OUT OF SCOPE that I should note?** For example: accessibility improvements, responsive layout changes, animation/transition refinements, new card types, or backend changes?

**Existing Code Reuse:**
Are there existing features in your codebase with similar patterns we should reference? For example:
- The existing skeleton card pattern in `DashboardView.module.css` (`.skeletonCard`, `.skeletonBar`, `@keyframes shimmer`) for reuse in the initial load skeleton
- The `Toast` component (`frontend/src/components/common/Toast.tsx`) as a potential pattern for inline error notifications
- Similar loading/error/empty state patterns from other views

Please provide file/folder paths or names of these features if there are additional ones to consider.

**Visual Assets Request:**
Do you have any design mockups, wireframes, or screenshots that could help guide the development?

If yes, please place them in:
`agent-os/specs/2026-02-18-dashboard-increment-6-polish-loading-error-ux-snapshot-test-coverage/planning/visuals/`

Use descriptive file names like:
- loading-skeleton-mockup.png
- error-banner-design.png
- dashboard-current-state.png

Please answer the questions above and let me know if you have added any visual files or can point to similar existing features.

---

## User Answers to Clarifying Questions

### Q1: Initial load skeleton
**Answer:** Yes -- replace the initial "Loading dashboard..." with a full-page skeleton matching the dashboard structure. Keep the scope-change skeleton behavior as already decided (only bottom 6 cards skeleton).

### Q2: Scope-change error resilience
**Answer:** Yes -- on scope-change fetch failure, preserve the previously loaded data and show an inline error banner/toast for the bottom section only (Strategic stays visible).

### Q3: Error visual treatment
**Answer:** Keep styling broadly the same; minor polish only (optional small error icon and a spinner/disabled state on Retry is fine, but no redesign).

### Q4: Snapshot test scope
**Answer:** Use (b) -- targeted snapshots for key subcomponents/states (loading skeleton block, success dashboard shell) and rely on explicit assertions for the rest to avoid brittleness.

### Q5: Test file organization
**Answer:** Organize tests by component: `DashboardView.test.tsx` for state/interaction tests; optionally a `DashboardSkeleton.test.tsx` if skeleton is its own component (avoid a special "increment" test file).

### Q6: Initial load skeleton coverage
**Answer:** Yes -- initial load skeleton covers ALL sections (header + 4 strategic cards + scope bar + 6 detail cards).

### Q7: Exclusions
**Answer:** Accessibility overhaul, responsive/mobile redesign, animations, new cards/metrics, any backend or API contract changes, and any polling/auto-refresh.

---

## Post-Answer Codebase Deep Dive

After receiving the user's answers, a targeted codebase investigation was performed to validate feasibility and identify implementation specifics.

### 1. Initial Loading Branch (DashboardView.tsx lines 148-155)

The current loading branch is an early return that replaces the entire dashboard:

```tsx
if (loading) {
  return (
    <div className={styles.container} data-testid="dashboard-view">
      <div className={styles.loadingState}>Loading dashboard...</div>
    </div>
  );
}
```

**Implication for Increment 6:** This entire early-return block will be replaced with a full-page skeleton. The skeleton must render inside the same `container` div and include placeholder blocks for:
- Header summary bar (`.headerSummary` shape)
- "Strategic Foundation" heading + 4 skeleton cards in `.strategicGrid`
- Scope control bar (`.scopeControlBar` shape)
- "Detailed Definition & Delivery" heading + "Pre-Coding" subheading + 3 skeleton cards
- "Post-Coding" subheading + 3 skeleton cards

### 2. Error State Branch (DashboardView.tsx lines 157-167)

The current error branch is also an early return:

```tsx
if (error) {
  return (
    <div className={styles.container} data-testid="dashboard-view">
      <div className={styles.errorState}>
        <span>{error}</span>
        <button onClick={fetchData}>Retry</button>
      </div>
    </div>
  );
}
```

**Implication for Increment 6:**
- **Initial load errors:** This full-page error behavior is fine and should stay. If the first fetch fails, there is no stale data to preserve.
- **Scope-change errors:** The `handleScopeChange` function (lines 117-129) currently sets `setError(message)` on catch, which triggers this same full-page error state. This needs to be changed to use a separate `scopeError` state variable so the main dashboard content remains visible while showing an inline error for the bottom section only.

### 3. handleScopeChange Error Handling (DashboardView.tsx lines 117-129)

```tsx
const handleScopeChange = useCallback(async (newScope: ScopeType) => {
  setSelectedScope(newScope);
  setScopeLoading(true);
  try {
    const result = await getDashboardSummary(activeProject!.id, newScope);
    setData(result);
    setScopeLoading(false);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load dashboard data';
    setError(message);   // <-- This triggers full-page error state
    setScopeLoading(false);
  }
}, [activeProject]);
```

**Key change needed:** Replace `setError(message)` with a new `setScopeError(message)` that does NOT trigger the full-page error branch. The scope error will be rendered inline within the Detailed D&D section instead.

### 4. Existing Skeleton CSS (DashboardView.module.css lines 350-392)

The following CSS classes already exist and can be directly reused for the initial-load skeleton:

- `.skeletonCard` -- white card with border, padding, flex column layout (mirrors `.card`)
- `.skeletonBar` -- 12px high bar with shimmer gradient animation
- `.skeletonBarTitle` -- 60% width
- `.skeletonBarMetric1` -- 80% width
- `.skeletonBarMetric2` -- 55% width
- `.skeletonBarMetric3` -- 40% width
- `@keyframes shimmer` -- left-to-right gradient sweep, 1.5s infinite

**New CSS needed for initial-load skeleton:**
- `.skeletonHeaderBar` -- a single wide shimmer bar matching `.headerSummary` dimensions
- `.skeletonScopeBar` -- a narrow shimmer bar matching `.scopeControlBar` dimensions
- `.skeletonSectionHeading` -- a short shimmer bar for section/subheading text
- Possibly `.skeletonStrategicCard` if strategic cards need different skeleton shapes than detail cards (same `.skeletonCard` class should work for both since both use similar card layout)

### 5. Toast Component (frontend/src/components/common/Toast.tsx)

The Toast component is a good candidate for the scope-change error notification:

- **Props:** `message: string`, `type: 'success' | 'error'`, `visible: boolean`, `onDismiss: () => void`, optional `duration` and `data-testid`
- **Behavior:** Auto-dismiss (5s success, 30s error), manual dismiss via close button, fixed position bottom center, slide-up animation
- **Positioning:** Fixed at bottom center of viewport (`position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%)`)
- **z-index:** 1100

**Assessment for scope-change error:** The Toast could work, but the user's answer says "inline error banner/toast for the bottom section only." The existing Toast is globally positioned (fixed bottom center), not inline within a section. Two approaches:
1. Use the existing Toast as-is (appears as overlay notification) -- simpler, reuses existing component
2. Create a small inline error banner rendered within the Detailed D&D section -- more precisely matches the "inline for the bottom section only" requirement

Given the user's preference for minimal redesign (Q3 answer), either approach works. The spec should note both options and recommend the simpler one (existing Toast) with a fallback to inline if the spec-writer prefers.

### 6. Existing Test File Naming and Patterns

Current dashboard test files:
- `dashboard-increment-1-dashboardview.test.tsx` (increment-based naming)
- `dashboard-increment-1-navigation.test.tsx` (increment-based naming)
- `dashboard-increment-3-dashboardview.test.tsx` (increment-based naming)
- `dashboard-increment-3-gap-tests.test.tsx` (increment-based naming)
- `dashboard-increment-4-scope-selector.test.tsx` (increment-based naming)
- `dashboard-increment-4-gap-fill.test.tsx` (increment-based naming)
- `DashboardView.personaPanel.test.tsx` (component-based naming -- Inc 5)

**User's decision:** Organize by component, not increment. New test file should be `DashboardView.test.tsx`. If a separate skeleton component is extracted, it gets `DashboardSkeleton.test.tsx`.

**Note:** The existing increment-based files will NOT be consolidated/renamed in this increment -- that would be a refactoring task outside scope. The new tests simply follow the new naming convention going forward.

**Test mock pattern:** All existing dashboard tests use the same pattern:
- `vi.mock` for `ProjectContext`, `ArchitectureContext`, `PersonaPanelContext`, `dashboardApi`, and the CSS module
- CSS module mocked with `Proxy` identity mapping (class name === property name)
- `sampleDto` fixture duplicated in each file
- `beforeEach` with dynamic `import()` of `DashboardView`

### 7. Visual Assets Check

**Mandatory bash check performed:** No visual files found in `planning/visuals/`.

---

## Decisions Summary

| Decision | Outcome |
|----------|---------|
| Initial load skeleton | Full-page skeleton covering ALL sections (header + 4 strategic + scope bar + 6 detail) |
| Scope-change skeleton | Keep existing behavior (bottom 6 cards only, strategic stays visible) |
| Scope-change error | Preserve existing data, show inline error/toast for bottom section only |
| Initial load error | Keep existing full-page error behavior (no stale data to preserve) |
| Error styling | Minor polish only -- optional small error icon, spinner/disabled on Retry |
| Snapshot approach | Targeted snapshots for key subcomponents/states, explicit assertions for the rest |
| Test file naming | `DashboardView.test.tsx` (component-based); optionally `DashboardSkeleton.test.tsx` |
| Skeleton component extraction | Possible -- if extracted, it gets its own test file |
| Toast reuse | Existing `Toast.tsx` component is available; inline banner also an option |
| Out of scope | Accessibility, responsive, animations, new cards, backend changes, polling |
