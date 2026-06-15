# Specification: Fix Roadmap Tab Buttons Incorrectly Disabled When a Project is Open

## Goal

Fix the bug where opening a project via "File > Open from backend" results in the Roadmap tab action buttons remaining disabled and the "Create or open a project to import roadmap" banner being displayed, even though the project is successfully loaded and its name appears in the top-right. The root cause is that ProjectContext.activeProject is not being refreshed when a model is opened from the backend.

## User Stories

- As a user, I want the Roadmap action buttons to be enabled after I open a project from the backend so that I can import roadmap.md and upload Book of Work without needing to create a new project or perform additional steps.
- As a user, I want consistent behavior between all project-opening flows (Create Project, Import Snapshot, Open from backend) so that the Roadmap tab always reflects the correct active project state.

## Specific Requirements

**Update TopBar handleOpenFromBackend to refresh ProjectContext**
- After successfully loading a model via `loadModelByFilename` and dispatching `LOAD_MODEL`, call `refreshActiveProject()` to update ProjectContext with the current active project from the backend
- Import and use `useRefreshActiveProject` hook from ProjectContext (already imported for snapshot import flow)
- Ensure the refresh happens after the dispatch so the UI updates with both the loaded model and the active project state

**Verify backend returns correct active project after open**
- The backend already maintains the active project state; when a model is opened, the corresponding project should already be marked as active (if the project exists)
- If the model name does not correspond to an existing project, `getActiveProject()` may return null or a different project, which is acceptable behavior
- No backend changes are required if the project activation already happens correctly via existing create/import flows

**Add activateProjectByName API function (if needed)**
- If the frontend needs to explicitly activate a project by name (not UUID) after opening a model, add a new API function `activateProjectByName(name: string)` in projectsApi.ts
- This function should call a new backend endpoint `POST /api/projects/activate-by-name` with request body `{ name: string }`
- The backend endpoint should find the project by name, activate it, and return the activated ProjectDto
- Only implement this if `refreshActiveProject()` alone is insufficient to sync the active project after opening a model

**Add backend endpoint for activation by name (if needed)**
- Add `POST /api/projects/activate-by-name` endpoint in ProjectController
- Accept request body with `name` field
- Call `projectService.activateProjectByName(name)` which finds the project by name and activates it
- Return 404 with message if no project exists with that name
- Ensure only one project is active at a time (existing invariant)

**Update ProductRoadmapPage gating to consider loading state**
- Currently `isImportDisabled = !activeProject || importing` does not account for initial loading state
- Update to: `isImportDisabled = loading || !activeProject || importing` where `loading` comes from `useProjectLoading()` hook
- This prevents permanently disabled buttons if ProjectContext is still initializing

**Update ProductRoadmapPage banner visibility logic**
- Currently the "Create or open a project..." banner shows when `!activeProject`
- Update to show banner only when `!loading && !activeProject` to avoid showing misleading banner during initial load
- Import and use `useProjectLoading()` hook from ProjectContext

**Ensure snapshot import flow remains functional**
- The existing snapshot import flow in TopBar already calls `refreshActiveProject()` after import succeeds
- Verify this continues to work correctly after the changes
- Both "Make imported project active" checked and unchecked scenarios should behave correctly

**Ensure Create Project flow remains functional**
- The existing CreateProjectModal already calls `refreshActiveProject()` after project creation
- Verify this continues to work correctly after the changes
- Roadmap buttons should be enabled immediately after creating a new project

## Visual Design

No visual mockups required for this bug fix. The existing UI components and styling remain unchanged.

## Existing Code to Leverage

**ProjectContext (frontend/src/contexts/ProjectContext.tsx)**
- Provides `activeProject`, `loading`, `refreshActiveProject()`, and hooks `useProject()`, `useProjectLoading()`, `useRefreshActiveProject()`
- Already has loading state that should be used for gating
- `refreshActiveProject()` calls `getActiveProject()` API and updates context state

**TopBar handleOpenFromBackend (frontend/src/components/TopBar/TopBar.tsx lines 108-117)**
- Currently loads model and dispatches `LOAD_MODEL` but does NOT call `refreshActiveProject()`
- Already imports `useRefreshActiveProject` hook for use in `handleImportSuccess`
- Should be updated to call `refreshActiveProject()` after successful model load

**ProductRoadmapPage isImportDisabled logic (frontend/src/components/ProductView/ProductRoadmapPage.tsx line 418)**
- Currently `const isImportDisabled = !activeProject || importing`
- Uses `useProject()` hook but not `useProjectLoading()` hook
- Should be updated to account for loading state

**projectsApi.ts activateProject function (frontend/src/api/projectsApi.ts lines 229-256)**
- Existing function activates a project by UUID
- Can be used as a pattern if activateProjectByName is needed
- Backend endpoint `POST /api/projects/{id}/activate` already exists

**CreateProjectModal and ImportProjectSnapshotModal**
- Both correctly call `refreshActiveProject()` after their respective operations succeed
- These flows work correctly and should be preserved as reference implementations

## Out of Scope

- Changes to the Planner or Implement chat functionality
- Modifications to roadmap or backlog data models
- Changes to MCP tooling
- Any changes to the actual roadmap import endpoint logic
- UI/UX redesign of the Roadmap tab layout
- Adding new visual indicators for loading states beyond current implementation
- Backend activation logic changes (only new endpoint if needed, not modifying existing behavior)
- Changes to how loadedFileName is managed in ArchitectureContext
- Performance optimizations for project context loading
- Adding toast notifications for project activation events
