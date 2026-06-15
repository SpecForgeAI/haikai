# Task Breakdown: Fix Snapshot Import Dialog Validation

## Overview
Total Tasks: 3 Task Groups, 16 Sub-Tasks
Estimated Complexity: Low (frontend-only verification and minor refinement)

## Summary
This spec addresses a validation UX issue in the ImportProjectSnapshotModal component. When the "Override Project Name/Folder?" checkbox is unchecked, the modal should not require or validate the projectName and projectParentFolder inputs, as the backend will use values from the snapshot JSON.

Based on code review, the existing implementation already implements the correct behavior. The primary work is verification and ensuring comprehensive test coverage.

## Task List

### Frontend Validation Logic

#### Task Group 1: Verify and Validate Import Modal Behavior
**Dependencies:** None

- [x] 1.0 Complete validation logic verification
  - [x] 1.1 Write 4-6 focused tests for validation behavior
    - Test: Import button enabled when override unchecked and no manual input provided
    - Test: Import request omits `importAsName` and `projectParentFolder` when override unchecked
    - Test: Snapshot `projectParentFolder` preserved in snapshot payload for backend fallback
    - Test: Form is valid when only `rawSnapshotJson` is provided (no field validation)
    - Test: Override toggle does not affect form validity (button stays enabled)
    - Test: Empty string values in override fields are treated as "not overriding"
  - [x] 1.2 Verify existing validation logic in ImportProjectSnapshotModal.tsx
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (line 136)
    - Confirm: `const isFormValid = rawSnapshotJson != null`
    - Confirm: No additional field validation when override is unchecked
    - Confirm: Import button disabled attribute uses only `isFormValid` and `isSubmitting`
  - [x] 1.3 Verify input field visibility behavior
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 273-314)
    - Confirm: `{overrideNameFolder && (...)}` conditional rendering hides inputs when unchecked
    - Confirm: Both "Import As Name" and "Project Parent Folder" inputs are hidden by default
    - Confirm: Original Name display is always visible
  - [x] 1.4 Verify request construction logic in handleImport
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 157-163)
    - Confirm: `...(overrideNameFolder && trimmedName !== '' ? { importAsName: trimmedName } : {})`
    - Confirm: `...(overrideNameFolder && trimmedFolder !== '' ? { projectParentFolder: trimmedFolder } : {})`
    - Confirm: Fields are omitted (not sent as empty strings) when override is unchecked
  - [x] 1.5 Ensure validation tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all validation scenarios work as expected
    - Command: `npm test -- --testPathPattern="ImportProjectSnapshotModal|SnapshotImportParentFolder"`

**Acceptance Criteria:**
- Import button is enabled when snapshot is loaded and override is unchecked
- No validation errors appear for name/folder fields when override is unchecked
- Import request omits `importAsName` and `projectParentFolder` when override is unchecked
- Backend receives snapshot with embedded `project.projectParentFolder` as fallback source

**Key Files:**
- `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 133-136, 157-163, 273-314)
- `frontend/src/__tests__/ImportProjectSnapshotModal.test.tsx`

---

### Frontend Pre-fill and State Management

#### Task Group 2: Verify Pre-fill and Reset Behavior
**Dependencies:** Task Group 1

- [x] 2.0 Complete pre-fill and state management verification
  - [x] 2.1 Write 2-4 focused tests for pre-fill behavior
    - Test: Name input pre-fills with `snapshotProjectName` when override toggled on
    - Test: Folder input pre-fills with `rawSnapshotJson.project.projectParentFolder` when override toggled on
    - Test: Pre-filled values can be edited by user
    - Test: All fields reset when modal is closed and reopened
  - [x] 2.2 Verify useEffect for pre-fill logic
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 94-110)
    - Confirm: Pre-fill triggers only when `overrideNameFolder` changes to true
    - Confirm: Pre-fill only applies when fields are empty (`importAsName === ''`)
    - Confirm: Focus moves to name input after pre-fill
  - [x] 2.3 Verify useEffect for modal reset
    - File: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 79-89)
    - Confirm: All form state resets when `isOpen` changes to true
    - Confirm: `setImportAsName('')`, `setProjectParentFolder('')`, `setOverrideNameFolder(false)`
  - [x] 2.4 Ensure pre-fill tests pass
    - Run ONLY the 2-4 tests written in 2.1
    - Verify pre-fill and reset work as expected
    - Command: `npm test -- --testPathPattern="ImportProjectSnapshotModal" --testNamePattern="pre-fill|reset"`

**Acceptance Criteria:**
- When override checkbox is checked, name input pre-fills with snapshot project name
- When override checkbox is checked, folder input pre-fills with snapshot parent folder
- Pre-filled values are editable
- All fields reset to default when modal is reopened

**Key Files:**
- `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` (lines 79-110)
- `frontend/src/__tests__/ImportProjectSnapshotModal.test.tsx`

---

### Test Review and Gap Analysis

#### Task Group 3: Test Coverage Verification and Gap Filling
**Dependencies:** Task Groups 1-2

- [x] 3.0 Review existing tests and fill critical gaps only
  - [x] 3.1 Review existing tests in ImportProjectSnapshotModal.test.tsx
    - File: `frontend/src/__tests__/ImportProjectSnapshotModal.test.tsx`
    - Review Test 1: Override checkbox renders unchecked by default (3 tests)
    - Review Test 2: Name/folder inputs hidden when override unchecked (3 tests)
    - Review Test 3: Name/folder inputs appear when override checked (3 tests)
    - Review Test 4: Pre-fill with snapshot values when override toggled (3 tests)
    - Review Test 5: Import button enabled when snapshot loaded (3 tests)
    - Review Test 6: Import request omits name/folder when override unchecked (3 tests)
    - Review Test 7: onImported callback receives (result, setActive) (3 tests)
    - Review Additional edge cases (4 tests)
    - Total existing tests: approximately 25 test cases
  - [x] 3.2 Analyze test coverage gaps for THIS feature only
    - Check if validation error suppression scenarios are fully tested
    - Verify tests cover specific acceptance criteria from spec:
      1. Import succeeds without specifying name/folder when override unchecked
      2. "Project parent folder is required" error only appears when override enabled
      3. Imported project uses `project.projectParentFolder` from snapshot JSON
    - Focus ONLY on gaps related to this spec's feature requirements
  - [x] 3.3 Write up to 4 additional strategic tests if gaps found
    - Add tests for any missing critical validation scenarios
    - Focus on the specific bug scenario: import without manual input when override unchecked
    - Do NOT add exhaustive edge case coverage
    - Potential gap tests:
      1. Test: No validation error shown when override unchecked (error message element absent)
      2. Test: Snapshot projectParentFolder is not lost during request construction
      3. Test: API client receives correct payload structure
  - [x] 3.4 Run feature-specific tests only
    - Run ONLY tests in ImportProjectSnapshotModal.test.tsx
    - Run ONLY tests in SnapshotImportParentFolderIntegration.test.ts (if exists)
    - Command: `npm test -- --testPathPattern="ImportProjectSnapshotModal|SnapshotImportParentFolder|projectSnapshotApi"`
    - Expected total: approximately 30-40 tests
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All existing ImportProjectSnapshotModal tests pass
- Test coverage confirms validation behavior matches spec requirements
- No more than 4 additional tests added for gap filling
- Feature-specific tests demonstrate correct behavior

**Key Test Files:**
- `frontend/src/__tests__/ImportProjectSnapshotModal.test.tsx` (primary)
- `frontend/src/__tests__/SnapshotImportParentFolderIntegration.test.ts` (integration)
- `frontend/src/__tests__/projectSnapshotApi.test.ts` (API layer)

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Sequential):
  Task Group 1: Verify Validation Logic (core functionality)
  |
  v
Phase 2 (Sequential):
  Task Group 2: Verify Pre-fill Behavior (UX behavior)
  |
  v
Phase 3 (Final):
  Task Group 3: Test Coverage Verification (quality assurance)
```

