# Add Project Snapshot JSON Export (Active Project) via Backend Endpoint

## Title
Add Project Snapshot JSON export (active project) via backend endpoint

## Intent
Replace the current incomplete frontend-only JSON export with a backend-generated "Project Snapshot" JSON that contains all persisted state for the ACTIVE project (as stored in the DB), so it can be shared and later imported to recreate the project exactly.

This spec implements ONLY:
- ProjectSnapshotDto
- GET export endpoint for the active project

(scope for import + frontend wiring will be separate write-specs)

## Scope
- Backend (architecture-model-service) only
- No schema changes
- No frontend changes

## Non-Goals
- Import endpoint
- Changing existing /api/model behavior
- Changing current frontend JSON export/import code (handled later)

---

## Requirements

### 1) Project Snapshot DTO (single JSON payload)
Create a DTO representing a full active-project export.

Must include at minimum:
a) **Project identity/config**
   - project: { id, name, project_parent_folder, is_active, created_at, updated_at }

b) **Architecture model file state equivalent to Save/Open**
   - model: the same payload returned by existing GET /api/model for the currently-opened/active filename context
     (i.e., metaModel.entities + metaModel.relationships + diagrams, and any other model sections you already persist)

c) **Work items**
   - work_items: all work items for the active project (initiatives, epics, features, stories), including hierarchy fields and status, as returned by current work-items API layer

d) **Project artifacts (imported/derived)**
   - artifacts: all persisted artifacts for the active project (including mission/roadmap imports if stored), sufficient for the UI to render "Last imported" status and artifact content as it does today.
   - Include revision/timestamp/source metadata you already persist.

### 2) Snapshot metadata
Include snapshot metadata fields:
- `snapshot_version`: integer (start at 1)
- `exported_at`: ISO-8601 timestamp (UTC)
- Include a stable `export_kind` string, e.g. "PROJECT_SNAPSHOT"

### 3) Export endpoint
Add an endpoint:
- `GET /api/projects/active/export`

Behavior:
- Resolve active project (same logic as existing "get active project")
- If no active project, return 404 with message: "No active project."
- Aggregate and return ProjectSnapshotDto in one response
- Response must be application/json.

### 4) Data sourcing rules

**Project:**
- from projects table active row

**Model:**
- must reflect what the tool considers the current persisted model for that active project:
  - If your model persistence is keyed by "filename"/model_file tied to the project name, use that.
  - The filename used must be the same one shown in UI after Save (which equals project name).
- If there is no model_file yet, return an empty/default model (same as new file) rather than failing.

**Work items:**
- fetch all for that active project (all types)

**Artifacts:**
- include all artifacts stored for that project (or at least everything currently required to render Product screens).
- Prefer including full artifact contents if they are stored in DB and required for identical UI state.

### 5) Performance & safety
- Must run in a single request without requiring multiple client calls.
- Use read-only transaction if appropriate.
- Ensure no file-system reads are required for export (export is from DB state only).

---

## Implementation Details (Backend)

### A) DTOs
Create:
- `src/main/java/.../api/dto/ProjectSnapshotDto.java` (record)

Include nested records for:
- `SnapshotMeta` (snapshot_version, exported_at, export_kind)
- `ProjectDto` (reuse existing if available)
- `ModelDto` (reuse the existing /api/model response DTO type if one exists; do not duplicate)
- `WorkItemDto` list (reuse existing)
- `ArtifactDto` list (reuse existing)

Use existing Jackson SNAKE_CASE strategy; ensure keys are stable.

### B) Service aggregation
Create service:
- `ProjectSnapshotService`
- Method: `exportActiveProjectSnapshot()`: ProjectSnapshotDto

Steps:
1. project = ProjectService.getActiveOrThrow404()
2. model = ModelService.loadModelForFilename(project.name) OR equivalent internal load
   - If not found, use the default/empty model DTO builder
3. workItems = WorkItemService.listAllForProject(project.id)
4. artifacts = ArtifactService.listAllForProject(project.id) (and include latest metadata fields)
5. meta = new SnapshotMeta(version=1, exported_at=nowUtc, export_kind="PROJECT_SNAPSHOT")

### C) Controller
Add:
- `ProjectExportController` (or extend existing ProjectsController)

Endpoint:
- `GET /api/projects/active/export`
- returns ProjectSnapshotDto

### D) Tests
Add at least one integration test:
- When active project exists, endpoint returns 200 and includes:
  - project.name
  - snapshot_version=1
  - model present
  - work_items array present (possibly empty)
  - artifacts array present (possibly empty)
- When no active project, endpoint returns 404.

---

## Acceptance Criteria
1. GET /api/projects/active/export returns a single JSON containing:
   - snapshot metadata (version, exported_at, export_kind)
   - active project details
   - full model payload as persisted (or default empty if none)
   - all project work items
   - all project artifacts + relevant metadata
2. Endpoint returns 404 with clear message when there is no active project.
