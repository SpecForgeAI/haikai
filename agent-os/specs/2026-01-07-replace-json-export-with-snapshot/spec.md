# Specification: Replace JSON Export with Backend Project Snapshot

## Goal
Ensure "Export JSON" exports the full project by downloading the backend-generated Project Snapshot (from GET /api/projects/active/export), removing any legacy saveJsonFile usage from the Export JSON flow.

## User Stories
- As a user, I want to export my entire project (including Product/Delivery data) so that I have a complete backup of all project data
- As a user, I want clear error feedback when export fails so that I understand what went wrong

## Specific Requirements

**Export JSON must call backend snapshot endpoint**
- When user clicks File -> Export JSON, call GET /api/projects/active/export
- Download response JSON as a file using triggerDownload utility
- Do not serialize state.model directly
- Do not call saveJsonFile() for Export JSON flow

**Filename generation**
- Downloaded file must be named: `<activeProjectName>-snapshot.json`
- Use snapshot.project.name from the backend response
- Fallback to "project-snapshot.json" if name unavailable
- Sanitize filename using existing sanitizeFilename() utility (removes < > : " / \ | ? *)

**Error handling for no active project**
- If backend returns 404, show error: "No active project to export"
- Use existing ErrorModal pattern (setErrorModalOpen, setErrorMessages)

**Error handling for other failures**
- Show "Export failed" with the backend error message if available
- Catch exceptions from exportActiveProjectSnapshot and display via ErrorModal

**Remove legacy export code path**
- Ensure saveJsonFile is not imported in TopBar.tsx
- If saveJsonFile becomes completely unused after this change, consider removal from fileOperations.ts
- serializeModel may remain for test usage but should not be used in production export flow

## Visual Design
No visual mockups provided - uses existing ErrorModal and file download patterns.

## Existing Code to Leverage

**C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/api/projectSnapshotApi.ts**
- exportActiveProjectSnapshot(): Promise<ProjectSnapshotDto | null> already exists
- Returns null on 404 (no active project)
- Throws Error with backend message on other failures
- GET /api/projects/active/export endpoint

**C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/TopBar/TopBar.tsx**
- handleExportJsonClick() handler already implemented using exportActiveProjectSnapshot
- Uses ErrorModal pattern (errorModalOpen, errorMessages state)
- Currently imports exportActiveProjectSnapshot, sanitizeFilename, triggerDownload

**C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/fileOperations.ts**
- sanitizeFilename(name: string): string - removes invalid filename characters
- triggerDownload(content: string, filename: string, mimeType?: string): void - Blob + createObjectURL download pattern
- saveJsonFile() is defined but NOT imported/used in TopBar.tsx

**C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/TopBar/FileMenu.tsx**
- onExportJson prop wired to handleExportJsonClick in TopBar
- No changes needed to FileMenu component

## Out of Scope
- Changes to backend snapshot payload structure
- Changes to backend export endpoint implementation
- Retaining "architecture-only" export option
- Import flow (handled in separate spec)
- Changes to XLSX export functionality
- Changes to Save As... (backend model save) functionality
- Removing serializeModel from fileOperations.ts (used by tests)
- Adding new export file format options
- Export progress indicator or async export queue
- Batch/multi-project export
