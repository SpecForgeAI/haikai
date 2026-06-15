# Specification: Project Snapshot JSON Import

## Goal
Add a backend import endpoint that accepts a previously exported Project Snapshot JSON and creates a NEW project in the database, restoring the complete exported state (model, work items, artifacts) so another user can import and see the tool exactly as the exporter did.

## User Stories
- As an architect, I want to import a Project Snapshot JSON file so that I can recreate a colleague's project environment on my machine
- As a team lead, I want to share project snapshots with team members so that everyone can work from the same baseline architecture model

## Specific Requirements

**POST /api/projects/import Endpoint**
- Accepts ProjectSnapshotImportRequestDto as request body containing the snapshot and import options
- Returns 201 Created with ProjectSnapshotImportResultDto on success
- Returns 400 Bad Request for validation errors (unsupported snapshot_version, missing parent folder, invalid model structure)
- Returns 409 Conflict for name collisions or ID collisions
- Endpoint handler in ProjectController following existing endpoint patterns

**ProjectSnapshotImportRequestDto Structure**
- snapshot: ProjectSnapshotDto (required) - the exported snapshot data to import
- import_as_name: String (optional) - overrides snapshot project name; if omitted, uses snapshot.project.name
- project_parent_folder: String (required) - local path for the new project environment
- set_active: Boolean (optional, default true) - whether to activate the imported project

**ProjectSnapshotImportResultDto Structure**
- project: ProjectDto - the newly created project with id, name, projectParentFolder, isActive
- model_saved: boolean - indicates whether model was successfully persisted
- work_items_inserted: int - count of work items imported
- artifacts_inserted: int - count of artifacts imported
- warnings: List<String> - optional warnings (empty in v1)

**ProjectSnapshotImportService Transactional Logic**
- Single @Transactional method ensuring all-or-nothing import
- On any failure, rollback leaves no partial data in database
- If set_active=true, deactivate all existing projects before creating new one
- Steps: validate snapshot version, validate parent folder, check name uniqueness, create project, persist model, persist work items, persist artifacts

**Snapshot Version Validation**
- Check snapshot.meta.snapshot_version == 1 (only supported version)
- Reject with 400 Bad Request if version is unsupported or missing
- Future versions may require migration logic but v1 implementation only supports version 1

**Project Name Uniqueness**
- Determine newProjectName = import_as_name ?? snapshot.project.name
- Query ProjectRepository to check if project with newProjectName already exists
- Reject with 409 Conflict and message "Project name already exists: <name>" if duplicate found
- Do NOT auto-suffix names in v1 to maintain deterministic behavior

**Model Persistence via ModelService.saveModel()**
- Call existing ModelService.saveModel(filename=newProjectName, model=snapshot.model)
- This creates or updates model_file and persists all entities, relationships, and diagrams
- Reuses the same truncate-and-insert strategy used by File -> Save operation
- Model entities preserve their IDs from the snapshot as-is

**Work Items Import with ID Preservation**
- Insert all snapshot.work_items with project_id=newProject.id.toString()
- Preserve original work item IDs (UUID) from snapshot
- Preserve parent_id references and all fields (type, status, title, description, sort_order, priority, target_window, tags, external_system, external_key)
- Before insert, check if any work_item.id already exists in database via WorkItemRepository.existsById()
- If collision detected, throw 409 Conflict with message indicating entity type and id

**Artifacts Import with ID Preservation**
- Insert all snapshot.artifacts with project_id=newProject.id.toString()
- Preserve original artifact IDs (UUID), revision numbers, content, source, and created_at timestamps
- Before insert, check if any artifact.id already exists via ProjectArtifactRepository.existsById()
- If collision detected, throw 409 Conflict with message indicating entity type and id

## Visual Design
No visual mockups provided - backend-only specification.

## Existing Code to Leverage

**ProjectSnapshotDto and SnapshotMeta (export DTOs)**
- Location: model/dto/export/ProjectSnapshotDto.java, SnapshotMeta.java
- Reuse ProjectSnapshotDto as the snapshot field type in the import request
- SnapshotMeta contains snapshot_version field to validate (must equal 1)

**ModelService.saveModel()**
- Location: service/ModelService.java
- Method signature: saveModel(String filename, ArchitectureModelDto model)
- Handles truncate-and-insert of all entities, relationships, and diagrams for a model file
- Creates model_file row if not exists, updates if exists

**ProjectService.createProject()**
- Location: service/ProjectService.java
- Method signature: createProject(String name, String parentFolder, boolean setActive)
- Handles project creation with deactivateAll() if setActive=true
- Validates required fields and returns ProjectDto

**WorkItemRepository and ProjectArtifactRepository**
- Locations: repository/entity/WorkItemRepository.java, repository/entity/ProjectArtifactRepository.java
- Both extend JpaRepository with existsById() method for collision detection
- Both support saveAll() for batch insert operations
- Both have deleteByProjectId() for cleanup if needed

**ProjectController Endpoint Patterns**
- Location: controller/ProjectController.java
- Follow existing patterns: @PostMapping, @RequestBody for request DTO, ResponseEntity with HttpStatus.CREATED
- Existing export endpoint at /api/projects/active/export returns ProjectSnapshotDto

## Out of Scope
- Merging import into an existing project (creates NEW project only)
- Partial import or selective entity import (all-or-nothing)
- Automatic ID remapping on collision (fail fast with 409 instead)
- Frontend UI for import (separate spec)
- Editing or creating company-level standards files
- Support for snapshot_version other than 1
- Auto-suffixing project names on collision
- Validation of work item parent hierarchy during import (trust snapshot structure)
- Migration or upgrade of snapshot schema versions
