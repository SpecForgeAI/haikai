# Specification: Overwrite Existing Project Option for Snapshot Import

## Goal
Extend the "Import Project Snapshot" feature to enforce project name uniqueness by default while allowing users to explicitly opt in to overwriting an existing project with the same name, where overwrite performs a full replacement (not merge) based on project name alone.

## User Stories
- As a user, I want to be warned when importing a snapshot that would conflict with an existing project name so that I do not accidentally overwrite important data.
- As a user, I want to explicitly choose to overwrite an existing project with an imported snapshot so that I can replace outdated project data with a fresh snapshot.

## Specific Requirements

**Frontend: Add "Overwrite existing project?" checkbox to Import dialog**
- Add checkbox in ImportProjectSnapshotModal with label "Overwrite existing project?"
- Default state: unchecked (safe-by-default behavior)
- State variable: `overwriteExistingProject` (boolean)
- Position: below the existing "Override Project Name/Folder?" checkbox in the modal content area
- Use existing `styles.checkboxGroup`, `styles.checkbox`, and `styles.checkboxLabel` CSS classes for consistency
- Add data-testid="overwrite-existing-checkbox" for testing

**Frontend: Update name conflict validation logic**
- Compute effective project name: if override is checked use user-entered `importAsName`, else use `rawSnapshotJson.project.name`
- When effective name conflicts with an existing project (requires fetching project list or checking on submit):
  - If `overwriteExistingProject` is unchecked: show error banner "Project name already exists: <name>" and disable Import button
  - If `overwriteExistingProject` is checked: suppress error and allow Import to proceed
- Re-evaluate conflict state when: override toggle changes, `importAsName` field value changes, or `overwriteExistingProject` checkbox is toggled
- Error display uses existing `styles.errorMessage` CSS class and `data-testid="error-message"`

**Frontend: Extend import request payload**
- Add `overwriteExistingProject: boolean` field to `ProjectSnapshotImportRequestDto` interface in `projectSnapshotApi.ts`
- In `importProjectSnapshot()` function, include `overwrite_existing_project: boolean` in request body (snake_case for backend)
- Send alongside existing fields: `snapshot`, `set_active`, `import_as_name`, `project_parent_folder`

**Frontend: Handle conflict error response from backend**
- If backend returns 409 Conflict with message "Project name already exists: <name>", display that message in the error banner
- Current error handling in `handleImport()` already extracts `err.message` and displays it, so this should work automatically

**Backend: Extend ProjectSnapshotImportRequestDto**
- Add field: `Boolean overwriteExistingProject` with `@JsonProperty("overwrite_existing_project")` and `@JsonAlias({"overwriteExistingProject", "overwrite_existing_project"})`
- Add accessor method `effectiveOverwriteExistingProject()` that returns `false` if null
- Controller automatically deserializes this from request JSON via existing Jackson configuration

**Backend: Modify ProjectSnapshotImportService conflict handling**
- After computing effective project name, query `projectRepository.findByName(effectiveProjectName)`
- If project exists and `request.effectiveOverwriteExistingProject()` is false: throw `ConflictException("Project name already exists: " + effectiveProjectName)`
- If project exists and overwrite is true: delete existing project then proceed with import
- Existing ConflictException is already mapped to HTTP 409 by GlobalExceptionHandler

**Backend: Implement project deletion for overwrite**
- Create new method or service (e.g., `deleteProjectById(UUID projectId)`) that removes:
  - All model file records (meta-model entities scoped to project's model files)
  - All work items (`work_item` table rows where `project_id` matches)
  - All project artifacts (`project_artifact` table rows where `project_id` matches)
  - All diagram-related records if scoped to project
  - The project record itself from `project` table
- Rely on database cascades where configured; otherwise delete in correct dependency order (children before parents)
- Wrap entire overwrite operation (delete + import) in single `@Transactional` to ensure atomicity

**Backend: Ensure idempotent overwrite behavior**
- After successful overwrite import, resulting project state must match snapshot content exactly
- Repeated overwrite imports with same snapshot yield identical database state
- Project ID will be new (generated during import), but project name matches effective name
- No merge of old data with new data; old project is fully removed before new import

## Visual Design
No visual mockups provided. Follow existing ImportProjectSnapshotModal styling patterns:
- Checkbox styling matches "Make imported project active" and "Override Project Name/Folder?" checkboxes
- Error banner styling matches existing `errorMessage` CSS class (red background, red border)

## Existing Code to Leverage

**ImportProjectSnapshotModal.tsx (frontend/src/components/Project/)**
- Contains existing checkbox patterns (`setActive`, `overrideNameFolder`) to replicate for new `overwriteExistingProject` state
- Has error display via `error` state and `styles.errorMessage` CSS class
- Uses `importProjectSnapshot()` API function for submission
- Reset logic in `useEffect` when `isOpen` changes should include new state variable

**projectSnapshotApi.ts (frontend/src/api/)**
- `ProjectSnapshotImportRequestDto` interface needs new optional `overwriteExistingProject?: boolean` field
- `importProjectSnapshot()` function builds request body; add `overwrite_existing_project` field when provided
- Response error handling already extracts message from backend error response

**ProjectSnapshotImportService.java (architecture-model-service)**
- `importSnapshot()` method already checks for name conflict with `projectRepository.existsByName()`
- Already throws `ConflictException` for name conflicts; modify to check overwrite flag first
- Transaction is already present via `@Transactional` annotation
- Add deletion logic before the existing project creation step when overwrite is enabled

**ProjectSnapshotImportRequestDto.java (architecture-model-service)**
- Record-based DTO; add new `Boolean overwriteExistingProject` field with Jackson annotations
- Add `effectiveOverwriteExistingProject()` method following pattern of existing `effectiveSetActive()`

**ProjectRepository.java (architecture-model-service)**
- Has `findByName(String name)` returning `Optional<ProjectEntity>` for looking up existing project by name
- Has `existsByName(String name)` for quick existence check

## Out of Scope
- Merge behavior: overwrite is full replacement only, no selective merging of old and new data
- Overwrite by project ID: matching is by project name only, not by UUID
- Confirmation dialog: no additional "Are you sure?" confirmation beyond the checkbox
- Undo/rollback UI: no ability to undo an overwrite after completion
- Soft delete: old project is permanently deleted, not archived
- Partial overwrite: cannot choose to keep some entities from old project
- Case-insensitive name matching: maintain existing case-sensitivity behavior from `existsByName()`
- Overwrite of active project warning: no special handling if the project being overwritten is currently active
- Batch import: this spec covers single snapshot import only
- CLI/API-only import: backend must enforce overwrite flag regardless of client (covered by requirement), but no separate CLI interface is in scope
