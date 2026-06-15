# Specification: Frontend Project Snapshot Export/Import

## Goal
Replace the legacy architecture-only JSON export/import with full project snapshot endpoints, enabling users to export and import complete project snapshots that preserve all project data including architecture model, product work items, and roadmap state.

## User Stories
- As a user, I want to export my entire project as a snapshot JSON file so that I can back it up or transfer it to another machine
- As a user, I want to import a project snapshot so that the imported project appears exactly as it was when exported, including all architecture and product data

## Specific Requirements

**API Client for Project Snapshots**
- Create new file `src/api/projectSnapshotApi.ts` following the pattern established in `projectsApi.ts`
- Implement `exportActiveProjectSnapshot()` function that calls `GET /api/projects/active/export`
- Implement `importProjectSnapshot(req)` function that calls `POST /api/projects/import`
- Define TypeScript interfaces: `ProjectSnapshotDto`, `ProjectSnapshotImportRequestDto`, `ProjectSnapshotImportResultDto`
- Use the same `API_BASE` pattern from environment variables as other API clients
- Handle snake_case/camelCase mapping consistent with existing API patterns

**Export JSON Behavior**
- When user clicks "Export as JSON..." in File menu, call `exportActiveProjectSnapshot()`
- On 404 response (no active project), display error toast/modal with message "No active project to export"
- On success, trigger download of the returned JSON as `<projectName>-snapshot.json`
- Sanitize project name for filename compatibility (remove/replace invalid characters)
- Use `Blob` + `URL.createObjectURL` pattern for file download (same as `saveJsonFile` in `fileOperations.ts`)

**Import JSON Behavior - File Selection**
- When user clicks "Import as JSON...", open file picker for `.json` files
- Read selected file contents using `FileReader.readAsText()`
- Parse JSON client-side to extract `snapshot.project.name` for display
- If JSON parse fails, show error modal and abort (no modal opens)

**ImportProjectSnapshotModal Component**
- Create new component at `src/components/Project/ImportProjectSnapshotModal.tsx`
- Follow styling and structure pattern from `CreateProjectModal.tsx`
- Props: `isOpen`, `onClose`, `snapshotProjectName` (string for display), `rawSnapshotJson` (parsed object), `onImported` (callback)
- Display read-only "Original Name" field showing `snapshot.project.name`
- Input field: `importAsName` (text, default: `snapshot.project.name`)
- Input field: `projectParentFolder` (text, required)
- Checkbox: `setActive` (default: checked) with label "Make imported project active"
- Disable Import button until `projectParentFolder` and `importAsName` are non-empty
- Cancel button closes modal without action

**Import Request Handling**
- On Import click, POST to `/api/projects/import` with body: `{ snapshot, import_as_name, project_parent_folder, set_active }`
- Handle 400 errors: display inline error message from backend response
- Handle 409 errors: display inline error message (name conflict or ID collision)
- Handle other errors: display generic failure message
- On success: close modal, trigger state refresh, call `onImported` callback

**State Refresh After Import**
- Call `refreshActiveProject()` from `ProjectContext` to update active project state
- Dispatch `LOAD_MODEL` action via `loadModelByFilename()` to reload architecture model into `ArchitectureContext`
- Refresh product data: work items and roadmap (use existing fetch patterns from Product view components)
- Ensure all three data domains refresh: project state, architecture model, product work items

**Remove Legacy JSON Export/Import**
- Remove usage of `saveJsonFile()` and `loadJsonFile()` from `TopBar.tsx` for the Export/Import JSON menu actions
- The File menu "Import as JSON..." and "Export as JSON..." must use snapshot endpoints exclusively
- Keep `saveJsonFile`/`loadJsonFile` functions in `fileOperations.ts` for now (may be used elsewhere), but remove their usage from File menu
- Do NOT remove XLSX import/export functionality - that remains unchanged

## Visual Design
No visual mockups provided. Modal should follow existing `CreateProjectModal.tsx` styling patterns.

## Existing Code to Leverage

**`src/api/projectsApi.ts`**
- Follow API client pattern: `API_BASE` from env, fetch with headers, error handling with status codes
- Use snake_case request bodies and map snake_case responses to camelCase DTOs
- Handle 404 specially for "no active project" scenarios

**`src/components/Project/CreateProjectModal.tsx`**
- Use as template for `ImportProjectSnapshotModal` structure and styling
- Reuse same CSS module approach with `CreateProjectModal.module.css` as reference
- Follow same patterns for form validation, keyboard handling (Escape/Enter), and error display

**`src/contexts/ProjectContext.tsx`**
- Use `useRefreshActiveProject()` hook to refresh active project after import
- Call `refreshActiveProject()` in the success handler

**`src/contexts/ArchitectureContext.tsx`**
- Dispatch `LOAD_MODEL` action to reload the architecture model after import
- Use existing `loadModelByFilename()` from `modelApi.ts` to fetch the model for the newly active project

**`src/utils/fileOperations.ts`**
- Reference `saveJsonFile` for Blob download pattern (lines 524-533)
- Reference `loadJsonFile` for FileReader pattern and JSON parsing (lines 391-484)
- Do NOT modify these functions; stop using them in TopBar for JSON export/import

## Out of Scope
- UI for authoring company-level standards files
- Background or automatic exports/imports
- Partial imports or exports (must be complete snapshot)
- Modifying the backend snapshot endpoints
- XLSX import/export changes (remains unchanged)
- Creating new navigation items or top-level UI changes
- Background tasks or async job handling
- Project deletion or project list management UI
- Modifying how the model is loaded from backend on initial app load
- Changes to the Save As or Open backend file dialogs
