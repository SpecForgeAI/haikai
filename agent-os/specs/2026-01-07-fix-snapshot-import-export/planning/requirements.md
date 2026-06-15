# Fix Project Snapshot Import/Export Mismatch and Make Name/Folder Overrides Optional

## Title
Fix Project Snapshot import/export mismatch (missing meta) and make name/folder overrides optional via checkbox

## Intent
Fix the current Project Snapshot import failure ("Snapshot metadata is required") by ensuring snapshot metadata is preserved through the export/import flow, and update the Import Project Snapshot modal so that "Import As Name" and "Project Parent Folder" are OPTIONAL, controlled by a new "Override Project Name/Folder?" checkbox.

This spec also makes import robust by allowing project parent folder to default from the snapshot when not overridden.

## Scope
- **Backend (architecture-model-service):**
  - Make snapshot metadata validation backward-compatible (optional)
  - Allow project_parent_folder to be omitted and default from snapshot.project.projectParentFolder
- **Frontend:**
  - Fix snapshot DTO mapping so export includes meta/work_items/artifacts and import sends them intact
  - Update ImportProjectSnapshotModal UX per requirement (override checkbox + optional fields)

## Non-Goals
- Any new "legacy architecture-only JSON" actions (we have only snapshot export/import)
- UI to author company-level standards files
- Additional project merge logic (import still creates new project)

---

## Problem Summary (Root Cause)

- Backend import requires snapshot.meta (version, exported_at, export_kind).
- The frontend export/import client currently uses an outdated ProjectSnapshotDto shape (project/model/productData), and its mapping strips/omits the meta/work_items/artifacts fields produced by the backend export endpoint.
- **Result:** Imported snapshot sent back to backend lacks meta → backend throws "Snapshot metadata is required".

---

## Requirements

### A) Backend: Import Should Accept Omitted project_parent_folder Unless User Explicitly Overrides

#### 1) ProjectSnapshotImportRequestDto
Add helper method:
```java
public String effectiveProjectParentFolder() {
    if (projectParentFolder != null && !projectParentFolder.isBlank()) {
        return projectParentFolder;
    }
    if (snapshot != null && snapshot.project() != null &&
        snapshot.project().projectParentFolder() != null &&
        !snapshot.project().projectParentFolder().isBlank()) {
        return snapshot.project().projectParentFolder();
    }
    return null;
}
```

#### 2) ProjectSnapshotImportService Validation
- Replace `validateProjectParentFolder(request.projectParentFolder())` with:
  `validateProjectParentFolder(request.effectiveProjectParentFolder())`
- When creating project, pass effective parent folder:
  `projectService.createProject(newProjectName, effectiveParentFolder, request.effectiveSetActive())`

#### 3) Snapshot Meta Validation (Backward Compatibility)
Keep meta required for v1 snapshots going forward, BUT accept older snapshots gracefully:
- If `snapshot.meta` is null:
  - Treat as version 1 (SUPPORTED_SNAPSHOT_VERSION) and continue
  - Log a warning: "importing legacy snapshot without meta"
- If `snapshot.meta` exists:
  - Validate `snapshot.meta.snapshotVersion == 1` as today

This ensures importing previously-exported-but-stripped snapshots doesn't hard fail.

---

### B) Frontend: Export/Import Must Preserve Snapshot Meta + work_items + artifacts

