# Specification: Auto-Save After Create Project

## Goal
When a user creates a new Project, automatically save the model using the project name as the filename, ensuring the top-right filename indicator updates immediately without requiring a manual File -> Save action.

## User Stories
- As a user, I want the filename display to show my project name immediately after creating a project so that I know my work is associated with the correct file.
- As a user, I want the auto-save to fail gracefully so that my project creation is not rolled back if there is a save error.

## Specific Requirements

**Auto-save triggered on project creation success**
- After `createProject()` resolves successfully in CreateProjectModal, invoke the existing save logic
- Use the created project's `name` property as the filename for the save operation
- The save must occur after `refreshActiveProject()` completes to ensure project context is updated
- Do not open the "Save Model As" modal; call the underlying save function directly

**Reuse existing save implementation from TopBar**
- The save logic in `TopBar.handleSaveToBackend()` (lines 92-124) contains the complete save flow
- This flow includes: `prepareModelForSave()`, `validateModel()`, `sanitizeModelForBackendSave()`, and `saveModelByFilename()`
- Extract this logic into a reusable function or call it directly from CreateProjectModal
- The same `dispatch({ type: 'LOAD_MODEL', ... })` pattern must be used to update `loadedFileName` state

**Update filename display state**
- The top-right filename is rendered from `state.loadedFileName` in TopBar (line 256-258)
- After successful save, dispatch `LOAD_MODEL` action with the project name as `fileName` parameter
- This updates `loadedFileName` in ArchitectureContext state (line 319)

**Error handling for auto-save failure**
- If save fails (API error or validation error), do NOT revert the project creation
- Display a non-blocking notification: "Project created, but initial save failed. You can retry via File > Save."
- Close the CreateProjectModal regardless of save success/failure (project creation succeeded)
- Use the existing notification toast pattern from TopBar (lines 38, 118-119, 276-280)

**Validation behavior**
- If `validateModel()` returns errors, treat as a "soft failure" for auto-save
- Show a notification indicating save failed due to validation, but do not block project creation
- User can manually trigger File -> Save As after fixing validation issues

**Guard against double-save**
- If user immediately clicks File -> Save after project creation, behavior should be idempotent
- Saving the same model with the same filename should succeed without issues
- No special locking mechanism required; the backend handles this naturally

**No changes to Project API contract**
- The `createProject()` function in projectsApi.ts remains unchanged
- No new parameters or return values are added to the Projects API
- Project creation and model save remain separate backend operations

**Component communication pattern**
- CreateProjectModal needs access to: ArchitectureContext state, dispatch function, save utilities
- Two options: (1) Pass save function as prop from TopBar, or (2) Import shared utilities
- Prefer extracting save logic to a shared utility to avoid prop drilling

## Existing Code to Leverage

**TopBar.handleSaveToBackend (lines 92-124)**
- Contains the full save flow: prepare -> validate -> sanitize -> save -> dispatch LOAD_MODEL
- Shows success notification pattern using `setNotification()` with 3-second auto-dismiss
- Error handling pattern using `setErrorMessages()` and ErrorModal
- File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/TopBar/TopBar.tsx`

**ArchitectureContext LOAD_MODEL action (lines 249-323)**
- Sets `loadedFileName` from action's `fileName` parameter (line 319)
- Also reconciles derived entities and sets initial diagram selection
- Must dispatch this action after save to update the filename display
- File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/contexts/ArchitectureContext.tsx`

**modelApi.saveModelByFilename (lines 74-89)**
- The API function that sends PUT request to backend with filename query param
- Returns `ModelFileSummaryDto` on success
- File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/api/modelApi.ts`

**CreateProjectModal.handleCreate (lines 94-109)**
- Current flow: `createProject()` -> `refreshActiveProject()` -> `onClose()`
- Insert auto-save between `refreshActiveProject()` and `onClose()`
- File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/Project/CreateProjectModal.tsx`

**Validation and sanitization utilities**
- `prepareModelForSave()` in validation.ts (lines 888-905) - reconciles derived entities
- `validateModel()` in validation.ts (lines 908-1090) - returns ValidationError[]
- `sanitizeModelForBackendSave()` in sanitize.ts - converts empty strings to undefined for FK fields
- File path: `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/validation.ts`

## Out of Scope
- Do not modify the Project creation API (`POST /api/projects`) or its request/response format
- Do not add new fields to the ProjectDto interface
- Do not create a new "auto-save" backend endpoint
- Do not implement auto-save on a timer or on model changes (only on project creation)
- Do not change the File -> Save As modal behavior or UI
- Do not add confirmation dialogs before auto-save
- Do not implement undo/rollback functionality for auto-save
- Do not modify the loadedFileName display format in TopBar
- Do not add loading spinners or progress indicators for the auto-save operation
- Do not change the notification toast styling or duration
