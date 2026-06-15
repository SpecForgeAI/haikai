# Tasks: Dashboard Increment 6 -- Polish + Loading/Error UX + Snapshot Test Coverage

> Auto-generated from `spec.md` on 2026-02-18

## Overview

Replace the plain-text "Loading dashboard..." state with a full-page skeleton component, make scope-change errors non-destructive (preserving previously loaded data with an inline error banner), add minor error-state polish (icon, retry spinner), fix the two existing test files that will break, and introduce targeted snapshot + behavioral tests. No new features, no backend changes.

**Total Task Groups:** 6
**Total Tasks:** 27

---

## Task Groups

### TG1: DashboardSkeleton Component + CSS

**Dependencies:** None

This group creates the extracted `DashboardSkeleton` sub-component and the three new CSS classes it requires. The skeleton mirrors the full dashboard structure: header bar, 4 strategic cards, scope bar, 6 detail cards, and 4 section/subheading placeholders.

- [x] **Task 1.1**: Add three new CSS classes to `DashboardView.module.css`
  - File(s): `frontend/src/components/DashboardView/DashboardView.module.css`
  - Details:
    - Add `.skeletonHeaderBar` after line 392 (after the `@keyframes shimmer` block). This is a single wide shimmer bar matching `.headerSummary` dimensions: `width: 100%; height: 54px; border-radius: 6px;` using the same `background` gradient and `animation: shimmer 1.5s ease-in-out infinite` as `.skeletonBar`.
    - Add `.skeletonScopeBar`: a narrow shimmer bar matching `.scopeControlBar` height: `width: 220px; height: 36px; border-radius: 4px;` with the same shimmer gradient/animation.
    - Add `.skeletonSectionHeading`: a short shimmer bar for section/subheading placeholders: `width: 120px; height: 14px; border-radius: 4px;` with the same shimmer gradient/animation.
    - All three classes reuse the exact `background`, `background-size`, and `animation` values from `.skeletonBar` (line 361-367).

- [x] **Task 1.2**: Add `.scopeErrorBanner` CSS class to `DashboardView.module.css`
  - File(s): `frontend/src/components/DashboardView/DashboardView.module.css`
  - Details:
    - Add `.scopeErrorBanner` replicating `.errorState` colors: `background: #fff3f3; border: 1px solid #ffcdd2; color: #c62828; border-radius: 6px; padding: 12px; font-size: 12px; font-weight: 500; display: flex; align-items: center; gap: 12px;`
    - Add `.scopeErrorBanner button` matching `.errorState button` styles: `background: #c62828; color: #ffffff; border: none; border-radius: 4px; padding: 4px 12px; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;`
    - Add `.scopeErrorBanner button:hover` with `background: #b71c1c;`
    - Add `.scopeErrorBanner button:disabled` with `opacity: 0.6; cursor: not-allowed;`
    - This class is used inline within the Detailed D&D section, not as an early-return replacement.

- [x] **Task 1.3**: Create `DashboardSkeleton.tsx` component
  - File(s): `frontend/src/components/DashboardView/DashboardSkeleton.tsx` (new file)
  - Details:
    - Create a new React functional component `DashboardSkeleton` that accepts no props.
    - Import `styles` from `./DashboardView.module.css`.
    - The component returns a single wrapper `<div data-testid="dashboard-skeleton">` containing:
      1. One `<div className={styles.skeletonHeaderBar} />` (header summary skeleton)
      2. One `<div className={styles.skeletonSectionHeading} />` ("Strategic Foundation" heading placeholder)
      3. A `<div className={styles.strategicGrid}>` containing 4 skeleton cards (each uses the existing `.skeletonCard` / `.skeletonBar` / `.skeletonBarTitle` / `.skeletonBarMetric1` / `.skeletonBarMetric2` / `.skeletonBarMetric3` markup pattern from DashboardView.tsx lines 330-347)
      4. One `<div className={styles.skeletonScopeBar} />` (scope control bar skeleton)
      5. One `<div className={styles.skeletonSectionHeading} />` ("Detailed D&D" heading placeholder)
      6. One `<div className={styles.skeletonSectionHeading} />` ("Pre-Coding" subheading placeholder)
      7. A `<div className={styles.detailGrid}>` containing 3 skeleton cards (pre-coding)
      8. One `<div className={styles.skeletonSectionHeading} />` ("Post-Coding" subheading placeholder)
      9. A `<div className={styles.detailGrid}>` containing 3 skeleton cards (post-coding)
    - Total: 10 skeleton cards + 1 header bar + 1 scope bar + 4 heading/subheading placeholders.
    - Export as named export: `export const DashboardSkeleton: React.FC`.

