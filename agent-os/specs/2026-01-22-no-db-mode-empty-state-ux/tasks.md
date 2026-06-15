# Task Breakdown: No-Database Mode Empty-State UX

## Overview
Total Tasks: 26

This spec implements user-friendly empty-state handling when the application runs with `includeDatabase=false` (no-DB mode). It includes:
- Reusable `NoProjectEmptyState` component
- Empty-state rendering in Architecture & Design view and Product & Delivery view
- Toast messages when Export is clicked with no project
- "File Mode" indicator in TopBar

## Technical Context

**Existing Hooks/Components:**
- `useIncludeDatabase()` - Hook from `AppConfigContext.tsx` (line 336)
- `useProject()` - Hook from `ProjectContext.tsx` (line 122)
- `useArchitecture()` - Hook from `ArchitectureContext.tsx`
- Notification toast pattern already in `TopBar.tsx` (lines 768-772)

**Key Files:**
- `frontend/src/components/TopBar/TopBar.tsx` - Contains export handlers and notification system
- `frontend/src/components/TopBar/TopBar.module.css` - TopBar styling
- `frontend/src/components/MetaModelView/MetaModelView.tsx` - Architecture & Design view
- `frontend/src/components/ProductView/ProductView.tsx` - Product & Delivery view
- `frontend/src/contexts/AppConfigContext.tsx` - `useIncludeDatabase` hook
- `frontend/src/contexts/ProjectContext.tsx` - `useProject` hook

## Task List

### UI Component Layer

#### Task Group 1: NoProjectEmptyState Component
**Dependencies:** None

- [x] 1.0 Complete NoProjectEmptyState component
  - [x] 1.1 Write 4 focused tests for NoProjectEmptyState functionality
    - Test: Renders "No project loaded" heading
    - Test: Renders "Import a project snapshot to begin working." sub-text
    - Test: Calls `onImportJson` when "Import JSON" button clicked
    - Test: Calls `onImportXlsx` when "Import XLSX" button clicked
    - File: `frontend/src/__tests__/NoProjectEmptyState.test.tsx`
  - [x] 1.2 Create NoProjectEmptyState component
    - File: `frontend/src/components/EmptyState/NoProjectEmptyState.tsx`
    - Props interface:
      ```typescript
      interface NoProjectEmptyStateProps {
        onImportJson: () => void;
        onImportXlsx: () => void;
      }
      ```
    - Content:
      - Centered container
      - Heading: "No project loaded"
      - Sub-text: "Import a project snapshot to begin working."
      - Primary button: "Import JSON" with `aria-label="Import project from JSON file"`
      - Secondary button: "Import XLSX" with `aria-label="Import project from Excel file"`
    - Test IDs:
      - `no-project-empty-state` (container)
      - `empty-state-heading`
      - `empty-state-subtext`
      - `import-json-button`
      - `import-xlsx-button`
  - [x] 1.3 Create NoProjectEmptyState styles
    - File: `frontend/src/components/EmptyState/NoProjectEmptyState.module.css`
    - Layout: Flexbox centered container (full width/height of parent)
    - Heading: `font-size: 1.5rem`, `color: #333`
    - Sub-text: `font-size: 1rem`, `color: #666`, `margin-bottom: 24px`
    - Buttons: Follow existing primary/secondary button patterns from codebase
    - Button container: `display: flex`, `gap: 12px`
  - [x] 1.4 Ensure NoProjectEmptyState component tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify component renders correctly
    - Verify button click handlers are called

**Acceptance Criteria:**
- All 4 tests from 1.1 pass
- Component renders centered empty-state layout
- Buttons have proper ARIA labels for accessibility
- Styles are clean and match existing design system

---

#### Task Group 2: TopBar File Mode Indicator
**Dependencies:** None

- [x] 2.0 Complete File Mode indicator in TopBar
  - [x] 2.1 Write 3 focused tests for File Mode indicator
    - Test: "File Mode" indicator renders when `includeDatabase=false`
    - Test: "File Mode" indicator does NOT render when `includeDatabase=true`
    - Test: Indicator has correct tooltip text
    - File: `frontend/src/__tests__/TopBar.file-mode-indicator.test.tsx`
  - [x] 2.2 Add File Mode indicator to TopBar component
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Location: Inside the `actions` div (right side), before the `fileName` span
    - Logic:
      ```tsx
      const includeDatabase = useIncludeDatabase();
      // ... in render:
      {!includeDatabase && (
        <span
          className={styles.fileModeIndicator}
          title="Database features are disabled. Use Import/Export for file-based workflows."
          data-testid="file-mode-indicator"
        >
          File Mode
        </span>
      )}
      ```
    - Import `useIncludeDatabase` from `AppConfigContext` (already imported as `useIncludeDelivery`)
  - [x] 2.3 Add File Mode indicator styles
    - File: `frontend/src/components/TopBar/TopBar.module.css`
    - Add `.fileModeIndicator` class:
      ```css
      .fileModeIndicator {
        font-size: 12px;
        color: #888;
        background: #f0f0f0;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: 500;
        cursor: help;
      }
      ```
  - [x] 2.4 Ensure File Mode indicator tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify indicator visibility based on toggle

