# Task Breakdown: Import Product Snapshot Redesign

## Overview
Total Tasks: 47 (across 7 task groups)

This spec redesigns the Import Product Snapshot flow by eliminating obsolete modal fields, introducing context-aware branching (direct load vs. simplified modal vs. cherry-pick merge), and unifying JSON and XLSX imports behind a single domain-tab cherry-pick modal.

**Key source files being modified or replaced:**
- `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (replaced by new flows)
- `frontend/src/components/LandingPage/LandingPage.tsx` (Flow A: direct load)
- `frontend/src/components/TopBar/TopBar.tsx` (Flow B: active project modal)
- `frontend/src/components/Import/ImportModeModal.tsx` (removed, replaced by cherry-pick)
- `frontend/src/components/common/ImportSummaryModal.tsx` (no longer used for XLSX)
- `frontend/src/contexts/ArchitectureContext.tsx` (extend IMPORT_META_MODEL reducer)
- `frontend/src/utils/excelOperations.ts` (refactor to produce cherry-pickable shape)

## Task List

### Utilities & Core Logic

#### Task Group 1: Shared Import Utilities and ID Conflict Resolution
**Dependencies:** None

This group builds the pure utility functions that all import flows depend on. These are stateless functions with no UI, making them ideal for test-driven development and independent implementation.

- [x] 1.0 Complete shared import utilities
  - [x] 1.1 Write 6 focused tests for import utility functions
    - Test `resolveIdConflicts`: no conflicts returns data unchanged
    - Test `resolveIdConflicts`: entity ID collision generates new UUID and updates remap map
    - Test `resolveIdConflicts`: relationship FK fields cascade-update to new entity IDs (covers fields like `application_id`, `source_application_point_id`, `business_user_id`, etc.)
    - Test `resolveIdConflicts`: diagram node `entity_id` fields cascade-update to remapped entity IDs
    - Test `resolveIdConflicts`: diagram edge `relationship_id` fields cascade-update to remapped relationship IDs
    - Test `buildMergeSummary`: produces correct count strings from selected merge data (e.g., "Merged 3 applications, 2 services, 1 diagram")
  - [x] 1.2 Create `frontend/src/utils/importMergeUtils.ts` with `resolveIdConflicts` function
    - Pure function signature: `resolveIdConflicts(selectedData: MergeableData, currentModel: ArchitectureModel): MergeableData`
    - Define `MergeableData` interface: `{ entities: Partial<MetaModelEntities>, relationships: Partial<MetaModelRelationships>, diagrams: Diagram[] }`
    - Scan all selected imported items for ID collisions against `currentModel.metaModel.entities`, `currentModel.metaModel.relationships`, and `currentModel.diagrams`
    - For collisions, generate new UUID via `crypto.randomUUID()`
    - Build `Map<string, string>` of oldId -> newId
    - Cascade-update all FK fields in imported relationships using the remap map (iterate all known FK field names from MetaModelRelationships types)
    - Cascade-update `entity_id` in imported `diagram_nodes` and `relationship_id` in imported `diagram_edges`
    - Return the conflict-free `MergeableData`
  - [x] 1.3 Create `buildMergeSummary` utility in same file
    - Takes `MergeableData` and returns a human-readable summary string with counts per entity type
    - Uses human-readable labels for entity type keys (e.g., `applications` -> "Applications", `logical_data_entities` -> "Logical Data Entities")
    - Includes diagram count if diagrams are present
  - [x] 1.4 Create `validateSnapshotSchema` shared validation function in `frontend/src/utils/importMergeUtils.ts`
    - Extract the duplicated schema validation logic from both `TopBar.handleFileChange` (line ~672) and `LandingPage.handleFileChange` (line ~109) into a single reusable function
    - Signature: `validateSnapshotSchema(parsed: unknown): { valid: boolean; errors: string[]; snapshot: ProjectSnapshotDto | null }`
    - Checks: file is object, has `project`, `project.name` (string), `meta`, `model`
    - Returns parsed `ProjectSnapshotDto` on success or error messages on failure
  - [x] 1.5 Create `extractCherryPickData` utility to convert a `ProjectSnapshotDto` into the cherry-pickable data shape
    - Signature: `extractCherryPickData(snapshot: ProjectSnapshotDto): CherryPickData`
    - Define `CherryPickData` interface: `{ entities: Record<string, NamedItem[]>, relationships: Record<string, NamedItem[]>, diagrams: NamedItem[] }`
    - `NamedItem` interface: `{ id: string; name: string; [key: string]: unknown }` (preserves full entity data while exposing id/name for checkbox labels)
    - Filters out empty collections (zero items) so UI hides them
    - Excludes `work_items` and `artifacts` from the data shape
  - [x] 1.6 Create `convertXlsxResultToCherryPickData` utility
    - Signature: `convertXlsxResultToCherryPickData(result: ImportResult): CherryPickData`
    - Converts `ImportResult.newEntities` and `ImportResult.updatedEntities` into the same `CherryPickData` shape used by JSON import
    - Relationships and diagrams are empty (XLSX does not contain them)
    - Combines new + updated entities into a single set per entity type (all shown as cherry-pickable items)
  - [x] 1.7 Ensure import utility tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all pure functions produce correct output
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 6 tests from 1.1 all pass
- `resolveIdConflicts` correctly detects and resolves ID collisions with cascading FK updates
- `validateSnapshotSchema` produces identical validation behavior to the current duplicated logic in TopBar and LandingPage
- `extractCherryPickData` and `convertXlsxResultToCherryPickData` produce a unified `CherryPickData` shape usable by the cherry-pick modal
- All functions are pure (no side effects, no React dependencies)

---

### Reducer Extension

#### Task Group 2: Extend IMPORT_META_MODEL Reducer for Merge with Diagrams
**Dependencies:** Task Group 1 (uses `MergeableData` type)

The existing `IMPORT_META_MODEL` reducer action in `ArchitectureContext.tsx` (line ~1034) supports appending/overwriting entities and relationships but does not handle diagrams. This group extends it to support additive merge including diagrams.

- [x] 2.0 Complete reducer extension for merge
  - [x] 2.1 Write 4 focused tests for the extended reducer action
    - Test: dispatching `MERGE_IMPORT` with entities appends them to existing arrays (no duplicates, no deletions)
    - Test: dispatching `MERGE_IMPORT` with relationships appends them to existing arrays
    - Test: dispatching `MERGE_IMPORT` with diagrams appends them to `state.model.diagrams`
    - Test: dispatching `MERGE_IMPORT` with empty selections produces no state change
  - [x] 2.2 Add new `MERGE_IMPORT` action type to `ArchitectureAction` union in `frontend/src/contexts/ArchitectureContext.tsx`
    - Action shape: `{ type: 'MERGE_IMPORT'; payload: MergeableData }`
    - Import `MergeableData` type from `importMergeUtils.ts`
  - [x] 2.3 Implement `MERGE_IMPORT` case in the reducer
    - For each entity collection key in `payload.entities`: spread existing array and append new items
    - For each relationship collection key in `payload.relationships`: spread existing array and append new items
    - For `payload.diagrams`: spread existing `state.model.diagrams` and append new diagrams
    - This is purely additive: no existing data is deleted or overwritten
    - Pattern follows existing `IMPORT_META_MODEL` case structure (line ~1034)
  - [x] 2.4 Ensure reducer tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify merge is additive and handles all three data categories (entities, relationships, diagrams)
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 4 tests from 2.1 all pass
- `MERGE_IMPORT` correctly appends entities, relationships, and diagrams without deleting existing data
- Empty payloads produce no state mutation
- Type definitions are correct and consistent with `MergeableData`

---

### Flow A: LandingPage Direct Load

#### Task Group 3: LandingPage Direct Load (No Active Project)
**Dependencies:** Task Group 1 (uses `validateSnapshotSchema`)

This group implements Flow A: when no active project exists, the user picks a JSON file from the LandingPage and it loads directly without any modal.

- [x] 3.0 Complete LandingPage direct load flow
  - [x] 3.1 Write 4 focused tests for LandingPage direct load
    - Test: valid JSON file triggers `LOAD_MODEL` dispatch without opening any modal
    - Test: `importProjectSnapshot` (DB mode) is called with implicit `setActive: true` and `overwriteExistingProject: true`
    - Test: `importToSession` (File Mode) is called instead of `importProjectSnapshot` when `includeDatabase` is false
    - Test: invalid JSON file shows inline error message on LandingPage (uses existing `errorMessage` state)
  - [x] 3.2 Refactor `LandingPage.handleFileChange` to use shared `validateSnapshotSchema`
    - Replace inline validation logic (lines ~109-130) with call to `validateSnapshotSchema` from `importMergeUtils.ts`
    - On validation failure, display errors via existing `setErrorMessage` pattern
  - [x] 3.3 Implement direct load logic (skip modal entirely)
    - After successful validation, do NOT open `ImportProjectSnapshotModal`
    - Remove `isImportModalOpen`, `pendingSnapshotName`, `pendingSnapshotJson` state variables
    - Remove the `<ImportProjectSnapshotModal>` JSX from LandingPage render
    - Instead, immediately:
      1. Dispatch `LOAD_MODEL` with `snapshot.model` and `fileName: snapshot.project.name`
      2. Call `importProjectSnapshot({ snapshot, setActive: true, overwriteExistingProject: true })` (DB mode) or `importToSession(...)` (File Mode)
      3. Call `refreshActiveProject()` after successful backend call
    - On API error, show inline error via `setErrorMessage`
  - [x] 3.4 Remove ImportProjectSnapshotModal import and references from LandingPage
    - Clean up unused imports: `ImportProjectSnapshotModal`, `ProjectSnapshotImportResultDto` (if no longer needed)
    - Remove `handleImportSuccess` callback (no longer needed since direct load handles everything inline)
  - [x] 3.5 Ensure LandingPage direct load tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify no modal opens for valid JSON files
    - Verify backend persistence is called correctly for both DB and File modes
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 4 tests from 3.1 all pass
- Valid JSON files load directly without any modal appearing
- Backend persistence works in both DB mode and File Mode
- Validation errors display inline on the LandingPage
- `ImportProjectSnapshotModal` is no longer referenced by LandingPage

---

### Flow B: Active Project Import Decision Modal

#### Task Group 4: Import Decision Modal (Save-and-Replace vs. Merge)
**Dependencies:** Task Group 1 (uses `validateSnapshotSchema`, `extractCherryPickData`), Task Group 2 (uses `MERGE_IMPORT` for merge path)

This group implements Flow B: the simplified modal shown when an active project exists. The user chooses between "Save and close, then load imported file" or "Merge imported data into current project."

- [x] 4.0 Complete import decision modal
  - [x] 4.1 Write 5 focused tests for the import decision modal
    - Test: modal renders with two radio options, first option selected by default
    - Test: modal shows imported project name as read-only header
    - Test: for XLSX imports, Option 1 ("Save and close") is hidden; modal skips to cherry-pick
    - Test: selecting Option 1 and confirming triggers save-and-replace flow (calls `saveModelToBackend`)
    - Test: selecting Option 2 and confirming opens the cherry-pick merge modal
  - [x] 4.2 Create `frontend/src/components/Import/ImportDecisionModal.tsx`
    - Props: `isOpen`, `onClose`, `importedProjectName: string`, `importSource: 'json' | 'xlsx'`, `onSaveAndReplace: () => void`, `onMerge: () => void`
    - Header: read-only display of imported project/file name
    - Two radio buttons (default: Option 1 selected):
      - Option 1: "Save and close current project, then load imported file" (hidden for XLSX)
      - Option 2: "Merge imported data into current project"
    - For XLSX: skip directly to `onMerge()` since Option 1 is not applicable
    - Footer: "Continue" (primary) and "Cancel" buttons
    - CSS module: `frontend/src/components/Import/ImportDecisionModal.module.css`
    - Follow styling patterns from existing `ImportProjectSnapshotModal.module.css`
  - [x] 4.3 Implement Save-and-Replace logic (Flow B Option 1, JSON only) in TopBar
    - Create `handleSaveAndReplace` function in TopBar:
      - **DB Mode:** Call `saveModelToBackend` for current project. If save fails (validation errors), abort import and show validation error modal. If save succeeds, call `importProjectSnapshot` with imported snapshot (implicit `setActive: true`, `overwriteExistingProject: true`), then dispatch `LOAD_MODEL`.
      - **File Mode:** Trigger JSON download via `buildLocalSnapshot` + `triggerDownload`, then load imported snapshot via `LOAD_MODEL` and call `importToSession`.
    - After successful load, call `refreshActiveProject()` and show success notification.
  - [x] 4.4 Refactor TopBar `handleFileChange` to use shared `validateSnapshotSchema` and new flow
    - Replace inline validation logic (lines ~672-696) with call to `validateSnapshotSchema`
    - After successful validation, open `ImportDecisionModal` instead of `ImportProjectSnapshotModal`
    - Store parsed snapshot in state for use by decision modal callbacks
  - [x] 4.5 Wire ImportDecisionModal into TopBar JSX
    - Add modal state: `isImportDecisionModalOpen`, `pendingImportSnapshot`, `pendingImportSource`
    - Render `<ImportDecisionModal>` with callbacks to `handleSaveAndReplace` and the cherry-pick modal opener
    - Remove old `<ImportProjectSnapshotModal>` usage from TopBar
  - [x] 4.6 Ensure import decision modal tests pass
    - Run ONLY the 5 tests written in 4.1
    - Verify radio button behavior and conditional rendering for JSON vs. XLSX
    - Verify save-and-replace flow triggers correct backend calls
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 5 tests from 4.1 all pass
- Import decision modal renders correctly for JSON (two options) and XLSX (skips to merge)
- Save-and-replace flow works for both DB mode and File Mode
- Save failure aborts the import and shows the validation error modal
- Old `ImportProjectSnapshotModal` is no longer used by TopBar

---

### Cherry-Pick Merge Modal

#### Task Group 5: Cherry-Pick Merge Modal (Domain-Tab UI)
**Dependencies:** Task Group 1 (uses `CherryPickData`, `extractCherryPickData`, `resolveIdConflicts`, `buildMergeSummary`), Task Group 2 (uses `MERGE_IMPORT` action)

This is the most complex UI piece. The cherry-pick merge modal uses the same domain-tab layout as `ContextPickerModal` (6 tabs: Business, Application, Data, Behavioural, UI, Diagrams) with Select All checkboxes per category and individual entity checkboxes. It also handles diagram dependency auto-selection and ID conflict resolution before dispatching the merge.

- [x] 5.0 Complete cherry-pick merge modal
  - [x] 5.1 Write 8 focused tests for the cherry-pick merge modal
    - Test: modal renders 6 domain tabs matching `ALL_DOMAINS` plus Diagrams tab
    - Test: each entity category shows "Select All" checkbox with entity count (e.g., "Applications (5)")
    - Test: empty categories (zero items in import) are hidden
    - Test: three-state checkbox logic uses `deriveCheckboxState` for indeterminate states (some items checked, some not)
    - Test: "Merge Selected" button is disabled when zero items are checked
    - Test: diagram checkbox auto-selects referenced entities from `diagram_nodes[].entity_id`
    - Test: unchecking a diagram un-selects auto-selected entities not referenced by any other checked diagram
    - Test: "Merge Selected" triggers `resolveIdConflicts` then dispatches `MERGE_IMPORT`
  - [x] 5.2 Create `frontend/src/components/Import/CherryPickMergeModal.tsx` shell with domain tabs
    - Props: `isOpen`, `onClose`, `cherryPickData: CherryPickData`, `currentModel: ArchitectureModel`, `onMergeComplete: (summary: string) => void`, `includeDatabase: boolean`
    - Reuse domain tab layout from `ContextPickerModal.tsx`:
      - Import `ALL_DOMAINS`, `DOMAIN_LABELS`, `DOMAIN_ICONS` from `architectureDomain.ts`
      - Import `DOMAIN_TO_ENTITY_TYPES`, `DOMAIN_TO_RELATIONSHIP_TYPES` from `contextPickerDomainMappings.ts`
    - Tab state: `activeTab` with type `ArchitectureDomain | 'diagrams'` (same as ContextPickerModal)
    - Create local `DomainTabStrip` or reuse pattern from ContextPickerModal (Business, Application, Data, Behavioural, UI, Diagrams)
    - CSS module: `frontend/src/components/Import/CherryPickMergeModal.module.css`
    - Base styles on `ContextPickerModal.module.css` patterns (tab strip, scrollable content area, footer)
  - [x] 5.3 Implement selection state management
    - Selection state: `Map<string, Set<string>>` keyed by collection key (e.g., `applications`, `services`), values are Sets of selected entity IDs
    - Diagram selection: `Set<string>` of selected diagram IDs
    - Track auto-selected entity IDs separately: `Set<string>` for diagram-dependency auto-selections (visual distinction)
    - Compute `totalSelectedCount` across all categories to enable/disable "Merge Selected" button
    - Use `deriveCheckboxState` from `frontend/src/utils/selectionUtils.ts` for category-level checkbox states
  - [x] 5.4 Implement entity category groups with Select All and individual checkboxes
    - For each domain tab, iterate `DOMAIN_TO_ENTITY_TYPES[domain]` and `DOMAIN_TO_RELATIONSHIP_TYPES[domain]`
    - For each collection key, render a category header with:
      - "Select All" checkbox (three-state via `deriveCheckboxState`)
      - Category label with count badge (e.g., "Applications (5)")
    - Below the header, render individual entity checkboxes with `entity.name` label
    - Hide categories where `cherryPickData.entities[key]` or `cherryPickData.relationships[key]` has zero items
    - Use the `ref` callback pattern from `EntityTypeGroup` in ContextPickerModal for setting `input.indeterminate`
  - [x] 5.5 Implement Diagrams tab
    - Render flat list of diagram checkboxes from `cherryPickData.diagrams` (JSON import only; XLSX has no diagrams)
    - Hide tab entirely if `cherryPickData.diagrams.length === 0`
    - Each diagram shows its `name` as label
  - [x] 5.6 Implement diagram dependency auto-selection
    - When a diagram checkbox is checked:
      1. Resolve all `entity_id` values from the diagram's `diagram_nodes` array
      2. For each referenced entity ID, find which collection key it belongs to in `cherryPickData.entities`
      3. Auto-check that entity and add its ID to the auto-selected tracking set
    - When a diagram is unchecked:
      1. Identify entities that were auto-selected for this diagram
      2. For each, check if any OTHER still-checked diagram also references it
      3. If not referenced by any other checked diagram, remove from auto-selected set and uncheck
    - Auto-selected entities should have a visual indicator (e.g., a small dependency badge or a subtle different background)
    - Manual entity selections should NOT be affected by diagram uncheck (only auto-selected ones)
  - [x] 5.7 Implement merge execution flow
    - "Merge Selected" button click handler:
      1. Gather all selected entity IDs, relationship IDs, and diagram IDs from selection state
      2. Build `MergeableData` from the selected items (extract full entity objects from `cherryPickData`)
      3. Call `resolveIdConflicts(selectedData, currentModel)` to get conflict-free data
      4. Dispatch `MERGE_IMPORT` action with the resolved data
      5. **DB Mode:** Call `saveModelToBackend` after dispatch to persist
      6. **File Mode:** No additional persistence needed (in-memory state updated by reducer)
      7. Call `onMergeComplete` with summary string from `buildMergeSummary`
    - Close modal after successful merge
  - [x] 5.8 Add modal footer with "Merge Selected" and "Cancel" buttons
    - "Merge Selected" disabled when `totalSelectedCount === 0`
    - "Merge Selected" shows loading state during merge execution
    - "Cancel" closes the modal without action
  - [x] 5.9 Ensure cherry-pick merge modal tests pass
    - Run ONLY the 8 tests written in 5.1
    - Verify domain tabs, checkbox logic, diagram auto-selection, and merge execution
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 8 tests from 5.1 all pass
- Six domain tabs render correctly with proper entity/relationship groupings
- Three-state checkbox logic works with `deriveCheckboxState`
- Empty categories are hidden
- Diagram dependency auto-selection works bidirectionally (check/uncheck)
- Merge execution calls `resolveIdConflicts`, dispatches `MERGE_IMPORT`, and persists appropriately
- "Merge Selected" is disabled when nothing is selected

---

### XLSX Import Redesign

#### Task Group 6: XLSX Import Redesign (Replace ImportModeModal with Cherry-Pick)
**Dependencies:** Task Group 1 (uses `convertXlsxResultToCherryPickData`), Task Group 4 (uses `ImportDecisionModal`), Task Group 5 (uses `CherryPickMergeModal`)

This group refactors the XLSX import flow to replace the old Append/Overwrite `ImportModeModal` with the new cherry-pick merge modal, providing a unified experience with JSON import.

- [x] 6.0 Complete XLSX import redesign
  - [x] 6.1 Write 4 focused tests for the XLSX import flow
    - Test: XLSX file selection triggers parsing via `importMetaModelFromExcel`, then shows `ImportDecisionModal` (which auto-skips to merge for XLSX)
    - Test: parsed XLSX data is converted via `convertXlsxResultToCherryPickData` and populates the cherry-pick modal
    - Test: cherry-pick modal for XLSX has no Diagrams tab content (XLSX has no diagrams)
    - Test: merge from XLSX dispatches `MERGE_IMPORT` with selected entities only (no relationships/diagrams)
  - [x] 6.2 Refactor TopBar XLSX import handler
    - Modify `handleXlsxFileChange` (the XLSX file input handler in TopBar):
      1. Parse file via `importMetaModelFromExcel(file, state.model, 'append')` (use 'append' mode to get all new entities without overwriting)
      2. Convert result via `convertXlsxResultToCherryPickData`
      3. Store `CherryPickData` in state
      4. Open `ImportDecisionModal` with `importSource: 'xlsx'` (which auto-skips to cherry-pick for XLSX)
    - Remove direct `dispatch({ type: 'IMPORT_META_MODEL', ... })` call from `executeXlsxImport`
    - Remove `ImportModeModal` state and integration: `isImportModeModalOpen`, `pendingXlsxFile`, `handleImportModeClose`, `handleImportModeSelect`
  - [x] 6.3 Remove ImportModeModal component and references
    - Remove `<ImportModeModal>` from TopBar JSX
    - Remove import of `ImportModeModal` and `ImportMode` from TopBar
    - Remove `ImportSummaryModal` usage for XLSX import results (no longer needed; merge summary notification replaces it)
    - Note: Do not delete the `ImportModeModal.tsx` and `ImportSummaryModal.tsx` source files yet -- just remove references from TopBar. Cleanup of unused files is a separate task.
  - [x] 6.4 Wire XLSX flow through ImportDecisionModal to CherryPickMergeModal
    - When `ImportDecisionModal` receives `importSource: 'xlsx'`, it calls `onMerge()` immediately (Option 1 hidden for XLSX)
    - `onMerge` callback opens `CherryPickMergeModal` populated with XLSX-derived `CherryPickData`
    - After merge completes, show success notification with merge summary
  - [x] 6.5 Ensure XLSX import tests pass
    - Run ONLY the 4 tests written in 6.1
    - Verify XLSX parsing flows through to cherry-pick modal correctly
    - Verify ImportModeModal is no longer rendered
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- The 4 tests from 6.1 all pass
- XLSX import uses the same cherry-pick merge modal as JSON import
- ImportModeModal is no longer referenced or rendered
- XLSX-parsed entities appear correctly in the cherry-pick UI with proper domain groupings
- Merge from XLSX persists correctly in both DB mode and File Mode

---

### Cleanup & Integration Testing

#### Task Group 7: Cleanup and Test Review
**Dependencies:** Task Groups 1-6

This group handles removal of obsolete code, integration verification, and test coverage gap analysis.

- [x] 7.0 Complete cleanup and integration testing
  - [x] 7.1 Remove obsolete UI elements and dead code
    - Remove "Override Product Name/Folder?" checkbox and conditional inputs from `ImportProjectSnapshotModal`
    - Remove "Project Parent Folder" field
    - Remove "Import As Name" field
    - Remove "Make imported project active" checkbox
    - Remove "Overwrite existing project?" checkbox
    - If `ImportProjectSnapshotModal` is no longer used anywhere after Task Groups 3-4, mark the component file as deprecated or remove it entirely
    - Remove the `ImportModeModal.tsx` component file (if confirmed unused after Task Group 6)
    - Clean up any orphaned CSS module files for removed components
  - [x] 7.2 Verify all import entry points are correctly wired
    - LandingPage "Import JSON" card -> Flow A (direct load, no modal)
    - TopBar "Import as JSON" menu item -> Flow B (ImportDecisionModal)
    - TopBar "Import as XLSX" menu item -> Flow B (ImportDecisionModal, auto-skips to cherry-pick)
    - Verify File Mode (`includeDatabase=false`) branching works for all three flows
  - [x] 7.3 Review existing tests from Task Groups 1-6
    - Review the 6 tests from Task Group 1 (import utilities)
    - Review the 4 tests from Task Group 2 (reducer)
    - Review the 4 tests from Task Group 3 (LandingPage direct load)
    - Review the 5 tests from Task Group 4 (import decision modal)
    - Review the 8 tests from Task Group 5 (cherry-pick merge modal)
    - Review the 4 tests from Task Group 6 (XLSX redesign)
    - Total existing tests: 31
  - [x] 7.4 Analyze test coverage gaps for this feature
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's import redesign
    - Prioritize end-to-end flow tests over unit test gaps
  - [x] 7.5 Write up to 8 additional tests to fill critical gaps
    - Potential gaps to consider:
      - End-to-end: JSON import from LandingPage with DB persistence and project refresh
      - End-to-end: JSON import from TopBar -> Save-and-Replace -> model loads correctly
      - End-to-end: JSON import from TopBar -> Merge -> cherry-pick -> verify model state after merge
      - End-to-end: XLSX import from TopBar -> cherry-pick -> verify model state after merge
      - File Mode: Save-and-replace triggers JSON download before loading imported snapshot
      - Error path: Save failure during save-and-replace aborts import
      - Error path: API error during LandingPage direct load shows inline error
      - Diagram auto-selection: complex scenario with multiple diagrams sharing entity references
    - Maximum 8 additional tests
  - [x] 7.6 Run all feature-specific tests
    - Run ALL tests written across Task Groups 1-7 (approximately 31-39 tests total)
    - Verify all pass
    - Do NOT run the entire application test suite
  - [x] 7.7 Verify post-merge summary notification
    - After merge, notification shows counts (e.g., "Merged 3 applications, 2 services, 1 diagram")
    - Notification auto-dismisses after a timeout (follow existing `setNotification` + `setTimeout` pattern in TopBar)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-39 tests total)
- No dead code from the old import flow remains
- All import entry points work correctly for both DB mode and File Mode
- Critical user workflows for this feature are covered by tests
- Post-merge summary notification displays correctly

---

## Execution Order

The recommended implementation sequence, accounting for dependencies:

```
Phase 1 (Foundation - no dependencies):
  Task Group 1: Shared Import Utilities and ID Conflict Resolution