**Acceptance Criteria:**
- `DashboardSkeleton.tsx` renders 10 skeleton cards, 1 header bar skeleton, 1 scope bar skeleton, and 4 section heading skeletons.
- Three new CSS classes (`.skeletonHeaderBar`, `.skeletonScopeBar`, `.skeletonSectionHeading`) use the same shimmer animation as `.skeletonBar`.
- `.scopeErrorBanner` CSS class replicates `.errorState` colors for inline use.
- The component has `data-testid="dashboard-skeleton"` on its root wrapper.

---

### TG2: Wire Skeleton into DashboardView + Scope-Error Resilience + Error Polish

**Dependencies:** TG1

This group modifies `DashboardView.tsx` to: (a) replace the "Loading dashboard..." early-return with the new skeleton, (b) add `scopeError` state for non-destructive scope-change errors with an inline banner, and (c) add minor error polish (icon, retry spinner).

- [x] **Task 2.1**: Replace loading early-return with `DashboardSkeleton`
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - Add import: `import { DashboardSkeleton } from './DashboardSkeleton';`
    - Replace lines 148-155 (the `if (loading)` early-return block) with:
      ```tsx
      if (loading) {
        return (
          <div className={styles.container} data-testid="dashboard-view">
            <DashboardSkeleton />
          </div>
        );
      }
      ```
    - The outer `<div>` with `className={styles.container}` and `data-testid="dashboard-view"` must be preserved for test compatibility.

- [x] **Task 2.2**: Add `scopeError` state variable and `retrying` state variable
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - Add after the existing `scopeLoading` state declaration (line 92):
      ```tsx
      const [scopeError, setScopeError] = useState<string | null>(null);
      const [retrying, setRetrying] = useState<boolean>(false);
      ```
    - These are separate from the existing `error` state (line 90) which remains for initial-load errors only.

- [x] **Task 2.3**: Modify `handleScopeChange` to use `scopeError` instead of `error`
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - In the `handleScopeChange` function (lines 117-129):
      - Add `setScopeError(null);` at the top of the function, alongside the existing `setScopeLoading(true)` (line 119).
      - In the catch block (line 126), replace `setError(message)` with `setScopeError(message)`.
    - This prevents scope-change errors from triggering the full-page error early-return branch (line 158), preserving the header, strategic foundation cards, and scope bar.

- [x] **Task 2.4**: Add `retrying` logic to `fetchData`
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - This task modifies the error state's Retry button behavior, not `fetchData` itself.
    - In the error early-return block (lines 157-167), change the Retry button's `onClick` to:
      ```tsx
      onClick={async () => { setRetrying(true); try { await fetchData(); } finally { setRetrying(false); } }}
      ```
    - Add `disabled={retrying}` to the button.
    - Change the button text to `{retrying ? 'Retrying...' : 'Retry'}`.

- [x] **Task 2.5**: Add error icon to full-page error state
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - In the error early-return block (lines 157-167), add a warning icon before the error message `<span>`:
      ```tsx
      <span style={{ fontSize: '16px' }}>{'\u26A0'}</span>
      <span>{error}</span>
      ```
    - The `\u26A0` is the Unicode warning triangle character.

- [x] **Task 2.6**: Render inline scope-error banner in Detailed D&D section
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - After the "Detailed Definition & Delivery" `<h3>` heading (line 324) and before the "Pre-Coding" `<div className={styles.subheading}>` (line 327), add a conditional block:
      ```tsx
      {scopeError ? (
        <div className={styles.scopeErrorBanner} data-testid="scope-error-banner">
          <span style={{ fontSize: '16px' }}>{'\u26A0'}</span>
          <span>{scopeError}</span>
          <button
            onClick={() => handleScopeChange(selectedScope)}
            disabled={scopeLoading}
          >
            {scopeLoading ? 'Retrying...' : 'Retry'}
          </button>
        </div>
      ) : (
        <>
          {/* Pre-Coding Row */}
          <div className={styles.subheading}>Pre-Coding</div>
          {scopeLoading ? ( ... existing skeleton ... ) : ( ... existing cards ... )}

          {/* Post-Coding Row */}
          <div className={styles.subheading}>Post-Coding</div>
          {scopeLoading ? ( ... existing skeleton ... ) : ( ... existing cards ... )}
        </>
      )}
      ```
    - When `scopeError` is truthy, the banner replaces the pre-coding and post-coding card grids entirely. The header, strategic foundation cards, and scope bar all remain visible above.
    - The inline Retry button calls `handleScopeChange(selectedScope)` and uses `scopeLoading` for its disabled/spinner state (since `handleScopeChange` already sets `scopeLoading`).
    - The existing "Pre-Coding" subheading `<div>` on line 327 must be moved inside the else branch of this conditional.

