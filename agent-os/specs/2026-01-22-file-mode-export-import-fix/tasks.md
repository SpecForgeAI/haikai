# Task Breakdown: File Mode JSON Export/Import Fix

## Overview

**Spec ID:** 2026-01-22-file-mode-export-import-fix
**Total Tasks:** 16
**Estimated Effort:** Small (frontend-only changes)

This task breakdown addresses the broken JSON export/import round-trip in File Mode:
- **Export Problem:** Currently exports stale backend data instead of current UI state
- **Import Problem:** Tries to load model via DB endpoint which fails in File Mode

---

## Task List

### Frontend Layer

#### Task Group 1: Fix File Mode JSON Export
**Dependencies:** None

- [x] 1.0 Complete File Mode JSON export fix
  - [x] 1.1 Write 3-5 focused tests for export functionality
    - **File:** `frontend/src/__tests__/TopBar.file-mode-export.test.tsx`
    - Test `buildLocalSnapshot` includes current ArchitectureContext model state
    - Test `executeJsonExport` uses local snapshot when `includeDatabase=false`
    - Test `executeJsonExport` uses backend endpoint when `includeDatabase=true`
    - Test exported JSON contains correct meta fields (version, exported_at, export_kind)
    - Mock ArchitectureContext with test model data (e.g., Business User entity)
  - [x] 1.2 Add `buildLocalSnapshot(projectName)` function to TopBar.tsx
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
    - Function signature: `const buildLocalSnapshot = (projectName: string): ProjectSnapshotDto`
    - Build snapshot with:
      - `meta.snapshot_version: 1`
      - `meta.exported_at: new Date().toISOString()`
      - `meta.export_kind: 'session'`
    - Use `activeProject` from ProjectContext if available, otherwise synthesize:
      - `id: crypto.randomUUID()`
      - `name: projectName`
      - `project_parent_folder: null`
      - `project_hierarchy: null`
      - `organisation_id: null`
      - `is_active: true`
      - `created_at/updated_at: new Date().toISOString()`
    - Set `model: state.model` (from ArchitectureContext - contains metaModel + diagrams)
    - Set `work_items: []` and `artifacts: []` (empty in File Mode)
  - [x] 1.3 Update `executeJsonExport()` to use `buildLocalSnapshot()` in File Mode
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
    - **Location:** Lines 385-417 (current `executeJsonExport` function)
    - When `includeDatabase=false`: call `buildLocalSnapshot(projectName)` instead of `exportSessionSnapshot()`
    - When `includeDatabase=true`: keep existing `exportActiveProjectSnapshot()` call
    - Remove the null check for session snapshot (local snapshot is always valid)
  - [x] 1.4 Ensure export tests pass
    - Run ONLY the 3-5 tests written in 1.1
    - Verify `buildLocalSnapshot` returns correct structure
    - Verify mode-based routing works correctly

**Acceptance Criteria:**
- The 3-5 tests written in 1.1 pass
- In File Mode, exported JSON contains current UI model state
- In DB Mode, existing backend export behavior unchanged
- Exported snapshot has correct meta fields

---

#### Task Group 2: Fix File Mode JSON Import - Modal Callback
**Dependencies:** Task Group 1

- [x] 2.0 Complete import modal callback update
  - [x] 2.1 Write 2-3 focused tests for modal callback
    - **File:** `frontend/src/__tests__/ImportProjectSnapshotModal.callback.test.tsx`
    - Test `onImported` callback receives all three parameters (result, setActive, snapshot)
    - Test `pendingSnapshotJson` is passed to callback on successful import
    - Mock the import API responses
  - [x] 2.2 Update `ImportProjectSnapshotModalProps` interface
    - **File:** `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
    - **Location:** Lines 56-74 (props interface)
    - Change callback signature from:
      ```typescript
      onImported: (result: ProjectSnapshotImportResultDto, setActive: boolean) => void;
      ```
    - To:
      ```typescript
      onImported: (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean,
        snapshot: ProjectSnapshotDto
      ) => void;
      ```
  - [x] 2.3 Update `handleImport()` to pass snapshot to callback
    - **File:** `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
    - **Location:** Line 283 (onImported call)
    - Change from: `onImported(result, setActive);`
    - To: `onImported(result, setActive, rawSnapshotJson);`
    - The `rawSnapshotJson` prop contains the parsed snapshot with model data
  - [x] 2.4 Ensure modal callback tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify callback receives snapshot parameter

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- `onImported` callback includes snapshot as third parameter
- No changes to modal UI or other behavior

---

#### Task Group 3: Fix File Mode JSON Import - Success Handler
**Dependencies:** Task Group 2

