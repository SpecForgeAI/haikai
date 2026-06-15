# Specification: Dashboard UX Improvements

## Goal
Enhance the dashboard with a new Test Strategy card, Strategic Foundation sub-sections, expanded metrics with proper data types, an enabled Summary Insight card, a side-by-side chat panel layout, and default-to-dashboard navigation -- making the dashboard the primary landing experience with richer, more accurate data representation.

## User Stories
- As a product team member, I want the dashboard to display properly-typed metrics (booleans, dates, strings) and a Test Strategy card so that I get an accurate, at-a-glance view of the entire product lifecycle status.
- As a user working with the AI assistant, I want the chat panel to sit side-by-side with the dashboard (not overlaying it) so that I can see my dashboard context while conversing.
- As a user opening the application, I want to land on the Dashboard tab by default so that I immediately see the product status overview.

## Specific Requirements

**1. Extend MetricCard type to support multiple value types**
- Change `MetricCard.value` from `number` to `number | boolean | string` in both `frontend/src/types/dashboard.ts` and `gateway/src/types/dashboard.ts`
- The `renderMetric` function in `DashboardView.tsx` already renders `{metric.value}` which handles all primitive types via string coercion; verify boolean renders as `true`/`false` and string renders directly
- Existing numeric MetricCard usages remain unchanged and backward-compatible
- The gateway mock service helper `card()` function needs a second overload or union parameter to accept `number | boolean | string`

**2. Add Test Strategy card to Strategic Foundation**
- Add `testStrategy` field to `StrategicFoundationSection` interface in both frontend and gateway type files
- Type: `{ exists: MetricCard; lastUpdated: MetricCard }` (new inline interface or named `TestStrategyMetrics`)
- Mock data values: `exists` = `{ label: 'Exists', value: true }` (boolean), `lastUpdated` = `{ label: 'Last Updated', value: '08/03/2026' }` (string date)
- Render the card with icon `shield emoji` or similar, title "Test Strategy", no navigation button (or navigate to product/implement)
- Card sits in the "Technical" sub-section alongside Standards and High-Level Architecture

**3. Split Strategic Foundation into Product and Technical sub-sections**
- Replace the existing `.strategicGrid` (4-column flat grid) with two `.subSectionGroup` containers inside `.sectionContent`, following the existing bordered pattern from Detailed D&D (blue dashed border, floating label)
- "Product" sub-section: label "Product", contains Product Definition and Roadmap cards in a `.detailGrid` (3-column, leaving one empty slot)
- "Technical" sub-section: label "Technical", contains Standards, High-Level Architecture, and Test Strategy cards in a `.detailGrid` (3-column, all three slots filled)
- Remove or deprecate the `.strategicGrid` CSS class (no longer needed)
- Both sub-sections follow the same responsive breakpoints as `.detailGrid` (2-column at 1200px, 1-column at 600px)

**4. Add Test Engineer persona to Strategic Foundation gutter**
- Add `<PersonaIcon name="Test Engineer" />` as the 3rd persona in the Strategic Foundation `.personaGutter`, after Product Manager and Architect
- `PERSONA_COLORS` already has Test Engineer mapped to `#2E7D32` -- no color changes needed