- [x] **Task 2.7**: Update component file header comment
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - Add to the file header comment block (lines 1-25):
      ```
      * Spec 2026-02-18: Dashboard Increment 6 -- (full-page skeleton, scope-error resilience, error polish)
      ```

**Acceptance Criteria:**
- Loading state renders `DashboardSkeleton` inside the existing `dashboard-view` testid wrapper (no more "Loading dashboard..." text).
- Scope-change errors preserve header, strategic cards, and scope bar; show inline `scope-error-banner` in the Detailed D&D section.
- Full-page error state shows warning icon and has disabled/spinner Retry button during re-fetch.
- Inline scope-error banner Retry button triggers `handleScopeChange(selectedScope)` and disables during `scopeLoading`.
- `scopeError` state is cleared at the start of each new scope change.

---

### TG3: Fix Broken Existing Tests

**Dependencies:** TG2

Two existing test files contain assertions that will break due to the loading skeleton replacement and scope-error resilience changes. These must be updated before new tests are written.

- [x] **Task 3.1**: Fix Test 2 in `dashboard-increment-3-dashboardview.test.tsx`
  - File(s): `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
  - Details:
    - Test 2 (lines 162-168) currently asserts: `expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();`
    - This will fail because "Loading dashboard..." text no longer exists; the skeleton is rendered instead.
    - Replace the assertion with:
      ```tsx
      expect(screen.getByTestId('dashboard-skeleton')).toBeInTheDocument();
      expect(screen.queryByTestId('header-summary')).not.toBeInTheDocument();
      ```
    - Update the test description to: `'Test 2: renders skeleton loading state while fetch is in progress'`

- [x] **Task 3.2**: Fix Gap 1 in `dashboard-increment-4-gap-fill.test.tsx`
  - File(s): `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`
  - Details:
    - Gap 1 (lines 148-178) currently asserts after a scope-change error:
      - `expect(screen.queryByTestId('scope-selector')).not.toBeInTheDocument();` (line 177)
    - With scope-error resilience, the scope selector now REMAINS visible. Update assertions to:
      ```tsx
      // Inline scope error banner is shown
      expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
      // Scope selector remains visible (dashboard data preserved)
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
      // Strategic foundation cards remain visible
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
      expect(screen.getByTestId('card-roadmap')).toBeInTheDocument();
      // Error message is displayed within the scope error banner
      expect(screen.getByText('Scope fetch failed')).toBeInTheDocument();
      // Retry button is available in the banner
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      ```
    - Update the test description to reflect the new behavior: `'Gap 1: error during scope change shows inline error banner while preserving dashboard data'`

- [x] **Task 3.3**: Fix Gap 2 in `dashboard-increment-4-gap-fill.test.tsx`
  - File(s): `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`
  - Details:
    - Gap 2 (lines 180-223) currently asserts after scope-change rejection:
      - No skeleton cards remain (line 221-222): `expect(remainingSkeletons.length).toBe(0);`
      - This was correct when the full-page error state replaced everything. Now the inline `scope-error-banner` replaces the card grids.
    - Update the post-rejection assertions to:
      ```tsx
      // After rejection, inline scope error banner should display
      await waitFor(() => {
        expect(screen.getByTestId('scope-error-banner')).toBeInTheDocument();
      });
      expect(screen.getByText('Network timeout')).toBeInTheDocument();
      // No skeleton cards should remain
      const remainingSkeletons = screen.getByTestId('dashboard-view').querySelectorAll('.skeletonCard');
      expect(remainingSkeletons.length).toBe(0);
      // Strategic cards and scope selector remain visible
      expect(screen.getByTestId('scope-selector')).toBeInTheDocument();
      expect(screen.getByTestId('card-product-definition')).toBeInTheDocument();
      ```
    - Update the test description to: `'Gap 2: scope-change error clears skeleton and shows inline error banner while preserving data'`

- [x] **Task 3.4**: Run fixed existing tests to verify no regressions
  - Details:
    - Run ONLY the two modified test files:
      - `npx vitest run frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
      - `npx vitest run frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx`
    - All 10 tests across both files (8 in inc-3, 2 in inc-4-gap) should pass.
    - Do NOT run the entire test suite at this stage.

