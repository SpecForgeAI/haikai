# Task Breakdown: Product Roadmap Stage 3 - Read-Only Review with ARCHIVED Status and Expandable Descriptions

## Overview
Total Tasks: 22
Feature: Enhance the Product Roadmap page with ARCHIVED status visual indication, default collapse behavior for archived items, and expandable epic descriptions.

**Key Files to Modify:**
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx` - Main page component
- `frontend/src/components/ProductView/WorkItemTree.tsx` - Tree component
- `frontend/src/components/ProductView/WorkItemTree.module.css` - Styles

**Key Files to Reference (No Changes Needed):**
- `frontend/src/utils/workItemTreeBuilder.ts` - Existing tree builder utility
- `frontend/src/types/workItems.ts` - Existing WorkItem types

## Task List

### CSS/Styling Layer

#### Task Group 1: ARCHIVED Badge and Row Styles
**Dependencies:** None

- [x] 1.0 Complete ARCHIVED badge and muted row CSS styles
  - [x] 1.1 Write 3-5 focused tests for ARCHIVED styling
    - Test that `.archivedBadge` class renders with grey color scheme
    - Test that `.archivedRow` class applies reduced opacity or muted styling
    - Test that archived badge displays alongside type badge (not replacing it)
    - Test that normal (non-archived) rows do not have muted styling
  - [x] 1.2 Add `.archivedBadge` CSS class to WorkItemTree.module.css
    - Grey background (#9e9e9e or similar)
    - Dark grey text (#424242 or similar)
    - Same padding, font-size, border-radius as existing `.typeBadge`
    - Margin-left for spacing from type badge
  - [x] 1.3 Add `.archivedRow` CSS class to WorkItemTree.module.css
    - Apply opacity: 0.6 or color: #888 to mute the row
    - Ensure hover states still work but remain muted
    - Ensure selected state still visible but muted
  - [x] 1.4 Ensure ARCHIVED styling tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify CSS classes render correctly

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- ARCHIVED badge has distinct grey color scheme
- ARCHIVED rows appear visually muted
- Styling does not break existing type badges or row styles

---

#### Task Group 2: Description Preview and Expand/Collapse Styles
**Dependencies:** Task Group 1

- [x] 2.0 Complete epic description preview CSS styles
  - [x] 2.1 Write 3-5 focused tests for description styling
    - Test that `.descriptionPreview` applies CSS line-clamp (2 lines max)
    - Test that `.descriptionExpanded` shows full text without truncation
    - Test that `.showMoreLink` renders as clickable link style
    - Test that description section appears below title row with proper spacing
  - [x] 2.2 Add `.descriptionPreview` CSS class to WorkItemTree.module.css
    - Font-size: 12px, color: #666
    - CSS line-clamp: 2 lines
    - overflow: hidden, text-overflow: ellipsis
    - Padding-left to align with title (accounting for chevron placeholder)
    - Margin-top: 4px for spacing from title
  - [x] 2.3 Add `.descriptionExpanded` CSS class to WorkItemTree.module.css
    - Same font-size and color as preview
    - No line-clamp, display full text
    - white-space: pre-wrap to preserve line breaks
  - [x] 2.4 Add `.showMoreLink` CSS class to WorkItemTree.module.css
    - Color: #1976d2 (link blue)
    - Font-size: 11px
    - cursor: pointer
    - Hover underline effect
    - Display inline after description text
  - [x] 2.5 Ensure description styling tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify CSS classes render correctly

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- Description preview truncates to 2 lines with ellipsis
- Expanded description shows full text
- Show more/less link is visually distinct and clickable

---

### Component Layer

#### Task Group 3: WorkItemTree ARCHIVED Badge Display
**Dependencies:** Task Group 1

- [x] 3.0 Complete ARCHIVED badge display in WorkItemTree
  - [x] 3.1 Write 4-6 focused tests for ARCHIVED badge functionality
    - Test ARCHIVED badge appears for items with status === 'ARCHIVED'
    - Test ARCHIVED badge displays alongside type badge (both visible)
    - Test non-ARCHIVED items do not show ARCHIVED badge
    - Test both INITIATIVE and EPIC types can display ARCHIVED badge
    - Test archived row has muted styling class applied
  - [x] 3.2 Update TreeNode component in WorkItemTree.tsx
    - Add logic to check if `item.status === 'ARCHIVED'`
    - Conditionally render ARCHIVED badge span after type badge
    - Apply `styles.archivedBadge` class to badge
    - Apply `styles.archivedRow` class to row container when archived
  - [x] 3.3 Ensure ARCHIVED badge tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify badge renders correctly for archived items

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- ARCHIVED badge appears next to type badge for archived items
- Row styling is muted for archived items
- Non-archived items are unaffected

---

#### Task Group 4: WorkItemTree Epic Description Expand/Collapse
**Dependencies:** Task Group 2

- [x] 4.0 Complete epic description expand/collapse in WorkItemTree
  - [x] 4.1 Write 4-6 focused tests for description expand/collapse
    - Test EPIC items with description show preview text
    - Test "Show more" link appears for descriptions exceeding 2 lines
    - Test clicking "Show more" expands to full description
    - Test clicking "Show less" collapses back to preview
    - Test description expansion state is per-epic (independent)
    - Test INITIATIVE items do not show description section
  - [x] 4.2 Add expandedDescriptionIds prop to WorkItemTreeProps interface
    - New prop: `expandedDescriptionIds: Set<string>`
    - New callback prop: `onToggleDescription: (id: string) => void`
  - [x] 4.3 Update TreeNode component to render description section for EPICs
    - Only render for type === 'EPIC' with non-empty description
    - Render below title row with proper indentation
    - Use `.descriptionPreview` or `.descriptionExpanded` class based on expanded state
    - Render "Show more" / "Show less" toggle link
  - [x] 4.4 Implement description toggle handler in TreeNode
    - Call `onToggleDescription(item.id)` when link clicked
    - Prevent event propagation to avoid row selection
  - [x] 4.5 Ensure description expand/collapse tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify toggle behavior works correctly

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- EPIC descriptions show 2-line preview by default
- "Show more" / "Show less" toggles correctly
- Toggle state is independent per epic
- INITIATIVEs do not display description sections

---

#### Task Group 5: ProductRoadmapPage ARCHIVED Collapse Behavior
**Dependencies:** Task Group 3

- [x] 5.0 Complete ARCHIVED default collapse behavior in ProductRoadmapPage
  - [x] 5.1 Write 3-5 focused tests for ARCHIVED collapse behavior
    - Test non-archived INITIATIVE is expanded by default
    - Test ARCHIVED INITIATIVE is collapsed by default on page load
    - Test user can manually expand collapsed ARCHIVED initiative
    - Test user can manually collapse expanded non-archived initiative
    - Test collapse state persists correctly in expandedIds Set
  - [x] 5.2 Update loadRoadmapItems function in ProductRoadmapPage.tsx
    - Modify expandedIds initialization logic
    - Add INITIATIVE to expandedIds only if `item.status !== 'ARCHIVED'`
    - ARCHIVED initiatives start collapsed (not added to expandedIds)
  - [x] 5.3 Ensure ARCHIVED collapse behavior tests pass
    - Run ONLY the 3-5 tests written in 5.1
    - Verify default collapse states are correct

**Acceptance Criteria:**
- The 3-5 tests written in 5.1 pass
- Non-archived initiatives are expanded by default
- Archived initiatives are collapsed by default
- Manual expand/collapse still works for all items

---

#### Task Group 6: ProductRoadmapPage Description Expansion State
**Dependencies:** Task Group 4

- [x] 6.0 Complete description expansion state management in ProductRoadmapPage
  - [x] 6.1 Write 3-5 focused tests for description state management
    - Test epicDescriptionExpandedIds state initializes empty
    - Test onToggleDescription callback adds/removes IDs from set
    - Test expandedDescriptionIds prop is passed to WorkItemTree
    - Test description expansion persists across tree re-renders
  - [x] 6.2 Add epicDescriptionExpandedIds state to ProductRoadmapPage
    - `const [epicDescriptionExpandedIds, setEpicDescriptionExpandedIds] = useState<Set<string>>(new Set())`
  - [x] 6.3 Implement handleToggleDescription callback
    - Toggle ID in epicDescriptionExpandedIds Set
    - Follow same pattern as existing handleToggle for expand/collapse
  - [x] 6.4 Pass description expansion props to WorkItemTree
    - Add `expandedDescriptionIds={epicDescriptionExpandedIds}`
    - Add `onToggleDescription={handleToggleDescription}`
  - [x] 6.5 Ensure description state management tests pass
    - Run ONLY the 3-5 tests written in 6.1
    - Verify state management works correctly

**Acceptance Criteria:**
- The 3-5 tests written in 6.1 pass
- Description expansion state is tracked in component
- Toggle callback correctly updates state
- Props are correctly passed to WorkItemTree

---

#### Task Group 7: Empty Epic and Import Summary Enhancements
**Dependencies:** Task Group 5, Task Group 6

- [x] 7.0 Complete empty epic placeholder and import summary enhancements
  - [x] 7.1 Write 4-6 focused tests for empty states and import summary
    - Test initiative with zero epics shows "No epics defined." placeholder
    - Test import success banner shows revision, initiatives, epics counts
    - Test import banner uses green accent color
    - Test partial backend data displays gracefully (show only available fields)
    - Test 404 error shows specific roadmap.md not found message
    - Test 409 error displays verbatim API error message
  - [x] 7.2 Update WorkItemTree to show placeholder for initiatives with no children
    - When INITIATIVE has children.length === 0 and isExpanded
    - Render "No epics defined." text with muted styling
    - Proper indentation under the initiative
  - [x] 7.3 Enhance import result display in ProductRoadmapPage
    - Display all available fields from ImportResult
    - Add initiativesUpdated, epicsUpdated if available
    - Handle partial data gracefully (only show fields that exist)
    - Apply green accent color to success banner (#2e7d32)
  - [x] 7.4 Improve error handling messages
    - Check error status/message for 404: display "roadmap.md not found at agent-os/product/roadmap.md"
    - Check error status/message for 409: display error message verbatim
    - Other errors: show generic message with Retry button (existing behavior)
  - [x] 7.5 Ensure empty state and import summary tests pass
    - Run ONLY the 4-6 tests written in 7.1
    - Verify all enhancements work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 7.1 pass
- Empty initiatives show "No epics defined." placeholder
- Import summary shows all available fields with green styling
- Error messages are specific and helpful

---

### Integration Testing

#### Task Group 8: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps only
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review 3-5 tests from styling groups (1.1, 2.1)
    - Review 4-6 tests from component groups (3.1, 4.1, 5.1, 6.1, 7.1)
    - Total existing tests: approximately 21-33 tests
  - [x] 8.2 Analyze test coverage gaps for Stage 3 feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on ARCHIVED + Description interaction scenarios
    - Check for gaps in error handling paths
    - Do NOT assess entire application test coverage
  - [x] 8.3 Write up to 8 additional integration tests if needed
    - Test full page render with mixed archived/non-archived items
    - Test ARCHIVED initiative collapsed with expanded epic descriptions inside
    - Test import flow followed by viewing archived items
    - Test keyboard navigation with archived items
    - Test responsive behavior of description expand/collapse
    - Focus on realistic user workflows
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to Stage 3 feature
    - Expected total: approximately 29-41 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All Stage 3 feature-specific tests pass
- Critical user workflows are covered
- No more than 8 additional integration tests added
- Testing focused exclusively on Stage 3 requirements

---

## Execution Order

Recommended implementation sequence:

1. **CSS/Styling Layer First** (Task Groups 1-2)
   - Group 1: ARCHIVED badge and row styles
   - Group 2: Description preview and expand styles
   - Rationale: CSS classes must exist before components can use them

2. **Component Enhancements** (Task Groups 3-7)
   - Group 3: WorkItemTree ARCHIVED badge display
   - Group 4: WorkItemTree description expand/collapse
   - Group 5: ProductRoadmapPage ARCHIVED collapse behavior
   - Group 6: ProductRoadmapPage description state management
   - Group 7: Empty states and import summary enhancements
   - Rationale: Build incrementally from visual to behavioral features

3. **Integration Testing** (Task Group 8)
   - Review all tests and fill gaps
   - Run comprehensive feature tests
   - Rationale: Ensure all components work together correctly

---

## File Change Summary

| File | Changes |
|------|---------|
| `WorkItemTree.module.css` | Add `.archivedBadge`, `.archivedRow`, `.descriptionPreview`, `.descriptionExpanded`, `.showMoreLink` classes |
| `WorkItemTree.tsx` | Add ARCHIVED badge rendering, description section with expand/collapse, empty epic placeholder |
| `ProductRoadmapPage.tsx` | Modify expandedIds initialization for ARCHIVED, add epicDescriptionExpandedIds state, enhance import result display, improve error messages |

---

## Dependencies Diagram

```
Task Group 1 (CSS: ARCHIVED)
    |
    v
