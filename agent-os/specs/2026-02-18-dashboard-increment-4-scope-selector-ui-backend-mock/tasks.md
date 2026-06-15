# Tasks: Dashboard Increment 4 -- Scope Selector UI + Backend Mock Branching

> Auto-generated from `spec.md` on 2026-02-18

## Overview

Add an interactive scope selector dropdown to the Dashboard that controls the metrics displayed in the Detailed Definition & Delivery section. The selector triggers a refetch of mock data from the gateway. Three distinct mock datasets (large, medium, small) provide visually distinguishable results per scope. Strategic Foundation and header stats remain invariant regardless of scope. Skeleton loading cards replace the bottom 6 cards during scope-change fetches.

**Total Task Groups:** 5
**Total Tasks:** 22

---

## Task Groups

### TG1: Gateway Mock Service -- Add Medium Dataset + Make Strategic Foundation Invariant
Dependencies: none

- [x] **Task 1.1**: Add `buildMediumDetailedDefinitionAndDelivery()` function
  - File(s): `gateway/src/services/dashboardSummaryMockService.ts`
  - Details: Add a new function `buildMediumDetailedDefinitionAndDelivery()` between `buildLargeDetailedDefinitionAndDelivery()` (line 149) and `buildSmallDetailedDefinitionAndDelivery()` (line 196). Follow the exact same structure as the large/small builders. Use these medium-range values:
    - `backlog`: epicsInScope 8, features 18, stories 45, storiesWithAC 32
    - `detailedArchitecture`: overall 18, processActivities 12, interfaceEndpoints 22, logicalDataEntities 8, physicalDataEntities 6
    - `testingSuite`: e2eTests 8, functionalTests 20
    - `postCoding.implementation`: 14
    - `postCoding.verification`: storiesVerified 10, pendingReview 4
    - Keep `summaryInsight` as `{ ...DISABLED_INSIGHT }`

- [x] **Task 1.2**: Refactor `buildMockDashboardSummary()` to make header and strategicFoundation invariant
  - File(s): `gateway/src/services/dashboardSummaryMockService.ts`
  - Details: In the `buildMockDashboardSummary()` function (line 254), make the following changes:
    - **Header stats invariant**: Remove the `isLargeScope` ternary for `initiativesCount`, `epicsCount`, `activeEpicsCount`, `storiesInProgressCount` (lines 271-274). Always use the large values: `initiativesCount: 5`, `epicsCount: 12`, `activeEpicsCount: 4`, `storiesInProgressCount: 18`
    - **Strategic Foundation invariant**: Replace the `isLargeScope ? buildLargeStrategicFoundation() : buildSmallStrategicFoundation()` ternary (lines 278-280) with a direct call to `buildLargeStrategicFoundation()` -- always return the large strategic foundation regardless of scope
    - Note: `buildSmallStrategicFoundation()` function can be left in the file (not deleted) to avoid breaking anything, but it will no longer be called

- [x] **Task 1.3**: Refactor `buildMockDashboardSummary()` to use 3-way branch for detailedDefinitionAndDelivery
  - File(s): `gateway/src/services/dashboardSummaryMockService.ts`
  - Details: Replace the `isLargeScope` boolean and its ternary (lines 259, 282-284) with a 3-way branch using a `switch` or `if/else if/else`:
    - `ENTIRE_PRODUCT` -> `buildLargeDetailedDefinitionAndDelivery()`
    - `QTR` -> `buildMediumDetailedDefinitionAndDelivery()`
    - `NEXT_5_EPICS` -> `buildSmallDetailedDefinitionAndDelivery()`
    - `CUSTOM` -> `buildSmallDetailedDefinitionAndDelivery()` (reuses small dataset)
    - Remove the `isLargeScope` local variable since it is no longer needed
    - Update the JSDoc comment on `buildMockDashboardSummary()` to reflect the 3-way branching and the invariance of header/strategicFoundation

