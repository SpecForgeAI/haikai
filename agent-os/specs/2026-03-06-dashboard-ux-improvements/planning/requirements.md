# Spec Requirements: Dashboard UX Improvements

## Initial Description
7 changes to the dashboard:

1. Add 5th "Test Strategy" card to Strategic Foundation with mock metrics "Exists? True" and "Last Updated: 08/03/2026"

2. Split Strategic Foundation into 2 sub-sections with bordered styling (matching Detailed Definition & Delivery pattern): "Product" (contains Product Definition, Roadmap) and "Technical" (contains Standards, High-Level Architecture, Test Strategy)

3. Add Test Engineer persona icon as 3rd persona on LHS of Strategic Foundation section

4. Enable "Summary Insight" for Detailed Definition & Delivery (remove greyed-out) with ~50-word believable progress text. Update top-level AI summary to ~70-word believable overall product progress description.

5. Metric changes: a) Remove "State" from Product Definition and Roadmap. b) Product Definition: "Mission Exists: True" and "Last Updated: 01/03/2026". c) Roadmap: Epics > Epics Completed. d) Standards: "Org Tech Stack: Generated" and "Product Tech Stack: Generated". e) Implementation: "Features in Progress: 2", "Stories in Progress: 7", "Stories Complete: 5"

6. Hub chat panel layout: side-by-side with dashboard (not overlay). Chat 30% width, dashboard 70%. Chat expanded by default.

7. Default to Dashboard tab on load (not Architecture & Design)

## Requirements Discussion

### First Round Questions

**Q1:** The current `MetricCard` type only supports numeric `value` fields (`{ label: string; value: number }`). Your requested metrics "Exists? True" and "Last Updated: 08/03/2026" are string-based. The Standards card already works around this by mapping numeric values to "Generated"/"Not Generated" in the JSX. I'm assuming we should follow the same pattern -- keep `MetricCard.value` as `number` and map to display strings in the rendering logic (e.g., value `1` renders as "True", value `0` renders as "08/03/2026" with a label-based convention). Is that acceptable, or would you prefer to extend the `MetricCard` type to support a `displayValue: string` field?
**Answer:** For all data changes, change the format (it is incorrect as it is). The "exists" field is a boolean (True or False), not a number. So extend the MetricCard type to support proper data types - booleans for exists fields, strings for dates, etc.

**Q2:** Currently the Strategic Foundation uses a flat 4-column grid (`.strategicGrid` with `grid-template-columns: repeat(4, 1fr)`). With the split into "Product" (2 cards) and "Technical" (3 cards), each sub-section will have a different number of cards. I'm assuming we should use the same `detailGrid` 3-column pattern used in Definition/Delivery for the "Technical" sub-section, and a 2-column grid for the "Product" sub-section. Is that correct, or should both sub-sections use the same column count (e.g., 3-column for both, leaving one empty slot in "Product")?
**Answer:** Both sub-sections use the same column count (3-column grid, leaving an empty slot in "Product").

**Q3:** The `UnifiedChatPanel` currently uses `position: fixed; right: 0; z-index: 900` and overlays all content. Changing to side-by-side (30/70) for the hub/dashboard requires significant layout restructuring. I'm assuming this side-by-side layout applies only when viewing the Dashboard (since the chat panel is rendered inside `DashboardView.tsx`), and the existing fixed-overlay behavior remains for all other views (Product & Delivery, Architecture & Design, Diagrams). Is that correct?
**Answer:** Just for Dashboard for now. Other views keep the existing fixed-overlay behavior.

**Q4:** When the chat panel is collapsed in the new side-by-side layout, should the dashboard expand to fill the full width (essentially reverting to current 100% layout), or should a slim collapsed tab remain visible at the right edge (the current 32px collapsed tab behavior), keeping the dashboard at approximately 97% width?
**Answer:** A slim collapsed tab remains visible at the right edge (current 32px tab behavior), keeping the dashboard at approximately 97% width.

