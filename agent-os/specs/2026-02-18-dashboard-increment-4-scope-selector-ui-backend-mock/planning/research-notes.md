# Research Notes: Dashboard Increment 4 -- Scope Selector UI + Backend Mock Branching

## Research Findings Summary

### Current State of the Dashboard

The dashboard has been built across three prior increments:

- **Increment 1** -- Added the top-level Dashboard tab, route, and UI scaffold
- **Increment 2** -- Defined the `DashboardSummaryDto` contract and built the `GET /api/dashboard/summary` mock endpoint in the gateway
- **Increment 3** -- Built the full dashboard layout with cards (header summary bar, Strategic Foundation 4-card grid, Detailed Definition & Delivery pre-coding/post-coding card grids)

### Key Files Identified

#### Frontend

| File | Purpose |
|------|---------|
| `frontend/src/components/DashboardView/DashboardView.tsx` | Main dashboard component (386 lines). Fetches data via `getDashboardSummary(activeProject.id)` and renders all 3 sections. |
| `frontend/src/components/DashboardView/DashboardView.module.css` | CSS module with styles for container, header bar, strategic grid (4-col), detail grid (3-col), cards, loading/error/empty states. |
| `frontend/src/api/dashboardApi.ts` | API client. `getDashboardSummary(projectId, scope?)` already accepts optional `ScopeType` parameter and appends `&scope=` to the URL. |
| `frontend/src/types/dashboard.ts` | Full DTO type definitions. Already defines `ScopeType = 'ENTIRE_PRODUCT' \| 'NEXT_5_EPICS' \| 'QTR' \| 'CUSTOM'` and `DashboardScope` interface. |
| `frontend/src/__tests__/dashboardApi.test.ts` | Tests for API client including scope parameter appending. |
| `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` | 8 tests for the DashboardView component (empty, loading, error, success, cards, navigation, insight). |

#### Gateway (Backend)

| File | Purpose |
|------|---------|
| `gateway/src/routes/dashboardSummary.ts` | Route handler for `GET /summary`. Validates projectId, reads optional scope (defaults to NEXT_5_EPICS), calls `buildMockDashboardSummary()`. |
| `gateway/src/services/dashboardSummaryMockService.ts` | Mock data factory. `buildMockDashboardSummary(projectId, scopeType, scopeValue)` returns different mock data based on scope. Currently has two size variants: "large" (ENTIRE_PRODUCT) and "small" (NEXT_5_EPICS, QTR, CUSTOM). |
| `gateway/src/types/dashboard.ts` | Mirror of frontend DTO types (camelCase wire format). Defines `ScopeType`, `DashboardScope`, `DashboardSummaryDto`, and all nested interfaces. |
| `gateway/src/routes/index.ts` | Barrel export. Already exports `dashboardSummaryRouter`. |
| `gateway/src/server.ts` | Mounts dashboard at `app.use('/api/dashboard', dashboardSummaryRouter)`. |
| `gateway/src/__tests__/dashboardSummary.test.ts` | Route tests including scope variant assertions, validation, and gap-fill tests for QTR/CUSTOM/scopeValue. |

### What Already Exists for Scope

**Significant finding: The scope infrastructure is already partially built.** Specifically:

1. **Frontend types**: `ScopeType` union type and `DashboardScope` interface already exist in `frontend/src/types/dashboard.ts`.
2. **API client**: `getDashboardSummary(projectId, scope?)` already accepts an optional `ScopeType` parameter. It appends `&scope=<value>` to the query string when provided.
3. **Gateway route**: Already reads `scope` query param, validates against a set of valid values, and defaults to `NEXT_5_EPICS`.
4. **Gateway mock service**: Already branches on `scopeType === 'ENTIRE_PRODUCT'` (large values) vs everything else (small values). QTR/CUSTOM currently return the same "small" data as NEXT_5_EPICS but with different labels.
5. **Dashboard UI**: Currently renders `scope.label` as a static `<span>` in the header summary bar (line 156, class `scopeLabel`). It is NOT interactive -- just displays the label. The `fetchData` function calls `getDashboardSummary(activeProject.id)` WITHOUT passing scope.

**Gap to fill**: The UI does not have a selector/dropdown for changing scope, and the `fetchData` callback does not pass a scope parameter.

### Existing Dropdown/Select Patterns in the App

Several existing components provide pattern references:

1. **DiagramSelector** (`DiagramsView/DiagramSelector.tsx`):
   - Uses native `<select>` element with CSS class `.selector` from `DiagramsView.module.css`
   - Styling: `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 200px; background: white;`
   - Has disabled variant: `.selectorDisabled` with grayed background, muted text, not-allowed cursor
   - Focus state: `border-color: #1976D2;`