**Acceptance Criteria:**
- Test 2 in inc-3 asserts `dashboard-skeleton` testid instead of "Loading dashboard..." text.
- Gap 1 in inc-4-gap asserts scope-error-banner is visible, scope-selector remains, strategic cards remain.
- Gap 2 in inc-4-gap asserts scope-error-banner replaces skeletons, dashboard data preserved.
- All 10 tests in the two modified files pass.

---

### TG4: New Test File -- DashboardSkeleton.test.tsx

**Dependencies:** TG1

Isolated tests for the extracted `DashboardSkeleton` component. This group can run in parallel with TG2/TG3 since it only depends on the skeleton component and CSS from TG1.

- [x] **Task 4.1**: Create `DashboardSkeleton.test.tsx`
  - File(s): `frontend/src/__tests__/DashboardSkeleton.test.tsx` (new file)
  - Details:
    - Mock the CSS module with Proxy identity mapping (same pattern as existing dashboard tests).
    - Import `DashboardSkeleton` from `../components/DashboardView/DashboardSkeleton`.
    - Write the following 4 tests:
      1. **Renders correct number of skeleton cards**: Render `<DashboardSkeleton />`, query all elements with class `skeletonCard`, assert count is 10 (4 strategic + 3 pre-coding + 3 post-coding).
      2. **Renders header bar skeleton**: Assert an element with class `skeletonHeaderBar` exists.
      3. **Renders scope bar and section heading skeletons**: Assert an element with class `skeletonScopeBar` exists. Assert 4 elements with class `skeletonSectionHeading` exist (Strategic Foundation, Detailed D&D, Pre-Coding, Post-Coding).
      4. **Snapshot test**: Render `<DashboardSkeleton />`, get the element by `data-testid="dashboard-skeleton"`, call `expect(element).toMatchSnapshot()` for regression detection.

- [x] **Task 4.2**: Run DashboardSkeleton tests
  - Details:
    - Run ONLY: `npx vitest run frontend/src/__tests__/DashboardSkeleton.test.tsx`
    - All 4 tests should pass.
    - The snapshot file `frontend/src/__tests__/__snapshots__/DashboardSkeleton.test.tsx.snap` should be created.

**Acceptance Criteria:**
- 4 tests pass: card count (10), header bar present, scope bar + 4 headings present, snapshot matches.
- Snapshot file is generated and committed.

---

### TG5: New Test File -- DashboardView.test.tsx

**Dependencies:** TG2, TG3

Behavioral and snapshot tests for the modified `DashboardView` component covering the new loading skeleton, scope-error resilience, and retry spinner states.