**Q5:** You want to enable the Summary Insight card with ~50 words of believable progress text. Currently the disabled card has no "Open" button. Should the enabled card: (a) display the text inline within the card metrics area with no navigation/action button, or (b) include an "Open" button like other cards that navigates somewhere?
**Answer:** Option (a) - display the ~50-word text inline within the card with no action button.

**Q6:** Currently `postCoding.implementation` is a single `MetricCard` (just one label/value). Your requirement calls for 3 metrics: "Features in Progress: 2", "Stories in Progress: 7", "Stories Complete: 5". This requires changing the `implementation` field from `MetricCard` to a structured type like `ImplementationMetrics { featuresInProgress: MetricCard; storiesInProgress: MetricCard; storiesComplete: MetricCard }`. I'm assuming this structural change to both the gateway and frontend types is acceptable. Correct?
**Answer:** Yes, changing the type in both gateway and frontend is acceptable.

**Q7:** The current default view is `'metamodel'` (Architecture & Design). There is an existing guard in `App.tsx` that redirects from `'product'` to `'metamodel'` when `includeDelivery` is `false`. Changing the default to `'dashboard'` should not trigger this guard (since `'dashboard'` !== `'product'`). I'm assuming the guard logic stays unchanged and we simply update the initial state. Is there anything else to consider here, such as when no active project is loaded?
**Answer:** No active project means landing page appears, so the dashboard is never visible with no active project. Don't worry about this edge case.

