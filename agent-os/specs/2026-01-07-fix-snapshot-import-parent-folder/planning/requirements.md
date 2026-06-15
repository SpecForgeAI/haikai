# Fix Snapshot Import to Use projectParentFolder from JSON Unless Override is Enabled

## Title
Fix snapshot import to use projectParentFolder from JSON unless override is enabled

## Intent
- When importing a project snapshot JSON, do not require the user to re-enter Project Name or Project Parent Folder if the snapshot already contains them and "Override Project Name/Folder?" is unchecked.
- Use the values from the imported snapshot's `project` object by default.
- Only require manual input when override is explicitly enabled.

## Scope
- Frontend import dialog + import request construction.
- No backend or schema changes.

## Constraints
- Snapshot JSON remains the source of truth unless override is enabled.
- Validation must align exactly with the override toggle state.
- No change to backend import endpoint contract.

## Work

### 1) Update Import Project Snapshot dialog validation logic
- In the import dialog component:
  - If `overrideProjectNameFolder === false`:
    - Do NOT require `projectName` input.
    - Do NOT require `projectParentFolder` input.
    - Suppress validation errors for both fields.
  - If `overrideProjectNameFolder === true`:
    - Require both `projectName` and `projectParentFolder`.
    - Show validation errors as today.

### 2) Default values behavior
- On file selection and JSON parse:
  - Read `project.name` and `project.projectParentFolder` from the snapshot.
  - Store them in local state as the effective defaults.
- When override is unchecked:
  - Inputs may be hidden or disabled (existing UX choice), but must not block submission.

### 3) Import request construction
- When submitting import:
  - If override is unchecked:
    - Do NOT send override name/folder fields.
    - Rely on backend using snapshot's `project.projectParentFolder`.
  - If override is checked:
    - Send explicitly provided `projectName` and `projectParentFolder`.

### 4) Regression tests
- Add frontend tests to verify:
  - Import succeeds with override unchecked and no manual folder input.
  - Validation error appears only when override is checked and folder is missing.
  - Snapshot `projectParentFolder` is preserved when override is unchecked.

## Acceptance Criteria
- Import dialog allows import without specifying project name or folder when override is unchecked.
- "Project parent folder is required" error only appears when override is enabled.
- Imported project uses the `project.projectParentFolder` from the snapshot JSON by default.