- [x] **Task 5.1**: Create `DashboardView.test.tsx` with mock setup and sampleDto fixture
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx` (new file)
  - Details:
    - Follow the identical mock setup pattern from all existing dashboard test files:
      - `vi.mock` for `ProjectContext` (returns `mockActiveProject`)
      - `vi.mock` for `ArchitectureContext` (returns `mockDispatch`)
      - `vi.mock` for `PersonaPanelContext` (returns `mockOpenPanel`)
      - `vi.mock` for `dashboardApi` (delegates to `mockGetDashboardSummary`)
      - `vi.mock` for CSS module with `Proxy` identity mapping
    - Duplicate the `sampleDto` fixture (same as in `dashboard-increment-4-gap-fill.test.tsx` lines 60-130). Do NOT extract a shared fixture file.
    - Use `beforeEach` with dynamic `import()` of `DashboardView` and `vi.clearAllMocks()`.

- [x] **Task 5.2**: Write snapshot test -- loading skeleton
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "renders loading skeleton and matches snapshot"
    - Set `mockActiveProject` to a valid project. Mock `getDashboardSummary` with `new Promise(() => {})` (never resolves).
    - Render `<DashboardView />`.
    - Assert `screen.getByTestId('dashboard-skeleton')` is in the document.
    - Snapshot the `dashboard-skeleton` element's `innerHTML`: `expect(screen.getByTestId('dashboard-skeleton').innerHTML).toMatchSnapshot()`.

- [x] **Task 5.3**: Write snapshot test -- success dashboard shell
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "renders success dashboard and matches targeted snapshot"
    - Set `mockActiveProject`, mock `getDashboardSummary` to resolve with `sampleDto`.
    - Render and `waitFor` the `header-summary` testid to appear.
    - Snapshot a targeted container query -- get the `dashboard-view` testid element, then snapshot only the tag names and data-testids of its direct children (or use `element.outerHTML` of `header-summary` specifically) to avoid brittleness with full innerHTML.
    - Alternatively: snapshot `screen.getByTestId('header-summary').innerHTML` as the targeted sub-section.

- [x] **Task 5.4**: Write behavioral test -- scope-change error preserves header and strategic cards
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "scope-change error preserves header and strategic foundation cards"
    - Initial load succeeds (resolve with `sampleDto`). Wait for cards to render.
    - Mock next call to reject with `new Error('Scope error')`.
    - Fire change event on `scope-selector` to trigger `handleScopeChange`.
    - Assert: `header-summary` testid is still in the document, `card-product-definition` is still visible, `card-roadmap` is still visible, `scope-selector` is still visible.

- [x] **Task 5.5**: Write behavioral test -- scope-change error shows inline banner with Retry
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "scope-change error shows inline error banner with Retry button"
    - Same setup as 5.4: initial load succeeds, then scope-change rejects.
    - Assert: `screen.getByTestId('scope-error-banner')` is in the document.
    - Assert: the error message text ("Scope error") is visible within the banner.
    - Assert: a Retry button exists within the banner.

- [x] **Task 5.6**: Write behavioral test -- clicking inline Retry re-triggers scope fetch
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "clicking Retry in scope error banner re-triggers scope fetch"
    - Setup: initial load succeeds, scope change rejects, banner appears.
    - Mock next `getDashboardSummary` call to resolve with `sampleDto` (recovery).
    - Click the Retry button in the banner.
    - Assert: `getDashboardSummary` was called again (check `mockGetDashboardSummary.mock.calls.length`).
    - After resolution, assert: `scope-error-banner` is no longer in the document (banner cleared by `setScopeError(null)` at the start of `handleScopeChange`), and detail cards are visible again.

- [x] **Task 5.7**: Write behavioral test -- retrying state disables Retry button on full-page error
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx`
  - Details:
    - Test: "retrying state disables Retry button on full-page error"
    - Mock initial load to reject (triggers full-page error state).
    - Wait for error state and Retry button to appear.
    - Mock next `getDashboardSummary` with `new Promise(() => {})` (never resolves, keeps retrying state).
    - Click Retry.
    - Assert: the button text changes to "Retrying..." and the button is `disabled`.

- [x] **Task 5.8**: Run DashboardView.test.tsx
  - Details:
    - Run ONLY: `npx vitest run frontend/src/__tests__/DashboardView.test.tsx`
    - All 6 tests (Tasks 5.2-5.7) should pass.
    - Snapshot file `frontend/src/__tests__/__snapshots__/DashboardView.test.tsx.snap` should be created.

**Acceptance Criteria:**
- 6 tests pass: 2 snapshot tests + 4 behavioral tests.
- Snapshot files are generated for both the loading skeleton innerHTML and the success header innerHTML.
- Scope-error resilience is verified: data preserved, inline banner shown, retry works, banner clears on success.
- Retrying state disables the full-page error Retry button and changes text to "Retrying...".

---

### TG6: Test Gap Analysis + Verification

**Dependencies:** TG1-TG5

Review all tests written in TG3-TG5, identify any critical untested paths for THIS feature, and run all feature-related tests together.

- [x] **Task 6.1**: Review tests from TG3, TG4, and TG5
  - Details:
    - TG3: 2 fixed tests in inc-3 (Test 2) and inc-4-gap (Gap 1, Gap 2) -- 3 assertions updated total across 10 tests in those files.
    - TG4: 4 new tests in `DashboardSkeleton.test.tsx` (card count, header bar, scope/headings, snapshot).
    - TG5: 6 new tests in `DashboardView.test.tsx` (2 snapshots + 4 behavioral).
    - Total new/modified tests: 10 new + 3 modified assertions.

