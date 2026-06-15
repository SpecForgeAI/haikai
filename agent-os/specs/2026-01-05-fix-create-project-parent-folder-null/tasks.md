# Task Breakdown: Fix Create Project parent folder null

## Overview
Total Tasks: 10

This is a bug fix to resolve the JSON key mismatch between frontend (camelCase) and backend (snake_case) that causes `project_parent_folder` to deserialize as null, violating the database NOT NULL constraint.

## Task List

### Backend Layer

#### Task Group 1: Backend JsonAlias and Validation
**Dependencies:** None

- [x] 1.0 Complete backend JsonAlias annotations and validation
  - [x] 1.1 Write 2-4 focused tests for CreateProjectRequest deserialization
    - Test that snake_case payload (`project_parent_folder`, `set_active`) deserializes correctly
    - Test that camelCase payload (`projectParentFolder`, `setActive`) deserializes correctly
    - Test that validation rejects blank/null `name` with 400 response
    - Test that validation rejects blank/null `projectParentFolder` with 400 response
  - [x] 1.2 Add JsonAlias annotations to CreateProjectRequest record in ProjectController.java
    - Import `com.fasterxml.jackson.annotation.JsonAlias`
    - Add `@JsonAlias({"projectParentFolder", "project_parent_folder"})` to `projectParentFolder` component
    - Add `@JsonAlias({"setActive", "set_active"})` to `setActive` component
    - Preserve existing `effectiveSetActive()` method logic
  - [x] 1.3 Add validation in ProjectService.createProject()
    - Validate `name` is not blank, throw `IllegalArgumentException("Project name is required")` if blank
    - Validate `parentFolder` is not blank/null, throw `IllegalArgumentException("Project parent folder is required")` if invalid
    - Leverage existing GlobalExceptionHandler which returns 400 for IllegalArgumentException
  - [x] 1.4 Ensure backend tests pass
    - Run ONLY the 2-4 tests written in 1.1
    - Verify both camelCase and snake_case payloads deserialize correctly
    - Verify validation returns appropriate 400 responses

**Acceptance Criteria:**
- The 2-4 tests written in 1.1 pass
- POST /api/projects accepts both camelCase and snake_case JSON keys
- Validation returns 400 with descriptive message for missing required fields
- No changes to global Jackson configuration

**Files Modified:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectControllerTest.java` (new or updated)

---

### Frontend Layer

#### Task Group 2: Frontend snake_case DTO Mapping
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend snake_case to camelCase mapping
  - [x] 2.1 Define ProjectDtoSnake interface in projectsApi.ts
    - Add private interface with snake_case fields: `id`, `name`, `project_parent_folder`, `is_active`, `created_at`, `updated_at`
    - Keep interface unexported (internal to projectsApi.ts)
    - Follow pattern established in workItemsApi.ts
  - [x] 2.2 Create mapProjectFromSnake mapping function
    - Implement `mapProjectFromSnake(dto: ProjectDtoSnake): ProjectDto`
    - Map: `project_parent_folder` -> `projectParentFolder`
    - Map: `is_active` -> `isActive`
    - Map: `created_at` -> `createdAt`
    - Map: `updated_at` -> `updatedAt`
    - Pass through `id` and `name` unchanged
  - [x] 2.3 Update createProject to send snake_case payload
    - Change request body to use `project_parent_folder` key
    - Change request body to use `set_active` key
    - Parse response as `ProjectDtoSnake` and map through `mapProjectFromSnake`
    - Preserve existing error handling pattern
  - [x] 2.4 Update listProjects to map snake_case response
    - Parse response as `ProjectDtoSnake[]`
    - Map each item through `mapProjectFromSnake`
    - Return `ProjectDto[]` to callers
  - [x] 2.5 Update getActiveProject to map snake_case response
    - Parse response as `ProjectDtoSnake`
    - Map through `mapProjectFromSnake` before returning
    - Preserve existing 404 -> null handling
  - [x] 2.6 Update activateProject to map snake_case response
    - Parse response as `ProjectDtoSnake`
    - Map through `mapProjectFromSnake` before returning
    - Preserve existing error handling pattern

**Acceptance Criteria:**
- All project API functions send/receive snake_case on the wire
- All project API functions return camelCase ProjectDto to callers
- UI code continues to work with camelCase fields without changes
- Error messages from backend validation are surfaced to UI

**Files Modified:**
- `frontend/src/api/projectsApi.ts`

---

### Integration Verification

#### Task Group 3: End-to-End Verification
**Dependencies:** Task Groups 1-2

- [x] 3.0 Verify end-to-end fix
  - [x] 3.1 Manual verification of Create Project flow
    - Start backend and frontend locally
    - Open Create Project modal
    - Enter project name and parent folder
    - Submit and verify project is created successfully (no DB constraint error)
    - Verify project appears in project list with correct parent folder
  - [x] 3.2 Verify validation error surfacing
    - Attempt to create project with empty name (if UI allows)
    - Verify 400 error message is displayed to user
  - [x] 3.3 Verify existing functionality unchanged
    - List projects still displays correctly
    - Get active project still works
    - Activate project still works

**Acceptance Criteria:**
- Creating a project with parent folder succeeds without DB constraint error
- Backend persists non-null `project_parent_folder` value
- Frontend displays projects correctly with all fields populated
- Validation errors are surfaced to the user

---

## Execution Order

Recommended implementation sequence:

1. **Backend JsonAlias and Validation (Task Group 1)** - Add annotations and validation first since backend can be tested independently
2. **Frontend snake_case DTO Mapping (Task Group 2)** - Update frontend to align with backend expectations
3. **End-to-End Verification (Task Group 3)** - Verify the complete fix works together

## Summary of Files to Modify

### Backend
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ProjectService.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ProjectControllerTest.java`

### Frontend
- `frontend/src/api/projectsApi.ts`
