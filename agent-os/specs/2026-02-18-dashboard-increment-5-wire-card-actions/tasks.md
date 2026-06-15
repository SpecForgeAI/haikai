# Tasks: Dashboard Increment 5 -- Wire Card Actions to Navigation + Persona Panel Placeholder

> Auto-generated from `spec.md` on 2026-02-18

## Overview

Make the Dashboard immediately actionable by wiring each card's primary action button to navigate to the relevant app area AND simultaneously open a lightweight "persona helper" panel. The panel is a right-anchored drawer rendered at the App shell level that displays the persona name, a "How can I help?" greeting, and a disabled chat input placeholder. No LLM integration or backend calls are involved -- this is a pure frontend UI feature.

**Total Task Groups:** 5
**Total Sub-Tasks:** 24

**Files to create:**
- `frontend/src/contexts/PersonaPanelContext.tsx` (new)
- `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` (new)
- `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` (new)

**Files to modify:**
- `frontend/src/App.tsx`
- `frontend/src/components/DashboardView/DashboardView.tsx`

---

## Task Groups

### TG1: PersonaPanelContext -- Global panel state context with provider and hooks
Dependencies: none

This task group creates the lightweight React Context that manages panel visibility and active persona name. Follows the `AppConfigContext.tsx` pattern (createContext + Provider + custom hooks).

- [x] **Task 1.1**: Write 4 focused tests for PersonaPanelContext
  - File(s): `frontend/src/__tests__/PersonaPanelContext.test.tsx` (new)
  - Tests to write:
    1. `usePersonaPanel` throws error when used outside provider
    2. `openPanel("Product Manager")` sets `isOpen: true` and `personaName: "Product Manager"`
    3. `closePanel()` after `openPanel` sets `isOpen: false` and `personaName: null`
    4. Calling `openPanel("Solution Architect")` while already open with a different persona updates `personaName` to the new value
  - Pattern: Render a test consumer component inside `<PersonaPanelProvider>`, call hook functions via `act()`, assert state
  - Reference: Follow Vitest + React Testing Library patterns used elsewhere in the codebase

- [x] **Task 1.2**: Create `PersonaPanelContext.tsx` with interfaces, context, and provider
  - File: `frontend/src/contexts/PersonaPanelContext.tsx` (new)
  - Define `PersonaPanelState` interface: `{ isOpen: boolean; personaName: string | null }`
  - Define `PersonaPanelContextType` interface: `{ isOpen: boolean; personaName: string | null; openPanel: (personaName: string) => void; closePanel: () => void }`
  - Create context via `createContext<PersonaPanelContextType | undefined>(undefined)`
  - Implement `PersonaPanelProvider` component:
    - Uses `useState<PersonaPanelState>({ isOpen: false, personaName: null })`
    - `openPanel` callback: sets `{ isOpen: true, personaName }`
    - `closePanel` callback: sets `{ isOpen: false, personaName: null }`
    - Wraps children with context provider
  - Follow the exact structure of `frontend/src/contexts/AppConfigContext.tsx` (lines 243-296): createContext, Provider component, custom hooks with guard throws

- [x] **Task 1.3**: Export custom hooks from `PersonaPanelContext.tsx`
  - File: `frontend/src/contexts/PersonaPanelContext.tsx` (same file as 1.2)
  - `usePersonaPanel()` -- returns full context `{ isOpen, personaName, openPanel, closePanel }`; throws if used outside provider
  - `useOpenPersonaPanel()` -- returns just the `openPanel` function (for DashboardView consumption); throws if outside provider
  - `useClosePersonaPanel()` -- returns just the `closePanel` function (for PersonaHelperPanel consumption); throws if outside provider
  - Each hook follows the guard pattern from `AppConfigContext.tsx` (lines 308-314): check `context === undefined`, throw descriptive error

- [x] **Task 1.4**: Run TG1 tests and verify they pass
  - Run only the tests from Task 1.1: `frontend/src/__tests__/PersonaPanelContext.test.tsx`
  - Expected: 4 tests pass

**Acceptance Criteria:**
- All 4 tests from Task 1.1 pass
- Provider correctly manages `isOpen` and `personaName` state
- All three hooks export correctly and throw when used outside provider
- `openPanel` while already open updates persona without closing first

