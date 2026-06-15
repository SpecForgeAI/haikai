# Specification: Export Project Name Prompt

## Goal
Ensure that every JSON or XLSX export includes a project name by prompting the user via a modal dialog when the active project name is unset, embedding the name in the export payload, including it in the filename, and persisting it as the active project name in the UI state.

## User Stories
- As a user, I want to be prompted for a project name when exporting if one is not already set, so that my exports always have meaningful identification.
- As a user, I want the project name I enter to be saved as the active project name, so I do not need to re-enter it for subsequent operations.
- As a user, I want imported files with project names to automatically set my active project name, so the context is preserved across export/import cycles.

## Specific Requirements

**ExportProjectNameModal Component**
- Create a new modal component following the ImportModeModal and CreateProjectModal patterns
- Single text input field labeled "Project Name"
- Two buttons: "Export" (primary) and "Cancel" (secondary)
- Input field should auto-focus when modal opens
- Enter key triggers "Export" when input is valid (non-empty after trim)
- Escape key triggers "Cancel"
- Show inline error message when user attempts to export with empty/whitespace-only name
- Modal should block interaction with underlying UI until dismissed

**Export Flow Integration for JSON**
- In TopBar.tsx handleExportJsonClick, check if state.loadedFileName is falsy (project name unset)
- If unset, show ExportProjectNameModal instead of proceeding with export
- On modal confirm: dispatch LOAD_MODEL or new action to set loadedFileName, then proceed with export using entered name
- On modal cancel: do nothing, return to normal UI state
- If project name already set, proceed with export immediately (no modal)

**Export Flow Integration for XLSX**
- In TopBar.tsx handleExportXlsxClick, apply same check for state.loadedFileName
- If unset, show ExportProjectNameModal
- On confirm: set active project name, call exportMetaModelToExcel with the entered name
- On cancel: abort export without changes

**Project Name in Export Payload (JSON)**
- The existing exportActiveProjectSnapshot already includes project.name in snapshot
- Ensure the project name is passed correctly when export is triggered after modal confirmation
- The snapshot JSON structure already contains project metadata at top level

**Project Name in Export Payload (XLSX)**
- Add a new "_metadata" worksheet as the first sheet in the workbook
- Include a single row with columns: "project_name", "export_date"
- Store the active project name and ISO timestamp in this metadata row
- This worksheet should be created in exportMetaModelToExcel function

**Project Name in Export Filename**
- For JSON export: filename format should be `{sanitizedProjectName}-snapshot.json`
- For XLSX export: filename format should be `{sanitizedProjectName}-metamodel.xlsx`
- Use existing sanitizeFilename utility from fileOperations.ts for sanitization
- Sanitization rules: replace path separators and illegal filename chars with underscore, collapse repeated underscores, trim leading/trailing underscores
- If sanitization results in empty string, fall back to "project"

**Import JSON - Set Project Name**
- In handleImportSuccess (TopBar.tsx), the project name from imported snapshot already updates via refreshActiveProject
- No additional changes needed for JSON import as the snapshot import flow already handles this

**Import XLSX - Read Project Name**
- In importMetaModelFromExcel, check for "_metadata" worksheet
- If present and contains a non-empty "project_name" value, include it in ImportResult
- Add optional projectName field to ImportResult interface
- TopBar should dispatch to set loadedFileName when projectName is present in import result
- For backward compatibility: if _metadata sheet is missing, do not set a project name

**State Management**
- The active project name is stored in AppState.loadedFileName in ArchitectureContext
- Setting project name requires dispatching LOAD_MODEL action with fileName parameter
- Consider adding a simpler SET_PROJECT_NAME action to ArchitectureContext for just updating loadedFileName without reloading model
- This new action type should only update loadedFileName, leaving model and other state unchanged

**Validation Rules**
- Project name is required (non-empty after trimming whitespace)
- Any unicode text is allowed in the project name
- Filename sanitization is handled separately from validation

## Existing Code to Leverage

**CreateProjectModal (frontend/src/components/Project/CreateProjectModal.tsx)**
- Use as template for ExportProjectNameModal structure and styling
- Reuse modal overlay, header, content, and footer patterns
- Copy keyboard handling (Enter to submit, Escape to cancel)
- Follow same validation error display pattern

**ImportModeModal (frontend/src/components/Import/ImportModeModal.tsx)**
- Simpler modal pattern with focused purpose
- Good example of minimal modal with clear action buttons
- Use similar CSS module approach

**TopBar.tsx handleExportJsonClick and handleExportXlsxClick**
- These are the integration points for adding project name check
- Both currently access state.loadedFileName for filename generation
- Modal state management can follow pattern of isImportModeModalOpen

**excelOperations.ts exportMetaModelToExcel**
- Add metadata worksheet creation before entity worksheets
- Use XLSX.utils.aoa_to_sheet for simple row creation
- Sheet name "_metadata" follows safe naming (starts with underscore allowed)

**fileOperations.ts sanitizeFilename**
- Existing utility removes invalid filename characters
- Extend or wrap to handle collapse of repeated underscores and edge cases

## Out of Scope
- Changes to backend database persistence for project naming
- Modifications to the Project domain object structure in backend
- Any UI indicators about feature toggles or startup modes
- Prompting for project name on application startup
- Auto-generating project names from content analysis
- Project name validation beyond non-empty requirement
- Changes to the Open, Save, or Save As flows
- Changes to backend API endpoints for export
- Multi-language or localization support for modal text
- Project name history or recent names autocomplete
