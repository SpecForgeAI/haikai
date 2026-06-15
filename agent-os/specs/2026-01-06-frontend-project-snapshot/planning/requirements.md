# Replace JSON Export/Import with Project Snapshot Endpoints (Frontend)

## Title
Replace JSON Export/Import with Project Snapshot endpoints and refresh active project state (Frontend)

## Intent
Update the frontend "File -> Export/Import JSON" feature to export and import FULL project snapshots using the new backend endpoints, so a project can be exported and imported on another machine and appear exactly the same in the UI. Remove the legacy architecture-only JSON export/import implementation.

## Scope
- Frontend only
- Wiring + UI changes only
- No backend changes
- No schema changes

## Assumptions (Backend Already Implemented)
- `GET /api/projects/active/export` returns ProjectSnapshotDto JSON
- `POST /api/projects/import` accepts ProjectSnapshotImportRequestDto and returns ProjectSnapshotImportResultDto
  (requires project_parent_folder; supports import_as_name and set_active)

## Non-Goals
- UI to author company-level standards files
- Background/automatic exports/imports
- Partial imports/exports (must be snapshot)

---

## Requirements

### 1) Remove Legacy JSON Export/Import (Architecture-Only)
- Delete/stop using:
  - `saveJsonFile(state.model, filename)` and `loadJsonFile()` flows that serialize/deserialize ArchitectureModel directly
- "Export JSON" and "Import JSON" must now operate on the Project Snapshot endpoints ONLY.

### 2) File Menu Actions
File menu must contain:
- "Export JSON"
- "Import JSON"

**Export JSON:**
- Initiates download of the snapshot JSON returned from backend.

**Import JSON:**
- Opens a file picker to select a snapshot JSON file
- Prompts user to provide:
  - `project_parent_folder` (required)
  - optional: `import_as_name` (default from snapshot.project.name)
  - `set_active` (default true; can be a checkbox "Make imported project active")
- Sends request to backend import endpoint
- On success, refreshes the UI to show the newly imported active project state.

### 3) Export Behavior (Backend-Driven)
Clicking "Export JSON" must:
- Call `GET /api/projects/active/export`
- If 404 "No active project", show a clear error toast/dialog
- Download as a file named:
  - `<activeProjectName>-snapshot.json`
  (sanitize filename for OS compatibility)

### 4) Import Behavior (Backend-Driven)
Import flow must:

a) Read selected file contents as text

b) Parse as JSON (client-side) to extract snapshot.project.name for default display ONLY
   - If parse fails, show error and abort

c) Show Import modal with:
   - Snapshot name (read-only display): snapshot.project.name
   - "Import as name" input (default snapshot.project.name)
   - "Project parent folder" input (required)
   - "Make active" checkbox (default checked)
   - Buttons: Import, Cancel

d) On Import:
   - POST /api/projects/import with body:
     ```json
     {
       "snapshot": <full parsed snapshot json>,
       "import_as_name": <value if different or always>,
       "project_parent_folder": <required>,
       "set_active": <checkbox value>
     }
     ```
   - Handle errors:
     - 400: show backend message
     - 409: show backend message (name conflict / id collision)
     - others: generic failure message

e) On success:
   - Close modal
   - Refresh active project + model + product data so screens match imported project

### 5) Refresh State After Import (Critical)
After successful import, the frontend must refresh, at minimum:
- Active project state (`GET /api/projects/active`)
- Current model load (the same call you use after Open/Save to populate architecture meta-model + diagrams)
- Product data used by Product screens:
  - Work items list / roadmap/backlog data (whatever existing fetch calls populate ProductView)
  - Artifact-derived UI (e.g., last imported summary), if it is fetched separately

Use the same existing fetch functions/hooks to avoid duplicating logic.

### 6) UX Constraints
- Do not add new top-level navigation items.
- Keep changes localized to File menu + new import modal + API client.
- No background tasks; everything happens synchronously from user actions.

---

## Implementation Details

### A) API Client Additions
Add new file: `src/api/projectSnapshotApi.ts`
- `exportActiveProjectSnapshot()`: Promise<ProjectSnapshotDto>
- `importProjectSnapshot(req: ProjectSnapshotImportRequestDto)`: Promise<ProjectSnapshotImportResultDto>

### B) Replace Existing JSON File Utilities Usage
In `src/components/TopBar/TopBar.tsx` (or wherever File menu actions live):
- Replace current Export JSON handler:
  - Call `exportActiveProjectSnapshot()`
  - Download JSON using `Blob + URL.createObjectURL`
- Replace current Import JSON handler:
  - Open file input
  - Read file
  - Parse JSON
  - Open ImportProjectSnapshotModal

### C) New Modal Component
Add: `src/components/Project/ImportProjectSnapshotModal.tsx`

Props:
- isOpen, onClose
- snapshot (parsed JSON object) OR snapshotProjectName string and rawSnapshotJson
- onImported (callback)

Inputs:
- importAsName (default snapshot.project.name)
- projectParentFolder (required)
- setActive (default true)

Validation:
- Disable Import until projectParentFolder and importAsName are non-empty

On submit:
- Calls `importProjectSnapshot(...)`
- Displays inline error messages

### D) State Refresh Orchestration
After import success, run the same refresh sequence you use after:
- Creating/activating a project
- Opening a file/model

Examples (use whichever exists in your codebase):
- `refreshActiveProject()`
- `loadModelForCurrentFilenameOrProject()`
- `refreshWorkItems()`
- `refreshArtifactsStatus()`

If no single "refreshAll" exists, add one in the top-level app context (App.tsx or relevant provider) and reuse it.

### E) Remove Legacy Helpers If Unused
- If `src/utils/fileOperations.ts` functions `saveJsonFile`/`loadJsonFile` become unused after this change:
  - Remove them or leave but unused (prefer removal to prevent confusion)
- Ensure no other parts of the app still call architecture-only JSON import/export.

---

## Acceptance Criteria

1. Export JSON downloads a file containing the full Project Snapshot JSON from the backend.

2. Import JSON uploads a snapshot plus required project_parent_folder and creates a new project successfully.

3. After import, the UI refreshes automatically and displays the imported project as active, with:
   - Architecture meta-model + diagrams
   - Product work items / roadmap/backlog state
   - Artifact-derived "last imported"/status panels
   matching what was exported.

4. Legacy architecture-only JSON import/export is no longer used by the File menu.
