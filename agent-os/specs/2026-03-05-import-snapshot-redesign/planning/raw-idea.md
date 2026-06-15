# Raw Feature Idea

Redesign the Import Product Snapshot flow. Key changes:

1. Remove "Project Parent Folder" field entirely (folders are now auto-derived from {rootFolder}/{orgName}/{projectName}/)
2. Remove "Import As Name" field entirely
3. Remove "Make imported project active" checkbox
4. Remove "Overwrite existing project?" checkbox

New behavior based on context:

A) NO active project (e.g. landing screen): User picks a JSON file → it loads directly into the UI. No modal appears at all.

B) Active project exists: User picks a JSON file → simplified modal with a single toggle between:
   - "Save and close existing, then load imported file" → saves current project, closes it, loads imported snapshot (imported project keeps its own name)
   - "Merge existing and imported file" → proceeds to validation/merge modal

C) Merge sub-flow: The existing ImportSummaryModal is repurposed to show BEFORE the merge happens. Validation rules are still tested. User can cherry-pick which parts to merge at both category level AND individual entity level (e.g. "All Services" checkbox at top, plus individual service checkboxes). The cherry-pick UI follows the same pattern as ContextPickerModal used in the Implement screen's "Add Context" button.
