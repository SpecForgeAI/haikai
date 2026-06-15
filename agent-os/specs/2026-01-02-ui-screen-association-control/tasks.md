# Task Breakdown: UI Screen Diagram Association Control

## Overview
Total Tasks: 11

This is a frontend-only UX enhancement to enable users to associate UI_SCREEN diagrams with existing UIScreen entities through an explicit dropdown selector in the Overview tab.

## Task List

### Prop Wiring Layer

#### Task Group 1: Wire Props from EditorPanel to OverviewTab
**Dependencies:** None

- [x] 1.0 Complete prop wiring from UIScreenDiagramEditorPanel to OverviewTab
  - [x] 1.1 Write 3 focused tests for prop wiring
    - Test that `uiScreens` array is passed to OverviewTab
    - Test that `onSelectScreenId` callback is wired to `setScreenId` from hook
    - Test that `selectedScreenId` (from `content.screen_id`) is passed correctly
  - [x] 1.2 Update OverviewTab interface to accept new props
    - Add `uiScreens: UIScreen[]` prop (array of UIScreen entities)
    - Ensure `onScreenIdChange?: (screenId: string | null) => void` is used
    - Add `selectedScreenId?: string | null` prop for controlled dropdown
  - [x] 1.3 Wire props in UIScreenDiagramEditorPanel
    - Pass `uiScreensList` (already computed from `metaModel.entities.ui_screens`) to OverviewTab
    - Pass `content.screen_id` as `selectedScreenId`
    - Create `handleScreenIdChange` callback that calls `setScreenId` from hook
    - Pass `handleScreenIdChange` as `onSelectScreenId` prop
  - [x] 1.4 Ensure prop wiring tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify props flow correctly from EditorPanel to OverviewTab

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- OverviewTab receives `uiScreens`, `selectedScreenId`, and `onSelectScreenId` props
- `setScreenId` from `useUIScreenDiagram` hook is wired to OverviewTab callback

**Files to modify:**
- `frontend/src/components/DiagramsView/UIScreenEditor/OverviewTab.tsx` (interface update)
- `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx` (prop passing)

---

### UI Implementation Layer

#### Task Group 2: Implement Dropdown UI in OverviewTab
**Dependencies:** Task Group 1

- [x] 2.0 Complete dropdown UI implementation in OverviewTab
  - [x] 2.1 Write 5 focused tests for dropdown UI behavior
    - Test dropdown renders with "Select a UIScreen..." placeholder when no selection
    - Test dropdown options display as `{screen.name} ({screen.route})` format
    - Test selecting a screen calls `onSelectScreenId` with screen ID
    - Test "Clear" button appears only when a screen is selected
    - Test warning message displays when `screen_id` is set but screen not found in list
  - [x] 2.2 Replace static message with dropdown selector
    - Remove static "No screen associated..." message (lines 54-57)
    - Add `<select>` element with label "Associated UIScreen"
    - Add placeholder option "Select a UIScreen..."
    - Follow dropdown pattern from `AddActionModal.tsx` (lines 310-337)
  - [x] 2.3 Implement dropdown options rendering
    - Map over `uiScreens` prop to generate `<option>` elements
    - Format: `{screen.name} ({screen.route})`
    - Handle empty route gracefully: `{screen.name}` only if no route
  - [x] 2.4 Implement selection display below dropdown
    - When a screen is selected, display name (bold) and route (muted) below dropdown
    - Reuse existing display pattern from lines 44-52
  - [x] 2.5 Implement "Clear" button/link
    - Add "Clear" link visible only when `selectedScreenId` is set
    - Clicking Clear calls `onSelectScreenId(null)`
    - Style as inline link/button next to the dropdown or below selection display
  - [x] 2.6 Implement missing screen warning
    - Detect when `content.screen_id` is set but screen not found in `uiScreens` list
    - Display warning: "Associated UIScreen not found"
    - Keep dropdown enabled so user can select a replacement
    - Style warning with amber/orange color to indicate issue
  - [x] 2.7 Ensure dropdown UI tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify all dropdown behaviors work correctly