- [x] **Task 1.4**: Write 4-6 focused tests for the mock service changes
  - File(s): `gateway/src/__tests__/dashboardSummary-increment4-mock.test.ts` (new file)
  - Details: Create a new test file (do NOT modify existing `dashboardSummary.test.ts`). Use supertest + the `app` import from `../server`. Tests:
    1. `QTR scope returns medium-range detail values` -- GET with `scope=QTR`, assert `detailedDefinitionAndDelivery.preCoding.backlog.epicsInScope.value` is 8 (medium), `storiesCount.value` is 45
    2. `ENTIRE_PRODUCT scope returns large detail values` -- assert backlog `epicsInScope.value` is 12, `storiesCount.value` is 85
    3. `NEXT_5_EPICS scope returns small detail values` -- assert backlog `epicsInScope.value` is 5, `storiesCount.value` is 22
    4. `CUSTOM scope returns same small detail values as NEXT_5_EPICS` -- assert backlog values match NEXT_5_EPICS exactly, but `scope.label` is "Custom Scope"
    5. `strategicFoundation is invariant across scopes` -- call with `ENTIRE_PRODUCT` and `NEXT_5_EPICS`, assert `strategicFoundation.highLevelArchitecture.overall.value` is equal for both (always 38)
    6. `header stats are invariant across scopes` -- call with `ENTIRE_PRODUCT` and `QTR`, assert `header.initiativesCount` is 5 and `header.epicsCount` is 12 for both

**Acceptance Criteria:**
- `buildMediumDetailedDefinitionAndDelivery()` exists and returns medium-range values
- `buildMockDashboardSummary()` always returns the large strategic foundation regardless of scope
- Header stats (initiativesCount, epicsCount, activeEpicsCount, storiesInProgressCount) are invariant
- `ENTIRE_PRODUCT` returns large detail data, `QTR` returns medium, `NEXT_5_EPICS`/`CUSTOM` return small
- All 4-6 new tests pass
- Existing tests in `dashboardSummary.test.ts` still pass (some assertions on strategicFoundation varying by scope will need updating -- see Task 1.5 note below)

> **Note on existing tests:** The existing `dashboardSummary.test.ts` Tests 3 and 4 assert on `strategicFoundation` values varying by scope. After making strategicFoundation invariant, these specific sub-assertions will fail. The spec says "Changes to the existing test files from Increment 3 (new tests should be additive, not modify existing tests)" -- however, making strategicFoundation invariant is an intentional behavioral change. The developer should note this conflict and only update the minimum necessary assertions in existing tests to reflect the new invariant behavior (e.g., strategicFoundation values are now always the large values regardless of scope).

---

### TG2: Frontend CSS -- Scope Control Bar + Skeleton Card Styles
Dependencies: none (can run in parallel with TG1)

- [x] **Task 2.1**: Add `.scopeControlBar`, `.scopeControlBarLabel`, `.scopeSelector`, `.scopeSelectorDisabled`, and `.customScopePlaceholder` CSS classes
  - File(s): `frontend/src/components/DashboardView/DashboardView.module.css`
  - Details: Append a new section after the existing `.disabledText` block (after line 288). Add the following classes in a new comment section `/* Scope Selector Control Bar */`:
    - `.scopeControlBar`: `display: flex; align-items: center; gap: 12px; margin: 20px 0 4px 0; padding: 0;`
    - `.scopeControlBarLabel`: `font-size: 13px; font-weight: 500; color: #555;`
    - `.scopeSelector`: `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 180px; background: white; cursor: pointer; transition: border-color 0.2s;` with `:focus { outline: none; border-color: #1976D2; }` and `:hover { border-color: #bbb; }`
    - `.scopeSelectorDisabled`: `background: #f5f5f5; color: #999; cursor: not-allowed; opacity: 0.8; border-color: #e0e0e0;`
    - `.customScopePlaceholder`: `font-size: 12px; color: #999; font-style: italic;`
  - Pattern reference: `.diagramTypeSelector` and `.selectorDisabled` in `frontend/src/components/DiagramsView/DiagramsView.module.css` lines 455-535

- [x] **Task 2.2**: Add `.skeletonCard`, `.skeletonBar`, and `@keyframes shimmer` CSS classes
  - File(s): `frontend/src/components/DashboardView/DashboardView.module.css`
  - Details: Append after the scope selector classes. Add a new comment section `/* Skeleton Loading Cards */`:
    - `.skeletonCard`: Same dimensions as `.card` (`background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); display: flex; flex-direction: column; gap: 8px;`)
    - `.skeletonBar`: `height: 12px; border-radius: 4px; background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite;`
    - Add width variant classes for different bar widths: `.skeletonBarTitle { width: 60%; }`, `.skeletonBarMetric1 { width: 80%; }`, `.skeletonBarMetric2 { width: 55%; }`, `.skeletonBarMetric3 { width: 40%; }`
    - `@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`
  - Pattern reference: `@keyframes pulse` in `frontend/src/components/DiagramsView/SequenceEditorPanel.module.css` lines 75-89 for animation timing approach

