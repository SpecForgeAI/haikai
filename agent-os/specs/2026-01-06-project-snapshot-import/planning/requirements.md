# Import Project Snapshot JSON to Create a NEW Project (Backend)

## Title
Import Project Snapshot JSON to create a NEW project (backend) with full DB state restored

## Intent
Add a backend import endpoint that accepts a previously exported Project Snapshot JSON and creates a NEW project in the database that reproduces the exported project state (model, work items, artifacts) so another user can import and see the tool exactly as the exporter did.

This spec implements ONLY:
- POST import endpoint
- Transactional import service
- Deterministic restoration of all persisted state contained in the snapshot

(scope for frontend wiring is a separate write-spec)

## Scope
- Backend (architecture-model-service) only
- No frontend changes
- No new DB schema (reuse existing tables)
- May add small validation/error handling + tests

## Non-Goals
- Merging into an existing project
- Partial import (must be all-or-nothing)
- Editing/creating company-level standards files

---

## Requirements

### 1) Import Endpoint
Add endpoint:
- `POST /api/projects/import`

Request body:
- `ProjectSnapshotDto` (from export endpoint, snapshot_version=1)

Optional import options in request body (choose body for consistency):
- `import_as_name?`: string - overrides snapshot project name; if omitted use snapshot project name
- `project_parent_folder`: string - **REQUIRED** at import time (see rationale below)
- `set_active?`: boolean (default true)

**Rationale for requiring project_parent_folder:**
The exported snapshot's parent folder is a local path that will not be valid on a colleague's machine. Import must therefore allow/require specifying the local parent folder for the new project environment.

### 2) Import Behavior (Creates a NEW Project)
- Always creates a new project row.
- **Name:**
  - `newProjectName = import_as_name ?? snapshot.project.name`
- **Parent folder:**
  - `newParentFolder = request.project_parent_folder` (required, non-blank)
- **If a project with newProjectName already exists:**
  - Return 409 Conflict with message: "Project name already exists: <name>"
  - (Do not auto-suffix in v1 to keep deterministic & explicit.)

### 3) What Gets Restored
For the new project:

**Project row:**
- id: newly generated
- name: newProjectName
- project_parent_folder: newParentFolder
- is_active: set based on set_active (default true), ensuring only one active project globally

**Model (architecture meta-model + diagrams):**
- Persist the snapshot.model exactly as the tool does for Save/Open today.
- Use the same underlying ModelService save path used by File -> Save (filename == project name).

**Work items:**
- Persist all snapshot.work_items under the NEW project id.
- Preserve work item IDs from snapshot if possible.
- Preserve hierarchy (parent_id) and all fields required for Product screens.

**Artifacts:**
- Persist all snapshot.artifacts under the NEW project id.
- Preserve revision/metadata so "Last Imported" and other artifact-derived UI states match.

### 4) ID Preservation Policy
Preserve IDs from the snapshot for:
- work_items
- artifacts
- (model entities are saved by ModelService and will preserve whatever ids are in snapshot.model payload)

**If any snapshot ID already exists in the database (rare UUID collision but possible):**
- Fail the import with 409 Conflict and a clear message indicating the entity type and id
- Do NOT attempt to remap IDs in v1 (would require deep relationship rewriting and increases risk)

### 5) Transactionality and Consistency
- The import must be all-or-nothing:
  - Wrap in a single transaction
  - If any step fails, rollback and do not leave partial data
- If set_active=true:
  - Deactivate any currently active project in the same transaction

### 6) Validation
Reject with **400 Bad Request** if:
- snapshot_version unsupported
- request.project_parent_folder is missing/blank
- snapshot.model missing or invalid structure (null lists should be treated as empty, but structural absence should be rejected)

Reject with **409 Conflict** if:
- Project name exists
- ID collision detected for work items or artifacts

### 7) Response
Return **201 Created** with an ImportResultDto:
- `project`: newly created project (id, name, parent_folder, is_active)
- `counts`:
  - `model_saved`: boolean
  - `work_items_inserted`: int
  - `artifacts_inserted`: int
- `warnings`: string[] (optional; keep empty in v1 unless needed)

---

## Implementation Details (Backend)

### A) DTOs
Reuse `ProjectSnapshotDto` for request body.

Add:
- `ProjectSnapshotImportRequestDto`:
  - snapshot: ProjectSnapshotDto
  - import_as_name?: String
  - project_parent_folder: String (required)
  - set_active?: Boolean (default true)

- `ProjectSnapshotImportResultDto`:
  - project: ProjectDto
  - model_saved: boolean
  - work_items_inserted: int
  - artifacts_inserted: int
  - warnings: List<String>

### B) Service
Create: `ProjectSnapshotImportService`
- Method: `importSnapshot(ProjectSnapshotImportRequestDto req): ProjectSnapshotImportResultDto`

**Steps (transactional):**
1. Validate snapshot.meta.snapshot_version == 1
2. Determine newProjectName and validate uniqueness
3. Validate parent folder non-blank
4. Create new Project row
   - if set_active=true:
     - deactivate currently active project(s)
     - set new project active
5. Persist model:
   - Call existing ModelService save method used by File -> Save:
     - `saveModel(filename=newProjectName, model=req.snapshot.model)`
   - Ensure it creates/updates the model_file as normal
6. Persist work items:
   - Insert all snapshot.work_items with project_id=newProject.id
   - Preserve id, parent_id, type, status, name/title, and any other existing columns
   - If repository supports batch insert, use it
   - Detect ID collisions before insert:
     - for each work_item.id, check existence; if exists -> throw conflict
7. Persist artifacts:
   - Insert all snapshot.artifacts with project_id=newProject.id
   - Preserve ids + metadata
   - Collision check same as work items
8. Return counts

### C) Controller
Add endpoint handler:
- `POST /api/projects/import`
- Returns 201 with `ProjectSnapshotImportResultDto`

Error mapping:
- 400 for validation
- 409 for conflicts
- 500 for unexpected errors

### D) Tests
Integration tests:

1. **Happy path:**
   - Given an exported snapshot from an existing project
   - POST import with import_as_name + project_parent_folder
   - Returns 201
   - Created project exists
   - /api/model for that filename returns same model payload structure
   - Work items count matches snapshot

2. **Conflict name:**
   - import_as_name matches existing project -> 409

3. **Missing parent folder -> 400**

---

## Acceptance Criteria

1. POST /api/projects/import with a valid snapshot and a provided project_parent_folder creates a new project and restores:
   - Model state
   - All work items
   - All artifacts/metadata

2. Import is transactional (no partial restores on failure).

3. Name conflicts and ID collisions return clear 409 errors.

4. If set_active=true (default), the imported project becomes the only active project.