**Acceptance Criteria:**
- All 3 tests from 2.1 pass
- "File Mode" badge appears in TopBar when `includeDatabase=false`
- Badge has tooltip explaining the mode
- Badge is not visible when `includeDatabase=true`

---

#### Task Group 3: TopBar Export Toast Handlers
**Dependencies:** None

- [x] 3.0 Complete export toast handlers for no-project state
  - [x] 3.1 Write 4 focused tests for export toast behavior
    - Test: Shows info toast when Export JSON clicked with `includeDatabase=false` AND `activeProject=null`
    - Test: Shows info toast when Export XLSX clicked with `includeDatabase=false` AND `activeProject=null`
    - Test: Does NOT show toast when Export JSON clicked with project loaded (has `loadedFileName`)
    - Test: Does NOT show toast when `includeDatabase=true` (DB mode)
    - File: `frontend/src/__tests__/TopBar.export-empty-toast.test.tsx`
  - [x] 3.2 Modify `handleExportJsonClick` to check for no-project in no-DB mode
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Location: `handleExportJsonClick` function (around line 387)
    - Add early return with toast before the existing `if (!state.loadedFileName)` check:
      ```typescript
      const handleExportJsonClick = async () => {
        // Spec 2026-01-22: Show toast when no project in no-DB mode
        if (!includeDatabase && !state.loadedFileName) {
          setNotification('Nothing to export yet - import a project snapshot first.');
          setTimeout(() => setNotification(null), 4000);
          return;
        }
        // ... existing code
      };
      ```
    - Note: Must import and use `useIncludeDatabase` hook
  - [x] 3.3 Modify `handleExportXlsxClick` to check for no-project in no-DB mode
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Location: `handleExportXlsxClick` function (around line 535)
    - Add same early return pattern as JSON handler
  - [x] 3.4 Add info toast styling (if needed)
    - File: `frontend/src/components/TopBar/TopBar.module.css`
    - Existing `.notification` class uses green background (success)
    - Consider adding `.notificationInfo` class with blue/neutral color, or reuse existing notification (spec says 'info' type)
    - Decision: Reuse existing `.notification` style as spec says "info" toast (user guidance, not error)
  - [x] 3.5 Ensure export toast tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify toast appears correctly in no-DB mode with no project

**Acceptance Criteria:**
- All 4 tests from 3.1 pass
- Toast displays "Nothing to export yet - import a project snapshot first."
- Toast auto-dismisses after 4 seconds
- No toast shown when project is loaded or in DB mode

---

### View Integration Layer

#### Task Group 4: MetaModelView Empty-State Integration
**Dependencies:** Task Group 1