**Q8:** Is there anything that should explicitly be excluded from this spec? For example, should we avoid changing the DashboardSkeleton to match the new layout, or should the skeleton be updated as well? Should existing tests be updated in this spec or deferred?
**Answer:** You decide if DashboardSkeleton should be updated (if it needs to be done, don't defer it!). Update tests now, don't defer.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Sub-section groups (Definition/Delivery) - Path: `frontend/src/components/DashboardView/DashboardView.module.css` (`.subSectionGroup` and `.subSectionGroupLabel` CSS classes)
- Feature: Sub-section groups (Definition/Delivery) - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (JSX rendering pattern for bordered sub-groups with labels)
- Feature: Persona gutter system - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (`PersonaIcon` component, `PERSONA_COLORS` map -- Test Engineer color `#2E7D32` already defined)
- Feature: Chat panel overlay - Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` and `UnifiedChatPanel.module.css` (current fixed-position overlay pattern to be adapted for side-by-side)
- Feature: Dashboard skeleton - Path: `frontend/src/components/DashboardView/DashboardSkeleton.tsx` (will need updating to match new layout)
- Feature: Mock data service - Path: `gateway/src/services/dashboardSummaryMockService.ts` (mock data factory to be updated with new metrics)
- Feature: Dashboard types (gateway) - Path: `gateway/src/types/dashboard.ts` (type definitions to be extended)
- Feature: Dashboard types (frontend) - Path: `frontend/src/types/dashboard.ts` (type definitions to be extended, must mirror gateway)
- Feature: Default view initial state - Path: `frontend/src/contexts/ArchitectureContext.tsx` (line ~256, `currentView: 'metamodel'` to change to `'dashboard'`)

No side-by-side panel layout patterns were identified elsewhere in the codebase. The chat/dashboard side-by-side layout will be a new pattern.

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Add 5th "Test Strategy" card to Strategic Foundation section with boolean "Exists? True" and string "Last Updated: 08/03/2026" metrics
- Split Strategic Foundation into "Product" (Product Definition, Roadmap) and "Technical" (Standards, High-Level Architecture, Test Strategy) sub-sections using the existing bordered `.subSectionGroup` pattern
- Both sub-sections use 3-column grid layout (Product has one empty slot)
- Add Test Engineer persona icon as 3rd persona in Strategic Foundation's persona gutter (after Product Manager and Architect)
- Enable Summary Insight card in Detailed D&D: remove disabled/greyed-out state, display ~50-word inline progress text with no action button
- Update top-level AI summary in the header bar to ~70-word believable overall product progress description
- Remove "State" metric from Product Definition card
- Update Product Definition metrics: "Mission Exists: True" (boolean), "Last Updated: 01/03/2026" (string date)
- Remove "State" metric from Roadmap card
- Rename Roadmap "Epics" metric to "Epics Completed" (remove the separate Epics count, keep Epics Completed)
- Rename Standards metrics: "Company Standards" to "Org Tech Stack", "Product Standards" to "Product Tech Stack" (values remain "Generated"/"Not Generated")
- Change Implementation from single MetricCard to structured type with 3 metrics: "Features in Progress: 2", "Stories in Progress: 7", "Stories Complete: 5"
- Extend `MetricCard` type to support proper data types: booleans for exists fields, strings for dates (not just numeric values)
- Hub chat panel displays side-by-side with dashboard: chat 30% width, dashboard 70% width
- Side-by-side layout applies only to the Dashboard view; other views retain existing fixed-overlay chat behavior
- Chat panel expanded by default on Dashboard view
- When chat panel is collapsed, 32px slim tab remains visible, dashboard fills ~97% width
- Default application tab on load changes from "Architecture & Design" (metamodel) to "Dashboard"
- DashboardSkeleton must be updated to reflect the new sub-section layout (do not defer)
- All existing tests must be updated to match the new layout and types (do not defer)

### Reusability Opportunities
- `.subSectionGroup` and `.subSectionGroupLabel` CSS classes already implement the bordered sub-section pattern needed for Strategic Foundation split
- `PersonaIcon` component and `PERSONA_COLORS` map already include Test Engineer with color `#2E7D32`
- `.detailGrid` CSS class already provides the 3-column grid pattern needed for the new sub-sections
- `SummaryInsight` type already supports `enabled: boolean` and `message: string | null` -- just needs mock data with `enabled: true` and a message

### Scope Boundaries
**In Scope:**
- All 7 described dashboard changes
- Type system changes to MetricCard (extend to support boolean and string values)
- Type system changes to ImplementationMetrics (new structured type)
- Type system changes to StrategicFoundationSection (add testStrategy field)
- Type system changes to ProductDefinitionMetrics (remove state, update value types)
- Type system changes to RoadmapMetrics (remove state, remove epicsCount)
- Type system changes to StandardsMetrics (rename fields)
- Gateway mock data updates for all changed metrics
- Frontend dashboard component restructuring
- Chat panel CSS changes for Dashboard-only side-by-side layout
- DashboardSkeleton update
- Test updates for all changed components and types
- Default view change in ArchitectureContext initial state

**Out of Scope:**
- Side-by-side chat layout for non-Dashboard views (Product & Delivery, Architecture & Design, Diagrams)
- Real/dynamic data for Summary Insight or header summary (using believable mock text only)
- Edge case handling for no active project on Dashboard view (landing page handles this)
- Any changes to the chat panel's functional behavior (only layout/positioning changes)

### Technical Considerations
- MetricCard type extension needs to be backwards-compatible -- existing cards using numeric values must continue to work
- Both frontend (`frontend/src/types/dashboard.ts`) and gateway (`gateway/src/types/dashboard.ts`) type definitions must be updated in sync
- Gateway mock service (`gateway/src/services/dashboardSummaryMockService.ts`) must produce data matching the new type shapes
- Chat panel side-by-side layout for Dashboard is a new CSS pattern not used elsewhere in the codebase -- will need new CSS classes rather than reusing existing patterns
- The `UnifiedChatPanel` component renders inside `DashboardView.tsx` -- the side-by-side layout change should be contained within the DashboardView wrapper, not in UnifiedChatPanel's own CSS (to avoid affecting other views)
- The 4-column `.strategicGrid` CSS class will be replaced by 3-column grids inside sub-section groups
- Responsive breakpoints for the new sub-section grids should follow the existing pattern (2-column at 1200px, 1-column at 600px)
