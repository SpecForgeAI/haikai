# Task Breakdown: Dashboard UX Improvements

## Overview
Total Tasks: 42 (across 5 task groups)

This spec covers 10 requirements that improve the dashboard with richer metric types, new cards, sub-section grouping, an enabled Summary Insight, side-by-side chat panel layout, and default-to-dashboard navigation.

## Task List

### Type System & Gateway Mock Data

#### Task Group 1: Type Definitions and Mock Data Updates
**Dependencies:** None

This group updates the shared type contract between gateway and frontend, then updates all gateway mock data to produce values conforming to the new types. All subsequent task groups depend on these type changes being in place.

- [x] 1.0 Complete type system and mock data layer
  - [x] 1.1 Write 4 focused tests for mock data service changes
    - Test 1: `buildMockDashboardSummary` returns `MetricCard` values with boolean, string, and number types (verify `productDefinition.missionExists.value` is `true`, `productDefinition.lastUpdatedLabel.value` is a string)
    - Test 2: `buildMockDashboardSummary` returns `testStrategy` field on `strategicFoundation` with `exists` and `lastUpdated` sub-fields
    - Test 3: `postCoding.implementation` is an object with `featuresInProgress`, `storiesInProgress`, `storiesComplete` fields (not a single MetricCard)
    - Test 4: `postCoding.summaryInsight.enabled` is `true` and `postCoding.summaryInsight.message` is a non-null string
  - [x] 1.2 Extend `MetricCard.value` type from `number` to `number | boolean | string`
    - File: `gateway/src/types/dashboard.ts` line 95 -- change `value: number` to `value: number | boolean | string`
    - File: `frontend/src/types/dashboard.ts` line 71 -- change `value: number` to `value: number | boolean | string`
  - [x] 1.3 Update `ProductDefinitionMetrics` interface -- remove `state` field, update value types
    - File: `gateway/src/types/dashboard.ts` lines 163-170 -- remove `state: MetricCard`, keep `missionExists` and `lastUpdatedLabel`
    - File: `frontend/src/types/dashboard.ts` lines 150-157 -- mirror the same removal
  - [x] 1.4 Update `RoadmapMetrics` interface -- remove `state` and `epicsCount`, rename `epicsCompletedCount`
    - File: `gateway/src/types/dashboard.ts` lines 149-158 -- remove `state`, remove `epicsCount`, rename `epicsCompletedCount` to `completed`
    - File: `frontend/src/types/dashboard.ts` lines 136-145 -- mirror changes
    - New shape: `{ initiativesCount: MetricCard; epics: MetricCard; completed: MetricCard }`
  - [x] 1.5 Update `StandardsMetrics` interface -- rename fields
    - File: `gateway/src/types/dashboard.ts` lines 105-110 -- rename `companyStandards` to `orgTechStack`, `productStandards` to `productTechStack`
    - File: `frontend/src/types/dashboard.ts` lines 92-97 -- mirror renames
  - [x] 1.6 Create `ImplementationMetrics` interface and update `PostCodingSection`
    - File: `gateway/src/types/dashboard.ts` -- add `ImplementationMetrics { featuresInProgress: MetricCard; storiesInProgress: MetricCard; storiesComplete: MetricCard }` after existing metric interfaces
    - File: `gateway/src/types/dashboard.ts` line 244 -- change `implementation: MetricCard` to `implementation: ImplementationMetrics`
    - File: `frontend/src/types/dashboard.ts` -- mirror both changes
  - [x] 1.7 Create `TestStrategyMetrics` interface and add `testStrategy` to `StrategicFoundationSection`
    - File: `gateway/src/types/dashboard.ts` -- add `TestStrategyMetrics { exists: MetricCard; lastUpdated: MetricCard }`
    - File: `gateway/src/types/dashboard.ts` `StrategicFoundationSection` -- add `testStrategy: TestStrategyMetrics`
    - File: `frontend/src/types/dashboard.ts` -- mirror both changes
  - [x] 1.8 Update gateway `card()` helper to accept `number | boolean | string`
    - File: `gateway/src/services/dashboardSummaryMockService.ts` line 65 -- change `value: number` parameter to `value: number | boolean | string`
  - [x] 1.9 Update `buildLargeStrategicFoundation()` mock data
    - File: `gateway/src/services/dashboardSummaryMockService.ts` lines 72-106
    - Product Definition: remove `state`, change `missionExists` value to `true` (boolean), change `lastUpdatedLabel` value to `'01/03/2026'` (string)
    - Roadmap: remove `state`, remove `epicsCount`, rename `epicsCompletedCount` to `completed` with label `'Completed'` and value `2`, rename `epicsCount` to `epics` with label `'Epics'` and value `5`
    - Standards: rename `companyStandards` to `orgTechStack` with label `'Org Tech Stack'` and value `'Generated'`, rename `productStandards` to `productTechStack` with label `'Product Tech Stack'` and value `'Generated'`
    - Add `testStrategy`: `{ exists: card('Exists', true), lastUpdated: card('Last Updated', '08/03/2026') }`
  - [x] 1.10 Update `buildSmallStrategicFoundation()` mock data with same structural changes
    - File: `gateway/src/services/dashboardSummaryMockService.ts` lines 114-148
    - Apply the same field removals, renames, and type changes as 1.9
  - [x] 1.11 Update all `buildLarge/Medium/SmallDetailedDefinitionAndDelivery()` functions
    - File: `gateway/src/services/dashboardSummaryMockService.ts`
    - Change `implementation: card('Implementation', N)` to `implementation: { featuresInProgress: card('Features in Progress', 2), storiesInProgress: card('Stories in Progress', 7), storiesComplete: card('Stories Complete', 5) }` (large)
    - Apply proportional values for medium and small variants
    - Change `summaryInsight: { ...DISABLED_INSIGHT }` in `buildLargeDetailedDefinitionAndDelivery` to `summaryInsight: { enabled: true, message: '<~50 word progress text>' }`
    - Keep summaryInsight disabled for medium and small variants (or enable all -- spec says enable for "Delivery" sub-section)
  - [x] 1.12 Update gateway import list in mock service
    - File: `gateway/src/services/dashboardSummaryMockService.ts` lines 16-34 -- add `ImplementationMetrics`, `TestStrategyMetrics` (or inline types) to the import block
  - [x] 1.13 Ensure mock data tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify `buildMockDashboardSummary` returns data conforming to the new type shapes

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- `MetricCard.value` accepts `number | boolean | string` in both gateway and frontend type files
- All gateway mock builder functions produce data matching the updated interfaces
- `ProductDefinitionMetrics` no longer has `state`, uses boolean/string values
- `RoadmapMetrics` no longer has `state` or `epicsCount`, has `epics` and `completed`
- `StandardsMetrics` uses `orgTechStack` and `productTechStack` field names
- `PostCodingSection.implementation` is `ImplementationMetrics` (3 fields, not a single MetricCard)
- `StrategicFoundationSection` has a `testStrategy` field with `TestStrategyMetrics` shape
- At least one `summaryInsight` has `enabled: true` with a non-null message