Task Group 3 (Component: ARCHIVED badge)
    |
    v
Task Group 5 (Page: ARCHIVED collapse)
    |
    +------------------+
                       |
Task Group 2 (CSS: Description)
    |                  |
    v                  |
Task Group 4 (Component: Description toggle)
    |                  |
    v                  |
Task Group 6 (Page: Description state)
    |                  |
    +------------------+
                       |
                       v
            Task Group 7 (Empty states, Import summary)
                       |
                       v
            Task Group 8 (Integration testing)
```

---

## Implementation Summary

**Completed on:** 2026-01-04

**Test Results:**
- Total tests written: 41
- All tests passing

**Files Modified:**
1. `frontend/src/components/ProductView/WorkItemTree.module.css` - Added CSS classes for ARCHIVED badge, archived row styling, description preview/expanded, and show more/less link
2. `frontend/src/components/ProductView/WorkItemTree.tsx` - Added ARCHIVED badge display, description expand/collapse, and empty epic placeholder
3. `frontend/src/components/ProductView/ProductRoadmapPage.tsx` - Added ARCHIVED collapse behavior, description expansion state management, and enhanced import result display

**Test File Created:**
- `frontend/src/__tests__/product-roadmap-stage3.test.ts` - Comprehensive tests for all Task Groups 1-8