- [x] 4.0 Complete MetaModelView empty-state rendering
  - [x] 4.1 Write 3 focused tests for MetaModelView empty-state
    - Test: Shows `NoProjectEmptyState` when `includeDatabase=false` AND `activeProject=null`
    - Test: Shows normal MetaModelView content when `includeDatabase=true`
    - Test: Shows normal MetaModelView content when project is loaded (even in no-DB mode)
    - File: `frontend/src/__tests__/MetaModelView.empty-state.test.tsx`
  - [x] 4.2 Add empty-state conditional rendering to MetaModelView
    - File: `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Add imports:
      ```typescript
      import { useIncludeDatabase } from '../../contexts/AppConfigContext';
      import { useProject } from '../../contexts/ProjectContext';
      import { NoProjectEmptyState } from '../EmptyState/NoProjectEmptyState';
      ```
    - Add logic at start of component:
      ```typescript
      const includeDatabase = useIncludeDatabase();
      const activeProject = useProject();
      ```
    - Add conditional return before main render:
      ```typescript
      if (!includeDatabase && activeProject === null) {
        return (
          <div className={styles.container}>
            <NoProjectEmptyState
              onImportJson={/* trigger import JSON flow */}
              onImportXlsx={/* trigger import XLSX flow */}
            />
          </div>
        );
      }
      ```
  - [x] 4.3 Wire up import handlers for MetaModelView empty-state
    - Challenge: Import handlers are in TopBar, need to expose them
    - Solution A: Lift import trigger to ArchitectureContext
    - Solution B: Use ref callbacks passed through context
    - Solution C: Emit custom events that TopBar listens for
    - **Recommended**: Create simple context or use existing pattern
    - Create `ImportActionsContext` with `triggerImportJson` and `triggerImportXlsx`
    - File: `frontend/src/contexts/ImportActionsContext.tsx`
    - Provider wraps in App.tsx, TopBar provides handlers, views consume
  - [x] 4.4 Ensure MetaModelView empty-state tests pass
    - Run ONLY the 3 tests written in 4.1
    - Verify empty-state renders when conditions met
    - Verify normal view renders when project loaded

**Acceptance Criteria:**
- All 3 tests from 4.1 pass
- Architecture & Design view shows empty-state when `includeDatabase=false` and no project
- Import JSON/XLSX buttons in empty-state trigger the actual import flows
- Normal view renders when project is loaded

---

#### Task Group 5: ProductView Empty-State Integration
**Dependencies:** Task Group 1, Task Group 4 (shares ImportActionsContext)

- [x] 5.0 Complete ProductView empty-state rendering
  - [x] 5.1 Write 3 focused tests for ProductView empty-state
    - Test: Shows `NoProjectEmptyState` when `includeDatabase=false` AND `activeProject=null`
    - Test: Shows normal ProductView content when `includeDatabase=true`
    - Test: Shows normal ProductView content when project is loaded (even in no-DB mode)
    - File: `frontend/src/__tests__/ProductView.empty-state.test.tsx`
  - [x] 5.2 Add empty-state conditional rendering to ProductViewContent
    - File: `frontend/src/components/ProductView/ProductView.tsx`
    - Add imports:
      ```typescript
      import { useIncludeDatabase } from '../../contexts/AppConfigContext';
      import { useProject } from '../../contexts/ProjectContext';
      import { NoProjectEmptyState } from '../EmptyState/NoProjectEmptyState';
      ```
    - Add logic at start of `ProductViewContent` function (around line 104):
      ```typescript
      const includeDatabase = useIncludeDatabase();
      const activeProject = useProject();
      ```
    - Add conditional return before main render:
      ```typescript
      if (!includeDatabase && activeProject === null) {
        return (
          <div className={styles.container} data-testid="product-view">
            <NoProjectEmptyState
              onImportJson={/* from ImportActionsContext */}
              onImportXlsx={/* from ImportActionsContext */}
            />
          </div>
        );
      }
      ```
  - [x] 5.3 Wire up import handlers for ProductView empty-state
    - Consume `ImportActionsContext` created in Task 4.3
    - Use `useImportActions()` hook to get handlers
  - [x] 5.4 Ensure ProductView empty-state tests pass
    - Run ONLY the 3 tests written in 5.1
    - Verify empty-state renders when conditions met
    - Verify normal view renders when project loaded

**Acceptance Criteria:**
- All 3 tests from 5.1 pass
- Product & Delivery view shows empty-state when `includeDatabase=false` and no project
- Import JSON/XLSX buttons in empty-state trigger the actual import flows
- Normal view renders when project is loaded

---

### Context/Wiring Layer

#### Task Group 6: ImportActionsContext Creation
**Dependencies:** None (but used by Task Groups 4 and 5)

- [x] 6.0 Complete ImportActionsContext for cross-component import triggering
  - [x] 6.1 Write 3 focused tests for ImportActionsContext
    - Test: Context throws error when used outside provider
    - Test: `triggerImportJson` is callable from context
    - Test: `triggerImportXlsx` is callable from context
    - File: `frontend/src/__tests__/ImportActionsContext.test.tsx`
  - [x] 6.2 Create ImportActionsContext
    - File: `frontend/src/contexts/ImportActionsContext.tsx`
    - Interface:
      ```typescript
      interface ImportActionsContextType {
        triggerImportJson: () => void;
        triggerImportXlsx: () => void;
      }
      ```
    - Provider component: `ImportActionsProvider`
    - Hook: `useImportActions()`
    - Default values: no-op functions (provider overrides)
  - [x] 6.3 Integrate ImportActionsProvider in App.tsx
    - File: `frontend/src/App.tsx`
    - Wrap inside ArchitectureProvider (needs access to dispatch for file inputs)
    - Pattern:
      ```tsx
      <ArchitectureProvider>
        <ImportActionsProvider>
          <AppContent />
        </ImportActionsProvider>
      </ArchitectureProvider>
      ```
  - [x] 6.4 Connect TopBar to ImportActionsContext
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Option A: TopBar provides context values via a nested provider
    - Option B: Use useImperativeHandle pattern
    - **Recommended**: TopBar uses `useEffect` to register handlers with context
    - Alternative: Create handlers at App.tsx level and pass down, but this requires refactoring TopBar
    - **Simplest Approach**: Have TopBar render the ImportActionsProvider with its handlers
  - [x] 6.5 Ensure ImportActionsContext tests pass
    - Run ONLY the 3 tests written in 6.1
    - Verify context provides import triggers

**Acceptance Criteria:**
- All 3 tests from 6.1 pass
- ImportActionsContext can trigger JSON and XLSX import flows
- Context is properly integrated in component tree

---

### Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 4 tests written for NoProjectEmptyState (Task 1.1)
    - Review the 3 tests written for File Mode indicator (Task 2.1)
    - Review the 4 tests written for export toast (Task 3.1)
    - Review the 3 tests written for MetaModelView empty-state (Task 4.1)
    - Review the 3 tests written for ProductView empty-state (Task 5.1)
    - Review the 3 tests written for ImportActionsContext (Task 6.1)
    - Total existing tests: 20 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identified critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize end-to-end workflows over unit test gaps
  - [x] 7.3 Write up to 6 additional strategic tests maximum (if needed)
    - Added 5 additional tests for extra coverage (aria-labels, container)
    - Total tests: 25 tests passing
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 20-26 tests maximum
    - All 25 tests pass
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- Critical user workflows for this feature are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 6: ImportActionsContext Creation** (infrastructure first)
   - Create the context that enables cross-component import triggering
   - This unblocks Task Groups 4 and 5

2. **Task Group 1: NoProjectEmptyState Component** (shared component)
   - Create the reusable empty-state component
   - This is used by Task Groups 4 and 5

3. **Task Group 2: TopBar File Mode Indicator** (independent)
   - Add the visual indicator to TopBar
   - No dependencies on other tasks

4. **Task Group 3: TopBar Export Toast Handlers** (independent)
   - Add toast for export when no project
   - No dependencies on other tasks

5. **Task Group 4: MetaModelView Empty-State Integration** (depends on 1, 6)
   - Integrate empty-state into Architecture view

6. **Task Group 5: ProductView Empty-State Integration** (depends on 1, 6)
   - Integrate empty-state into Product view

7. **Task Group 7: Test Review & Gap Analysis** (final)
   - Review all tests and fill critical gaps

---

## File Summary

### Files to Create
| File | Task Group |
|------|------------|
| `frontend/src/components/EmptyState/NoProjectEmptyState.tsx` | 1 |
| `frontend/src/components/EmptyState/NoProjectEmptyState.module.css` | 1 |
| `frontend/src/contexts/ImportActionsContext.tsx` | 6 |
| `frontend/src/__tests__/NoProjectEmptyState.test.tsx` | 1 |
| `frontend/src/__tests__/TopBar.file-mode-indicator.test.tsx` | 2 |
| `frontend/src/__tests__/TopBar.export-empty-toast.test.tsx` | 3 |
| `frontend/src/__tests__/MetaModelView.empty-state.test.tsx` | 4 |
| `frontend/src/__tests__/ProductView.empty-state.test.tsx` | 5 |
| `frontend/src/__tests__/ImportActionsContext.test.tsx` | 6 |

### Files to Modify
| File | Task Group | Changes |
|------|------------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | 2, 3, 6 | Add File Mode indicator, export toast handlers, connect ImportActionsContext |
| `frontend/src/components/TopBar/TopBar.module.css` | 2 | Add `.fileModeIndicator` styles |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | 4 | Add empty-state conditional rendering |
| `frontend/src/components/ProductView/ProductView.tsx` | 5 | Add empty-state conditional rendering |
| `frontend/src/App.tsx` | 6 | Add ImportActionsProvider to component tree |

---

## Notes

### Design Decisions

1. **ImportActionsContext vs Event Bus**: Using React Context to expose import triggers is more idiomatic for React than custom events. It maintains the unidirectional data flow pattern.

2. **Notification Reuse**: The existing `.notification` toast style (green, slide-up animation) is reused for the "info" toast. The spec says "info type" which is user guidance, not an error, so the existing style is appropriate.

3. **Empty-State Location**: The empty-state is rendered inside the view's container div to maintain consistent layout structure. This ensures the ChatPanel (in MetaModelView) still renders alongside the empty-state.

4. **activeProject vs loadedFileName**: The spec uses `activeProject` (from ProjectContext) as the trigger. However, `loadedFileName` (from ArchitectureContext) could also indicate a project is loaded. The implementation should check `activeProject === null` as specified, but note that after import, `activeProject` may update asynchronously.

### Testing Strategy

- Each task group writes focused tests FIRST (TDD approach)
- Tests are written in separate files for clarity
- Only feature-specific tests are run during development
- Final test review ensures coverage without over-testing
