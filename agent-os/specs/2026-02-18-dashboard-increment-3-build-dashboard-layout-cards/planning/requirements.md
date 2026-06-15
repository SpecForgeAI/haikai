# Spec Requirements: Dashboard Increment 3 -- Build Dashboard Layout + Cards

## Initial Description

Implement the Dashboard UI as the new top-level view that renders a 3-section layout (Header, Strategic Foundation, Detailed Definition & Delivery) with 10 cards using data fetched from the gateway mock endpoint GET /api/dashboard/summary. This is UI + data wiring only -- all values are mock data from the backend. No LLM insight generation, no real DB derivation.

Scope includes:
- frontend: DashboardView renders 3 sections with card grids
- frontend: fetch DashboardSummaryDto from backend and render all metrics
- frontend: loading + error states
- frontend: card primary actions navigate to existing app sections

Scope excludes (from raw idea, later revised by Q&A):
- scope selector UI (Increment 4)
- persona chat panel/drawer (Increment 5)
- any LLM insights (summaryInsight.enabled remains false)

**NOTE**: The original raw idea stated "no backend changes." Answer #1 revised this -- this increment now ALSO includes backend DTO changes (gateway types, mock service, frontend types) to add missing card fields: standards, backlog, testingSuite, verification. Answer #4 also removes MetricCard.status from the DTO entirely.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea lists 3 sections with 10 cards (Strategic Foundation: Product Definition, Roadmap, Standards, High-Level Architecture; Pre-Coding: Backlog, Detailed Architecture, Testing Suite; Post-Coding: Implementation, Verification, Summary Insight). However, `DashboardSummaryDto` from Increment 2 has only 2 sections (`strategicFoundation` and `detailedDefinitionAndDelivery`) and does NOT include fields for "Standards", "Backlog", "Testing Suite", or "Verification". How should the 10 cards map to the existing DTO data?
**Answer:** Use option (c) -- update the Increment 2 DTO so all 10 cards have explicit fields. Add: standards, testingSuite, backlog, verification, detailedArchitecture (as per the agreed metrics). Keep summaryInsight with enabled=false. No field reinterpretation. This means this increment also includes backend DTO changes (gateway types + mock service + frontend types).

**Q2:** The raw idea describes 3 UI sections ("Strategic Foundation", "Pre-Coding", "Post-Coding") but the DTO has 2 data sections (`strategicFoundation`, `detailedDefinitionAndDelivery`). Should the UI render 3 visual sections or 2 sections matching the DTO structure? And what should the visible section headings be?
**Answer:** Render 3 visual sections: (1) Header Summary, (2) Strategic Foundation, (3) Detailed Definition & Delivery with subtle subheadings "Pre-Coding" and "Post-Coding".

**Q3:** For each card, what is the navigation target?
**Answer:** Navigation targets for card primary actions:
- Product Definition -> Product & Delivery > Product tab
- Roadmap -> Product & Delivery > Roadmap tab
- Standards -> Product & Delivery > Product tab (standards area)
- High-Level Architecture -> Architecture & Design (metamodel)
- Backlog -> Product & Delivery > Backlog tab
- Detailed Architecture -> Architecture & Design (metamodel)
- Testing Suite -> Product & Delivery > Implement tab (for now)
- Implementation -> Product & Delivery > Implement tab
- Verification -> Product & Delivery > Implement tab (for now)
- Summary Insight -> no navigation (disabled)

**Q4:** Should each status value map to a specific color for a visual indicator on the card? What form should the indicator take (dot, border, background tint)?
**Answer:** No status color mapping in Increment 3. Don't introduce MetricCard.status at all. Keep cards visually consistent with icon + title + metrics only. (This means the `status` field should be REMOVED from the MetricCard type.)

**Q5:** When `useProject()` returns `null` (no project selected), what should the dashboard show?
**Answer:** Show a single centered empty-state: "Select a project to view the dashboard." (no skeleton cards).