---

## Files to Verify (No Changes Expected)

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/components/Project/ImportProjectSnapshotModal.tsx` | Verify | Confirm validation and pre-fill logic is correct |
| `frontend/src/api/projectSnapshotApi.ts` | Verify | Confirm request construction and field omission |
| `frontend/src/__tests__/ImportProjectSnapshotModal.test.tsx` | Verify/Update | Review and extend test coverage if gaps found |

---

## Out of Scope (from spec)

- Backend changes to import endpoint or validation
- Changes to snapshot JSON schema or structure
- Snapshot export functionality modifications
- Work item or artifact import logic
- Project activation/auto-open behavior after import
- New modal UI components or styling changes
- Batch import functionality
- Override checkbox label or positioning changes
- "Make imported project active" checkbox behavior
- Error modal or notification toast changes

---

## Implementation Notes

Based on code review, the existing implementation in `ImportProjectSnapshotModal.tsx` already implements the correct behavior:

1. **Line 136**: `const isFormValid = rawSnapshotJson != null`
   - No field validation when override unchecked - CORRECT

2. **Lines 273-314**: Conditional rendering with `{overrideNameFolder && (...)}`
   - Inputs are hidden when override is unchecked - CORRECT

3. **Lines 161-162**: Request construction with conditional spread operators
   - Fields omitted when override unchecked OR values empty - CORRECT

4. **Lines 240-246** in projectSnapshotApi.ts: Double-gate validation
   - `if (req.field !== undefined && req.field !== '')` - CORRECT

The primary task is to **verify** this behavior works correctly through testing and ensure comprehensive test coverage. If verification reveals any issues, minimal code changes may be needed.

---

## Existing Test Coverage Summary

From `ImportProjectSnapshotModal.test.tsx`:

| Test Group | Test Count | Coverage |
|------------|------------|----------|
| Override checkbox default state | 3 | Override unchecked by default |
| Input visibility when unchecked | 3 | Name/folder inputs hidden |
| Input visibility when checked | 3 | Name/folder inputs appear |
| Pre-fill behavior | 3 | Snapshot values pre-fill fields |
| Import button enabled | 3 | Button enabled when snapshot loaded |
| Request omits fields | 3 | Name/folder omitted when unchecked |
| Callback receives result | 3 | (result, setActive) parameters |
| Task Group 1: Validation behavior | 6 | No validation errors, button always enabled |
| Task Group 2: Pre-fill and reset | 5 | Pre-fill with snapshot values, reset on reopen |
| Additional edge cases | 3 | Reset on reopen, error handling |
| **Total** | **35** | Core functionality covered |

---

## Risk Assessment

**Low Risk**: The existing implementation appears correct based on code review. The tasks are primarily verification-focused.

**Key Verification Points:**
1. Import button stays enabled when override is unchecked
2. No validation errors appear for hidden fields
3. Request payload correctly omits optional fields
4. Backend receives snapshot with embedded projectParentFolder

---

## Implementation Complete

**Date:** 2026-01-07

**Test Results:**
- ImportProjectSnapshotModal.test.tsx: 35 tests passed
- SnapshotImportParentFolderIntegration.test.ts: 12 tests passed
- projectSnapshotApi.test.ts: 20 tests passed
- **Total: 67 tests passed**

**Verification Summary:**
- All validation logic confirmed correct in ImportProjectSnapshotModal.tsx
- All pre-fill and reset behavior confirmed correct
- All request construction logic confirmed correct
- All acceptance criteria met