**Acceptance Criteria:**
- All new CSS classes compile without error
- `.scopeSelector` visually matches the `.diagramTypeSelector` pattern
- `.skeletonCard` matches `.card` dimensions
- `@keyframes shimmer` produces a visible left-to-right gradient sweep animation

---

### TG3: Frontend Component -- Scope Selector State, Handler, and Rendering
Dependencies: TG1, TG2

- [x] **Task 3.1**: Add `ScopeType` import and new state variables to `DashboardView.tsx`
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details:
    - Add `ScopeType` to the import from `'../../types/dashboard'` (line 20): `import type { DashboardSummaryDto, MetricCard, ScopeType } from '../../types/dashboard';`
    - Add two new state variables after the existing `error` state (line 75):
      ```
      const [selectedScope, setSelectedScope] = useState<ScopeType>('NEXT_5_EPICS');
      const [scopeLoading, setScopeLoading] = useState<boolean>(false);
      ```

- [x] **Task 3.2**: Create the `handleScopeChange` async handler function
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details: Add a new handler function after the `fetchData` useCallback (after line 94). This function should:
    - Accept the new scope value as a parameter (from `e.target.value` cast to `ScopeType`)
    - Set `setSelectedScope(newScope)` immediately
    - Set `setScopeLoading(true)`
    - Call `await getDashboardSummary(activeProject!.id, newScope)`
    - On success: call `setData(result)` and `setScopeLoading(false)`
    - On error: call `setError(message)` and `setScopeLoading(false)`
    - Wrap in a `useCallback` with `[activeProject]` dependency
    - Do NOT modify the existing `fetchData` callback -- the initial load remains unchanged (no scope param on first load, so it uses the server default of NEXT_5_EPICS)

- [x] **Task 3.3**: Render the scope control bar with `<select>` element
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details: Insert the scope control bar JSX immediately before the Section 3 `<h3>` heading (between line 262 closing `</div>` of `.strategicGrid` and line 267 `<h3>Detailed Definition & Delivery</h3>`). The markup:
    ```tsx
    {/* Scope Control Bar */}
    <div className={styles.scopeControlBar} data-testid="scope-control-bar">
      <span className={styles.scopeControlBarLabel}>Scope:</span>
      <select
        className={`${styles.scopeSelector}${scopeLoading ? ' ' + styles.scopeSelectorDisabled : ''}`}
        value={selectedScope}
        onChange={(e) => handleScopeChange(e.target.value as ScopeType)}
        disabled={scopeLoading}
        data-testid="scope-selector"
      >
        <option value="ENTIRE_PRODUCT">Entire Product</option>
        <option value="NEXT_5_EPICS">Next 5 Epics</option>
        <option value="QTR">This Quarter</option>
        <option value="CUSTOM">Custom</option>
      </select>
      {selectedScope === 'CUSTOM' && (
        <span className={styles.customScopePlaceholder}>
          (custom scope not yet configurable)
        </span>
      )}
    </div>
    ```
    - The `<select>` is disabled when `scopeLoading === true`
    - The disabled class is conditionally applied using template concatenation
    - The custom placeholder `<span>` only renders when `selectedScope === 'CUSTOM'`

- [x] **Task 3.4**: Replace Section 3 cards with skeleton placeholders during `scopeLoading`
  - File(s): `frontend/src/components/DashboardView/DashboardView.tsx`
  - Details: Wrap the Section 3 content (the two `.detailGrid` blocks for Pre-Coding and Post-Coding, lines 270-382) in a conditional. When `scopeLoading === true`, render 6 skeleton cards in place of the real cards. When `scopeLoading === false`, render the existing cards as-is. The skeleton card markup for each of the 6 cards:
    ```tsx
    <div className={styles.skeletonCard}>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarTitle}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric1}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric2}`}></div>
      <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric3}`}></div>
    </div>
    ```
    - Render the skeletons inside the same grid structure: 3 in a `.detailGrid` under "Pre-Coding" subheading, 3 in a `.detailGrid` under "Post-Coding" subheading, preserving the visual layout
    - The "Pre-Coding" and "Post-Coding" subheadings should still render during skeleton loading (only the card content is replaced)
    - The Section 3 `<h3>` heading "Detailed Definition & Delivery" should still render during skeleton loading