- [x] **Task 6.2**: Identify critical untested paths for this feature
  - Details:
    - Check if the following are covered (and add tests in Task 6.3 ONLY if critical gaps exist):
      - `scopeError` state cleared at the start of `handleScopeChange` (partially covered by Task 5.6 retry test)
      - Warning icon (`\u26A0`) renders in full-page error state (minor, could be a gap)
      - Warning icon renders in scope-error banner (minor, could be a gap)
      - `scopeLoading` disables inline Retry button text to "Retrying..." (partially covered by Task 5.5/5.6)
      - Multiple consecutive scope-change errors do not stack (edge case)
      - Full-page error Retry success clears error and shows dashboard (already covered by inc-3 gap test 1)

- [x] **Task 6.3**: Write up to 4 additional tests to fill critical gaps (if needed)
  - File(s): `frontend/src/__tests__/DashboardView.test.tsx` (append to existing file from TG5)
  - Details:
    - Only write tests if Task 6.2 identifies genuinely critical gaps. Possible candidates:
      1. "full-page error state renders warning icon" -- assert `\u26A0` character is present in the error state.
      2. "scope-error banner Retry button shows Retrying... while loading" -- trigger scope error, click Retry with a never-resolving promise, assert button text is "Retrying..." and button is disabled.
    - Maximum 4 additional tests. Skip edge cases, performance tests, and accessibility tests.

- [x] **Task 6.4**: Run ALL feature-related tests together
  - Details:
    - Run all dashboard test files that were modified or created in this increment:
      ```
      npx vitest run frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx frontend/src/__tests__/DashboardSkeleton.test.tsx frontend/src/__tests__/DashboardView.test.tsx
      ```
    - Expected total: approximately 20-24 tests (8 inc-3 + 2 inc-4-gap + 4 skeleton + 6-10 DashboardView).
    - All tests must pass.

- [x] **Task 6.5**: Run the FULL dashboard test suite for regression check
  - Details:
    - Run all 8+ dashboard test files together to verify no regressions in untouched tests:
      ```
      npx vitest run frontend/src/__tests__/dashboard-increment-1-dashboardview.test.tsx frontend/src/__tests__/dashboard-increment-1-navigation.test.tsx frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx frontend/src/__tests__/DashboardView.personaPanel.test.tsx frontend/src/__tests__/DashboardSkeleton.test.tsx frontend/src/__tests__/DashboardView.test.tsx
      ```
    - All 71+ tests (61 existing + 10+ new) must pass.
    - Verify snapshot files are committed.

**Acceptance Criteria:**
- All feature-related tests pass (TG3 + TG4 + TG5 tests).
- Full dashboard test suite passes with no regressions in untouched test files.
- No more than 4 additional gap-fill tests added.
- Snapshot files exist and are stable.

---

## Execution Order

Recommended implementation sequence:

1. **TG1: DashboardSkeleton Component + CSS** -- No dependencies; creates the foundation files.
2. **TG2: Wire Skeleton + Scope-Error Resilience + Error Polish** -- Depends on TG1; modifies `DashboardView.tsx`.
3. **TG3: Fix Broken Existing Tests** -- Depends on TG2; updates assertions in 2 existing test files.
4. **TG4: New DashboardSkeleton.test.tsx** -- Depends on TG1 only; can run in parallel with TG2/TG3 if desired.
5. **TG5: New DashboardView.test.tsx** -- Depends on TG2 and TG3; the main new test file.
6. **TG6: Test Gap Analysis + Verification** -- Depends on all previous; final validation.

## Files Changed Summary

| File | Action | Task Group |
|------|--------|------------|
| `frontend/src/components/DashboardView/DashboardView.module.css` | Modified (4 new CSS classes) | TG1 |
| `frontend/src/components/DashboardView/DashboardSkeleton.tsx` | New file | TG1 |
| `frontend/src/components/DashboardView/DashboardView.tsx` | Modified (skeleton import, scopeError state, retrying state, error icon, inline banner) | TG2 |
| `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` | Modified (Test 2 assertion) | TG3 |
| `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx` | Modified (Gap 1 + Gap 2 assertions) | TG3 |
| `frontend/src/__tests__/DashboardSkeleton.test.tsx` | New file (4 tests) | TG4 |
| `frontend/src/__tests__/DashboardView.test.tsx` | New file (6-10 tests) | TG5, TG6 |
