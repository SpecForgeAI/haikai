# Specification: Fix Open Modal Hierarchy Grouping by Sourcing Projects

## Goal
Fix the bug where the Open modal groups all projects under "(No hierarchy)" even when projects have a `projectHierarchy` value, by changing the data source from model filenames (which lack hierarchy) to the projects API (which includes `projectHierarchy`).

## User Stories
- As a user, I want the Open modal to group projects by their hierarchy (e.g., "Rivvy Portal" under "Rivvy") so that I can quickly find projects in a familiar, organized structure.
- As a user, I want the Open modal to visually match the Delete modal so that the UI is consistent across project management operations.

## Specific Requirements

**Replace data source in Open modal from model filenames to projects API**
- Change `ModelFileDialog.tsx` to call `listProjects()` from `projectsApi.ts` instead of `fetchModelFilenames()` from `modelApi.ts` when in "open" mode
- Store fetched projects as `ProjectDto[]` directly, eliminating the need for the `mapModelFilesToProjectDtos` mapping utility
- Remove import of `fetchModelFilenames` and `mapModelFilesToProjectDtos` from the Open modal (they may still be needed for "saveAs" mode)
- Maintain dual-mode behavior: "open" mode uses projects API; "saveAs" mode continues using filenames API

**Update GroupedProjectList data flow in Open modal**
- Pass `ProjectDto[]` directly to `GroupedProjectList` (no mapping needed since projects API already returns `projectHierarchy`)
- Projects with `projectHierarchy` value appear under their hierarchy section (e.g., "Rivvy")
- Projects with null/blank hierarchy appear under "(No hierarchy)" section
- Ordering: "(No hierarchy)" section first, then alphabetical hierarchy sections, with projects sorted alphabetically within each section

**Update selection and confirmation to use project name**
- When a project row is clicked, store both `selectedProjectId` (for highlighting) and derive the project `name` for the open action
- On OK/Confirm, pass the selected project's `name` to `onConfirm()` callback (project name serves as the unique identifier for opening)
- OK button remains disabled until a project is selected (no regression)

**Ensure backend project_hierarchy is returned correctly**
- Verify `GET /api/projects` endpoint returns `project_hierarchy` field for each project (already implemented in `ProjectDto.java`)
- Frontend `projectsApi.ts` already maps `project_hierarchy` to `projectHierarchy` via `mapProjectFromSnake()`
- Treat null and blank/whitespace-only values as null for grouping purposes

**Update or remove modelFileMapping utility**
- The `mapModelFilesToProjectDtos()` utility in `modelFileMapping.ts` is no longer needed for the Open modal
- If "saveAs" mode does not need grouped display, the utility can be removed entirely; otherwise keep for "saveAs" mode only
- Remove unused imports from `ModelFileDialog.tsx`

**Add automated tests for Open modal hierarchy grouping**
- Add test: Open modal displays project with hierarchy under correct section header
- Add test: Open modal displays project without hierarchy under "(No hierarchy)" section
- Add test: Open modal selection and OK button work correctly with project data
- Update or remove tests in `ModelFileDialogOpenMode.test.ts` that reference the old mapping utility

## Existing Code to Leverage

**`frontend/src/components/Project/DeleteProjectModal.tsx`**
- Reference implementation that correctly sources from `listProjects()` API
- Uses `GroupedProjectList` component with `ProjectDto[]` directly
- Pattern for loading, error handling, selection state, and confirmation flow

**`frontend/src/components/Project/GroupedProjectList.tsx`**
- Reusable component already used by Delete modal
- Groups by `projectHierarchy`, displays "(No hierarchy)" section first
- Handles expand/collapse, selection highlighting, and project counts
- No changes needed to this component

**`frontend/src/api/projectsApi.ts`**
- `listProjects()` function already returns `ProjectDto[]` with `projectHierarchy` mapped from snake_case
- `mapProjectFromSnake()` handles `project_hierarchy` to `projectHierarchy` conversion
- `ProjectDto` interface already includes `projectHierarchy: string | null`

**`architecture-model-service/.../controller/ProjectController.java` and `model/dto/ProjectDto.java`**
- `GET /api/projects` endpoint already returns `project_hierarchy` field via `ProjectDto` record
- Jackson SNAKE_CASE strategy outputs `project_hierarchy` from `projectHierarchy` field
- No backend changes required; endpoint already provides required data

**`frontend/src/__tests__/GroupedProjectList.test.tsx`**
- Comprehensive test suite for GroupedProjectList component behavior
- Tests grouping, sorting, collapsing, selection, and empty state
- Pattern to follow for new Open modal tests

## Out of Scope
- Changes to the Delete modal (it already works correctly)
- Changes to the "saveAs" mode of ModelFileDialog (it uses flat file list, not hierarchy grouping)
- Changes to the GroupedProjectList component itself (it already handles hierarchy correctly)
- Adding new fields to ProjectDto beyond what already exists
- Database migrations (project_hierarchy column already exists)
- Backend API changes (GET /api/projects already returns project_hierarchy)
- Changing how projects are opened after selection (only the data source for the list changes)
- Removing the /api/model/filenames endpoint (still used by saveAs mode)
- UI styling changes beyond ensuring consistency with Delete modal
- Keyboard navigation enhancements beyond existing Enter/Escape support
