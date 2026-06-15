# Replace JSON export to use backend Project Snapshot export endpoint (full project export)

## Title
Replace JSON export to use backend Project Snapshot export endpoint (full project export)

## Intent
Ensure "Export JSON" exports EVERYTHING for the active project by downloading the backend-generated Project Snapshot
(from GET /api/projects/active/export), rather than exporting the frontend-only ArchitectureModel via
saveJsonFile(state.model,...). This fixes missing Product/Delivery data in exported JSON.

## Scope
- frontend only
- update File menu Export JSON action
- remove legacy saveJsonFile usage from Export JSON flow
- no backend changes (assumes snapshot export endpoint already exists)
- import flow is out of scope in this spec (handled separately)

## Non-Goals
- Any changes to snapshot payload structure
- Any changes to backend export implementation
- Retaining "architecture-only" export option (explicitly not wanted)

## Requirements

### 1) Export JSON must call backend snapshot endpoint
- When user clicks File -> Export JSON:
  - Call GET /api/projects/active/export
  - Download response JSON as a file
- Do not serialize state.model directly and do not call saveJsonFile().

### 2) Filename
- The downloaded file name must be:
  - <activeProjectName>-snapshot.json
- If activeProjectName is unavailable, fall back to:
  - project-snapshot.json
- Sanitize filename for Windows/macOS/Linux (remove invalid characters).

### 3) Error handling
- If backend returns 404 (no active project):
  - show a clear user error message (toast/banner/modal consistent with existing patterns)
- For other errors:
  - show "Export failed" with the backend message if available.

### 4) Remove legacy export code path
- Ensure Export JSON no longer imports/uses:
  - saveJsonFile(...) or serializeModel(state.model)
- If saveJsonFile becomes unused after this change, remove it or leave it unused (prefer removal if truly unused).

## Implementation Details

### A) API client
- Add/ensure API function exists:
  - src/api/projectSnapshotApi.ts
    - exportActiveProjectSnapshot(): Promise<any> (or typed ProjectSnapshotDto)
  - This must call:
    - GET /api/projects/active/export

### B) TopBar / File menu wiring
- In the file menu handler (TopBar.tsx or equivalent):
  - Replace current Export JSON handler:
    - old: saveJsonFile(state.model, fileName)
    - new:
      1) const snapshot = await exportActiveProjectSnapshot()
      2) const json = JSON.stringify(snapshot, null, 2)
      3) create Blob and trigger download (<name>-snapshot.json)

### C) Download helper
- Use existing file download helper if present; otherwise implement a small utility:
  - create Blob([json], { type: 'application/json' })
  - createObjectURL
  - anchor.click()
  - revokeObjectURL

### D) Active project name source
- Use the same source used to show project name in top-right:
  - activeProject?.name OR currentFilename
- Prefer activeProject.name for snapshot filename.

## Acceptance Criteria
- Export JSON downloads a file whose contents match the backend /api/projects/active/export response.
- Exported JSON includes project + model + product/work items/artifacts (i.e., not just ArchitectureModel).
- No code path remains that exports state.model via saveJsonFile for Export JSON.
- Clear error shown if there is no active project to export.