#### 1) Update Snapshot API Client Types to Match Backend
Update `src/api/projectSnapshotApi.ts`:
- Replace the outdated `ProjectSnapshotDto` that has `productData` with the real snapshot shape:
  - `meta`: `{ snapshot_version, exported_at, export_kind }` (or camelCase if you map)
  - `project`: `ProjectDto` (existing)
  - `model`: `ArchitectureModelDto` (existing model payload)
  - `workItems` / `work_items`: `WorkItemDto[]` (use `unknown[]` if you don't have typed DTOs)
  - `artifacts`: `ProjectArtifactDto[]` (`unknown[]` ok for now)
- Ensure `importProjectSnapshot` sends the snapshot INCLUDING meta/work_items/artifacts.

#### 2) Export: Save the Raw Backend Snapshot JSON As-Is
In TopBar (File -> Export JSON):
- Use `exportActiveProjectSnapshot()` and download exactly what backend returns
- Do NOT remap/reshape snapshot in a way that drops meta/work_items/artifacts
- Filename remains: `<projectName>-snapshot.json`

#### 3) Import: Do Not Reshape Snapshot in a Way That Drops Meta
When reading the JSON file client-side:
- Parse into an object
- Use `snapshot.project.name` for display default
- Send the parsed object back to backend in the import request (no lossy mapping)

---

### C) Frontend: Import Modal UX Change (Override Checkbox; Optional Fields)

#### 1) Change Defaults
- "Make imported project active" checkbox:
  - MUST remain checked by default (current behavior)
- Add new checkbox below it:
  - Label: "Override Project Name/Folder?"
  - Default: unchecked

#### 2) Conditional Fields
**When "Override Project Name/Folder?" is unchecked:**
- Hide "Import As Name" and "Project Parent Folder" inputs
- Import uses snapshot defaults:
  - `import_as_name` omitted (backend uses `snapshot.project.name`)
  - `project_parent_folder` omitted (backend uses `snapshot.project.projectParentFolder` via `effectiveProjectParentFolder()`)

**When "Override Project Name/Folder?" is checked:**
- Show both inputs:
  - Import As Name (optional)
  - Project Parent Folder (optional)
- Pre-fill them with snapshot defaults for convenience:
  - Import As Name default value = `snapshot.project.name`
  - Project Parent Folder default value = `snapshot.project.projectParentFolder`
- If user clears either, it should be treated as "not overriding" for that field.

#### 3) Validation
- Modal "Import" button should be enabled as long as:
  - Snapshot JSON is present/parsed
  - (No requirement for name/folder unless you want to enforce non-empty overrides; do NOT enforce)
- Show backend errors inline as today.

---

## Implementation Details

### Backend Changes

**1) Update ProjectSnapshotImportRequestDto**
- Add method: `effectiveProjectParentFolder()` (as described)

**2) Update ProjectSnapshotImportService**
- Use `request.effectiveProjectParentFolder()` for validation and project creation
- Adjust `validateSnapshotVersion`:
  - If `snapshot.meta == null` -> accept as legacy (assume version 1)
  - Else validate normally

**3) Add/adjust tests:**
- Import succeeds when project_parent_folder omitted but `snapshot.project.projectParentFolder` is present
- Import succeeds when snapshot.meta omitted (legacy) but `snapshot.project` exists

### Frontend Changes

**1) Update projectSnapshotApi.ts**
- Replace `ProductDataDto` and any mapping that expects `product_data`
- Ensure `exportActiveProjectSnapshot` returns full snapshot including meta/work_items/artifacts
- Ensure `importProjectSnapshot` posts snapshot without stripping fields

**2) Update ImportProjectSnapshotModal.tsx**
- Add state: `overrideNameFolder` (boolean, default false)
- Move the "Import As Name" + "Project Parent Folder" inputs under conditional rendering:
  - Only render when `overrideNameFolder == true`
- Place override checkbox directly below "Make imported project active"
- When `overrideNameFolder` toggled on: initialize fields to snapshot defaults if currently empty
- When `overrideNameFolder` toggled off: do not require fields; import should omit them (send undefined)

**3) Update request payload in modal**
- If `overrideNameFolder` is false:
  - Call `importProjectSnapshot({ snapshot: rawSnapshotJson, setActive })`
- If true:
  - Call `importProjectSnapshot({ snapshot, setActive, importAsName: trimmedOrUndefined, projectParentFolder: trimmedOrUndefined })`

(Note: `projectParentFolder` becomes optional because backend now supports fallback.)

---

## Acceptance Criteria

1. Import no longer fails with "Snapshot metadata is required" when using the updated export JSON.
2. Exported JSON contains snapshot meta + work_items + artifacts (as produced by backend).
3. Import modal shows:
   - "Make imported project active" (checked by default)
   - "Override Project Name/Folder?" below it (unchecked by default)
   - "Import As Name" and "Project Parent Folder" fields ONLY appear when override checkbox is checked
4. Import works when override checkbox is unchecked (name/folder default from snapshot).
5. Import works when override checkbox is checked and user overrides either name and/or folder.
