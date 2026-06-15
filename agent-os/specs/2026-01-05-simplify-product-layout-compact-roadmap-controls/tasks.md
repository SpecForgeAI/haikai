# Task Breakdown: Simplify Product Layout and Compact Roadmap Controls

## Overview
Total Tasks: 14

This is a UI refactoring task to reduce vertical space waste in the Product area by:
1. Removing the redundant "Product" header row
2. Compacting Roadmap import/refresh controls into a thin control row
3. Merging two buttons into one unified "Import/Refresh roadmap.md" button
4. Moving "Last Imported" status inline into the control row

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/ProductView/ProductView.tsx` | Remove header div, add conditional roadmap control row |
| `frontend/src/components/ProductView/ProductView.module.css` | Remove `.header`/`.title` classes, add `.roadmapControlRow` styles |
| `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | Remove action row, remove `handleRefresh()`, remove inline styles, export state/handlers for parent |
| `frontend/src/components/ProductView/ProductRoadmapPage.module.css` | Remove `.lastImportedPanel` styles, add inline badge layout styles |

## Task List

### UI Layout Changes

#### Task Group 1: Remove Product Header and Add Control Row Structure
**Dependencies:** None

- [x] 1.0 Complete header removal and control row structure
  - [x] 1.1 Write 4 focused tests for layout changes
    - Test that no "Product" h1 header exists in ProductView
    - Test that `.roadmapControlRow` renders only when `activeTab === 'roadmap'`
    - Test that control row contains "Import/Refresh roadmap.md" button
    - Test that control row contains inline Last Imported info
  - [x] 1.2 Remove header div from `ProductView.tsx`
    - Delete lines 139-142: `<div className={styles.header}><h1 className={styles.title}>Product</h1></div>`
    - Tab bar becomes first child after container div opens
  - [x] 1.3 Remove header CSS classes from `ProductView.module.css`
    - Delete `.header` class (lines 17-24)
    - Delete `.title` class (lines 26-31)
  - [x] 1.4 Add `.roadmapControlRow` CSS class to `ProductView.module.css`
    - Height: match tab bar (~36-40px, compact single-line)
    - Background: `#fafafa` with bottom border `1px solid #e0e0e0`
    - Display: flex with `justify-content: space-between` and `align-items: center`
    - Padding: match tab bar padding (`8px 16px`)
  - [x] 1.5 Ensure layout tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify header is removed
    - Verify control row structure is in place

**Acceptance Criteria:**
- The 4 tests written in 1.1 pass
- No "Product" header row appears under top-level navigation
- `.roadmapControlRow` CSS class is defined with correct styling
- Tab bar is now first element in ProductView container

---

#### Task Group 2: Implement Control Row with Merged Button and Inline Status
**Dependencies:** Task Group 1

- [x] 2.0 Complete control row implementation
  - [x] 2.1 Write 5 focused tests for control row functionality
    - Test merged button displays "Import/Refresh roadmap.md" label
    - Test button is disabled when `!activeProject || importing`
    - Test inline "Last Imported" shows revision badge, timestamp, source badge
    - Test "Not imported yet" displays when `lastImportedMetadata` is null
    - Test button calls `handleImport()` on click
  - [x] 2.2 Remove `handleRefresh()` function from `ProductRoadmapPage.tsx`
    - Delete lines 216-219 (the `handleRefresh` callback)
    - Remove the "Refresh" button from action row (lines 354-361)
  - [x] 2.3 Export necessary state and handlers from `ProductRoadmapPage.tsx`
    - Expose `importing`, `lastImportedMetadata`, `loadingMetadata`, `handleImport`, `isImportDisabled` via props or callback pattern
    - Alternative: Lift state to ProductView if simpler
  - [x] 2.4 Add control row JSX to `ProductView.tsx`
    - Render conditionally: `{activeTab === 'roadmap' && (<div className={styles.roadmapControlRow}>...)}`
    - Left side: Single button "Import/Refresh roadmap.md" with disabled state logic
    - Right side: Inline Last Imported info (revision badge, timestamp, source badge) or "Not imported yet"
  - [x] 2.5 Add inline status styles to `ProductView.module.css`
    - Add `.controlRowButton` for merged button styling
    - Add `.inlineStatus` for right-aligned status container
    - Reuse badge classes from `ProductRoadmapPage.module.css` or duplicate minimal styles
  - [x] 2.6 Ensure control row tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify merged button works correctly
    - Verify inline status displays properly

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Single "Import/Refresh roadmap.md" button replaces two buttons
- Button disabled state works correctly (no active project or importing)
- Last Imported info displays inline with badges
- "Not imported yet" displays when no metadata exists

---

#### Task Group 3: Clean Up Old Layout and Finalize
**Dependencies:** Task Group 2

