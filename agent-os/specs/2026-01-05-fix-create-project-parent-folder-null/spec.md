# Specification: Fix Create Project parent folder null

## Goal
Fix the Create Project flow where the frontend sends camelCase JSON keys but the backend expects snake_case due to global Jackson configuration, causing `project_parent_folder` to deserialize as null and violate the database NOT NULL constraint.

## User Stories
- As a user, I want to create a project with a parent folder so that my project files are stored in the correct location without encountering database constraint errors.
- As a developer, I want the API to tolerate both snake_case and camelCase input so that frontend/backend JSON format mismatches do not cause silent null values.

## Specific Requirements

**Backend: Add JsonAlias annotations to CreateProjectRequest**
- Add `@JsonAlias({"projectParentFolder", "project_parent_folder"})` to the `projectParentFolder` record component
- Add `@JsonAlias({"setActive", "set_active"})` to the `setActive` record component
- Import `com.fasterxml.jackson.annotation.JsonAlias` in ProjectController.java
- Keep snake_case as the canonical format (no changes to global Jackson config)
- Ensure both camelCase and snake_case payloads deserialize correctly

**Backend: Add validation for required fields in ProjectService**
- Validate that `name` is not blank before creating project
- Validate that `parentFolder` is not blank/null before creating project
- Throw `IllegalArgumentException` with descriptive message when validation fails (leverages existing GlobalExceptionHandler which returns 400)
- Error message format: "Project name is required" or "Project parent folder is required"

**Frontend: Add snake_case backend DTO interface**
- Define `ProjectDtoSnake` interface with snake_case field names: `id`, `name`, `project_parent_folder`, `is_active`, `created_at`, `updated_at`
- Keep this interface private to projectsApi.ts (not exported)
- Mirror the pattern established in workItemsApi.ts

**Frontend: Add mapping function from snake_case to camelCase**
- Create `mapProjectFromSnake(dto: ProjectDtoSnake): ProjectDto` function
- Map all fields: `project_parent_folder` -> `projectParentFolder`, `is_active` -> `isActive`, `created_at` -> `createdAt`, `updated_at` -> `updatedAt`
- Keep `id` and `name` as-is (same in both formats)

**Frontend: Update createProject to send snake_case payload**
- Change JSON body to use `project_parent_folder` instead of `projectParentFolder`
- Change JSON body to use `set_active` instead of `setActive`
- Parse response through `mapProjectFromSnake` before returning
- Keep existing error handling pattern intact

**Frontend: Update listProjects to map snake_case response**
- Parse response as `ProjectDtoSnake[]`
- Map each item through `mapProjectFromSnake`
- Return mapped `ProjectDto[]` to callers

**Frontend: Update getActiveProject to map snake_case response**
- Parse response as `ProjectDtoSnake`
- Map through `mapProjectFromSnake` before returning
- Keep existing 404 -> null handling unchanged

**Frontend: Update activateProject to map snake_case response**
- Parse response as `ProjectDtoSnake`
- Map through `mapProjectFromSnake` before returning
- Keep existing error handling pattern intact

## Existing Code to Leverage

**workItemsApi.ts snake_case mapping pattern**
- Defines `WorkItemDto` interface with snake_case fields for backend response
- Implements `mapWorkItemDtoToWorkItem()` function for snake_case to camelCase conversion
- Implements `mapWorkItemCreatePayloadToDto()` for camelCase to snake_case request conversion
- This pattern should be replicated exactly for the projects API

**GlobalExceptionHandler IllegalArgumentException handling**
- Already handles `IllegalArgumentException` and returns 400 Bad Request with message
- Response body includes: timestamp, status, error, message
- No new exception class needed; just throw IllegalArgumentException in ProjectService

**DiagramDto JsonAlias usage**
- Shows existing pattern for using `@JsonAlias` to accept multiple field name formats
- Example: `@JsonAlias({ "type", "diagramType" })` on the `diagramType` field
- Same annotation pattern applies to CreateProjectRequest record components

**ProjectController CreateProjectRequest record**
- Currently a simple record with three components: name, projectParentFolder, setActive
- Record components can be annotated with `@JsonAlias` just like class fields
- The `effectiveSetActive()` method provides default value logic that should be preserved

**projectsApi.ts existing error handling**
- Extracts server error message from response body when available
- Falls back to status text when no server message
- This pattern must be preserved to surface backend validation errors to UI

## Out of Scope
- Changes to the database schema or Liquibase migrations
- Modifications to the UI components or Create Project modal design
- Changes to the global Jackson SNAKE_CASE configuration in application.yml
- Adding new API endpoints or modifying endpoint paths
- Changes to the ProjectDto record or ProjectEntity class
- Changes to ProjectMapper or how entities map to DTOs
- Adding authentication or authorization to project endpoints
- Performance optimizations or caching
- Logging changes beyond what already exists
- Unit tests for the frontend mapping functions (manual verification sufficient)
