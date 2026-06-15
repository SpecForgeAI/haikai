# Raw Idea

## Title
Export Requires Project Name When Unset (Modal Prompt + Filename + Persist Active Name)

## Intent
Ensure that exporting (JSON or XLSX) always includes a project name.
If the active project name is not set at the time of export, prompt the user with a small modal dialog
to enter "Project Name" and confirm or cancel. On confirmation, set that name as the active project name,
embed it into the exported file, and include it in the export filename. This applies regardless of the
includeDelivery/includeDatabase startup toggles.

## Scope

### In Scope
- Detect "project name unset" at the moment an export is initiated (JSON or XLSX).
- If unset, show a modal dialog with:
    - Text field: "Project Name"
    - Buttons: "Export" (primary) and "Cancel"
- On "Export" confirm:
    - Validate non-empty project name (trim whitespace; disallow empty).
    - Set the entered project name as the active project name in the UI state.
    - Ensure the exported artifact contains this project name in its data payload/metadata.
    - Ensure the exported filename includes the project name.
- On "Cancel":
    - Do not export.
    - Do not set/modify the active project name.
- Import behaviour:
    - When importing JSON or XLSX, if the file contains a project name, set it as the active project name.
- Must work in all startup-toggle combinations:
    - includeDatabase true/false
    - includeDelivery true/false

### Out of Scope
- Any new DB persistence rules for project naming (beyond existing "active project name" concept).
- Any changes to what constitutes a "project" domain object in the backend.
- Any additional UI indicators about feature toggles or modes.

## Definitions

### active_project_name
- The name currently shown/treated as the active project name in the tool session.
- May be absent when the user has not created/opened/imported a project or otherwise provided a name.

### project_name_validation
- Required, non-empty after trimming.
- Allowed characters: any unicode text is allowed; filename sanitization is handled separately.

### filename_rules
- Export filename must include the project name in a human-readable way.
- If project name contains characters not suitable for filenames, sanitize deterministically:
    - replace path separators and illegal filename characters with underscore
    - collapse repeated underscores
    - trim leading/trailing underscores
- If sanitization results in an empty string (edge case), fall back to "project".
- Preserve existing export naming conventions beyond the added project name.

### export_payload_rules
- JSON export: include project name in a stable, top-level metadata location consistent with current schema.
- XLSX export: include project name in a stable, well-known place consistent with current export/import design
  (e.g., a metadata sheet or a defined cell), so it can be re-imported.
- Backward compatibility: importing older exports without project name must still work; in that case,
  do not set a name automatically and leave it unset until user provides it (e.g., at next export).

### ui_requirements
- Modal is small and focused; no mention of feature toggles.
- Modal blocks export until user confirms or cancels.
- Keyboard UX:
    - Enter triggers "Export" when valid
    - Esc triggers "Cancel"
- When validation fails (empty), show a minimal inline error and keep modal open.

## Acceptance Criteria
- If active project name is unset, exporting JSON prompts for Project Name; confirming exports successfully,
  sets the active project name, embeds it in the export, and includes it in the filename.
- If active project name is unset, exporting XLSX behaves identically.
- If active project name is already set, export proceeds with no prompt and still embeds/uses the name.
- Cancelling the modal results in no export and no name changes.
- Importing a file that contains a project name sets it as the active project name immediately.
- Works the same whether includeDatabase is true or false, and whether includeDelivery is true or false.