---

### TG2: PersonaHelperPanel component + CSS module -- Right-anchored drawer panel
Dependencies: TG1

This task group creates the reusable drawer component and its CSS module. The component reads state from PersonaPanelContext via hooks, renders conditionally when `isOpen` is true, and handles Escape key dismissal.

- [x] **Task 2.1**: Write 5 focused tests for PersonaHelperPanel
  - File(s): `frontend/src/__tests__/PersonaHelperPanel.test.tsx` (new)
  - Tests to write:
    1. Panel renders with correct persona name when `isOpen: true` -- assert `data-testid="persona-helper-panel"` is in the document and `data-testid="persona-panel-label"` contains the persona name text
    2. Panel does NOT render when `isOpen: false` -- assert `data-testid="persona-helper-panel"` is not in the document
    3. Greeting text "How can I help?" is displayed -- assert `data-testid="persona-panel-greeting"` contains that text
    4. Disabled input is rendered with placeholder "Coming soon..." -- assert `data-testid="persona-panel-input"` has `disabled` attribute and correct placeholder
    5. Clicking close button calls `closePanel` -- assert `data-testid="persona-panel-close"` click triggers close behavior (panel disappears)
  - Pattern: Wrap component in `<PersonaPanelProvider>` with pre-set state; use `screen.getByTestId` / `screen.queryByTestId`

- [x] **Task 2.2**: Create `PersonaHelperPanel.module.css`
  - File: `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.module.css` (new)
  - `.panel` -- Fixed-position right-anchored drawer:
    - `position: fixed; top: 60px; right: 0; height: calc(100vh - 60px); width: 340px`
    - `background: #ffffff; border-left: 1px solid #e0e0e0`
    - `box-shadow: -2px 0 8px rgba(0, 0, 0, 0.08); z-index: 900`
    - `display: flex; flex-direction: column`
  - `.header` -- Flex row with space-between:
    - `display: flex; align-items: center; justify-content: space-between`
    - `padding: 16px 20px; border-bottom: 1px solid #e0e0e0; flex-shrink: 0`
  - `.personaLabel` -- Persona name styling:
    - `font-size: 12px; font-weight: 600; color: #00695C`
    - Matches `ProductManagerChatPanel.module.css` `.personaLabel` + `.personaTeal` styles
  - `.closeButton` -- Unstyled close button:
    - `background: none; border: none; cursor: pointer; font-size: 18px; color: #666; padding: 0 4px; line-height: 1`
    - Hover state: `color: #333`
  - `.body` -- Panel body area:
    - `flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 16px`
  - `.greeting` -- Greeting text:
    - `font-size: 14px; color: #333; line-height: 1.5`
  - `.disabledInput` -- Disabled input styling:
    - `width: 100%; padding: 8px 12px; font-size: 13px`
    - `border: 1px solid #ccc; border-radius: 4px`
    - `background: #f5f5f5; color: #999; cursor: not-allowed`
    - Follows `ProductManagerChatPanel.module.css` `.chatInput:disabled` pattern

- [x] **Task 2.3**: Create `PersonaHelperPanel.tsx` component
  - File: `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` (new)
  - Import `usePersonaPanel` and `useClosePersonaPanel` from `PersonaPanelContext`
  - Import CSS module styles
  - Component takes **no props** -- all state from context
  - Read `{ isOpen, personaName }` from `usePersonaPanel()`
  - Read `closePanel` from `useClosePersonaPanel()`
  - Early return `null` when `!isOpen`
  - JSX structure:
    ```
    <div className={styles.panel} data-testid="persona-helper-panel">
      <div className={styles.header}>
        <span className={styles.personaLabel} data-testid="persona-panel-label">{personaName}</span>
        <button className={styles.closeButton} onClick={closePanel} aria-label="Close persona panel" data-testid="persona-panel-close">X</button>
      </div>
      <div className={styles.body}>
        <p className={styles.greeting} data-testid="persona-panel-greeting">How can I help?</p>
        <input className={styles.disabledInput} type="text" disabled placeholder="Coming soon..." data-testid="persona-panel-input" />
      </div>
    </div>
    ```

