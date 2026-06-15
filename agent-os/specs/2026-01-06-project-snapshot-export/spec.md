# Specification: Project Snapshot JSON Export

## Goal
Provide a backend endpoint that exports a complete JSON snapshot of the active project, including project identity, architecture model, work items, and artifacts, enabling future import functionality and replacing the incomplete frontend-only export.

## User Stories
- As a user, I want to export my active project as a single JSON file so that I can share it or back it up for later import.
- As a user, I want the export to include all persisted state (model, work items, artifacts) so that I can recreate the project exactly when importing.

## Specific Requirements

**ProjectSnapshotDto structure**
- Create a Java record `ProjectSnapshotDto` as the root response type
- Include nested `SnapshotMeta` record with: snapshot_version (Integer, starts at 1), exported_at (Instant, UTC), export_kind (String, value "PROJECT_SNAPSHOT")
- Include `project` field using existing `ProjectDto`
- Include `model` field using existing `ArchitectureModelDto` (same payload as GET /api/model)
- Include `work_items` field as List of existing `WorkItemDto`
- Include `artifacts` field as List of existing `ProjectArtifactDto`
- Place DTO in `com.example.architecturemodel.model.dto.export` package following existing pattern

**SnapshotMeta nested record**
- Define as inner record within ProjectSnapshotDto or as separate file in export package
- Use @JsonProperty annotations for snake_case serialization consistent with other DTOs
- snapshot_version: Integer value 1 for initial implementation (allows future schema evolution)
- exported_at: Instant serialized as ISO-8601 UTC timestamp
- export_kind: String constant "PROJECT_SNAPSHOT" to identify the export type

**ProjectSnapshotService**
- Create new service class in `com.example.architecturemodel.service` package
- Inject ProjectService, ModelService, WorkItemService, ProjectArtifactService, ProjectArtifactRepository
- Implement `exportActiveProjectSnapshot()` method returning `ProjectSnapshotDto`
- Mark method with @Transactional(readOnly = true) for consistent read snapshot

**Service aggregation logic**
- Step 1: Call `projectService.getActiveProject()` to get active ProjectDto (throws 404 if none)
- Step 2: Load model using `modelService.loadModel(project.name())` where project name is the filename
- Step 3: If model not found (ResourceNotFoundException), create empty/default ArchitectureModelDto instead of failing
- Step 4: Fetch work items via `workItemService.getWorkItems(project.id().toString(), null, null)`
- Step 5: Fetch all artifacts via `projectArtifactRepository.findByProjectIdOrderByCreatedAtDesc(project.id().toString())`
- Step 6: Build SnapshotMeta with version=1, exported_at=Instant.now(), export_kind="PROJECT_SNAPSHOT"
- Return assembled ProjectSnapshotDto

**GET /api/projects/active/export endpoint**
- Add endpoint in existing `ProjectController` (extends current /api/projects path structure)
- Path: GET /api/projects/active/export
- Response 200: ProjectSnapshotDto (application/json)
- Response 404: When no active project exists, return error body with message "No active project."
- Inject ProjectSnapshotService into ProjectController

**Error handling**
- Leverage existing GlobalExceptionHandler for ResourceNotFoundException -> 404
- If model file not found for project name, service handles gracefully by returning empty model
- Validation errors (from downstream services) bubble up as 400 Bad Request

**Empty/default model handling**
- When no model file exists for the project name, return empty ArchitectureModelDto
- Empty model structure: metaModel with empty entities/relationships, empty diagrams list
- Follow existing pattern in ModelService.loadModel for handling missing files

## Visual Design
No visual mockups provided - this is a backend-only feature.

## Existing Code to Leverage

**ProjectService (src/main/java/.../service/ProjectService.java)**
- Reuse `getActiveProject()` method which returns ProjectDto or throws ResourceNotFoundException
- Existing method already handles the "No active project" 404 scenario
- Follow the @Transactional(readOnly = true) pattern for read operations

**ModelService (src/main/java/.../service/ModelService.java)**
- Reuse `loadModel(String filename)` method which returns ArchitectureModelDto
- Uses project name as filename for model file lookup
- Handle ResourceNotFoundException by building empty model with default structure

**WorkItemService (src/main/java/.../service/WorkItemService.java)**
- Reuse `getWorkItems(String projectId, String type, UUID parentId)` method
- Call with null type and null parentId to get all work items for project
- Returns List of WorkItemDto with proper ordering

**ProjectArtifactService/Repository**
- Use ProjectArtifactRepository.findByProjectIdOrderByCreatedAtDesc to get all artifacts
- Alternative: Add getAllArtifactsForProject method to ProjectArtifactService if needed
- Returns List of ProjectArtifactDto including all artifact types and revisions

**Export DTO patterns (src/main/java/.../model/dto/export/)**
- Follow ProjectContextPackageDto pattern for record structure and @JsonProperty usage
- Use snake_case for JSON property names via @JsonProperty annotations
- Place new DTO in same export package for consistency

## Out of Scope
- Import endpoint (POST /api/projects/import) - separate spec
- Frontend changes to wire up the new export endpoint
- Modifying existing GET /api/model behavior
- Database schema changes
- File system writes (export is in-memory JSON response only)
- Export of non-active projects by ID
- Incremental/differential exports
- Compression or streaming of large exports
- Authentication/authorization changes
- Export format versioning migration logic (version field is for future use only)
