# Specification: Dashboard Increment 4 -- Scope Selector UI + Backend Mock Branching

## Goal

Add an interactive scope selector to the Dashboard that controls the metrics displayed in the Detailed Definition & Delivery section, triggering a refetch of mock data from the gateway. Strategic Foundation remains invariant regardless of scope. Three distinct mock datasets (large, medium, small) provide visually distinguishable results per scope.

## User Stories

- As a product manager, I want to switch the dashboard scope between Entire Product, Next 5 Epics, Quarterly, and Custom so that I can see metrics scoped to the slice of work I care about.
- As a product manager, I want the Strategic Foundation section to remain stable when I change scope so that I can compare delivery metrics without losing strategic context.

## Specific Requirements

**Scope Selector Placement and Element**
- Render a standalone control bar immediately before the "Detailed Definition & Delivery" `<h3>` heading (between the closing `</div>` of `.strategicGrid` at line 262 and the Section 3 heading at line 267 of `DashboardView.tsx`)
- Use a native `<select>` element to match the existing DiagramSelector/DiagramTypeSelector pattern
- The control bar is a flex row containing a label ("Scope:") and the `<select>` dropdown
- Add `data-testid="scope-selector"` on the `<select>` and `data-testid="scope-control-bar"` on the container

**Scope Options and Default**
- Four `<option>` values: `ENTIRE_PRODUCT` ("Entire Product"), `NEXT_5_EPICS` ("Next 5 Epics"), `QTR` ("This Quarter"), `CUSTOM` ("Custom")
- Default selected value is `NEXT_5_EPICS`, matching the backend default
- When `CUSTOM` is selected, display a static placeholder text "(custom scope not yet configurable)" next to the selector using a muted `<span>` -- no input field, no modal, no additional interaction

**State Management**
- Add `selectedScope: ScopeType` state (default `'NEXT_5_EPICS'`) and `scopeLoading: boolean` state (default `false`) to the component
- On scope change: set `scopeLoading = true`, call `getDashboardSummary(activeProject.id, newScope)`, on success update `data` and set `scopeLoading = false`, on error set `error` and `scopeLoading = false`
- The existing initial `loading` state and `fetchData` callback remain unchanged for the first load; scope-change fetches are a separate flow using the new `scopeLoading` flag
- Disable the `<select>` during `scopeLoading === true` to prevent rapid re-selection

**Loading Behavior -- Skeleton Cards**
- During `scopeLoading === true`, the Header Summary Bar (Section 1) and Strategic Foundation (Section 2) remain fully rendered from existing `data`
- The 6 cards in Detailed Definition & Delivery (Section 3) are replaced with 6 skeleton placeholder cards
- Each skeleton card matches the `.card` dimensions (same border, border-radius, padding) but renders 3-4 grey animated bars instead of real content
- Use a CSS `@keyframes shimmer` animation: a left-to-right gradient sweep using `linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)` with `background-size: 200% 100%` and `animation: shimmer 1.5s ease-in-out infinite`
- Skeleton bars inside each card: one 60% width bar for the title area, two-three 40-80% width bars for the metrics area, spaced with the same gap as `.cardMetrics`

**API Client Updates**
- No changes to `getDashboardSummary()` in `dashboardApi.ts` -- it already accepts an optional `ScopeType` parameter
- The only change is at the call site in `DashboardView.tsx` line 86: pass `selectedScope` as the second argument to `getDashboardSummary`

**Gateway Mock Data -- Three Distinct Datasets**
- Refactor `buildMockDashboardSummary` in `dashboardSummaryMockService.ts` to support three dataset sizes for the `detailedDefinitionAndDelivery` section: large (ENTIRE_PRODUCT), medium (QTR), and small (NEXT_5_EPICS and CUSTOM)
- Add a new `buildMediumDetailedDefinitionAndDelivery()` function with values at rough midpoints between the existing large and small datasets
- Medium dataset target values: Epics In Scope 8, Features 18, Stories 45, Stories with AC 32, Process Activities 12, Interface Endpoints 22, Logical Data Entities 8, Physical Data Entities 6, E2E Tests 8, Functional Tests 20, Implementation 14, Stories Verified 10, Pending Review 4
- CUSTOM reuses the small (NEXT_5_EPICS) dataset values with label "Custom Scope"

**Strategic Foundation Invariance**
- Modify `buildMockDashboardSummary` so that `strategicFoundation` always returns the same dataset regardless of scope -- use the existing "large" strategic foundation values as the single invariant dataset
- Similarly, make the `header` stats (initiativesCount, epicsCount, activeEpicsCount, storiesInProgressCount) invariant -- always return the "large" header values regardless of scope
- Only the `detailedDefinitionAndDelivery` section and the `scope` object vary by scope type