2. **DiagramTypeSelector** (inside DiagramSelector):
   - Another native `<select>` with class `.diagramTypeSelector`
   - Similar styling: `padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 100px;`
   - Has hover state: `border-color: #bbb;`

3. **ModeSelector** (`DiagramsView/ModeSelector.tsx`):
   - Segmented button control (not a dropdown), but shows another selection pattern
   - Active segment uses `#1976D2` blue background

4. **PaletteDomainSelector** (`DiagramsView/PaletteDomainSelector.tsx`):
   - Icon-only button group for domain switching
   - Selected state uses `#1976D2` color + white background

**Consistent design tokens observed across the app:**
- Primary blue: `#1976D2` (focus states, active elements)
- Border: `#ddd` or `#e0e0e0`
- Background: `white` or `#f5f5f5`
- Text: `#333` (primary), `#555/#666` (secondary), `#888/#999` (muted)
- Font sizes: 11-14px range
- Border radius: 4px or 6px
- Transitions: 0.15s or 0.2s ease

### Loading/Error State Patterns

- Dashboard uses: `.loadingState` (centered italic text "Loading dashboard..."), `.errorState` (red background with Retry button)
- These match the `ProductPage.module.css` patterns identically
- No skeleton/shimmer loading patterns exist in the codebase -- all loading states are simple text-based
- The closest existing animation pattern is a `pulse` keyframe animation in `SequenceEditorPanel.module.css` (a `.savingIndicator` that fades opacity between 1 and 0.5 over 1.5s)

### Current Dashboard Header Layout

The header summary bar is a flex container with `flex-wrap: wrap` and `gap: 16px`:
```
[Project Name h2] [Mode Badge] [Scope Label span] [Initiatives: N] [Epics: N] [Active Epics: N] [Stories In Progress: N] [Last updated: ...auto-right]
```