- [x] **Task 3.5**: Write 5-8 focused tests for the scope selector UI behavior
  - File(s): `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx` (new file)
  - Details: Create a new test file (do NOT modify existing `dashboard-increment-3-dashboardview.test.tsx`). Use the same mock pattern as the Increment 3 test file (mock `useProject`, `useArchitectureDispatch`, `getDashboardSummary`, CSS module). Reuse the `sampleDto` fixture structure. Tests to write:
    1. `scope selector renders with default value NEXT_5_EPICS` -- verify `data-testid="scope-selector"` exists and has `value="NEXT_5_EPICS"`
    2. `scope selector is inside scope-control-bar container` -- verify `data-testid="scope-control-bar"` exists and contains the select
    3. `changing scope calls getDashboardSummary with new scope` -- fire change event on the select to "ENTIRE_PRODUCT", assert `mockGetDashboardSummary` was called with `(projectId, 'ENTIRE_PRODUCT')`
    4. `scope selector is disabled during scopeLoading` -- fire change event, before the promise resolves assert the select element has `disabled` attribute
    5. `skeleton cards render during scopeLoading` -- fire change event, before promise resolves assert `.skeletonCard` elements exist (query by class name or data-testid)
    6. `Strategic Foundation cards remain visible during scopeLoading` -- fire change event, assert `card-product-definition` and `card-hla` testids are still in the DOM during loading
    7. `selecting CUSTOM shows placeholder text` -- change select to "CUSTOM", after data loads assert "(custom scope not yet configurable)" text is visible
    8. `after scope change completes, real cards render with updated data` -- provide a different DTO for the second call, verify the updated metric values appear

**Acceptance Criteria:**
- Scope selector renders between Strategic Foundation and Detailed Definition & Delivery sections
- Default selected value is `NEXT_5_EPICS`
- Changing the scope triggers a new API call with the selected scope
- During scope loading, the select is disabled and 6 skeleton cards replace the detail cards
- Header and Strategic Foundation remain stable during scope loading
- Selecting CUSTOM shows the placeholder text
- All 5-8 new tests pass

---

### TG4: Integration Verification -- Existing Test Compatibility
Dependencies: TG1, TG3

- [x] **Task 4.1**: Run existing gateway tests and fix any assertion failures caused by invariant strategicFoundation
  - File(s): `gateway/src/__tests__/dashboardSummary.test.ts` (read-only check, minimal edits if needed)
  - Details: Run the existing `dashboardSummary.test.ts` test suite. The following tests may fail because they assert on scope-variant strategicFoundation values:
    - Test 3 (ENTIRE_PRODUCT): asserts `strategicFoundation.productDefinition.state.value >= 10` -- this will still pass (large values are 45)
    - Test 4 (NEXT_5_EPICS): asserts `strategicFoundation.productDefinition.state.value <= 15` -- this will NOW FAIL because strategicFoundation always returns the large value (45)
    - Gap Test 1 (QTR): asserts `strategicFoundation.productDefinition.state.value <= 15` -- this will NOW FAIL
    - Gap Test 2 (CUSTOM): asserts `strategicFoundation.productDefinition.state.value <= 15` -- this will NOW FAIL
  - If failures occur, update ONLY the specific sub-assertions that check strategicFoundation values. Change them to expect the invariant large values (e.g., `>= 10` instead of `<= 15`). Do not rewrite or restructure the test file. Add a comment `// Updated: Increment 4 -- strategicFoundation is now invariant (always returns large values)` next to each changed assertion.

- [x] **Task 4.2**: Run existing frontend DashboardView tests and verify they still pass
  - File(s): `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` (read-only check)
  - Details: Run the Increment 3 test suite. These tests should continue to pass because:
    - Test 1 (no project) -- unaffected by scope changes
    - Test 2 (loading) -- the initial loading state is unchanged
    - Test 3 (error) -- error handling is unchanged
    - Test 4 (header) -- scope label in header is unchanged
    - Test 5 (Strategic Foundation cards) -- cards still render
    - Test 6 (Detail cards) -- cards still render on initial load (scopeLoading is false)
    - Test 7 (navigation) -- navigation is unchanged
    - Test 8 (Summary Insight) -- card is unchanged
  - If any test fails unexpectedly, investigate and fix in the component code (not in the test file)

**Acceptance Criteria:**
- All existing gateway tests pass (with minimal assertion updates for invariant strategicFoundation)
- All existing frontend DashboardView tests pass without modification
- No regressions in existing functionality

---

### TG5: Test Gap Analysis -- Final Verification
Dependencies: TG1, TG2, TG3, TG4