- [x] **Task 2.4**: Add Escape key listener to PersonaHelperPanel
  - File: `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` (same file as 2.3)
  - Add `useEffect` that registers a global `keydown` listener for `Escape` key
  - Listener calls `closePanel()` when `event.key === 'Escape'`
  - Only register when `isOpen` is true -- use `isOpen` in the dependency array
  - Clean up listener in the `useEffect` return function
  - Guard: skip if `document.activeElement` is an `input`, `textarea`, or `contenteditable` element (future-proofing, same pattern as `CreateOrganisationModal.tsx` AppContent keyboard handler at `App.tsx` lines 88-116)

- [x] **Task 2.5**: Run TG2 tests and verify they pass
  - Run only the tests from Task 2.1: `frontend/src/__tests__/PersonaHelperPanel.test.tsx`
  - Expected: 5 tests pass

**Acceptance Criteria:**
- All 5 tests from Task 2.1 pass
- Panel renders when open, hidden when closed
- Correct persona name displayed in header
- "How can I help?" greeting text visible
- Disabled input with "Coming soon..." placeholder rendered
- Close button dismisses panel
- Escape key dismisses panel (when open)
- CSS matches the spec design (right-anchored, 340px wide, z-index 900, below 60px TopBar)

---

### TG3: App shell integration -- Mount provider and panel in App.tsx
Dependencies: TG1, TG2

This task group wires the new context provider and panel component into the application shell. Minimal changes to `App.tsx`.

- [x] **Task 3.1**: Add `PersonaPanelProvider` to the `App()` component
  - File: `frontend/src/App.tsx`
  - Add import at top of file (after line 6): `import { PersonaPanelProvider } from './contexts/PersonaPanelContext';`
  - In `App()` function (lines 141-153), wrap `<AppContent />` with `<PersonaPanelProvider>`:
    - Before: `<ArchitectureProvider><AppContent /></ArchitectureProvider>`
    - After: `<ArchitectureProvider><PersonaPanelProvider><AppContent /></PersonaPanelProvider></ArchitectureProvider>`
  - This places PersonaPanelProvider inside ArchitectureProvider but wrapping AppContent, so both DashboardView and PersonaHelperPanel have access
  - Nesting order becomes: `AppConfigProvider > ProjectProvider > ArchitectureProvider > PersonaPanelProvider > AppContent`

- [x] **Task 3.2**: Render `PersonaHelperPanel` in `AppContent()`
  - File: `frontend/src/App.tsx`
  - Add import at top of file: `import { PersonaHelperPanel } from './components/PersonaHelperPanel/PersonaHelperPanel';`
  - In `AppContent()` return JSX (lines 118-138), add `<PersonaHelperPanel />` as a sibling after the `<CreateOrganisationModal>` block (after line 136):
    ```
    {/* Spec 2026-02-18: Dashboard Increment 5 - PersonaHelperPanel mounted at App root */}
    <PersonaHelperPanel />
    ```
  - This mirrors the existing pattern of rendering app-level overlays as siblings of the main layout

**Acceptance Criteria:**
- PersonaPanelProvider wraps AppContent in the correct nesting order
- PersonaHelperPanel is rendered at the App shell level as a sibling after CreateOrganisationModal
- No visual changes when panel is closed (panel returns null when not open)
- Existing app functionality is unaffected

---

### TG4: Dashboard card action wiring -- Extend onClick handlers to open persona panel
Dependencies: TG1, TG3

This task group modifies the 9 active dashboard card action buttons to call `openPanel(personaName)` alongside the existing `navigateTo()` call. The `navigateTo()` function itself is NOT modified.

