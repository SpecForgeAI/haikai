# Specification: Fix Snapshot Import Dialog Validation

## Goal
Fix the ImportProjectSnapshotModal component to correctly use projectParentFolder from the snapshot JSON when the "Override Project Name/Folder?" checkbox is unchecked, eliminating unnecessary validation errors and manual input requirements.

## User Stories
- As a user, I want to import a project snapshot without re-entering the Project Name or Project Parent Folder when the snapshot already contains them
- As a user, I only want to see validation errors for name/folder fields when I have explicitly enabled the override option

## Specific Requirements

**Conditional Validation Based on Override Toggle**
- When `overrideNameFolder === false`: disable validation for `projectName` and `projectParentFolder` inputs
- When `overrideNameFolder === false`: import button remains enabled regardless of input field state
- When `overrideNameFolder === true`: validate that both `projectName` and `projectParentFolder` are provided if user intends to override
- Validation logic: `isFormValid = rawSnapshotJson != null` when override is unchecked; add field checks only when override is checked

**Input Field Visibility Behavior**
- When override unchecked: hide both "Import As Name" and "Project Parent Folder" input fields entirely
- When override checked: show both input fields and pre-fill with values from `snapshot.project.name` and `snapshot.project.projectParentFolder`
- Pre-fill logic triggers via useEffect when `overrideNameFolder` toggles to true
- Clear pre-filled values when modal closes and reopens (via isOpen useEffect reset)

**Import Request Construction Logic**
- When override unchecked: omit `importAsName` and `projectParentFolder` from request body entirely
- When override checked with empty values: omit fields (treat empty as "not overriding")
- When override checked with non-empty values: include trimmed values in request body
- Request payload uses conditional spread: `...(overrideNameFolder && trimmedValue !== '' ? { field: trimmedValue } : {})`

**Snapshot Default Values Extraction**
- On JSON file parse in TopBar, extract `project.name` for display in "Original Name" read-only field
- Store parsed snapshot JSON in `pendingSnapshotJson` state for passing to modal
- Modal receives `snapshotProjectName` and `rawSnapshotJson` as props for default value access

**Test Coverage for Validation Behavior**
- Test: Import button enabled when override unchecked and no manual input provided
- Test: Import request omits `importAsName` and `projectParentFolder` when override unchecked
- Test: Validation error only appears when override checked and required field missing
- Test: Snapshot `projectParentFolder` preserved in request body snapshot for backend fallback
- Test: Pre-fill works correctly when override toggled on

## Existing Code to Leverage

**ImportProjectSnapshotModal.tsx (lines 133-136)**
- Validation logic: `const isFormValid = rawSnapshotJson != null`
- Already implements no-validation-when-override-unchecked pattern
- Keep this approach for field validation bypass

**ImportProjectSnapshotModal.tsx (lines 157-163)**
- Request construction with conditional spread operators
- Pattern: `...(overrideNameFolder && trimmedFolder !== '' ? { projectParentFolder: trimmedFolder } : {})`
- Ensures fields omitted unless override enabled AND value non-empty

**projectSnapshotApi.ts (lines 240-246)**
- API client conditionally includes fields: `if (req.projectParentFolder !== undefined && req.projectParentFolder !== '')`
- Double-gate ensures empty strings never sent to backend
- Backend then falls back to `snapshot.project.projectParentFolder`

**ImportProjectSnapshotModal.test.tsx (tests 5-6)**
- Existing tests verify button enabled when override unchecked
- Existing tests verify request omits name/folder when override unchecked
- Extend with edge cases for validation error suppression

**TopBar.tsx handleFileChange (lines 189-231)**
- Parses JSON and extracts `snapshotProjectName` from `parsedSnapshot.project.name`
- Stores full `parsedSnapshot` in `pendingSnapshotJson` for modal access
- Pattern established for snapshot data extraction

## Out of Scope
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
