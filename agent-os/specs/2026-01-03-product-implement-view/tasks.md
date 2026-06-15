# Task Breakdown: Product Implement View (Stage 5 - Increment 4)

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This feature introduces the Stage 5 "Implement" view scaffold with Feature/Story handoff from Backlog, URL-based routing with query parameters, and a two-pane layout showing an implementation assistant placeholder and work item summary.

## Task List

### Frontend Components - Routing & Navigation

#### Task Group 1: URL-Based Routing and Navigation Setup
**Dependencies:** None

This group establishes the routing infrastructure to support deep-linking and navigation between Backlog and Implement views.

- [x] 1.0 Complete routing and navigation layer
  - [x] 1.1 Write 4-6 focused tests for routing functionality
    - Test URL parsing extracts workItemId from query parameter
    - Test navigation from Backlog to Implement preserves workItemId in URL
    - Test browser refresh preserves workItemId and reloads correctly
    - Test missing/invalid workItemId shows empty state
    - Test "Back to Backlog" navigation works correctly
  - [x] 1.2 Update ProductView.tsx to support URL-based tab switching
    - Import useSearchParams from react-router-dom (or use URLSearchParams)
    - Parse tab and workItemId from URL query parameters
    - Update tab state based on URL (implement tab active when workItemId present)
    - Preserve query params when switching tabs
    - File: `frontend/src/components/ProductView/ProductView.tsx`
  - [x] 1.3 Add "Work on this now" button to WorkItemDetailsPanel
    - Add onWorkOnThis prop to WorkItemDetailsPanelProps interface
    - Add button in ActionButtons component for FEATURE and STORY types only
    - Use actionButtonPrimary styling (same as Add Feature/Story buttons)
    - Button label: "Work on this now"
    - Do not show for INITIATIVE or EPIC types
    - File: `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
  - [x] 1.4 Wire navigation handler in ProductBacklogPage
    - Create handleWorkOnThis callback that navigates to /product/implement?workItemId=<id>
    - Pass handler as onWorkOnThis prop to WorkItemDetailsPanel
    - Use navigate from react-router-dom or window.location for navigation
    - File: `frontend/src/components/ProductView/ProductBacklogPage.tsx`
  - [x] 1.5 Ensure routing tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify URL parsing works correctly
    - Verify navigation between views works

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- "Work on this now" button appears only for FEATURE and STORY types
- Clicking button navigates to /product/implement?workItemId=<uuid>
- URL can be refreshed and state is preserved
- Tab bar reflects active view based on URL

**Files to Modify:**
- `frontend/src/components/ProductView/ProductView.tsx`
- `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx`
- `frontend/src/components/ProductView/ProductBacklogPage.tsx`

**Existing Patterns to Follow:**
- ActionButtons pattern in WorkItemDetailsPanel.tsx (lines 85-176)
- Navigation patterns in ProductBacklogPage.tsx
- Tab state management in ProductView.tsx (lines 33-36)

---

### Frontend Components - Implement Page

#### Task Group 2: ProductImplementPage Component
**Dependencies:** Task Group 1

This group creates the main Implement page component with data loading, empty state handling, and two-pane layout structure.

- [x] 2.0 Complete ProductImplementPage component
  - [x] 2.1 Write 4-6 focused tests for ProductImplementPage
    - Test empty state renders when workItemId is missing
    - Test empty state renders when workItemId is invalid/not found
    - Test "Go to Backlog" button navigates correctly
    - Test loading state renders while fetching data
    - Test error state renders on API failure
    - Test successful data load renders two-pane layout
  - [x] 2.2 Create ProductImplementPage.tsx component scaffold
    - Create new file with component shell
    - Import useSearchParams for reading workItemId from URL
    - Import useArchitecture for loadedFileName (projectId)
    - Set up component structure with data-testid attributes
    - File: `frontend/src/components/ProductView/ProductImplementPage.tsx` (new)
  - [x] 2.3 Implement data loading logic
    - Reuse fetchWorkItems(projectId) from workItemsApi.ts
    - Reuse buildWorkItemTree and deriveParentChain from workItemTreeBuilder.ts
    - Find selected item by ID from work items using byId map
    - Compute parentChain using deriveParentChain utility
    - Compute children list using childrenByParent map
    - Handle loading state with spinner
    - Handle error state with retry button
    - Follow patterns from ProductBacklogPage.tsx (lines 93-127)
  - [x] 2.4 Implement empty state handling
    - Show empty state when workItemId is missing from URL
    - Show empty state when item is not found in fetched data
    - Display message: "Select a feature or story from Backlog to begin."
    - Include "Go to Backlog" button that navigates to backlog tab
    - Center content vertically and horizontally
  - [x] 2.5 Implement two-pane layout structure
    - Left pane: ~60-70% width for Implementation Assistant
    - Right pane: remainder for Work Item Summary
    - Use flex layout similar to ProductBacklogPage two-column pattern
    - Ensure responsive behavior
  - [x] 2.6 Ensure ProductImplementPage tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify all states render correctly

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Empty state shows when workItemId missing or invalid
- Loading spinner appears during data fetch
- Error state appears on API failure with retry option
- Two-pane layout renders correctly with proper proportions

**Files to Create/Modify:**
- `frontend/src/components/ProductView/ProductImplementPage.tsx` (new)
- `frontend/src/components/ProductView/ProductImplementPage.module.css` (new)

**Existing Patterns to Follow:**
- Data loading in ProductBacklogPage.tsx (lines 93-127)
- Tree building in ProductBacklogPage.tsx (lines 130-163)
- State handling in ProductBacklogPage.tsx (lines 304-355)
- Two-column layout in ProductBacklogPage.module.css

---

### Frontend Components - UI Panels

#### Task Group 3: Implementation Assistant and Work Item Summary Panels
**Dependencies:** Task Group 2

This group implements the left and right pane content for the Implement view.

- [x] 3.0 Complete UI panels for Implement view
  - [x] 3.1 Write 4-6 focused tests for UI panels
    - Test ImplementationAssistantPanel renders with correct header
    - Test ImplementationAssistantPanel shows placeholder text
    - Test WorkItemSummaryPanel renders title, type badge, status badge
    - Test WorkItemSummaryPanel renders description
    - Test WorkItemSummaryPanel renders parent chain breadcrumb
    - Test WorkItemSummaryPanel renders children list for FEATURE with STORYs
  - [x] 3.2 Create ImplementationAssistantPanel component
    - Create new file for placeholder left pane
    - Header with title: "Implementation Assistant"
    - Placeholder content: "Chat-driven implementation will be added next."
    - Optional disabled input box for visual shape
    - Style consistently with empty/placeholder patterns
    - File: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (new)
  - [x] 3.3 Create WorkItemSummaryPanel component
    - Create new file for right pane summary
    - Header with title: "Work Item"
    - Display fields: Title, Type badge, Status badge, Description
    - Reuse badge styling from WorkItemDetailsPanel.module.css
    - Display parent chain as breadcrumb (reuse ParentChainBreadcrumb pattern)
    - Display children list with titles (if FEATURE with STORYs)
    - Add context placeholder: "Context linking (Architecture + Diagrams) will be added next."
    - Add "Back to Backlog" button at bottom
    - Read-only display (no edit/delete actions)
    - File: `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx` (new)
  - [x] 3.4 Create CSS modules for new panels
    - Create ImplementationAssistantPanel.module.css
    - Create WorkItemSummaryPanel.module.css
    - Follow existing color and spacing conventions from ProductView.module.css
    - Reuse badge styles pattern from WorkItemDetailsPanel.module.css
  - [x] 3.5 Integrate panels into ProductImplementPage
    - Import and render ImplementationAssistantPanel in left pane
    - Import and render WorkItemSummaryPanel in right pane
    - Pass required props (item, parentChain, children) to WorkItemSummaryPanel
    - Wire "Back to Backlog" navigation
  - [x] 3.6 Ensure UI panel tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify all panel content renders correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Left pane shows "Implementation Assistant" header with placeholder
- Right pane shows work item details (title, badges, description)
- Parent chain breadcrumb displays correctly
- Children list shows for FEATURE items with child STORYs
- "Back to Backlog" navigation works

**Files to Create:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` (new)
- `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` (new)
- `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx` (new)
- `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css` (new)