The scope label is currently a simple `<span>` with class `.scopeLabel` (italic, 12px, #666).

### Mock Data Branching (Current State)

The gateway mock service currently has only TWO data variants:
- **isLargeScope** (ENTIRE_PRODUCT): Values in 10-50 range
- **!isLargeScope** (everything else): Values in 2-15 range

QTR and CUSTOM return the small variant with different labels. The raw idea says "Backend returns different mock variants per scope" which may imply adding more distinct mock data sets (e.g., QTR-specific values that differ from NEXT_5_EPICS).

---

## Clarifying Questions

1. **Scope selector placement**: The current dashboard header summary bar renders `scope.label` as a static `<span>`. I assume the scope selector should **replace** this static `<span>` with an interactive `<select>` dropdown in the same position within the header bar. Is that correct, or should the selector be placed elsewhere (e.g., above the "Detailed Definition & Delivery" section heading, or as a standalone control bar between the header and the card grids)?

2. **Selector element type**: The existing codebase uses native `<select>` elements for dropdowns (DiagramSelector, DiagramTypeSelector). I assume we should follow this pattern and use a native `<select>` styled consistently with those existing components. Is that correct, or would you prefer a segmented button control (like ModeSelector) or a custom dropdown component?

3. **Which scope options should appear in the dropdown?** The `ScopeType` union already defines four values: `ENTIRE_PRODUCT`, `NEXT_5_EPICS`, `QTR`, and `CUSTOM`. I assume we should show all four. However, `QTR` and `CUSTOM` may need additional parameters (quarter label, custom filter value). Should we include all four options in this increment, or limit the dropdown to `ENTIRE_PRODUCT` and `NEXT_5_EPICS` only (with QTR/CUSTOM deferred)?

4. **Scope effect on Strategic Foundation section**: The raw idea says the selector "controls the metrics displayed in the Detailed Definition & Delivery section (pre-coding + post-coding cards)". Does this mean the Strategic Foundation section (Product Definition, Roadmap, Standards, HLA cards) should remain unchanged regardless of scope? Or should the scope affect ALL sections including Strategic Foundation? Currently the mock service returns different data for both sections based on scope.

5. **Default scope value**: I assume the default selection should be `NEXT_5_EPICS` (matching the current backend default). Is that correct, or should the default be `ENTIRE_PRODUCT`?

6. **Loading behavior during scope change**: When the user changes the scope, the dashboard needs to refetch data. I assume we should show a loading indicator during the refetch. Should this (a) replace the entire dashboard with "Loading dashboard..." (current pattern), (b) show a more subtle inline loading indicator near the selector while keeping stale data visible, or (c) disable the selector and show a spinner but keep the existing cards visible?

7. **Distinct mock data per scope**: The current mock service only has two data variants (large for ENTIRE_PRODUCT, small for everything else). The raw idea says "Backend returns different mock variants per scope." Should we add a **third** distinct data set for QTR (medium-range values), or is the current two-variant approach (large vs small) sufficient as long as the labels differ?

8. **Is there anything that should be explicitly excluded from this increment?** For example: URL state persistence of the selected scope, keyboard accessibility beyond native select behavior, mobile-specific responsive behavior for the selector, or any scope-dependent card visibility toggling.

---

## User Answers to Clarifying Questions

**Q1 -- Scope selector placement:**
Standalone control bar within the final section, above the "Detailed Definition & Delivery" heading/cards (NOT in the top header bar).

**Q2 -- Selector element type:**
Use native `<select>` to match existing patterns.

**Q3 -- Which scope options:**
Include all four options (ENTIRE_PRODUCT, NEXT_5_EPICS, QTR, CUSTOM) in the dropdown.

**Q4 -- Strategic Foundation invariance:**
Yes -- Strategic Foundation remains unchanged regardless of scope; restrict scope effects to the bottom section only (adjust mock service accordingly).

**Q5 -- Default scope:**
Yes -- default scope is NEXT_5_EPICS.

**Q6 -- Loading behavior:**
Use (b): keep Strategic Foundation stable and show skeletons only for the bottom 6 cards during scope change.

**Q7 -- Mock data distinctness:**
Add a third distinct "medium" dataset for QTR so it visually behaves differently. CUSTOM can reuse NEXT_5_EPICS numbers but with different label.

**Q8 -- Explicit exclusions:**
URL/query-string persistence, scope-based card show/hide logic, any mobile-specific redesign, and any polling/auto-refresh.

---

## Post-Answer Codebase Research

After receiving the user's answers, the following targeted research was conducted to validate feasibility and identify implementation details.

### 1. Dashboard Section Structure and Selector Insertion Point

**File: `frontend/src/components/DashboardView/DashboardView.tsx`**

The user wants the scope selector as a standalone control bar above the "Detailed Definition & Delivery" heading. In the current code, the relevant insertion point is at **line 267**:

```tsx
{/* Section 3: Detailed Definition & Delivery */}
<h3 className={styles.sectionHeading}>Detailed Definition & Delivery</h3>
```

The selector control bar would be inserted **immediately before** this `<h3>` heading (after the Strategic Foundation grid closes at line 262). This is a clean insertion point -- it sits between the closing `</div>` of `.strategicGrid` and the Section 3 heading.

The current structure is:
1. Lines 148-172: Section 1 -- Header Summary Bar (`.headerSummary`)
2. Lines 177-262: Section 2 -- Strategic Foundation (`.sectionHeading` + `.strategicGrid`)
3. Lines 267-382: Section 3 -- Detailed Definition & Delivery (`.sectionHeading` + two `.detailGrid` blocks)

The scope `<span>` in the header bar (line 156: `<span className={styles.scopeLabel}>{scope.label}</span>`) should be **kept as-is** since the user wants the selector in Section 3, not replacing the header label.

### 2. Mock Service Data Values and "Medium" Dataset Design

**File: `gateway/src/services/dashboardSummaryMockService.ts`**

Current data ranges for the Detailed Definition & Delivery section:

| Metric | ENTIRE_PRODUCT (large) | NEXT_5_EPICS (small) | QTR (medium -- to create) |
|--------|----------------------|---------------------|--------------------------|
| Epics In Scope | 12 | 5 | ~8 |
| Features | 28 | 10 | ~18 |
| Stories | 85 | 22 | ~45 |
| Stories with AC | 60 | 14 | ~32 |
| Process Activities | 20 | 4 | ~12 |
| Interface Endpoints | 40 | 10 | ~22 |
| Logical Data Entities | 15 | 3 | ~8 |
| Physical Data Entities | 12 | 2 | ~6 |
| E2E Tests | 15 | 3 | ~8 |
| Functional Tests | 42 | 8 | ~20 |
| Implementation | 28 | 5 | ~14 |
| Stories Verified | 18 | 3 | ~10 |
| Pending Review | 7 | 2 | ~4 |

The "medium" values above are rough midpoints that would be visually distinguishable.

**Key change needed in mock service**: Currently `strategicFoundation` varies by scope (line 278-279: `isLargeScope ? buildLargeStrategicFoundation() : buildSmallStrategicFoundation()`). Per user's answer Q4, Strategic Foundation must be **invariant** -- always return the same data regardless of scope. Similarly, the header stats (lines 271-274) currently vary by scope and may need to be made invariant or kept scope-dependent only for header counts (needs clarification -- but the user specifically said "restrict scope effects to the bottom section only").

**CUSTOM scope**: Will reuse the NEXT_5_EPICS (small) dataset values but with the label "Custom Scope" (already handled by `resolveScopeLabel`).

### 3. Skeleton/Loading State Patterns

**Finding: No skeleton components or CSS classes exist anywhere in the codebase.**

All current loading states use simple centered text ("Loading dashboard...", "Loading...") or full-page spinners. The grep search for `skeleton`, `shimmer`, `pulse`, `placeholder-glow`, `loading-card`, `loadingSkeleton`, `skeletonCard` across all `.tsx`, `.css`, and `.ts` files returned zero matches for skeleton patterns.

The only animation-related pattern found is a `pulse` keyframe in `SequenceEditorPanel.module.css`:
```css
.savingIndicator {
  font-size: 11px;
  color: #1976D2;
  font-style: italic;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**Implication**: Skeleton loading for the 6 bottom cards will be a **new pattern** introduced in this increment. The skeletons should:
- Replace the 6 cards in the Detailed Definition & Delivery section while loading
- Keep the card shape/size but show animated placeholder blocks
- Use the existing design tokens (`#f5f5f5` background, `#e0e0e0` for shimmer, `6px` border-radius)
- Use a CSS `@keyframes` animation (shimmer or pulse) consistent with the `pulse` pattern already in the codebase

### 4. Existing `<select>` Patterns for Reference

**File: `frontend/src/components/DiagramsView/DiagramSelector.tsx`**

The native `<select>` pattern to follow:
```tsx
<select
  className={`${styles.selector} ${!hasDiagrams ? styles.selectorDisabled : ''}`}
  value={state.selectedDiagramId || ''}
  onChange={handleChange}
  disabled={!hasDiagrams}
>
  {options.map((opt) => (
    <option key={opt.id} value={opt.id}>{opt.name}</option>
  ))}
</select>
```

CSS from `DiagramsView.module.css`:
```css
.selector {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  min-width: 200px;
  background: white;
  transition: border-color 0.2s, background-color 0.2s;
}
.selector:focus {
  outline: none;
  border-color: #1976D2;
}
```

The scope selector should replicate this styling within `DashboardView.module.css`. It will need:
- A `.scopeControlBar` container class (flex row, aligned, positioned above Section 3)
- A `.scopeSelector` class for the `<select>` element (matching existing patterns)
- A disabled state for when data is loading (`.scopeSelectorDisabled`)

### 5. API Client and fetchData Integration

**File: `frontend/src/api/dashboardApi.ts`**

The `getDashboardSummary(projectId, scope?)` function already supports the optional scope parameter. The `fetchData` callback in `DashboardView.tsx` just needs to pass the selected scope:

```tsx
// Current (line 86):
const result = await getDashboardSummary(activeProject.id);

// Needed:
const result = await getDashboardSummary(activeProject.id, selectedScope);
```

No API client changes needed -- just the component state management and the call site update.

### 6. State Management Approach

New state needed in `DashboardView.tsx`:
- `selectedScope: ScopeType` (default: `'NEXT_5_EPICS'`)
- `scopeLoading: boolean` (for skeleton display -- distinct from the initial `loading` state)

The scope change handler would:
1. Set `selectedScope` to the new value
2. Set `scopeLoading` to true
3. Call `getDashboardSummary(activeProject.id, newScope)`
4. On success: update `data` and set `scopeLoading` to false
5. On error: set `error` and `scopeLoading` to false

During `scopeLoading === true`:
- Header and Strategic Foundation remain stable (rendered from existing `data`)
- Bottom 6 cards show skeleton placeholders instead of real content

---

## Existing Code Reuse

**Similar Features Identified:**

- **DiagramSelector** (`frontend/src/components/DiagramsView/DiagramSelector.tsx`) -- native `<select>` pattern with CSS module styling
- **DiagramsView.module.css** (`frontend/src/components/DiagramsView/DiagramsView.module.css`) -- `.selector` and `.diagramTypeSelector` CSS classes for dropdown styling
- **dashboardApi.ts** (`frontend/src/api/dashboardApi.ts`) -- `getDashboardSummary()` already accepts optional `ScopeType` param
- **DashboardView.tsx** (`frontend/src/components/DashboardView/DashboardView.tsx`) -- existing `fetchData` callback to modify
- **dashboardSummaryMockService.ts** (`gateway/src/services/dashboardSummaryMockService.ts`) -- existing mock branching logic to extend with medium dataset
- **SequenceEditorPanel.module.css** (`frontend/src/components/DiagramsView/SequenceEditorPanel.module.css`) -- `@keyframes pulse` animation pattern for loading indicators

## Visual Assets

**Mandatory visual check performed**: No visual files found in `planning/visuals/`.
