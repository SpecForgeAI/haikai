# Task Breakdown: Product Backlog Stage 4 - Roadmap Epic Anchoring

## Overview
Total Tasks: 26
Primary Files to Modify:
- `frontend/src/components/ProductView/ProductBacklogPage.tsx`
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`

Reference Files (no changes needed):
- `frontend/src/components/ProductView/WorkItemTree.tsx`
- `frontend/src/components/ProductView/WorkItemTree.module.css`
- `frontend/src/utils/workItemTreeBuilder.ts`

## Task List

### State Management & Filtering Logic

#### Task Group 1: Archived Filter State and LocalStorage Persistence
**Dependencies:** None

- [x] 1.0 Complete archived filter state management
  - [x] 1.1 Write 4-6 focused tests for archived filter state behavior
    - Test `showArchivedRoadmapItems` defaults to `false`
    - Test localStorage read on component mount with key `product_backlog_show_archived::<projectId>`
    - Test localStorage write when toggle changes
    - Test state resets when `loadedFileName` (projectId) changes
    - Test localStorage key includes correct projectId
  - [x] 1.2 Add `showArchivedRoadmapItems` state to ProductBacklogPage
    - Add `useState<boolean>` with default `false`
    - Initialize from localStorage on mount using pattern: `product_backlog_show_archived::${loadedFileName}`
    - Handle case where localStorage value doesn't exist (use default `false`)
  - [x] 1.3 Implement localStorage persistence
    - Create `useEffect` to write to localStorage when `showArchivedRoadmapItems` changes
    - Use key pattern: `product_backlog_show_archived::${loadedFileName}`
    - Only persist when `loadedFileName` is truthy
  - [x] 1.4 Create toggle handler callback
    - Implement `handleToggleShowArchived` callback using `useCallback`
    - Toggle `showArchivedRoadmapItems` state
    - Selection clearing logic handled in Task Group 2
  - [x] 1.5 Ensure archived filter state tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify localStorage integration works correctly

**Acceptance Criteria:**
- `showArchivedRoadmapItems` defaults to `false` on first load
- Preference persists to localStorage with correct key pattern
- Preference loads correctly when returning to page
- State resets appropriately when project changes

---

#### Task Group 2: Work Item Filtering Before Tree Build
**Dependencies:** Task Group 1

- [x] 2.0 Complete work item filtering logic
  - [x] 2.1 Write 4-6 focused tests for filtering behavior
    - Test that ARCHIVED INITIATIVEs are excluded when toggle is OFF
    - Test that ARCHIVED EPICs are excluded when toggle is OFF
    - Test that children of ARCHIVED parents are naturally hidden (orphan handling)
    - Test that ARCHIVED items appear when toggle is ON
    - Test that FEATUREs and STORYs are never filtered by this logic (only their parents)
  - [x] 2.2 Implement `filterWorkItemsForTree` utility function
    - Create function that filters work items based on `showArchivedRoadmapItems`
    - When `false`: exclude items where `(type === 'INITIATIVE' || type === 'EPIC') && status === 'ARCHIVED'`
    - When `true`: return all items unchanged
    - Place in ProductBacklogPage or create separate utility
  - [x] 2.3 Integrate filter into tree building pipeline
    - Apply `filterWorkItemsForTree` before calling `buildWorkItemTree`
    - Update `treeResult` useMemo to depend on both `workItems` and `showArchivedRoadmapItems`
  - [x] 2.4 Implement selection clearing on filter toggle
    - In toggle handler, check if `selectedId` refers to an item that will be hidden
    - If selected item is ARCHIVED INITIATIVE/EPIC, or is a descendant of one, clear selection
    - Use `treeResult.byId` to check if item exists in filtered tree
  - [x] 2.5 Compute `visibleEpics` count for empty state detection
    - Create `useMemo` to count EPICs where `status !== 'ARCHIVED'`
    - This count is used by Task Group 4 for empty state guidance
  - [x] 2.6 Ensure filtering tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify tree builds correctly with filtered data

**Acceptance Criteria:**
- ARCHIVED INITIATIVEs and EPICs are hidden when toggle is OFF
- Children of hidden parents do not appear in tree (natural orphan handling)
- All items visible when toggle is ON
- Selection clears when selected item becomes hidden

---

### UI Components

#### Task Group 3: Filter Toggle UI in Backlog Header
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete filter toggle UI
  - [x] 3.1 Write 4-6 focused tests for filter toggle UI
    - Test header hint text "Features belong under Roadmap Epics." is rendered
    - Test checkbox/toggle is rendered with label "Show archived roadmap items"
    - Test checkbox reflects current `showArchivedRoadmapItems` state
    - Test clicking checkbox calls toggle handler
    - Test toggle is accessible (proper label association, keyboard interaction)
  - [x] 3.2 Create header section in ProductBacklogPage
    - Add header area above tree panel in the two-column layout
    - Include hint text: "Features belong under Roadmap Epics."
    - Style to be visually distinct but not distracting
  - [x] 3.3 Implement checkbox toggle control
    - Render checkbox input with label "Show archived roadmap items"
    - Bind checked state to `showArchivedRoadmapItems`
    - Bind onChange to `handleToggleShowArchived`
    - Add appropriate `data-testid` attributes
  - [x] 3.4 Add CSS styles for header section
    - Create or extend ProductBacklogPage.module.css
    - Style header with appropriate spacing and typography
    - Ensure checkbox and label are properly aligned
    - Maintain visual consistency with existing design
  - [x] 3.5 Ensure filter toggle UI tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify toggle interaction works correctly

**Acceptance Criteria:**
- Header section appears above tree panel
- Hint text is clearly visible
- Checkbox reflects and controls filter state
- Toggle interaction is smooth and accessible

---

#### Task Group 4: Empty State Guidance When No Active Epics
**Dependencies:** Task Group 2

- [x] 4.0 Complete empty state guidance UI
  - [x] 4.1 Write 4-6 focused tests for empty state guidance
    - Test guidance block appears when `visibleEpics.length === 0`
    - Test guidance text: "No active roadmap epics found."
    - Test secondary text: "Import a roadmap to create epics before adding features."
    - Test "Go to Roadmap" button is present and navigates to `/product/roadmap`
    - Test archived toggle remains visible and functional in empty state
    - Test guidance disappears when toggle reveals archived epics
  - [x] 4.2 Implement empty state condition check
    - Use `visibleEpics.length === 0` from Task Group 2
    - Determine whether to show guidance block vs normal tree
    - Consider case where all epics are archived (toggle can reveal them)
  - [x] 4.3 Create guidance block UI component
    - Primary text: "No active roadmap epics found."
    - Secondary text: "Import a roadmap to create epics before adding features."
    - "Go to Roadmap" button with navigation action
    - Place replacing or above tree area (based on spec)
  - [x] 4.4 Implement "Go to Roadmap" navigation
    - Add navigation handler using appropriate routing method
    - Navigate to `/product/roadmap` path
    - Ensure navigation works with existing routing setup
  - [x] 4.5 Add CSS styles for guidance block
    - Style guidance container with appropriate spacing
    - Style primary and secondary text with different weights/sizes
    - Style navigation button as primary action
    - Center content visually in empty state
  - [x] 4.6 Ensure empty state guidance tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify guidance appears/disappears correctly

**Acceptance Criteria:**
- Guidance block appears when no active (non-archived) epics exist
- Guidance text clearly communicates next steps
- "Go to Roadmap" button navigates correctly
- Toggle remains functional to reveal archived items
- Guidance hides when archived epics are revealed via toggle

---

#### Task Group 5: Feature Creation Gating on Archived Epics
**Dependencies:** Task Group 2

- [x] 5.0 Complete feature creation gating
  - [x] 5.1 Write 4-6 focused tests for feature creation gating
    - Test "+ Add Feature" button is enabled when active EPIC is selected
    - Test "+ Add Feature" button is disabled when ARCHIVED EPIC is selected
    - Test disabled button shows tooltip/help text: "Cannot add features under an archived epic."
    - Test button remains hidden for non-EPIC types (INITIATIVE, FEATURE, STORY)
    - Test keyboard interaction respects disabled state
  - [x] 5.2 Extend ActionButtons to check archived status
    - In WorkItemDetailsPanel.tsx, modify EPIC condition in ActionButtons
    - Check `item.status !== 'ARCHIVED'` in addition to `item.type === 'EPIC'`
    - Pass disabled state to button component
  - [x] 5.3 Implement disabled button state with tooltip
    - When EPIC is ARCHIVED, render button as disabled
    - Add tooltip or help text: "Cannot add features under an archived epic."
    - Use existing disabled styling patterns or add new styles
    - Ensure button click is prevented when disabled
  - [x] 5.4 Add CSS styles for disabled button state
    - Style disabled button with reduced opacity or grayed appearance
    - Add cursor style to indicate non-interactive state
    - Style tooltip/help text appropriately
  - [x] 5.5 Ensure feature creation gating tests pass
    - Run ONLY the 4-6 tests written in 5.1
    - Verify gating behavior is correct for all scenarios

**Acceptance Criteria:**
- "+ Add Feature" enabled only for non-archived EPICs
- Disabled state is visually distinct
- Tooltip explains why button is disabled
- Keyboard and mouse interactions respect gating

---

### Testing & Integration

#### Task Group 6: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review 4-6 tests from Task Group 1 (archived filter state)
    - Review 4-6 tests from Task Group 2 (work item filtering)
    - Review 4-6 tests from Task Group 3 (filter toggle UI)
    - Review 4-6 tests from Task Group 4 (empty state guidance)
    - Review 4-6 tests from Task Group 5 (feature creation gating)
    - Total existing tests: approximately 20-30 tests
  - [x] 6.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows lacking coverage
    - Focus on integration between components (e.g., toggle -> filter -> tree -> selection)
    - Check edge cases: rapid toggle switching, stale localStorage, missing projectId
    - Prioritize end-to-end user flows over unit test gaps
  - [x] 6.3 Write up to 8 additional strategic tests maximum
    - Add tests for critical integration points identified in 6.2
    - Focus on complete user workflows:
      - User loads page with persisted preference
      - User toggles filter and sees tree update
      - User selects archived item, toggles filter off, selection clears
      - User navigates to roadmap from empty state
    - Do NOT write comprehensive coverage for all edge cases
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's features (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 28-38 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical user workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 28-38 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Archived Filter State and LocalStorage Persistence**
   - Foundation for all other features
   - No dependencies, can start immediately

2. **Task Group 2: Work Item Filtering Before Tree Build**
   - Depends on Task Group 1 for state variable
   - Core logic that other UI components rely on

3. **Task Group 3: Filter Toggle UI in Backlog Header**
   - Depends on Task Groups 1 and 2
   - User-facing control for the filter

4. **Task Group 4: Empty State Guidance When No Active Epics**
   - Depends on Task Group 2 for `visibleEpics` computation
   - Can be done in parallel with Task Group 5

5. **Task Group 5: Feature Creation Gating on Archived Epics**
   - Depends on Task Group 2 for understanding archived status
   - Can be done in parallel with Task Group 4

6. **Task Group 6: Test Review & Gap Analysis**
   - Final task group after all features implemented
   - Validates complete integration

---

## Implementation Notes

### Key Patterns from Existing Code

**State Management (ProductBacklogPage.tsx):**
- Uses React hooks: `useState`, `useEffect`, `useCallback`, `useMemo`
- Pattern: `const [state, setState] = useState<Type>(initialValue)`
- Callback pattern: `const handleX = useCallback(() => {...}, [deps])`

**Tree Building Pipeline:**
```typescript
// Current flow:
const treeResult = useMemo(() => buildWorkItemTree(workItems), [workItems]);