**Existing Patterns to Follow:**
- ParentChainBreadcrumb in WorkItemDetailsPanel.tsx (lines 62-79)
- Badge styling in WorkItemDetailsPanel.module.css (lines 57-96)
- Field group pattern in WorkItemDetailsPanel.tsx (lines 234-261)
- Placeholder styling in ProductView.module.css (lines 77-87)

---

### Testing

#### Task Group 4: Test Review and Integration Verification
**Dependencies:** Task Groups 1-3

This group reviews existing tests and fills critical gaps to ensure feature completeness.

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 routing tests from Task Group 1
    - Review the 4-6 ProductImplementPage tests from Task Group 2
    - Review the 4-6 UI panel tests from Task Group 3
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to Product Implement View requirements
    - Prioritize end-to-end navigation flow testing
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - End-to-end: Backlog -> "Work on this now" -> Implement view loads with correct item
    - Deep-link: Direct URL navigation loads correct work item
    - Empty state: Invalid UUID shows proper empty state
    - Navigation: "Back to Backlog" returns to backlog with correct state
    - FEATURE children: Children list populates correctly for FEATURE items
    - STORY no children: STORY items show no children list
    - Type filtering: Button only appears for FEATURE/STORY, not INITIATIVE/EPIC
    - URL persistence: Browser refresh maintains state
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Product Implement View feature
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify all acceptance criteria are met

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical user workflows for this feature are covered
- No more than 8 additional tests added when filling gaps
- All 5 acceptance criteria from spec are verified:
  1. "Work on this now" button appears for FEATURE/STORY in Backlog
  2. Clicking navigates to Implement view with work item details
  3. Deep-linking via URL works (refresh preserves state)
  4. Missing/invalid ID shows empty state with "Go to Backlog"
  5. Two-pane layout renders correctly

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Routing & Navigation** (Foundation)
   - Establishes URL-based routing infrastructure
   - Adds "Work on this now" button to existing component
   - Enables navigation flow between views