Phase 2 (can run in parallel - both depend only on TG1):
  Task Group 2: Extend IMPORT_META_MODEL Reducer
  Task Group 3: LandingPage Direct Load (Flow A)

Phase 3 (depends on TG1, TG2):
  Task Group 4: Import Decision Modal (Flow B)

Phase 4 (depends on TG1, TG2, TG4):
  Task Group 5: Cherry-Pick Merge Modal (Flow C)

Phase 5 (depends on TG1, TG4, TG5):
  Task Group 6: XLSX Import Redesign

Phase 6 (depends on all):
  Task Group 7: Cleanup and Test Review
```

**Parallelization opportunities:**
- Task Groups 2 and 3 can be implemented simultaneously after Task Group 1 completes
- Task Group 3 (LandingPage) is independent of Task Groups 4-6 (TopBar flows) and could be deployed separately

**Key files created by this spec:**
- `frontend/src/utils/importMergeUtils.ts` (TG1: shared utilities)
- `frontend/src/components/Import/ImportDecisionModal.tsx` (TG4: decision modal)
- `frontend/src/components/Import/ImportDecisionModal.module.css` (TG4: styles)
- `frontend/src/components/Import/CherryPickMergeModal.tsx` (TG5: cherry-pick modal)
- `frontend/src/components/Import/CherryPickMergeModal.module.css` (TG5: styles)

**Key files modified by this spec:**
- `frontend/src/components/LandingPage/LandingPage.tsx` (TG3: remove modal, add direct load)
- `frontend/src/components/TopBar/TopBar.tsx` (TG4, TG6: replace old modal, refactor XLSX flow)
- `frontend/src/contexts/ArchitectureContext.tsx` (TG2: add MERGE_IMPORT action)

**Key files removed or deprecated by this spec:**
- `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (replaced by new flows)
- `frontend/src/components/Import/ImportModeModal.tsx` (replaced by cherry-pick merge)
- References to `ImportSummaryModal` from XLSX flow (replaced by merge summary notification)