**Acceptance Criteria:**
- The 5 tests written in 2.1 pass
- Dropdown displays with correct placeholder and options format
- Selection triggers `onSelectScreenId` callback
- Clear button sets `screen_id` to null
- Warning displays for orphaned screen references
- No crashes when associated UIScreen is deleted

**Files to modify:**
- `frontend/src/components/DiagramsView/UIScreenEditor/OverviewTab.tsx`

**Reference pattern:**
- `frontend/src/components/DiagramsView/UIScreenEditor/modals/AddActionModal.tsx` (lines 310-337)

---

### Testing Layer

#### Task Group 3: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review tests from Task Groups 1-2
    - Review the 3 prop wiring tests from Task 1.1
    - Review the 5 dropdown UI tests from Task 2.1
    - Total existing tests: 8 tests
  - [x] 3.2 Analyze test coverage gaps for THIS feature only
    - Identify any critical user workflows lacking coverage
    - Focus ONLY on UIScreen association feature
    - Prioritize end-to-end association flow
  - [x] 3.3 Write up to 3 additional integration tests if needed
    - Test full flow: select screen -> verify dirty state -> autosave triggers
    - Test clear flow: clear selection -> verify dirty state -> autosave triggers
    - Test persistence: verify `typed_content.screen_id` is updated correctly
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests related to UIScreen association feature
    - Expected total: approximately 8-11 tests maximum
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 8-11 tests total)
- Full association workflow is covered (select, display, clear, persist)
- Missing screen warning scenario is tested
- No more than 3 additional tests added

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Prop Wiring** - Wire data flow from EditorPanel to OverviewTab
2. **Task Group 2: Dropdown UI** - Implement the dropdown selector and related UI
3. **Task Group 3: Test Review** - Verify coverage and fill critical gaps

## Implementation Notes

### Existing Code to Leverage

| File | What to Use |
|------|-------------|
| `UIScreenDiagramEditorPanel.tsx` | Already has `uiScreensList` computed (line 105-108) and `setScreenId` from hook (line 67) |
| `useUIScreenDiagram.ts` | `setScreenId()` already implements debounced autosave (lines 187-196) |
| `OverviewTab.tsx` | Interface already declares `onScreenIdChange` (line 15), just needs wiring |
| `AddActionModal.tsx` | Dropdown pattern to follow (lines 310-337) |

### Key Type References

```typescript
// From types/model.ts
interface UIScreen {
  id: string;
  name: string;
  route?: string;
}

// From types/typedContent.ts
interface UIScreenContent {
  screen_id: string | null;
  components: UIScreenComponentRef[];
  actions: UIScreenActionRef[];
}
```

### Dropdown Pattern to Follow

```tsx
// From AddActionModal.tsx lines 316-327
<select value={selectedScreenId || ''} onChange={handleChange}>
  <option value="">Select a UIScreen...</option>
  {uiScreens.map((screen) => (
    <option key={screen.id} value={screen.id}>
      {screen.name} ({screen.route})
    </option>
  ))}
</select>
```

## Out of Scope

- Backend changes to architecture-model-service
- Changes to UI Workflow diagrams
- Creating new UIScreen entities from the editor
- Bulk association features
- Association history/audit

## Implementation Summary

### Files Modified
- `frontend/src/components/DiagramsView/UIScreenEditor/OverviewTab.tsx` - Updated interface and implemented dropdown UI
- `frontend/src/components/DiagramsView/UIScreenDiagramEditorPanel.tsx` - Wired props to OverviewTab

### Files Created
- `frontend/src/__tests__/ui-screen-association.test.ts` - 14 tests covering all task groups

### Test Results
- 14 tests passing
- Task Group 1: 3 prop wiring tests
- Task Group 2: 8 dropdown UI tests (including 3 missing screen warning tests)
- Task Group 3: 3 integration tests
