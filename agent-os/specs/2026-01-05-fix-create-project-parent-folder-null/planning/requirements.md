# Requirements: Fix Create Project parent folder null

## Title
Fix Create Project parent folder null by aligning frontend JSON with backend SNAKE_CASE and adding backend aliases

## Intent
Fix the Create Project flow where the user enters a Parent Folder in the UI but the backend receives null, causing:
  null value in column "project_parent_folder" violates not-null constraint
Root cause: backend is configured with Jackson property-naming-strategy SNAKE_CASE, so it expects request JSON fields like
project_parent_folder / set_active, while the frontend sends camelCase (projectParentFolder / setActive), resulting in null
deserialization.

## Scope
- frontend: projects API request/response DTO mapping (snake_case <-> camelCase)
- backend: make CreateProjectRequest tolerant via JsonAlias for camelCase
- no schema changes
- no UI redesign; only fix the wiring

## Requirements

### Backend
- Continue using global Jackson SNAKE_CASE strategy.
- Create Project endpoint must accept BOTH snake_case and camelCase for:
  - project_parent_folder / projectParentFolder
  - set_active / setActive
- If required fields are missing, return a clear 400 with a useful message (keep existing global error handling patterns).

### Frontend
- The Projects API client must:
  - Send POST /api/projects payload using snake_case keys expected by backend
  - Correctly map snake_case response payloads into the existing camelCase ProjectDto used by the UI
- The Create Project modal must succeed when user provides parent folder.
- Error messaging should surface backend message when provided (keep current pattern).

## Implementation Details

### Backend (architecture-model-service)
1) Update CreateProjectRequest in ProjectController.java
- Add Jackson aliases to tolerate camelCase input while keeping snake_case canonical:
  - Annotate record components:
    - projectParentFolder with @JsonAlias({"projectParentFolder","project_parent_folder"})
    - setActive with @JsonAlias({"setActive","set_active"})
  - (Optional) also annotate name with @JsonAlias({"name"}) for symmetry (not required).
- Ensure imports include:
  - com.fasterxml.jackson.annotation.JsonAlias

2) (Optional hardening) Validate required fields in ProjectService.createProject(...)
- If name is blank OR projectParentFolder is blank/null:
  - throw a BadRequestException (or existing validation exception type used elsewhere)
  - message should mention which field is missing

### Frontend
1) Update src/api/projectsApi.ts to follow the established pattern used in workItemsApi.ts
- Introduce a backend response/request DTO using snake_case:
  - interface ProjectDtoSnake {
      id: string;
      name: string;
      project_parent_folder: string;
      is_active: boolean;
      created_at: string;
      updated_at: string;
    }
- Add mapping helpers:
  - function mapProjectFromSnake(dto: ProjectDtoSnake): ProjectDto
  - (If needed) function mapProjectToCreateRequest(name, projectParentFolder): { name: string; project_parent_folder: string; set_active: boolean }

2) Modify API calls to use snake_case on the wire
- createProject():
  - body JSON keys must be:
    - name
    - project_parent_folder
    - set_active
- listProjects(), getActiveProject(), activateProject():
  - parse response as ProjectDtoSnake (or array) and map into ProjectDto before returning to UI code

## Acceptance Criteria
- Creating a project with a non-empty Parent Folder no longer throws the DB constraint error.
- Backend receives a non-null project_parent_folder and persists it.
- Frontend continues to use ProjectDto with camelCase fields (projectParentFolder, isActive, createdAt, updatedAt) without breaking UI code.
- POST /api/projects works with both camelCase and snake_case payloads (verified by simple manual curl or frontend).
- Existing endpoints returning projects no longer yield undefined fields in the UI due to snake/camel mismatch.