- [x] **Task 4.1**: Write 6 focused tests for dashboard card wiring
  - File(s): `frontend/src/__tests__/DashboardView.personaPanel.test.tsx` (new)
  - Tests to write:
    1. Clicking "Open Product" button on Product Definition card opens panel with persona "Product Manager"
    2. Clicking "Open Architecture" button on HLA card opens panel with persona "Solution Architect"
    3. Clicking "Open Tests" button on Testing Suite card opens panel with persona "Test Engineer"
    4. Clicking "Open Implement" button on Implementation card opens panel with persona "Implementation Assistant"
    5. Summary Insight card has no action button and does not open panel -- assert no button element exists within `card-summary-insight`
    6. Clicking a second card while panel is open updates persona name -- click Product Definition (Product Manager), then click HLA (Solution Architect), assert panel shows "Solution Architect"
  - Pattern: Render `<DashboardView />` wrapped in all required providers (ProjectProvider with mock project, ArchitectureProvider, PersonaPanelProvider). Mock `getDashboardSummary` API to return test data. Assert panel state via data-testid attributes.
  - Note: Tests 1-4 cover the 4 distinct persona strings. The remaining 5 cards (Roadmap, Standards, Backlog, Detailed Architecture, Verification) use the same personas already tested, so explicit tests for each are not needed.

- [x] **Task 4.2**: Import `useOpenPersonaPanel` in DashboardView
  - File: `frontend/src/components/DashboardView/DashboardView.tsx`
  - Add import at top (after line 24): `import { useOpenPersonaPanel } from '../../contexts/PersonaPanelContext';`

- [x] **Task 4.3**: Call `useOpenPersonaPanel()` hook in DashboardView component body
  - File: `frontend/src/components/DashboardView/DashboardView.tsx`
  - Inside the `DashboardView` component function body (after line 77, near `const dispatch = useArchitectureDispatch();`):
    ```typescript
    const openPanel = useOpenPersonaPanel();
    ```

- [x] **Task 4.4**: Wire all 9 active card onClick handlers to also call `openPanel`
  - File: `frontend/src/components/DashboardView/DashboardView.tsx`
  - Each button's inline arrow function is expanded to a block body with two calls.
  - Changes (exact persona strings from the mapping table):

  1. **Product Definition** (line 219):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'product')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'product'); openPanel('Product Manager'); }}`

  2. **Roadmap** (line 239):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'roadmap')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'roadmap'); openPanel('Product Manager'); }}`

  3. **Standards** (line 263):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'product')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'product'); openPanel('Product Manager'); }}`

  4. **High-Level Architecture** (line 283):
     - Before: `onClick={() => navigateTo(dispatch, 'metamodel')}`
     - After: `onClick={() => { navigateTo(dispatch, 'metamodel'); openPanel('Solution Architect'); }}`

  5. **Backlog** (line 357):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'backlog')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'backlog'); openPanel('Product Manager'); }}`

  6. **Detailed Architecture** (line 377):
     - Before: `onClick={() => navigateTo(dispatch, 'metamodel')}`
     - After: `onClick={() => { navigateTo(dispatch, 'metamodel'); openPanel('Solution Architect'); }}`

  7. **Testing Suite** (line 395):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'implement')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); openPanel('Test Engineer'); }}`

  8. **Implementation** (line 440):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'implement')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); openPanel('Implementation Assistant'); }}`

  9. **Verification** (line 458):
     - Before: `onClick={() => navigateTo(dispatch, 'product', 'implement')}`
     - After: `onClick={() => { navigateTo(dispatch, 'product', 'implement'); openPanel('Test Engineer'); }}`

  - **Summary Insight card** (lines 464-474): NO CHANGES -- it has no button, uses `cardDisabled` class, and remains as-is.

- [x] **Task 4.5**: Run TG4 tests and verify they pass
  - Run only the tests from Task 4.1: `frontend/src/__tests__/DashboardView.personaPanel.test.tsx`
  - Expected: 6 tests pass

**Acceptance Criteria:**
- All 6 tests from Task 4.1 pass
- All 9 active card buttons call both `navigateTo()` and `openPanel()` with the correct persona string
- The `navigateTo()` function signature and implementation remain unchanged
- Summary Insight card is unmodified (no button, no persona)
- Clicking different cards updates the panel's persona name

---

### TG5: Test gap analysis and verification
Dependencies: TG1, TG2, TG3, TG4

Review all tests written in TG1-TG4, identify any critical gaps, and run the full feature test suite.

- [x] **Task 5.1**: Run all existing tests from TG1-TG4 together
  - Run all three test files:
    - `frontend/src/__tests__/PersonaPanelContext.test.tsx` (4 tests from TG1)
    - `frontend/src/__tests__/PersonaHelperPanel.test.tsx` (5 tests from TG2)
    - `frontend/src/__tests__/DashboardView.personaPanel.test.tsx` (6 tests from TG4)
  - Expected: 15 tests pass
  - Fix any failures before proceeding

