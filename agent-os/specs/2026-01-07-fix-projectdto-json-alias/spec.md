# Specification: Fix ProjectDto JSON Deserialization

## Goal
Add @JsonAlias annotations to ProjectDto record fields to accept camelCase field names during JSON deserialization, fixing the "Project parent folder is required" error when importing project snapshots that use camelCase instead of snake_case.

## User Stories
- As a user importing a project snapshot, I want the import to succeed regardless of whether the JSON uses camelCase or snake_case field names so that legacy or externally generated snapshots work correctly.
- As a developer, I want backward compatibility maintained so that existing API responses continue to use snake_case without breaking clients.

## Specific Requirements

**Add @JsonAlias annotations to ProjectDto**
- File: architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ProjectDto.java
- Add import statement for com.fasterxml.jackson.annotation.JsonAlias
- Add @JsonAlias("projectParentFolder") to the projectParentFolder field
- Add @JsonAlias("isActive") to the isActive field
- Add @JsonAlias("createdAt") to the createdAt field
- Add @JsonAlias("updatedAt") to the updatedAt field
- Fields id and name do not need @JsonAlias as they are the same in both conventions

**Preserve SNAKE_CASE output for API responses**
- Do NOT add @JsonProperty annotations that would change output format
- The global Jackson SNAKE_CASE strategy (configured in application.yml) must continue to apply for serialization
- @JsonAlias only affects deserialization input, not serialization output
- API responses must continue to return project_parent_folder, is_active, created_at, updated_at

**Unit test for camelCase snapshot import**
- Add test to ProjectSnapshotImportServiceTest verifying import succeeds with camelCase JSON
- Test should construct a ProjectDto using camelCase field names in raw JSON
- Verify effectiveProjectParentFolder() correctly reads from snapshot.project.projectParentFolder
- Verify no "Project parent folder is required" error is thrown

**Integration test for deserialization**
- Add test that deserializes raw JSON with camelCase field names into ProjectDto
- Verify all fields (projectParentFolder, isActive, createdAt, updatedAt) are correctly populated
- Use ObjectMapper with SNAKE_CASE strategy to simulate production configuration

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**ProjectSnapshotImportRequestDto @JsonAlias pattern**
- File: architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/export/ProjectSnapshotImportRequestDto.java
- Uses @JsonAlias for importAsName, projectParentFolder, and setActive fields
- Pattern: @JsonAlias({"camelCase", "snake_case"}) on each field
- Proves the approach works within this codebase and with the global SNAKE_CASE Jackson config

**CreateProjectRequest @JsonAlias pattern**
- File: architecture-model-service/src/main/java/com/example/architecturemodel/controller/ProjectController.java (inner record)
- Uses @JsonAlias({"projectParentFolder", "project_parent_folder"}) and @JsonAlias({"setActive", "set_active"})
- Demonstrates pattern for accepting both naming conventions on input

**DiagramDto @JsonAlias pattern**
- File: architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/diagram/DiagramDto.java
- Uses @JsonAlias({ "type", "diagramType" }) for the diagramType field
- Shows @JsonAlias can accept multiple alternative names

**ProjectSnapshotImportServiceTest test patterns**
- File: architecture-model-service/src/test/java/com/example/architecturemodel/service/ProjectSnapshotImportServiceTest.java
- Contains ParentFolderFallbackTests nested class with relevant test patterns
- Uses effectiveProjectParentFolder() assertions to verify fallback behavior
- Provides template for new camelCase deserialization tests

**application.yml Jackson configuration**
- File: architecture-model-service/src/main/resources/application.yml
- Configures spring.jackson.property-naming-strategy: SNAKE_CASE globally
- Root cause: this strategy causes Jackson to expect snake_case during deserialization by default

## Out of Scope
- Frontend changes (this is a backend-only fix)
- Database schema changes
- Changes to the Jackson global SNAKE_CASE configuration
- Adding @JsonProperty annotations to ProjectDto (would duplicate output field names)
- Modifying other DTOs besides ProjectDto
- Changes to export format (must continue outputting snake_case)
- Changes to ProjectSnapshotImportRequestDto (already has @JsonAlias)
- Changes to ProjectSnapshotDto wrapper (issue is in nested ProjectDto)
- Performance optimizations
- API documentation updates