---

### Dashboard Component Updates

#### Task Group 2: DashboardView Component and CSS Updates
**Dependencies:** Task Group 1

This group implements all visual and structural changes to the DashboardView component: sub-section grouping for Strategic Foundation, Test Strategy card, persona gutter update, metric rendering changes, Summary Insight enablement, and header summary text.

- [x] 2.0 Complete DashboardView component updates
  - [x] 2.1 Write 6 focused tests for DashboardView changes
    - Test 1: Strategic Foundation renders two sub-section groups with labels "Product" and "Technical"
    - Test 2: "Technical" sub-section contains cards for Standards, High-Level Architecture, and Test Strategy
    - Test 3: "Product" sub-section contains cards for Product Definition and Roadmap
    - Test 4: Test Strategy card renders with `Exists: true` and `Last Updated: 08/03/2026` metrics
    - Test 5: Summary Insight card renders insight text (not disabled placeholder) when `summaryInsight.enabled` is true
    - Test 6: Implementation card renders three metrics (Features in Progress, Stories in Progress, Stories Complete)
  - [x] 2.2 Update Strategic Foundation section: replace `.strategicGrid` with two `.subSectionGroup` containers
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 267-332
    - Replace the single `<div className={styles.strategicGrid}>` with two bordered sub-sections:
      - "Product" sub-section: `<div className={styles.subSectionGroup}>` with `<span className={styles.subSectionGroupLabel}>Product</span>` containing Product Definition and Roadmap cards inside `<div className={styles.detailGrid}>`
      - "Technical" sub-section: `<div className={styles.subSectionGroup}>` with `<span className={styles.subSectionGroupLabel}>Technical</span>` containing Standards, HLA, and Test Strategy cards inside `<div className={styles.detailGrid}>`
    - Follow the exact JSX pattern from lines 389-443 (Definition/Delivery sub-groups)
  - [x] 2.3 Add Test Strategy card to the "Technical" sub-section
    - File: `frontend/src/components/DashboardView/DashboardView.tsx`
    - New card with `data-testid="card-test-strategy"`, shield icon, title "Test Strategy"
    - Render `renderMetric(strategicFoundation.testStrategy.exists)` and `renderMetric(strategicFoundation.testStrategy.lastUpdated)`
    - No navigation button (or navigate to `product/implement`)
  - [x] 2.4 Add Test Engineer persona icon to Strategic Foundation persona gutter
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` line 265
    - Add `<PersonaIcon name="Test Engineer" />` after the existing `<PersonaIcon name="Architect" />` line
    - Color `#2E7D32` is already in `PERSONA_COLORS` map (line 93)
  - [x] 2.5 Update Product Definition card -- remove `state` metric, verify new value types render
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` line 278 -- remove `{renderMetric(strategicFoundation.productDefinition.state)}`
    - Verify `renderMetric` correctly renders boolean `true` and string `'01/03/2026'` via JSX string coercion (the `{metric.value}` expression on line 79 already handles this)
  - [x] 2.6 Update Roadmap card -- remove `state` metric, update field references
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 291-295
    - Remove `{renderMetric(strategicFoundation.roadmap.state)}`
    - Change `strategicFoundation.roadmap.epicsCount` to `strategicFoundation.roadmap.epics`
    - Change `strategicFoundation.roadmap.epicsCompletedCount` to `strategicFoundation.roadmap.completed`
  - [x] 2.7 Update Standards card -- use `renderMetric()` directly with new field names
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 306-314
    - Replace the inline workaround (checking `value > 0` to map to "Generated"/"Not Generated") with:
      - `{renderMetric(strategicFoundation.standards.orgTechStack)}`
      - `{renderMetric(strategicFoundation.standards.productTechStack)}`
    - Values are now proper strings (`'Generated'`), so `renderMetric` renders them directly
  - [x] 2.8 Update Implementation card -- render three metrics from `ImplementationMetrics`
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` line 464
    - Replace `{renderMetric(postCoding.implementation)}` with:
      - `{renderMetric(postCoding.implementation.featuresInProgress)}`
      - `{renderMetric(postCoding.implementation.storiesInProgress)}`
      - `{renderMetric(postCoding.implementation.storiesComplete)}`
  - [x] 2.9 Enable Summary Insight card -- remove disabled state, render inline text
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 482-491
    - Remove `${styles.cardDisabled}` class from the card wrapper
    - Replace `<div className={styles.disabledText}>AI insights coming soon</div>` with conditional rendering:
      - If `postCoding.summaryInsight.enabled && postCoding.summaryInsight.message`: render `<div className={styles.insightText}>{postCoding.summaryInsight.message}</div>`
      - Else: render the disabled placeholder
    - No "Open" button needed
  - [x] 2.10 Add `.insightText` CSS class
    - File: `frontend/src/components/DashboardView/DashboardView.module.css`
    - Add after the `.disabledText` block (around line 385):
      ```css
      .insightText {
        font-size: 13px;
        color: #555;
        font-style: italic;
        line-height: 1.5;
      }
      ```
  - [x] 2.11 Update header AI summary text
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 248-250
    - Replace the placeholder text in `<span className={styles.headerSummaryText}>` with the ~70-word believable summary from the spec:
      "The product is in a healthy greenfield state with a well-defined mission and active roadmap of 5 initiatives spanning 12 epics. Strategic foundations including tech stack standards and high-level architecture are fully generated. Detailed definition is progressing with 22 stories in the current scope, though acceptance criteria coverage at 64% needs attention. Implementation has begun with 2 features actively being developed and early verification results looking positive."
  - [x] 2.12 Update `artifactExists` derivation logic for new value types
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 540-546
    - `mission`: change `=== 1` to `=== true` (value is now boolean)
    - `roadmap`: remove `roadmap.state` reference (field removed), derive from `roadmap.initiativesCount.value > 0` or similar
    - `techStack`: change `standards.companyStandards` to `standards.orgTechStack`, adjust comparison for string value (e.g., `=== 'Generated'` or simply truthy check)
    - `testStrategy`: change `standards.productStandards` to check actual `testStrategy.exists.value === true`
  - [x] 2.13 Remove or deprecate `.strategicGrid` CSS class
    - File: `frontend/src/components/DashboardView/DashboardView.module.css` lines 272-288
    - Remove the `.strategicGrid` block and its media queries (no longer used after sub-section conversion)
    - Note: verify DashboardSkeleton no longer references it (addressed in Task Group 3)
  - [x] 2.14 Ensure DashboardView component tests pass
    - Run ONLY the 6 tests written in 2.1
    - Verify all cards render with correct metric values and new layout structure