- [x] 3.0 Complete cleanup and finalization
  - [x] 3.1 Write 3 focused tests for cleanup verification
    - Test no `.lastImportedPanel` element exists in ProductRoadmapPage
    - Test no inline style objects exist in ProductRoadmapPage (actionRowStyles, primaryButtonStyles, secondaryButtonStyles)
    - Test roadmap tree is sole main content below control row
  - [x] 3.2 Remove action row from `ProductRoadmapPage.tsx`
    - Delete lines 344-362 (action row div with buttons)
    - Control row is now rendered in ProductView.tsx
  - [x] 3.3 Remove `.lastImportedPanel` from `ProductRoadmapPage.tsx`
    - Delete lines 371-393 (lastImportedPanel div and contents)
    - Status now rendered inline in ProductView control row
  - [x] 3.4 Remove inline style constants from `ProductRoadmapPage.tsx`
    - Delete `actionRowStyles` (lines 499-506)
    - Delete `primaryButtonStyles` (lines 508-517)
    - Delete `secondaryButtonStyles` (lines 519-528)
  - [x] 3.5 Clean up `ProductRoadmapPage.module.css`
    - Remove or deprecate `.lastImportedPanel` (lines 36-43)
    - Remove or deprecate `.lastImportedTitle` (lines 45-52)
    - Keep badge styles (`.revisionBadge`, `.timestamp`, `.sourceBadge`) as they may be reused
  - [x] 3.6 Verify tree panel is sole main content
    - Ensure `.treePanel` starts immediately after control row
    - Tree should start at left edge, retain current width
    - Error card (`.errorCard`), import summary (`.importSummaryCard`), and CTA section remain in ProductRoadmapPage
  - [x] 3.7 Ensure cleanup tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify old layout elements are removed
    - Verify tree displays as sole main content

**Acceptance Criteria:**
- The 3 tests written in 3.1 pass
- No duplicate controls remain
- No inline styles remain in ProductRoadmapPage
- Roadmap tree is sole main content visible
- Error/success cards still render in ProductRoadmapPage when needed

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4 tests from Task Group 1 (layout changes)
    - Review the 5 tests from Task Group 2 (control row functionality)
    - Review the 3 tests from Task Group 3 (cleanup verification)
    - Total existing tests: 12 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify any missing integration tests for control row + ProductRoadmapPage interaction
    - Check import flow still works end-to-end
    - Verify tab switching shows/hides control row correctly
  - [x] 4.3 Write up to 5 additional tests if critical gaps exist
    - Integration test: Import button triggers import and refreshes tree
    - Integration test: Tab switching from roadmap to backlog hides control row
    - Verify no "Product" header appears in any tab
    - Verify import disabled state with tooltip/visual feedback
    - Focus on user workflows, not exhaustive unit coverage
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 12-17 tests
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (12-17 tests total)
- Import/Refresh functionality works exactly as before
- Layout changes are verified
- No more than 5 additional tests added in gap analysis

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Remove Product Header and Add Control Row Structure**
   - Remove header elements
   - Add CSS for control row
   - Establishes the layout foundation

2. **Task Group 2: Implement Control Row with Merged Button and Inline Status**
   - Depends on Task Group 1 (control row CSS exists)
   - Wire up button and status display
   - May require state lifting or prop passing

3. **Task Group 3: Clean Up Old Layout and Finalize**
   - Depends on Task Group 2 (control row is functional)
   - Remove old action row and panel from ProductRoadmapPage
   - Clean up unused styles and inline constants

4. **Task Group 4: Test Review and Gap Analysis**
   - Depends on Task Groups 1-3 (all implementation complete)
   - Review all written tests
   - Fill critical integration gaps
   - Final verification

---

## Implementation Notes

### State Management Approach
The control row needs access to state from ProductRoadmapPage:
- `importing` (boolean)
- `lastImportedMetadata` (ArtifactMetadata | null)
- `loadingMetadata` (boolean)
- `handleImport` (function)
- `isImportDisabled` (boolean)

**Recommended approach:** Use a callback pattern where ProductRoadmapPage exposes these via a render prop or ref, OR lift the relevant state to ProductView. The simpler approach is to keep the control row rendering in ProductView but pass down handlers from ProductRoadmapPage via a shared context or forwarded refs.

### CSS Class Organization
- New classes in `ProductView.module.css`:
  - `.roadmapControlRow` - thin horizontal bar container
  - `.controlRowButton` - merged import/refresh button
  - `.inlineStatus` - right-aligned status info
  - `.inlineStatusMuted` - "Not imported yet" styling
- Reuse from `ProductRoadmapPage.module.css`:
  - `.revisionBadge`, `.timestamp`, `.sourceBadge` - badge styling

### Preserved Functionality
- Error card (`.errorCard`) remains in ProductRoadmapPage
- Import summary card (`.importSummaryCard`) remains in ProductRoadmapPage
- CTA section (`.ctaSection`) remains in ProductRoadmapPage
- "No active project" warning banner remains
- WorkItemTree component unchanged

## Implementation Summary

All 4 task groups have been completed:

### Task Group 1: Header Removal and Control Row Structure
- Removed the "Product" header h1 from ProductView.tsx
- Removed `.header` and `.title` CSS classes from ProductView.module.css
- Added `.roadmapControlRow` CSS class with proper styling
- Tab bar is now first element in container

### Task Group 2: Control Row Implementation
- Added `RoadmapControlState` interface to ProductRoadmapPage.tsx
- Implemented `onControlStateChange` callback pattern for state lifting
- Added control row JSX to ProductView.tsx (conditionally rendered when Roadmap tab active)
- Single "Import/Refresh roadmap.md" button with proper disabled states
- Inline status display with revision badge, timestamp, and source badge
- Added all necessary CSS classes for button and status styling

### Task Group 3: Cleanup
- Removed `handleRefresh()` function from ProductRoadmapPage.tsx
- Removed action row with Import and Refresh buttons
- Removed lastImportedPanel div
- Removed inline style constants (actionRowStyles, primaryButtonStyles, secondaryButtonStyles)
- Cleaned up ProductRoadmapPage.module.css (removed lastImportedPanel and lastImportedTitle)
- Tree panel remains sole main content with error/success cards preserved

### Task Group 4: Test Review
- Created comprehensive test file: `simplify-product-layout.test.ts`
- 34 tests covering all layout changes, control row functionality, cleanup verification, and integration
- All tests pass successfully
- Existing ProductRoadmapPage tests and product-view-navigation tests also pass
