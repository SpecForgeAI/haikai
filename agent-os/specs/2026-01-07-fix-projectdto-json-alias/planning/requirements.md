# Fix ProjectDto JSON deserialization to accept camelCase field names

## Title
Fix ProjectDto JSON deserialization to accept camelCase field names

## Intent
- Fix the "Project parent folder is required" error when importing a project snapshot that uses camelCase field names (projectParentFolder) instead of snake_case (project_parent_folder).
- Backend uses global SNAKE_CASE Jackson strategy, but imported JSON files may contain camelCase fields.
- Add @JsonAlias annotations to ProjectDto to accept both naming conventions.

## Scope
- Backend only: ProjectDto.java
- No frontend changes.
- No database/schema changes.

## Constraints
- Must preserve existing SNAKE_CASE output for API responses (no breaking changes).
- Must accept both camelCase and snake_case on input for backward compatibility.

## Work

### 1) Add @JsonAlias annotations to ProjectDto
- File: architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java
- Add import: com.fasterxml.jackson.annotation.JsonAlias
- Add @JsonAlias("projectParentFolder") to projectParentFolder field
- Add @JsonAlias("isActive") to isActive field
- Add @JsonAlias("createdAt") to createdAt field
- Add @JsonAlias("updatedAt") to updatedAt field

### 2) Add test for camelCase snapshot import
- Verify import succeeds when snapshot.project uses camelCase field names
- Verify effectiveProjectParentFolder() correctly reads from snapshot.project.projectParentFolder

## Acceptance Criteria
- Import succeeds when snapshot JSON contains "projectParentFolder" (camelCase).
- Import succeeds when snapshot JSON contains "project_parent_folder" (snake_case).
- Export continues to output snake_case field names (no change to output format).
- "Project parent folder is required" error no longer appears when override is unchecked and snapshot contains valid projectParentFolder.
