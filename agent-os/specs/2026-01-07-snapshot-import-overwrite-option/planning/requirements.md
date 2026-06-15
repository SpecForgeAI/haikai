# Add "Overwrite existing project?" option to snapshot import (project identity by name; full replacement)

## Title
Add "Overwrite existing project?" option to snapshot import (project identity by name; full replacement)

## Intent
- Extend "Import Project Snapshot" so that project name uniqueness is enforced by default, but users can explicitly opt in to overwriting an existing project with the same name.
- Project equality for overwrite is based on project name alone.
- Overwrite is a full replacement (not a merge): existing project data is removed and replaced by the imported snapshot.

## Scope
- Frontend: Import Project Snapshot dialog UX + validation + request payload.
- Backend: Snapshot import endpoint and import service logic to support overwrite-by-name.
- Tests: frontend + backend.

## Constraints
- Safe-by-default: overwrite checkbox is OFF by default, and import must be blocked on name conflict unless overwrite is enabled.
- Overwrite is keyed by project name only (case-sensitive or case-insensitive must match current uniqueness rule; keep existing behavior).
- No partial merge behavior.
- Import remains deterministic and repeatable.

-------------------------------------------------------------------------------

## FRONTEND WORK

### 1) Import dialog UI: add checkbox
- In the Import Project Snapshot modal, add a checkbox:
  - label: "Overwrite existing project?"
  - default: unchecked
  - state: overwriteExistingProject (boolean)
- Place it near the existing options (below "Override Project Name/Folder?" is fine).

### 2) Name conflict validation rules (update existing logic)
- Determine effective project name used for import:
  - if Override Project Name/Folder? is checked: use user-entered projectName
  - else: use snapshot.project.name
- If an existing project already has that effective name:
  - If overwriteExistingProject is unchecked:
    - show existing error banner: "Project name already exists: <name>"
    - disable Import button (or block submit and show error) — current pattern is acceptable
  - If overwriteExistingProject is checked:
    - suppress that error banner
    - allow Import

### 3) Interaction rules with override name/folder
- overwriteExistingProject applies to the effective project name (post-override if override is enabled).
- If user toggles Override on/off or edits projectName, re-evaluate conflict and enable/disable Import accordingly.
- Do not require overwrite if the effective name is not conflicting.

### 4) Submit payload
- Extend the existing snapshot import request payload sent by the frontend to include:
  - overwriteExistingProject: boolean
- Send it to the existing snapshot import endpoint (same endpoint), alongside existing fields (e.g., makeActive, override flags, etc.).

### 5) Frontend tests
- Add/extend tests for Import Project Snapshot dialog:
  - When snapshot name conflicts and overwrite is unchecked, Import is blocked and error is shown.
  - When overwrite is checked, error disappears and Import is allowed.
  - When override name changes to a non-conflicting name, overwrite is not required.
  - When override name changes to a conflicting name, overwrite gating applies.

-------------------------------------------------------------------------------

## BACKEND WORK (architecture-model-service)

### 6) API contract: extend import request DTO
- In the snapshot import request DTO (e.g., ProjectSnapshotImportRequestDto), add:
  - boolean overwriteExistingProject (default false)
- Controller: accept this field from request JSON.

### 7) Import behavior changes (overwrite-by-name)
- In the snapshot import service orchestration (e.g., ProjectSnapshotImportService):
  - Determine effective project name used for import:
    - if override is enabled in request: use request.projectName
    - else: use snapshot.project.name
  - Lookup existing project by name.
  - If an existing project is found:
    - If overwriteExistingProject is false:
      - return a 409 Conflict (preferred) OR keep existing error handling style but must clearly communicate:
        - "Project name already exists: <name>"
    - If overwriteExistingProject is true:
      - perform full replacement:
        A) Delete existing project (by id) and all associated data
           - rely on DB cascades where present; otherwise explicitly delete dependent rows in correct order
        B) Import the snapshot as if it were a new import using the snapshot content (plus overrides)
      - The result must reflect the snapshot state, not a merge.
- Important: project identity is by name; overwrite selection is triggered by name match only.

### 8) Deletion strategy for "full replacement"
- Implement a single internal service method, e.g. ProjectDeletionService.deleteProjectById(projectId), that:
  - deletes all project-scoped records including (at minimum):
    - model files + all meta-model tables scoped to those model files
    - product data / work items / roadmap imports
    - diagrams and diagram relationships
    - any snapshot/import tracking records if applicable
  - ensures referential integrity (delete children before parents if cascades are incomplete)
- Wrap overwrite import in a single transaction so either:
  - old project remains unchanged on failure, OR
  - it is fully replaced.

### 9) Import determinism after overwrite
- After overwrite import:
  - The resulting project name must equal the effective project name.
  - If override folder/name are not enabled, the snapshot project's values are used (per prior fix).
  - Ensure repeated overwrite imports with the same snapshot yield the same resulting DB state (idempotent for content).

### 10) Backend tests
- Add integration tests (controller + service + DB):
  - Given an existing project "SampleProject":
    - importing a snapshot with name "SampleProject" and overwriteExistingProject=false returns conflict and does not modify DB.
    - importing with overwriteExistingProject=true deletes old project data and replaces it with snapshot data.
  - Verify replacement is not a merge (e.g., data removed that is not present in snapshot).
  - Verify transactionality (if import fails mid-way, the original project is not partially deleted).

-------------------------------------------------------------------------------

## Acceptance Criteria
- UI shows "Overwrite existing project?" checkbox (default off).
- If imported (effective) project name already exists and overwrite is OFF:
  - Import is blocked and the error "Project name already exists: <name>" is shown.
- If overwrite is ON:
  - Import proceeds and fully replaces the existing project with the snapshot contents.
- Replacement is based on project name alone and is not a merge.
- Backend enforces the rule even if a client bypasses the UI.
