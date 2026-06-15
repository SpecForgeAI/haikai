# Task Breakdown: Global "Select All" Control for Advanced Add Diagram Modal

## Overview
Total Tasks: 12

This is a frontend-only feature that adds a "Select All" checkbox to the Advanced Add modal footer and increases the modal width from 700px to 900px.

## Task List

### Frontend Components

#### Task Group 1: CSS Styling Updates
**Dependencies:** None

- [x] 1.0 Complete CSS styling updates
  - [x] 1.1 Write 3 focused tests for CSS changes
    - Test that `.dialog` has max-width of 900px
    - Test that `.selectAllControl` class exists and follows `.layoutControl` pattern
    - Test that Select All checkbox uses consistent styling (18x18px, accent-color: #1976D2)
  - [x] 1.2 Update `.dialog` max-width in `AdvancedAddDialog.module.css`
    - Change `max-width: 700px` to `max-width: 900px` (line 25)
    - Maintains `width: 90%` constraint for smaller viewports
  - [x] 1.3 Add `.selectAllControl` CSS class
    - Follow `.layoutControl` pattern (lines 115-119)
    - Include `display: flex`, `align-items: center`, `gap: 8px`
  - [x] 1.4 Ensure CSS tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify modal width renders at 900px
    - Verify Select All control styling matches existing controls

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Modal max-width is 900px
- `.selectAllControl` class follows existing footer control patterns
- Checkbox styling is consistent with tree checkboxes

#### Task Group 2: Select All State and Handler
**Dependencies:** Task Group 1

- [x] 2.0 Complete Select All state management
  - [x] 2.1 Write 4 focused tests for state and handler functionality
    - Test that `selectAllChecked` state initializes to `false`
    - Test that checking Select All adds all non-root keys to `selectedKeys`
    - Test that unchecking Select All resets `selectedKeys` to only root key
    - Test that Select All uses `getDescendantKeys(treeData)` to collect all keys
  - [x] 2.2 Add `selectAllChecked` state in `AdvancedAddDialog.tsx`
    - Add `const [selectAllChecked, setSelectAllChecked] = useState<boolean>(false);` after line 909
    - State is independent from `selectedKeys` (no auto-sync)
  - [x] 2.3 Create `handleSelectAllChange` handler function
    - Use `useCallback` following existing handler patterns (e.g., `handleSpacingChange` at line 1027)
    - When checked: collect all keys via `getDescendantKeys(treeData)` and add to `selectedKeys`
    - When unchecked: reset `selectedKeys` to only contain `treeData.key` (root)
    - Update `selectAllChecked` state to match new checkbox value
  - [x] 2.4 Ensure state management tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify state initializes correctly
    - Verify handler logic correctly updates `selectedKeys`

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- `selectAllChecked` state is independent from `selectedKeys`
- Checking Select All selects all non-root nodes
- Unchecking Select All deselects all non-root nodes (keeps root selected)

#### Task Group 3: Select All UI Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete Select All UI integration
  - [x] 3.1 Write 4 focused tests for UI rendering and behavior
    - Test that Select All checkbox renders in footer with label "Select All"
    - Test that Select All checkbox is positioned after Width control and before `footerSpacer`
    - Test that clicking Select All checkbox calls `handleSelectAllChange`
    - Test that Select All checkbox reflects `selectAllChecked` state (checked/unchecked)
  - [x] 3.2 Add Select All control JSX in footer
    - Insert after the Width control `div` (line 1165) and before `footerSpacer` (line 1168)
    - Structure: `<div className={styles.selectAllControl}>...</div>`
    - Include checkbox input with `checked={selectAllChecked}` and `onChange={handleSelectAllChange}`
    - Include label with text "Select All" using `.layoutLabel` class pattern
  - [x] 3.3 Add data-testid attributes for testing
    - Checkbox: `data-testid="select-all-checkbox"`
    - Container: `data-testid="select-all-control"`
  - [x] 3.4 Verify checkbox styling matches tree checkboxes
    - Use `.checkbox` class styling: 18x18px, accent-color: #1976D2
    - Checkbox is never disabled (unlike root node)
  - [x] 3.5 Ensure UI component tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify Select All renders correctly in footer
    - Verify click interactions work as expected

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- Select All checkbox renders in footer between Width control and spacer
- Checkbox is visually consistent with tree checkboxes
- Click handler is properly connected

### Testing

#### Task Group 4: Test Review and Integration Testing
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3 CSS tests from Task 1.1
    - Review the 4 state/handler tests from Task 2.1
    - Review the 4 UI component tests from Task 3.1
    - Total existing tests: 11 tests
  - [x] 4.2 Analyze test coverage gaps for this feature
    - Identify any critical user workflows lacking test coverage
    - Focus ONLY on gaps related to Select All functionality
    - Prioritize end-to-end user interactions
  - [x] 4.3 Write up to 5 additional strategic tests if needed
    - Test Select All with empty tree (no children) - should not error
    - Test Select All does NOT affect expansion state
    - Test Select All checkbox does NOT sync back from individual selections
    - Test "Add to Diagram" includes all items when Select All is checked
    - Test modal width renders correctly at 900px with deeply nested content
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to Select All feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 11-16 tests
    - Verify all critical Select All workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (11-16 tests total)
- Select All functionality works correctly in all scenarios
- Modal width increase displays properly
- No regressions in existing Advanced Add functionality

## Execution Order

Recommended implementation sequence:
1. **CSS Styling Updates (Task Group 1)** - Update modal width and add new CSS class
2. **Select All State and Handler (Task Group 2)** - Implement state management and handler logic
3. **Select All UI Component (Task Group 3)** - Add Select All checkbox to footer
4. **Test Review and Integration Testing (Task Group 4)** - Verify all functionality and fill test gaps

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/DiagramsView/AdvancedAddDialog.module.css` | Increase `.dialog` max-width to 900px, add `.selectAllControl` class |
| `frontend/src/components/DiagramsView/AdvancedAddDialog.tsx` | Add `selectAllChecked` state, `handleSelectAllChange` handler, Select All checkbox JSX |

## Existing Code References

| Code Element | Location | Purpose |
|--------------|----------|---------|
| `selectedKeys` state | Line 907-909 | Track selected node keys |
| `getDescendantKeys()` helper | Lines 677-684 | Recursively collect all descendant keys |
| `treeData` | Line 902-904 | Built tree data structure |
| `.layoutControl` CSS class | Lines 115-119 | Pattern for footer controls |
| `.checkbox` CSS class | Lines 279-290 | Checkbox styling pattern |
| Footer controls | Lines 1115-1168 | Existing footer layout structure |