2. **Task Group 2: ProductImplementPage** (Core Component)
   - Creates main page component with data loading
   - Implements empty state and error handling
   - Sets up two-pane layout structure

3. **Task Group 3: UI Panels** (User Interface)
   - Creates placeholder left pane for Implementation Assistant
   - Creates summary right pane for Work Item details
   - Completes visual design and content display

4. **Task Group 4: Test Review** (Quality Assurance)
   - Reviews all tests from previous groups
   - Fills critical gaps in test coverage
   - Validates all acceptance criteria

---

## Key Files Reference

### Files to Modify
| File | Task Group | Purpose |
|------|------------|---------|
| `ProductView.tsx` | 1 | URL-based tab switching |
| `WorkItemDetailsPanel.tsx` | 1 | "Work on this now" button |
| `ProductBacklogPage.tsx` | 1 | Navigation handler wiring |

### Files to Create
| File | Task Group | Purpose |
|------|------------|---------|
| `ProductImplementPage.tsx` | 2 | Main implement page component |
| `ProductImplementPage.module.css` | 2 | Implement page styles |
| `ImplementationAssistantPanel.tsx` | 3 | Left pane placeholder |
| `ImplementationAssistantPanel.module.css` | 3 | Left pane styles |
| `WorkItemSummaryPanel.tsx` | 3 | Right pane summary |
| `WorkItemSummaryPanel.module.css` | 3 | Right pane styles |

### Existing Utilities to Reuse
| Utility | Source File | Usage |
|---------|-------------|-------|
| `fetchWorkItems` | `api/workItemsApi.ts` | Load work items |
| `buildWorkItemTree` | `utils/workItemTreeBuilder.ts` | Build byId and childrenByParent maps |
| `deriveParentChain` | `utils/workItemTreeBuilder.ts` | Compute parent breadcrumb |

---

## Notes

- This is a **frontend-only** feature with no backend changes required
- All data loading reuses existing API endpoints and utilities
- The Implementation Assistant is a **placeholder only** - no LLM integration
- Work item editing is **out of scope** - display is read-only
- URL query parameter pattern enables future session bookmarking/sharing

---

## Implementation Summary

### Test Results
All 64 feature-specific tests pass:
- **Task Group 1 (Routing):** 13 tests
- **Task Group 2 (ProductImplementPage):** 13 tests
- **Task Group 3 (UI Panels):** 20 tests
- **Task Group 4 (Integration):** 18 tests

### Files Created
1. `frontend/src/components/ProductView/ProductImplementPage.tsx`
2. `frontend/src/components/ProductView/ProductImplementPage.module.css`
3. `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
4. `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css`
5. `frontend/src/components/ProductView/WorkItemSummaryPanel.tsx`
6. `frontend/src/components/ProductView/WorkItemSummaryPanel.module.css`
7. `frontend/src/__tests__/product-implement-routing.test.ts`
8. `frontend/src/__tests__/ProductImplementPage.test.ts`
9. `frontend/src/__tests__/product-implement-panels.test.ts`
10. `frontend/src/__tests__/product-implement-integration.test.ts`

### Files Modified
1. `frontend/src/components/ProductView/ProductView.tsx` - URL-based tab switching
2. `frontend/src/components/ProductView/WorkItemDetailsPanel.tsx` - "Work on this now" button
3. `frontend/src/components/ProductView/ProductBacklogPage.tsx` - Navigation handler wiring