- [x] **Task 5.2**: Identify untested critical paths and write up to 5 additional tests
  - File(s): `frontend/src/__tests__/PersonaHelperPanel.test.tsx` (appended)
  - Gap-fill tests written (4 test groups, 7 individual test cases):
    1. Escape key closes panel when panel is open (genuine gap -- Escape handler was untested)
    2. Escape key does NOT close panel when focus is on an input element (tests the activeElement guard)
    3. Click-outside does NOT close panel (verifies intentional no-backdrop-dismiss behavior)
    4. Panel renders correctly with each of the 4 unique persona strings (parametric: "Product Manager", "Solution Architect", "Test Engineer", "Implementation Assistant")
  - Gaps assessed but not written (already covered or not unit-testable):
    - openPanel with second persona while already open -- covered by TG1 test 4 and TG4 test 6
    - Panel persists across view change -- architectural property (panel at App root, views swap inside main); not meaningfully unit-testable
    - Modal z-index layering -- CSS properties not available in jsdom with mocked CSS modules

- [x] **Task 5.3**: Run all feature-specific tests and verify everything passes
  - Run all test files related to this feature:
    - `frontend/src/__tests__/PersonaPanelContext.test.tsx`
    - `frontend/src/__tests__/PersonaHelperPanel.test.tsx`
    - `frontend/src/__tests__/DashboardView.personaPanel.test.tsx`
  - Result: 22 tests passed (4 + 12 + 6)
  - Also ran existing dashboard tests: `frontend/src/__tests__/dashboard-increment-3-dashboardview.test.tsx`
  - Result: 8 tests passed -- no regressions

- [x] **Task 5.4**: Verify acceptance criteria manually
  - Walk through each acceptance criterion from the spec:
    1. Clicking any of the 9 active card buttons navigates AND opens panel -- PASS (all 9 onClick handlers call both navigateTo and openPanel)
    2. Correct persona name for each card per mapping table -- PASS (verified via code and tests)
    3. Panel shows "How can I help?" greeting -- PASS (PersonaHelperPanel.tsx line 99)
    4. Disabled input with "Coming soon..." placeholder -- PASS (PersonaHelperPanel.tsx lines 101-107)
    5. X close button works -- PASS (verified by TG2 test 5)
    6. Escape key closes panel -- PASS (verified by gap-fill test 1)
    7. Click-outside does NOT close panel -- PASS (verified by gap-fill test 3)
    8. Panel persists across view changes -- PASS (panel mounted at App root, outside view-switching main block)
    9. Summary Insight card unchanged (disabled, no persona) -- PASS (verified by TG4 test 5)
    10. Clicking different card updates persona name in open panel -- PASS (verified by TG1 test 4 and TG4 test 6)
    11. Panel positioned below 60px TopBar, fills remaining height on right -- PASS (CSS: top: 60px, height: calc(100vh - 60px), right: 0)
    12. Panel does not overlap TopBar (starts at top: 60px) -- PASS (CSS: top: 60px)
    13. Modal (Ctrl+Shift+M) renders above panel (z-index 1000 > 900) -- PASS (panel z-index: 900 in CSS)
    14. No network requests on panel open/close -- PASS (no API imports or fetch calls in context or panel component)

**Acceptance Criteria:**
- All feature-specific tests pass (22 total)
- All 14 acceptance criteria from the spec are verified
- 4 gap-fill test groups written (within the 5 maximum)
- No regressions in existing functionality (dashboard increment 3 tests: 8/8 pass)

---

## Execution Order

Recommended implementation sequence:

1. **TG1: PersonaPanelContext** -- Create the global state context first (no UI dependencies)
2. **TG2: PersonaHelperPanel + CSS** -- Build the drawer component that consumes the context
3. **TG3: App shell integration** -- Wire provider and panel into App.tsx (enables end-to-end flow)
4. **TG4: Dashboard card wiring** -- Extend card buttons to open panel (completes the feature)
5. **TG5: Test gap analysis** -- Review, fill gaps, run full suite, verify acceptance criteria