- [x] **Task 5.1**: Run all feature-specific tests together
  - File(s): Tests to run:
    - `gateway/src/__tests__/dashboardSummary.test.ts` (existing, 11 tests)
    - `gateway/src/__tests__/dashboardSummary-increment4-mock.test.ts` (new from TG1, ~6 tests)
    - `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` (existing, 8 tests)
    - `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx` (new from TG3, ~6-8 tests)
  - Details: Run all four test files and ensure all pass. Fix any failures. Expected total: approximately 31-33 tests.

- [x] **Task 5.2**: Identify critical untested paths and write up to 4 additional gap-fill tests
  - File(s): `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx` (new file, only if gaps found)
  - Details: Review the coverage of all tests from TG1-TG4. Potential gaps to evaluate:
    - End-to-end flow: scope change -> API call -> data update -> card re-render with new values (may already be covered by Task 3.5 test 8)
    - Error during scope change: verify that changing scope and getting an error still shows the error state correctly
    - Rapid scope changes: verify that only the last scope change result is displayed (race condition guard)
    - Skeleton card count: verify exactly 6 skeleton cards render (3 + 3 in the two grids)
  - Only write tests for genuinely missing critical paths. Maximum of 4 additional tests. If all paths are adequately covered, skip this task.

- [x] **Task 5.3**: Manual acceptance criteria verification
  - Details: Manually verify each acceptance criterion from the spec:
    - [x] Scope selector renders between Strategic Foundation grid and "Detailed Definition & Delivery" heading
    - [x] Native `<select>` with 4 options: Entire Product, Next 5 Epics, This Quarter, Custom
    - [x] Default selection is "Next 5 Epics"
    - [x] Changing scope triggers API call and updates the 6 bottom cards
    - [x] Strategic Foundation and header remain unchanged during and after scope change
    - [x] Skeleton cards with shimmer animation appear during scope loading
    - [x] Select is disabled during loading
    - [x] Selecting "Custom" shows "(custom scope not yet configurable)" placeholder
    - [x] QTR returns visually distinct medium values (e.g., Epics In Scope: 8, Stories: 45)
    - [x] ENTIRE_PRODUCT returns large values, NEXT_5_EPICS returns small values
    - [x] CUSTOM reuses NEXT_5_EPICS values with "Custom Scope" label

**Acceptance Criteria:**
- All ~31-37 feature-specific tests pass
- No regressions in existing tests
- All manual acceptance criteria verified
- Maximum 4 additional gap-fill tests added (if needed)

---

## Execution Order

```
TG1 (Gateway Mock Service) ---|
                               |---> TG3 (Frontend Component) ---> TG4 (Integration Verification) ---> TG5 (Gap Analysis)
TG2 (Frontend CSS)        ----|
```

1. **TG1** and **TG2** can execute in parallel (no dependencies between them)
2. **TG3** depends on both TG1 (backend must return correct data) and TG2 (CSS classes must exist)
3. **TG4** depends on TG1 and TG3 (verifies existing tests still work after all code changes)
4. **TG5** runs last (comprehensive test review and manual verification)

---

## Files Modified (Summary)

| File | Change Type | Task(s) |
|------|-------------|---------|
| `gateway/src/services/dashboardSummaryMockService.ts` | Modified | 1.1, 1.2, 1.3 |
| `gateway/src/__tests__/dashboardSummary-increment4-mock.test.ts` | New | 1.4 |
| `gateway/src/__tests__/dashboardSummary.test.ts` | Minimal edits (assertion updates) | 4.1 |
| `frontend/src/components/DashboardView/DashboardView.module.css` | Modified (appended) | 2.1, 2.2 |
| `frontend/src/components/DashboardView/DashboardView.tsx` | Modified | 3.1, 3.2, 3.3, 3.4 |
| `frontend/src/__tests__/dashboard-increment-4-scope-selector.test.tsx` | New | 3.5 |
| `frontend/src/__tests__/dashboard-increment-4-gap-fill.test.tsx` | New (only if needed) | 5.2 |

**Files NOT modified (confirmed by spec):**
- `frontend/src/api/dashboardApi.ts` -- already supports optional `ScopeType` param
- `frontend/src/types/dashboard.ts` -- `ScopeType` already defined
- `gateway/src/routes/dashboardSummary.ts` -- route already supports scope
- `gateway/src/types/dashboard.ts` -- types already defined
- `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` -- existing tests remain unmodified
