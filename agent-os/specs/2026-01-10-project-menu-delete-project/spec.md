# Specification: Add Project menu + Delete Project flow

## Goal
Introduce a first-class **Project** menu (renaming the existing File menu) and add a **Delete Project** capability that lets the user choose an existing saved project, requires explicit confirmation, and on confirm deletes both the project's filesystem contents and all database rows owned by that project.

## User Stories
- As a user, I want to access project operations from a clearly labeled "Project" menu so that project management actions are easy to find
- As a user, I want to delete a project (including all its files and data) so that I can clean up projects I no longer need

## Specific Requirements

**Rename File menu to Project menu**
- Change the menu button label from "File" to "Project" in TopBar.tsx
- Update FileMenu component name to ProjectMenu (or rename the label only)
- Menu button styling and positioning remain unchanged
- Update data-testid from "file-menu-trigger" to "project-menu-trigger"

**Reorder Project menu items**
- Menu items must appear in this exact order: Create, Open, Save As, Delete, (separator), Import as JSON, Export as JSON, Import as XLSX, Export as XLSX
- Add a new separator after "Delete" item
- Existing "Create Project..." becomes just "Create..." for brevity
- Existing "Open..." and "Save As..." remain unchanged
- Add new "Delete..." menu item after "Save As..."

**Delete Project modal component**
- Create DeleteProjectModal component following ModelFileDialog patterns
- Modal displays list of saved projects (reuse listProjects API call)
- User must select exactly one project before Delete button is enabled
- Modal shows: project name and last updated date in each row
- Delete button uses destructive styling (red background color)
- Cancel button closes modal with no side effects

**Delete Project modal behavior**
- On Delete click: show loading/busy state (spinner in button or overlay)
- On success: close modal, show success toast notification, refresh project list
- On failure: keep modal open, display error message inline in modal
- Keyboard support: Escape closes modal, Enter triggers Delete if enabled

**Frontend deleteProject API function**
- Add deleteProject(projectId: string) function to projectsApi.ts
- Calls DELETE /api/projects/{id} endpoint
- Returns Promise with success/failure status and message
- Maps snake_case error responses to camelCase as per existing patterns

**Clear active project on delete of current project**
- After successful delete, check if deleted project was the active project
- If so, call setActiveProject(null) or dispatch to clear active state
- Reset ArchitectureContext model to empty state via RESET_MODEL action
- UI should show "no project loaded" state in Product and Architecture views

**Backend DELETE endpoint**
- Add DELETE /api/projects/{id} endpoint in ProjectController
- Returns 200 OK with message on success
- Returns 400 Bad Request if projectParentFolder is blank/missing
- Returns 404 Not Found if project does not exist
- Returns 500 Internal Server Error if filesystem or DB deletion fails

**Backend filesystem deletion logic**
- Resolve project's projectParentFolder from the project entity
- Validate folder path is not blank, null, or root-like ("/", "C:\", empty string)
- Delete all contents recursively under projectParentFolder for the project
- If path normalization or validation fails, return error before touching DB
- Use Java NIO Files.walk() with deleteOnExit or similar for safe recursive delete

**Backend database deletion logic**
- Delete all rows owned by the project in correct FK order or use cascade
- Tables to delete: work_items, project_artifacts, model data (via model filename)
- Use @Transactional to ensure atomicity - rollback if any delete fails
- Delete the project row itself last
- Deactivate all projects after delete to ensure clean state

**Backend safety checks**
- Reject deletion if projectParentFolder resolves to root directory
- Reject deletion if projectParentFolder path traversal escapes intended location
- Log all deletion attempts with project ID and folder path for audit
- Never return partial success - either full delete or full failure

## Existing Code to Leverage

**FileMenu.tsx and TopBar.tsx**
- FileMenu component has the dropdown menu structure with items and separators
- TopBar manages menu visibility state and handlers (fileMenuVisible, handleFileMenuClose)
- Portal rendering pattern for dropdown positioning already implemented
- Reuse menu item click handler pattern (handleXxxClick -> onXxx -> onClose)

**ModelFileDialog.tsx**
- Modal overlay and content structure suitable for Delete modal
- File list rendering with selection highlighting (styles.selected)
- Loading spinner and error state display patterns
- Cancel/OK button footer layout to repurpose for Cancel/Delete
- CSS module styles can be extended for destructive button styling

**projectsApi.ts**
- listProjects() function already fetches project list for selection
- mapProjectFromSnake() handles API response transformation
- Error handling pattern with try/catch and serverMessage extraction
- API_BASE constant for endpoint URL construction

**ProjectController.java and ProjectService.java**
- ProjectController already has CRUD endpoints pattern to follow
- ProjectService.getActiveProjectEntity() pattern for fetching project
- ProjectRepository methods like findById, deactivateAll available
- @Transactional annotation usage for atomic operations

**ProjectContext.tsx**
- refreshActiveProject() can be called after delete to update UI state
- setActiveProject pattern (if extended) for clearing active project
- useProject hook for checking if deleted project was active

## Out of Scope
- Soft delete or archive functionality (trash/recycle bin)
- Undo delete capability
- Bulk delete of multiple projects at once
- Project renaming from the Delete modal
- Confirmation dialog with typed project name (simple button confirmation only)
- Cross-project or multi-tenant ownership validation
- Structured project naming or logical folder organization
- Project export before delete prompt
- Backup creation before deletion
- Delete project from within the project (must use modal to select)