// New flow with filtering:
const filteredItems = useMemo(() => filterWorkItemsForTree(workItems, showArchivedRoadmapItems), [workItems, showArchivedRoadmapItems]);
const treeResult = useMemo(() => buildWorkItemTree(filteredItems), [filteredItems]);
```

**Existing Archived Styling (WorkItemTree.module.css):**
- `.archivedBadge` - grey badge styling
- `.archivedRow` - opacity: 0.6, hover: 0.7

**WorkItemDetailsPanel ActionButtons:**
- Already has type-based conditional rendering
- Pattern: `{itemType === 'EPIC' && onAddFeature && (<button>...</button>)}`
- Extend with status check: `{itemType === 'EPIC' && item.status !== 'ARCHIVED' && onAddFeature && (<button>...</button>)}`

### LocalStorage Key Pattern
```typescript
const storageKey = `product_backlog_show_archived::${loadedFileName}`;
```

### Filtering Logic
```typescript
function filterWorkItemsForTree(items: WorkItem[], showArchived: boolean): WorkItem[] {
  if (showArchived) return items;
  return items.filter(item => {
    const isRoadmapItem = item.type === 'INITIATIVE' || item.type === 'EPIC';
    const isArchived = item.status === 'ARCHIVED';
    return !(isRoadmapItem && isArchived);
  });
}
```

### Selection Clearing Logic
```typescript
// After filter toggle, check if selected item is still visible
useEffect(() => {
  if (selectedId && !treeResult.byId.has(selectedId)) {
    setSelectedId(null);
  }
}, [selectedId, treeResult.byId]);
```

---

## Implementation Summary

All 6 task groups have been completed. Here is a summary of the changes made:

### Files Modified:

1. **`frontend/src/components/ProductView/ProductBacklogPage.tsx`**
   - Added `showArchivedRoadmapItems` state with localStorage persistence
   - Added `filterWorkItemsForTree` utility function
   - Added `visibleEpics` computed value for empty state detection
   - Added `handleToggleShowArchived` toggle handler
   - Added `handleGoToRoadmap` navigation handler
   - Added header section with hint text and filter checkbox
   - Added empty epic guidance block UI
   - Updated tree building pipeline to use filtered items
   - Added selection clearing when filtered item is hidden

2. **`frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`**
   - Extended `ActionButtons` to gate feature creation on archived epics
   - Added disabled state and tooltip for archived EPIC selection

3. **`frontend/src/components/ProductView/ProductBacklogPage.module.css`**
   - Added `.backlogHeader` styles for header section
   - Added `.headerHint` styles for hint text
   - Added `.filterToggle`, `.filterCheckbox`, `.filterLabelText` styles for checkbox
   - Added `.emptyEpicGuidance` styles for empty state guidance
   - Added `.guidancePrimary`, `.guidanceSecondary` styles for guidance text
   - Added `.goToRoadmapButton` styles for navigation button

4. **`frontend/src/components/ProductView/WorkItemDetailsPanel.module.css`**
   - Added `.buttonWithTooltip` container styles
   - Added `.actionButtonDisabled` disabled button styles
   - Added `.disabledTooltip` tooltip text styles

5. **`frontend/src/__tests__/product-backlog-stage4-archived-filter.test.ts`** (new file)
   - 36 tests covering all 6 task groups
   - Tests for localStorage persistence, filtering logic, UI elements, empty state, and feature gating

### Test Results:
- All 36 feature-specific tests pass
- All 46 existing ProductBacklog-related tests continue to pass