**Acceptance Criteria:**
- The 6 tests written in 2.1 pass
- Strategic Foundation section uses two bordered sub-sections ("Product" and "Technical") instead of a flat 4-column grid
- Test Strategy card appears in the "Technical" sub-section with correct metrics
- Test Engineer persona icon appears in the Strategic Foundation gutter
- Product Definition and Roadmap cards no longer show "State" metric
- Standards card uses `renderMetric()` directly (no inline workaround)
- Implementation card renders three metrics
- Summary Insight card shows inline text when enabled
- Header shows the updated ~70-word summary text
- `artifactExists` derivation works with new value types (boolean/string)

---

### Chat Panel Side-by-Side Layout

#### Task Group 3: Side-by-Side Chat Panel Layout for Dashboard
**Dependencies:** Task Group 2

This group implements the side-by-side layout where the chat panel sits alongside the dashboard (30/70 split) instead of overlaying it. Only applies to the Dashboard view; other views retain the existing fixed-overlay behavior.

- [x] 3.0 Complete side-by-side chat panel layout
  - [x] 3.1 Write 4 focused tests for side-by-side layout
    - Test 1: DashboardView renders a `.dashboardLayout` flex-row wrapper containing both the dashboard container and the chat panel
    - Test 2: UnifiedChatPanel with `layout="inline"` prop renders with `.panelInline` class (not `.panel` with fixed positioning)
    - Test 3: When chat panel is collapsed in inline mode, collapsed tab uses `.collapsedTabInline` class (no fixed positioning)
    - Test 4: UnifiedChatPanel without `layout` prop (non-Dashboard views) still renders with `.panel` class (fixed positioning)
  - [x] 3.2 Add `layout` prop to `UnifiedChatPanelProps` interface
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` lines 161-176
    - Add optional prop: `layout?: 'overlay' | 'inline'`
    - Default to `'overlay'` when not provided
    - Destructure in component function (line 182)
  - [x] 3.3 Update UnifiedChatPanel collapsed rendering for inline mode
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` lines 581-596
    - When `layout === 'inline'`: use `styles.collapsedTabInline` instead of `styles.collapsedTab`
    - Use conditional className: `className={layout === 'inline' ? styles.collapsedTabInline : styles.collapsedTab}`
  - [x] 3.4 Update UnifiedChatPanel expanded rendering for inline mode
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` lines 602-607
    - When `layout === 'inline'`: use `styles.panelInline` instead of `styles.panel`
    - In inline mode, do not apply `style={{ width: \`${width}px\` }}` (width is controlled by flex parent)
    - Use conditional className: `className={layout === 'inline' ? styles.panelInline : styles.panel}`
    - Use conditional style: `style={layout === 'inline' ? undefined : { width: \`${width}px\` }}`
  - [x] 3.5 Add `.panelInline` and `.collapsedTabInline` CSS classes
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css`
    - `.panelInline`: `position: relative; height: 100%; width: 100%; background: #ffffff; border-left: 1px solid #e0e0e0; display: flex; flex-direction: column;` (no `z-index`, no `box-shadow`, no fixed positioning)
    - `.collapsedTabInline`: same as `.collapsedTab` but with `position: relative; height: 100%;` instead of `position: fixed; top: 60px; right: 0; height: calc(100vh - 60px);` and no `z-index: 900`
  - [x] 3.6 Update DashboardView to wrap content in `.dashboardLayout` flex parent
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 237-550
    - Replace the outer `<>` fragment with `<div className={styles.dashboardLayout}>`
    - Move the existing `<div className={styles.container}>` and `<UnifiedChatPanel>` inside this flex parent
    - Pass `layout="inline"` prop to `<UnifiedChatPanel>`
  - [x] 3.7 Add `.dashboardLayout` CSS class
    - File: `frontend/src/components/DashboardView/DashboardView.module.css`
    - ```css
      .dashboardLayout {
        display: flex;
        height: calc(100vh - 60px);
        overflow: hidden;
      }

      .dashboardLayout .container {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
      }
      ```
    - Note: When chat is expanded, dashboard takes remaining space (~70%); when collapsed, dashboard fills ~97%
  - [x] 3.8 Ensure the loading, error, and empty states also use the `.dashboardLayout` wrapper
    - File: `frontend/src/components/DashboardView/DashboardView.tsx` lines 184-228
    - The early-return branches (no project, loading, error, no data) currently return just the dashboard container without the chat panel. Decide whether to:
      - (a) Wrap only the success branch in `.dashboardLayout` (simpler, chat panel only appears on success), or
      - (b) Wrap all branches to keep chat panel visible during loading/error states
    - The current code already renders `<UnifiedChatPanel>` only after all early returns, so option (a) is the natural fit
  - [x] 3.9 Ensure side-by-side layout tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify inline vs overlay behavior distinction works correctly

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- On Dashboard view, chat panel and dashboard content sit side-by-side in a flex row
- Chat panel uses `position: relative` (inline mode) instead of `position: fixed`
- When collapsed, a 32px tab remains visible and dashboard fills remaining width
- Non-Dashboard views are unaffected (chat panel still uses fixed overlay)
- No `z-index: 900` on the inline variant

---

### Skeleton and Navigation Updates

#### Task Group 4: DashboardSkeleton Update and Default Tab Change
**Dependencies:** Task Group 2 (needs `.strategicGrid` removal, new sub-section pattern)

This group updates the DashboardSkeleton to match the new sub-section layout and changes the default application tab to Dashboard.

- [x] 4.0 Complete skeleton and navigation updates
  - [x] 4.1 Write 4 focused tests for skeleton and navigation changes
    - Test 1: DashboardSkeleton renders two sub-section groups (Product with 2 skeleton cards, Technical with 3 skeleton cards) instead of a single 4-card strategicGrid
    - Test 2: DashboardSkeleton no longer uses `.strategicGrid` CSS class
    - Test 3: Initial `currentView` in ArchitectureContext is `'dashboard'` (not `'metamodel'`)
    - Test 4: DashboardSkeleton snapshot matches updated structure
  - [x] 4.2 Update DashboardSkeleton component
    - File: `frontend/src/components/DashboardView/DashboardSkeleton.tsx` lines 37-43
    - Replace:
      ```jsx
      <div className={styles.strategicGrid}>
        <SkeletonCard /> <SkeletonCard /> <SkeletonCard /> <SkeletonCard />
      </div>
      ```
    - With two sub-section groups:
      ```jsx
      <div className={styles.subSectionGroup}>
        <span className={styles.subSectionGroupLabel}>Product</span>
        <div className={styles.detailGrid}>
          <SkeletonCard /> <SkeletonCard />
        </div>
      </div>
      <div className={styles.subSectionGroup}>
        <span className={styles.subSectionGroupLabel}>Technical</span>
        <div className={styles.detailGrid}>
          <SkeletonCard /> <SkeletonCard /> <SkeletonCard />
        </div>
      </div>
      ```
    - Update the component header comment to reflect "Product (2 cards) + Technical (3 cards)" instead of "4 skeleton cards"
  - [x] 4.3 Update DashboardSkeleton snapshot
    - File: `frontend/src/__tests__/__snapshots__/DashboardSkeleton.test.tsx.snap`
    - Delete the old snapshot file content (it will be regenerated)
    - Run the snapshot test with `--updateSnapshot` flag to regenerate
  - [x] 4.4 Update DashboardSkeleton test assertions
    - File: `frontend/src/__tests__/DashboardSkeleton.test.tsx`
    - Update any assertions that check for the old 4-card strategicGrid structure
    - Assert new sub-section group labels ("Product", "Technical") and card counts (2 + 3 = 5)
  - [x] 4.5 Change default view to Dashboard
    - File: `frontend/src/contexts/ArchitectureContext.tsx` line 256
    - Change `currentView: 'metamodel'` to `currentView: 'dashboard'`
    - Update the comment on line 252 to reference this spec
  - [x] 4.6 Ensure skeleton and navigation tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify skeleton renders correctly with new structure
    - Verify default view is `'dashboard'`

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- DashboardSkeleton renders "Product" (2 cards) and "Technical" (3 cards) sub-sections
- DashboardSkeleton no longer references `.strategicGrid`
- Snapshot test is updated and passing
- Application defaults to Dashboard tab on load
- Existing navigation guard in App.tsx is unaffected

---

### Test Review & Verification

#### Task Group 5: Test Review, Gap Analysis, and Final Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 tests written by Task Group 1 (mock data service)
    - Review the 6 tests written by Task Group 2 (DashboardView component)
    - Review the 4 tests written by Task Group 3 (side-by-side layout)
    - Review the 4 tests written by Task Group 4 (skeleton and navigation)
    - Total existing tests: 18 tests
  - [x] 5.2 Analyze test coverage gaps for this spec's features only
    - Check that the `renderMetric` function handles boolean and string values correctly (string coercion test)
    - Check that `artifactExists` derivation works with the new value types
    - Check that existing dashboard tests in `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` still compile with the type changes
    - Check that the `card()` helper function correctly builds MetricCards with non-numeric values
    - Check responsive behavior of new sub-section groups (if applicable)
  - [x] 5.3 Write up to 8 additional strategic tests to fill identified critical gaps
    - Potential tests:
      - Test: `renderMetric` renders `true` as the string "true" and `'Generated'` as "Generated"
      - Test: `artifactExists.mission` is `true` when `missionExists.value` is boolean `true`
      - Test: `artifactExists.testStrategy` correctly derives from `testStrategy.exists.value`
      - Test: Summary Insight shows disabled placeholder when `enabled` is `false`
      - Test: Standards card renders "Org Tech Stack: Generated" (not "Company Standards: 1")
      - Test: Roadmap card renders "Initiatives", "Epics", "Completed" metrics (no "State")
      - Test: Product Definition card renders "Mission Exists: true" and "Last Updated: 01/03/2026" (no "State")
      - Test: DashboardView with inline chat panel renders `.dashboardLayout` wrapper
  - [x] 5.4 Run feature-specific tests only
    - Run all tests from 1.1, 2.1, 3.1, 4.1, and 5.3
    - Expected total: approximately 18 + 8 = 26 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass
  - [x] 5.5 Verify TypeScript compilation
    - Run `tsc --noEmit` on both gateway and frontend to ensure all type changes compile cleanly
    - Fix any type errors caused by the interface changes across the codebase
  - [x] 5.6 Verify no regressions in existing dashboard tests
    - Run existing test files that may be affected by type changes:
      - `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
      - `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx`
      - `frontend/src/__tests__/DashboardView.test.tsx`
      - `frontend/src/__tests__/DashboardSkeleton.test.tsx`
      - `frontend/src/__tests__/hub-chat-dashboard-wiring.test.tsx`
    - Update any broken assertions caused by the structural and type changes

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- TypeScript compilation succeeds with no type errors in gateway or frontend
- Existing dashboard test files compile and pass (with necessary assertion updates)
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

### Recommended implementation sequence:

```
Phase 1 (Foundation):
  Task Group 1: Type Definitions and Mock Data Updates
  -- No dependencies, must complete first

Phase 2 (Core UI - can partially parallelize):
  Task Group 2: DashboardView Component and CSS Updates
  -- Depends on Task Group 1

Phase 3 (Layout + Navigation - can parallelize with each other):
  Task Group 3: Side-by-Side Chat Panel Layout
  -- Depends on Task Group 2 (needs updated DashboardView structure)

  Task Group 4: DashboardSkeleton and Default Tab Change
  -- Depends on Task Group 2 (needs .strategicGrid removed)
  -- Can run in parallel with Task Group 3

Phase 4 (Verification):
  Task Group 5: Test Review, Gap Analysis, Final Verification
  -- Depends on all previous groups (1-4)
```

### Parallelization opportunities:
- Task Groups 3 and 4 can execute in parallel after Task Group 2 completes
- Within Task Group 1, gateway type changes (1.2-1.7) and frontend type changes can be done simultaneously since they are independent files that must mirror each other
- Within Task Group 2, CSS additions (2.10, 2.13) can be done in parallel with JSX changes

### Key files modified (summary):
| File | Task Groups |
|------|-------------|
| `gateway/src/types/dashboard.ts` | 1 |
| `frontend/src/types/dashboard.ts` | 1 |
| `gateway/src/services/dashboardSummaryMockService.ts` | 1 |
| `frontend/src/components/DashboardView/DashboardView.tsx` | 2, 3, 5 |
| `frontend/src/components/DashboardView/DashboardView.module.css` | 2, 3 |
| `frontend/src/components/DashboardView/DashboardSkeleton.tsx` | 4 |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | 3 |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.module.css` | 3 |
| `frontend/src/contexts/ArchitectureContext.tsx` | 4 |
| `frontend/src/__tests__/DashboardSkeleton.test.tsx` | 4 |
| `frontend/src/__tests__/__snapshots__/DashboardSkeleton.test.tsx.snap` | 4 |
| `frontend/src/__tests__/dashboard-ux-improvements-gaps.test.tsx` | 5 |
| `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx` | 5 (mock data updated) |
| `frontend/src/__tests__/dashboard-increment-3-gap-tests.test.tsx` | 5 (mock data + assertions updated) |
| `frontend/src/__tests__/DashboardView.test.tsx` | 5 (mock data + snapshots updated) |
| `frontend/src/__tests__/hub-chat-dashboard-wiring.test.tsx` | 5 (mock data updated) |
| `frontend/src/__tests__/__snapshots__/DashboardView.test.tsx.snap` | 5 (regenerated) |