**Scope Response Label Mapping**
- The existing `resolveScopeLabel` function in the mock service already maps scope types to labels: ENTIRE_PRODUCT -> "Entire Product", NEXT_5_EPICS -> "Next 5 Epics", QTR -> "Q1 2026", CUSTOM -> "Custom Scope"
- No changes needed to the label mapping logic
- The `scopeValue` pass-through from the query parameter remains unchanged

**CSS Styling for Scope Selector**
- Add `.scopeControlBar` class: `display: flex; align-items: center; gap: 12px; margin: 20px 0 4px 0; padding: 0;`
- Add `.scopeControlBarLabel` class: `font-size: 13px; font-weight: 500; color: #555;`
- Add `.scopeSelector` class: replicate the `.diagramTypeSelector` pattern from `DiagramsView.module.css` -- `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 180px; background: white; cursor: pointer; transition: border-color 0.2s;` with `:focus { outline: none; border-color: #1976D2; }` and `:hover { border-color: #bbb; }`
- Add `.scopeSelectorDisabled` class matching the `.selectorDisabled` pattern: `background: #f5f5f5; color: #999; cursor: not-allowed; opacity: 0.8; border-color: #e0e0e0;`
- Add `.customScopePlaceholder` class: `font-size: 12px; color: #999; font-style: italic;`
- Add `.skeletonCard`, `.skeletonBar`, and `@keyframes shimmer` in `DashboardView.module.css`

## Visual Design

No visual mockups were provided for this increment.

## Existing Code to Leverage

**DiagramSelector native `<select>` pattern (`frontend/src/components/DiagramsView/DiagramSelector.tsx`)**
- Lines 110-125: Native `<select>` with `className`, `value`, `onChange`, `disabled` props and `<option>` mapping
- Lines 135-146: Second `<select>` (DiagramTypeSelector) showing the same pattern with a static option list
- Replicate this pattern directly for the scope selector, substituting scope options for diagram options

**DiagramsView.module.css selector styles (lines 455-535)**
- `.selector` class: padding, border, border-radius, font-size, min-width, background, transition
- `.selectorDisabled` class: grayed background, muted text, not-allowed cursor, reduced opacity
- `.diagramTypeSelector` class: identical pattern with smaller min-width, adds `:hover` state
- Copy these patterns into `DashboardView.module.css` as `.scopeSelector` and `.scopeSelectorDisabled`

**dashboardApi.ts `getDashboardSummary()` (`frontend/src/api/dashboardApi.ts`)**
- Lines 26-45: Already accepts optional `ScopeType` second parameter and appends `&scope=` to the URL
- No modifications needed to this file -- only the call site in DashboardView needs to pass the scope

**dashboardSummaryMockService.ts mock branching (`gateway/src/services/dashboardSummaryMockService.ts`)**
- Lines 254-286: `buildMockDashboardSummary()` currently branches on `isLargeScope` boolean for both `strategicFoundation` and `detailedDefinitionAndDelivery`
- Lines 149-191: `buildLargeDetailedDefinitionAndDelivery()` provides the large dataset template to follow for the new medium builder
- Lines 196-238: `buildSmallDetailedDefinitionAndDelivery()` provides the small dataset template
- Extend with a `buildMediumDetailedDefinitionAndDelivery()` function and change the main function to use a 3-way branch for the detail section while making strategic foundation invariant

**SequenceEditorPanel.module.css pulse animation (lines 75-89)**
- `@keyframes pulse` with opacity oscillation at 1.5s ease-in-out infinite
- Use as reference for the shimmer animation timing and approach, but implement a gradient-based shimmer instead of opacity pulse for the skeleton cards

## Out of Scope

- URL query-string persistence of the selected scope (no `?scope=` in the browser URL)
- Scope-based card show/hide logic (all 6 detail cards always render; only metric values change)
- Mobile-specific responsive redesign of the scope selector
- Polling, auto-refresh, or WebSocket-based live updates
- Real data aggregation from the database (mock data only)
- LLM-generated insights or AI summary for any section
- Custom scope configuration UI (input fields, modals, filter builders) -- only a static placeholder message
- `scopeValue` query parameter support from the frontend (only `scope` type is sent)
- Changes to the existing test files from Increment 3 (new tests should be additive, not modify existing tests)
- Any changes to the gateway route handler (`dashboardSummary.ts`) -- the route already supports scope; only the mock service needs modification