- [x] 3.0 Complete import success handler update
  - [x] 3.1 Write 3-4 focused tests for import success behavior
    - **File:** `frontend/src/__tests__/TopBar.file-mode-import.test.tsx`
    - Test `handleImportSuccess` dispatches `LOAD_MODEL` with snapshot.model in File Mode
    - Test `handleImportSuccess` calls `loadModelByFilename` in DB Mode
    - Test `handleImportSuccess` handles missing model in snapshot gracefully
    - Test model is loaded into ArchitectureContext after import
    - Mock dispatch function and verify LOAD_MODEL action payload
  - [x] 3.2 Update `handleImportSuccess` signature to accept snapshot
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
    - **Location:** Lines 533-558 (handleImportSuccess function)
    - Change signature from:
      ```typescript
      const handleImportSuccess = async (result: ProjectSnapshotImportResultDto, setActive: boolean)
      ```
    - To:
      ```typescript
      const handleImportSuccess = async (
        result: ProjectSnapshotImportResultDto,
        setActive: boolean,
        snapshot: ProjectSnapshotDto
      )
      ```
  - [x] 3.3 Implement mode-aware model loading logic
    - **File:** `frontend/src/components/TopBar/TopBar.tsx`
    - **Location:** Inside `handleImportSuccess` function
    - When `setActive=true`:
      - Always call `refreshActiveProject()` first
      - If `includeDatabase=true` (DB Mode):
        - Keep existing: `await loadModelByFilename(result.project.name)`
        - Dispatch `LOAD_MODEL` with loaded model
      - If `includeDatabase=false` (File Mode):
        - Use `snapshot.model` directly
        - Add null check: `if (snapshot.model) { ... }`
        - Dispatch: `dispatch({ type: 'LOAD_MODEL', payload: snapshot.model, fileName: result.project.name })`
        - Log warning if snapshot.model is null
  - [x] 3.4 Ensure import success tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify mode-based loading works correctly
    - Verify LOAD_MODEL is dispatched with correct payload

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- In File Mode, model loads directly from snapshot into ArchitectureContext
- In DB Mode, existing loadModelByFilename behavior unchanged
- UI immediately reflects imported entities/diagrams

---

#### Task Group 4: Integration Testing and Verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration testing and gap analysis
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 3-5 export tests (Task 1.1)
    - Review the 2-3 modal callback tests (Task 2.1)
    - Review the 3-4 import success tests (Task 3.1)
    - Total existing tests: approximately 8-12 tests
  - [x] 4.2 Write up to 5 additional integration tests
    - **File:** `frontend/src/__tests__/file-mode-roundtrip.test.tsx`
    - Test export/import round-trip preserves model content:
      - Start with model containing Business User entity
      - Export to JSON via `buildLocalSnapshot`
      - Clear/reset state
      - Import the exported JSON
      - Verify Business User entity is restored
    - Test round-trip preserves diagrams array
    - Test round-trip with empty model (edge case)
    - Test DB mode still works correctly (regression)
    - Test File Mode indicator displays correctly
  - [x] 4.3 Run all feature-specific tests
    - Run tests from 1.1, 2.1, 3.1, and 4.2
    - Expected total: approximately 13-17 tests
    - Do NOT run the entire application test suite
    - Verify all tests pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 13-17 tests total)
- Export -> Import round-trip preserves model content
- DB Mode behavior unchanged (regression verified)
- File Mode indicator displays when `includeDatabase=false`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Fix File Mode JSON Export** (Foundation)
   - Implement `buildLocalSnapshot` function
   - Update `executeJsonExport` routing
   - This enables File Mode to export current UI state

2. **Task Group 2: Fix File Mode JSON Import - Modal Callback** (Interface Change)
   - Update props interface
   - Pass snapshot to callback
   - This enables the success handler to receive snapshot data

3. **Task Group 3: Fix File Mode JSON Import - Success Handler** (Complete Fix)
   - Update handler signature
   - Implement mode-aware loading
   - This completes the File Mode import fix

4. **Task Group 4: Integration Testing** (Verification)
   - Round-trip testing
   - Regression testing
   - Final verification

---

## Files Summary

| File | Task Groups | Changes |
|------|-------------|---------|
| `frontend/src/components/TopBar/TopBar.tsx` | 1, 3 | Add `buildLocalSnapshot()`, update `executeJsonExport()`, update `handleImportSuccess()` |
| `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` | 2 | Update `onImported` callback signature to include snapshot |
| `frontend/src/__tests__/TopBar.file-mode-export.test.tsx` | 1 | New test file for export functionality |
| `frontend/src/__tests__/ImportProjectSnapshotModal.callback.test.tsx` | 2 | New test file for modal callback |
| `frontend/src/__tests__/TopBar.file-mode-import.test.tsx` | 3 | New test file for import functionality |
| `frontend/src/__tests__/file-mode-roundtrip.test.tsx` | 4 | New test file for integration testing |

---

## Key Implementation Notes

1. **Use existing LOAD_MODEL action** - ArchitectureContext already handles this correctly
2. **No backend changes required** - This is a frontend-only fix
3. **Maintain DB mode behavior** - All DB mode code paths remain unchanged
4. **state.model structure** - Contains `metaModel` (entities, relationships) and `diagrams`
5. **activeProject from ProjectContext** - Use if available, synthesize if not
6. **pendingSnapshotJson in modal** - Already holds parsed snapshot, just pass it through

---

## Risk Mitigation

- **Callback signature change:** Search for all usages of `onImported` callback and update them
- **Null check for snapshot.model:** Add defensive check in `handleImportSuccess`
- **Type safety:** Ensure `ProjectSnapshotDto` type includes model field correctly

---

## Implementation Complete

All 4 task groups have been implemented and tested:
- **32 tests pass** across all feature-specific test files
- File Mode JSON export now uses `buildLocalSnapshot()` to capture current UI state
- File Mode JSON import now loads model directly from snapshot
- DB Mode behavior remains unchanged (verified via tests)