**Q6:** Is there anything specific to EXCLUDE from this increment?
**Answer:** Explicitly exclude: auto-refresh/polling, mobile-specific redesign, animations, persona panel/drawer, and any LLM insight rendering (Summary Insight stays "coming soon").

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Current DashboardView placeholder (Increment 1) - Path: `frontend/src/components/DashboardView/DashboardView.tsx` and `DashboardView.module.css`
- Feature: DashboardSummaryDto types (Increment 2) - Path: `frontend/src/types/dashboard.ts`
- Feature: Gateway dashboard types (Increment 2) - Path: `gateway/src/types/dashboard.ts`
- Feature: Gateway mock service (Increment 2) - Path: `gateway/src/services/dashboardSummaryMockService.ts`
- Feature: Frontend API client (Increment 2) - Path: `frontend/src/api/dashboardApi.ts`
- Feature: ProjectContext for active project - Path: `frontend/src/contexts/ProjectContext.tsx` (`useProject()` returns `ProjectDto | null` with `.id`)
- Feature: ArchitectureContext for view switching - Path: `frontend/src/contexts/ArchitectureContext.tsx` (`dispatch({ type: 'SET_VIEW', payload: 'product' | 'metamodel' | 'diagrams' | 'dashboard' })`)
- Feature: ProductView tab navigation via URL params - Path: `frontend/src/components/ProductView/ProductView.tsx` (uses `updateUrl(tab, workItemId?)` with `window.history.pushState`)
- Feature: ProductPage.module.css for card/form CSS patterns - Path: `frontend/src/components/ProductView/ProductPage.module.css` (`.formCard`, `.loadingState`, `.errorState`)
- Feature: TopBar view switching - Path: `frontend/src/components/TopBar/TopBar.tsx` (dispatches `SET_VIEW` actions)
- Feature: App CSS global layout - Path: `frontend/src/App.css` (`.main-content` uses `margin-top: 60px` and `height: calc(100vh - 60px)`)

### Follow-up Questions

No follow-up questions were needed. All answers were clear and unambiguous. The scope expansion (backend DTO changes) and scope reduction (removing MetricCard.status) are well-defined.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed by both user statement and mandatory filesystem check).

### Visual Insights:
Not applicable -- no visual assets were provided.

## Requirements Summary

### Functional Requirements

**Backend DTO Changes (NEW scope from Q1/Q4 answers):**
- Remove `status` field from `MetricCard` type (both gateway and frontend copies)
- Add `standards` field (type `MetricCard`) to `StrategicFoundationSection`
- Add `backlog` field (type `MetricCard`) to `DetailedDefinitionAndDeliverySection`
- Add `testingSuite` field (type `MetricCard`) to `DetailedDefinitionAndDeliverySection`
- Add `verification` field (type `MetricCard`) to `DetailedDefinitionAndDeliverySection`
- Update `dashboardSummaryMockService.ts` to populate all new fields with mock data (both large and small scope variants)
- Keep `summaryInsight.enabled = false` and `summaryInsight.message = null`

**Frontend Dashboard UI:**
- Replace the placeholder DashboardView with a full 3-section layout
- Section 1: "Header Summary" -- project name from `header.projectName`, scope label from `scope.label`, generation timestamp from `header.generatedAt`
- Section 2: "Strategic Foundation" -- 4 cards: Product Definition, Roadmap, Standards, High-Level Architecture
- Section 3: "Detailed Definition & Delivery" with subtle subheadings "Pre-Coding" (Backlog, Detailed Architecture, Testing Suite) and "Post-Coding" (Implementation, Verification, Summary Insight)
- Each card displays: icon + title + metrics (numeric values from MetricCard fields)
- No status color indicators on cards (status field removed from DTO)
- Summary Insight card renders as "Coming soon" placeholder (enabled=false)

**Data Fetching:**
- Call `getDashboardSummary(projectId)` from `frontend/src/api/dashboardApi.ts` on mount
- Obtain `projectId` from `useProject()` hook (`activeProject.id`)
- Show loading state during fetch
- Show error state on fetch failure
- Show empty-state "Select a project to view the dashboard." when no active project