**5. Enable Summary Insight for Detailed D&D**
- Remove `cardDisabled` CSS class and `disabledText` div from the Summary Insight card in the Delivery sub-group
- Replace with inline text display: render `postCoding.summaryInsight.message` inside the `.cardMetrics` area using a new `.insightText` CSS class (italic, ~13px, color #555, line-height 1.5)
- No "Open" button -- just the card header (icon + title) and the inline text
- Update gateway mock data: set `summaryInsight.enabled = true` and `summaryInsight.message` to approximately 50 words of believable progress text, e.g.: "Delivery is progressing steadily with 5 stories completed and 7 actively in development across 2 features. Verification coverage is solid at 72% of completed stories reviewed. The testing suite has good functional coverage but end-to-end tests should be expanded before the next release milestone to reduce regression risk."
- Conditionally render: if `summaryInsight.enabled && summaryInsight.message`, show the insight text; otherwise show the existing disabled placeholder

**6. Update header AI summary text**
- Replace the current placeholder text in `.headerSummaryText` with approximately 70 words of believable overall product progress, e.g.: "The product is in a healthy greenfield state with a well-defined mission and active roadmap of 5 initiatives spanning 12 epics. Strategic foundations including tech stack standards and high-level architecture are fully generated. Detailed definition is progressing with 22 stories in the current scope, though acceptance criteria coverage at 64% needs attention. Implementation has begun with 2 features actively being developed and early verification results looking positive."

**7. Metric changes across existing cards**
- **Product Definition**: Remove `state` field from `ProductDefinitionMetrics` interface and mock data. Change `missionExists.value` from `number` (1) to `boolean` (true). Change `lastUpdatedLabel.value` from `number` (0) to `string` ('01/03/2026'). Remove the `renderMetric(strategicFoundation.productDefinition.state)` line from JSX.
- **Roadmap**: Remove `state` field from `RoadmapMetrics` interface and mock data. Keep `initiativesCount` as-is. Rename `epicsCount` to `epics` with label "Epics" and value 5. Rename `epicsCompletedCount` to `completed` with label "Completed" and value 2. Remove the `renderMetric(strategicFoundation.roadmap.state)` line from JSX.
- **Standards**: Rename `companyStandards` to `orgTechStack` with label "Org Tech Stack" and string value "Generated". Rename `productStandards` to `productTechStack` with label "Product Tech Stack" and string value "Generated". Remove the inline rendering workaround in JSX (lines 307-314 that check `value > 0`) and use `renderMetric()` directly since values are now proper strings.
- **Implementation**: Replace single `MetricCard` field with new `ImplementationMetrics` interface: `{ featuresInProgress: MetricCard; storiesInProgress: MetricCard; storiesComplete: MetricCard }`. Mock values: `featuresInProgress = { label: 'Features in Progress', value: 2 }`, `storiesInProgress = { label: 'Stories in Progress', value: 7 }`, `storiesComplete = { label: 'Stories Complete', value: 5 }`. Update `PostCodingSection.implementation` type from `MetricCard` to `ImplementationMetrics`. Update JSX to render all three metrics.

**8. Chat panel side-by-side layout for Dashboard**
- In `DashboardView.tsx`, wrap the existing `<div className={styles.container}>` and `<UnifiedChatPanel>` in a new flex-row parent `<div className={styles.dashboardLayout}>` with `display: flex`
- When chat is expanded: dashboard container gets `flex: 0 0 70%` (or `width: 70%`), chat panel gets `flex: 0 0 30%`
- When chat is collapsed: dashboard container gets `flex: 1` (~97% width), collapsed tab is 32px
- The `UnifiedChatPanel` must switch from `position: fixed` to `position: relative` (or `static`) when rendered inside the Dashboard layout -- pass a new prop `layout="inline"` (or similar) to signal inline mode
- In `UnifiedChatPanel.module.css`, add a `.panelInline` variant class that uses `position: relative; height: 100%; width: 100%` instead of the fixed positioning, and a `.collapsedTabInline` variant similarly
- For non-Dashboard views, `UnifiedChatPanel` continues using the existing `position: fixed` overlay -- no prop is passed, so it defaults to overlay mode
- The `.dashboardLayout` wrapper should have `height: calc(100vh - 60px)` and `overflow: hidden` to match the existing `.main-content` constraints
- Chat panel is expanded by default (`defaultOpen={true}` is already passed)
- Remove `z-index: 900` from the inline variant since it is in normal flow
- The resize handle remains functional in inline mode but the max-width constraint may need adjustment

**9. Default tab change to Dashboard**
- In `frontend/src/contexts/ArchitectureContext.tsx`, line 256, change `currentView: 'metamodel'` to `currentView: 'dashboard'`
- The existing navigation guard in `App.tsx` (redirects `product` to `metamodel` when `includeDelivery` is false) does not affect `dashboard` -- no guard changes needed
- No-active-project case shows the landing page before the dashboard is ever rendered

**10. Update DashboardSkeleton to match new layout**
- Replace the single `.strategicGrid` with 4 skeleton cards with two `.subSectionGroup` containers: "Product" (2 skeleton cards in `.detailGrid`) and "Technical" (3 skeleton cards in `.detailGrid`)
- Keep the rest of the skeleton (header bar, scope bar, D&D sub-sections) as-is
- Update the snapshot test at `frontend/src/__tests__/__snapshots__/DashboardSkeleton.test.tsx.snap`
- Update `frontend/src/__tests__/DashboardSkeleton.test.tsx` to assert the new sub-section structure

## Visual Design

No visual assets were provided.

## Existing Code to Leverage

**Sub-section group pattern (`.subSectionGroup` + `.subSectionGroupLabel`)**
- Defined in `frontend/src/components/DashboardView/DashboardView.module.css` (lines 249-266)
- Blue dashed border with floating label, already used for "Definition" and "Delivery" sub-groups in Detailed D&D
- Reuse the exact same CSS classes for the new "Product" and "Technical" sub-groups in Strategic Foundation
- JSX pattern in `DashboardView.tsx` (lines 389-443) shows the bordered container with label and inner `.detailGrid`

**PersonaIcon component and PERSONA_COLORS map**
- Defined in `DashboardView.tsx` (lines 87-106)
- Test Engineer with color `#2E7D32` is already in the map -- just add `<PersonaIcon name="Test Engineer" />` to the Strategic Foundation persona gutter
- The Detailed D&D section (line 370) already includes Test Engineer as a reference example

**SummaryInsight type**
- Defined in both `frontend/src/types/dashboard.ts` (lines 76-83) and `gateway/src/types/dashboard.ts` (lines 72-81)
- Already supports `enabled: boolean` and `message: string | null`
- The gateway mock service `DISABLED_INSIGHT` constant (line 39) just needs to be replaced with an enabled variant for the Delivery sub-section

**Gateway mock service scope-variant pattern**
- `gateway/src/services/dashboardSummaryMockService.ts` uses builder functions (`buildLargeStrategicFoundation`, `buildSmallDetailedDefinitionAndDelivery`, etc.) with scope-based branching
- New mock data for Test Strategy, updated metrics, and enabled Summary Insight should follow this same builder pattern
- The `card()` helper function (line 65) needs updating to accept `number | boolean | string` for the value parameter

**UnifiedChatPanel collapse/expand state persistence**
- `UnifiedChatPanel.tsx` uses per-threadKey localStorage keys for collapse state and width
- The inline layout variant should continue using this persistence so collapse state survives across sessions
- The `isCollapsed` state and `handleToggle` callback (lines 266-295) drive the collapsed/expanded rendering

## Out of Scope
- Side-by-side chat layout for non-Dashboard views (Product & Delivery, Architecture & Design, Diagrams) -- these retain the existing fixed-overlay behavior
- Real or dynamic data for Summary Insight or header summary -- using believable mock text only
- Edge case handling for no active project on Dashboard view -- the landing page handles this before the dashboard renders
- Any changes to the chat panel's functional behavior (message sending, persona switching, task execution) -- only layout and positioning changes
- Adding navigation or action buttons to the Summary Insight card -- it displays inline text only
- Changing the `UnifiedChatPanel` resize max-width from 50vw when in inline mode -- the 30% flex basis handles width constraints
- Real-time or LLM-generated summary text -- all summary content is hardcoded mock strings
- Changes to the Detailed Definition & Delivery sub-section structure (Definition/Delivery groupings remain as-is)
- Any backend API contract changes beyond type definitions and mock data -- no new endpoints
- Updating `artifactExists` derivation logic in `DashboardView.tsx` lines 540-546 to use the new MetricCard value types -- this must be updated to work with boolean values instead of `=== 1` checks, but this is a consequence of the type change, not a separate feature