**Card Navigation (primary action):**
- Product Definition: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=product`
- Roadmap: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=roadmap`
- Standards: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=product` (standards area)
- High-Level Architecture: dispatch `SET_VIEW: 'metamodel'`
- Backlog: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=backlog`
- Detailed Architecture: dispatch `SET_VIEW: 'metamodel'`
- Testing Suite: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=implement`
- Implementation: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=implement`
- Verification: dispatch `SET_VIEW: 'product'`, then navigate to `?tab=implement`
- Summary Insight: no navigation (disabled)

### Reusability Opportunities
- Card CSS can reuse the `.formCard` pattern from `ProductPage.module.css` (`background: #ffffff`, `border: 1px solid #e0e0e0`, `border-radius: 6px`, `padding: 16px`)
- Loading state can reuse the `.loadingState` pattern from `ProductPage.module.css`
- Error state can reuse the `.errorState` pattern from `ProductPage.module.css`
- Empty-state can reuse the `.placeholder` centering pattern from `DashboardView.module.css`
- View switching logic follows the exact pattern in `TopBar.tsx` (`dispatch({ type: 'SET_VIEW', payload })`)
- Tab navigation follows the exact pattern in `ProductView.tsx` (`updateUrl(tab)` with `window.history.pushState`)
- Data fetching pattern: `useEffect` + `useState` for loading/error/data states (common React pattern used throughout the codebase)

### Scope Boundaries

**In Scope:**
- Update gateway types: `gateway/src/types/dashboard.ts` (remove status from MetricCard, add new section fields)
- Update gateway mock service: `gateway/src/services/dashboardSummaryMockService.ts` (add mock data for new fields)
- Update frontend types: `frontend/src/types/dashboard.ts` (mirror gateway changes)
- Replace `frontend/src/components/DashboardView/DashboardView.tsx` with full card layout
- Replace `frontend/src/components/DashboardView/DashboardView.module.css` with grid/card styles
- Data fetching from `GET /api/dashboard/summary` with loading/error/empty states
- Card primary action navigation to existing app sections
- Unit tests for frontend components and any backend changes

**Out of Scope:**
- Scope selector UI (Increment 4)
- Persona chat panel/drawer (Increment 5)
- Auto-refresh or polling for data updates
- Mobile-specific responsive redesign
- Card animation or transition effects
- Any LLM insight rendering (Summary Insight card shows "Coming soon")
- Any real data aggregation or computation (all data is mock)
- Status color indicators or badges on cards (MetricCard.status removed)

### Technical Considerations
- `useProject()` from `ProjectContext` provides `activeProject.id` for the API call
- `useArchitectureDispatch()` provides `dispatch` for `SET_VIEW` actions
- `window.history.pushState` with `?tab=xxx` for ProductView tab navigation (matching `ProductView.tsx` pattern)
- Navigation from dashboard to ProductView tabs requires: (1) dispatch SET_VIEW to 'product', (2) pushState with `?tab=xxx` so ProductView picks up the correct tab
- Navigation to metamodel view requires only: dispatch SET_VIEW to 'metamodel'
- CSS design tokens from existing codebase: primary blue `#1976D2`, border color `#e0e0e0`, card background `#ffffff`, placeholder background `#f5f5f5`, border-radius `6px`, font sizes `12-14px`, text colors `#333` / `#666` / `#888`
- Container uses `height: calc(100vh - 60px)` to fill below the TopBar (matching `DashboardView.module.css` pattern)
- The DashboardView should support vertical scrolling since 10 cards + header will likely exceed viewport height
- Gateway types and frontend types must stay in sync (camelCase wire format, no casing transforms)
- The `card()` helper function in the mock service needs updating to exclude the status parameter
- Existing gateway route (`gateway/src/routes/dashboardSummary.ts`) and server.ts registration do NOT need changes -- only the types and mock service change
