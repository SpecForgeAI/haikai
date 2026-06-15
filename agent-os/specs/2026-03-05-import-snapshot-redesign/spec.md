# Specification: Import Product Snapshot Redesign

## Goal
Redesign the Import Product Snapshot flow to eliminate obsolete modal fields (parent folder, import-as name, overwrite checkbox, make-active checkbox), introduce context-aware branching (direct load vs. simplified modal vs. cherry-pick merge), and unify the JSON and XLSX import experiences behind a single domain-tab cherry-pick modal.

## User Stories
- As a user with no active project, I want to pick a JSON file from the landing page and have it load directly without any modal so that I can start working immediately.
- As a user with an active project, I want to choose between replacing my current project or selectively merging specific entities and diagrams from the imported file so that I do not lose work or import unwanted data.
- As a user importing an XLSX file, I want the same cherry-pick merge experience as JSON import so that I have a consistent and controlled way to bring in architecture data.

## Specific Requirements

**Flow A -- Direct Load from LandingPage (No Active Project)**
- Triggered only from LandingPage "Import JSON" card; TopBar is not accessible when no project is active
- After client-side JSON schema validation passes (file size, required fields: project, meta, model), skip any modal entirely
- Dispatch `LOAD_MODEL` with the snapshot's `model` and set `loadedFileName` to `snapshot.project.name`
- Persist to backend: call `importProjectSnapshot` (DB mode) or `importToSession` (File Mode) with implicit `setActive: true` and `overwriteExistingProject: true`
- Refresh ProjectContext via `refreshActiveProject` after successful backend call
- On validation or API error, show an inline error message on the LandingPage (existing `errorMessage` state pattern)

**Flow B -- Active Project Modal (TopBar, JSON or XLSX)**
- Triggered from TopBar "Import as JSON" or "Import as XLSX" menu items when `activeProject` exists
- After file parsing and validation, show a simplified modal with two radio-button options (default: first option selected):
  - Option 1: "Save and close current project, then load imported file"
  - Option 2: "Merge imported data into current project"
- For XLSX imports, Option 1 is hidden (XLSX always merges); the modal skips directly to Flow C
- The modal shows the imported project/file name as a read-only header for context

**Flow B Option 1 -- Save-and-Replace (JSON only)**
- DB Mode: call `saveModelToBackend` for the current project; if save fails (validation errors), abort the import and show the validation error modal; if save succeeds, call `importProjectSnapshot` with the imported snapshot (implicit `setActive: true`, `overwriteExistingProject: true`), then dispatch `LOAD_MODEL`
- File Mode (`includeDatabase=false`): trigger a JSON file download of the current project via `buildLocalSnapshot` + `triggerDownload`, then load the imported snapshot into ArchitectureContext via `LOAD_MODEL` and call `importToSession`
- After successful load, refresh ProjectContext and show success notification

**Flow B Option 2 / Flow C -- Cherry-Pick Merge Modal**
- Opened when user selects "Merge" in Flow B, or directly for XLSX imports
- Uses the same domain-tab layout as ContextPickerModal: 6 tabs (Business, Application, Data, Behavioural, UI, Diagrams)
- Each tab shows entity categories from the imported data mapped via `DOMAIN_TO_ENTITY_TYPES` and `DOMAIN_TO_RELATIONSHIP_TYPES`
- Each category header has a "Select All" checkbox with entity count (e.g., "Applications (5)") plus individual entity checkboxes beneath it
- Relationship categories are also shown per domain tab, with the same Select All + individual checkbox pattern
- Diagrams tab shows individual diagram checkboxes (JSON import only; XLSX has no diagrams)
- Empty categories (zero items in the import) are hidden from the UI
- Three-state checkbox logic uses `deriveCheckboxState` from `selectionUtils.ts` for indeterminate states
- Footer has "Merge Selected" (primary) and "Cancel" buttons; "Merge Selected" is disabled when zero items are checked

**Diagram Dependency Auto-Selection**
- When a diagram checkbox is checked, resolve all `entity_id` values from its `diagram_nodes` array
- Auto-check any entity whose ID matches a diagram node's `entity_id`, across all domain tabs
- Auto-selected entities should be visually indicated (e.g., slightly different style or a dependency badge) so the user understands they were pulled in
- When a diagram is unchecked, auto-selected entities that are not referenced by any other still-checked diagram should be unchecked

**ID Conflict Resolution During Merge**
- Before applying the merge, scan all selected imported items for ID collisions against the current model's entities, relationships, and diagrams
- For any collision, generate a new UUID for the imported item
- Build a `Map<oldId, newId>` of all remapped IDs
- Cascade-update all FK fields in imported relationships that reference remapped entity IDs (e.g., `application_id`, `service_id`, `source_application_point_id`, `business_user_id`, etc.)
- Cascade-update all `entity_id` fields in imported diagram nodes that reference remapped entity IDs
- Cascade-update all `relationship_id` fields in imported diagram edges that reference remapped relationship IDs
- This logic should be a pure utility function (e.g., `resolveIdConflicts`) that takes the selected imported data and the current model, returning the conflict-free data ready to merge

**Merge Execution**
- After cherry-pick selection and ID conflict resolution, dispatch an action to merge the selected items into the current model
- Reuse or extend the existing `IMPORT_META_MODEL` reducer action, adding support for diagrams and ensuring it handles additive merge (no deletes of existing data)
- After dispatch, persist: call `saveModelToBackend` (DB mode) or update in-memory state (File Mode)
- Show a post-merge summary notification with counts (e.g., "Merged 3 applications, 2 services, 1 diagram")

**XLSX Import Redesign**
- Remove the `ImportModeModal` component (Append/Overwrite selection) entirely; it is replaced by the cherry-pick merge flow
- After XLSX parsing via `importMetaModelFromExcel`, convert the parsed entity data into the same cherry-pickable data shape used by JSON import (entities grouped by collection key, no relationships or diagrams since XLSX does not contain them)
- Show the cherry-pick merge modal (Flow C) populated with the XLSX-parsed entities
- XLSX import is only available from TopBar when an active project exists; it always enters Flow C directly (no save-and-replace option)

**File Mode Considerations**
- Flow A (LandingPage): call `importToSession` instead of `importProjectSnapshot`; load model from snapshot directly via `LOAD_MODEL`
- Flow B Option 1 (save-and-replace): trigger JSON download via `buildLocalSnapshot` + `triggerDownload`, then load imported snapshot into memory
- Flow B Option 2 / Flow C (merge): merge operates on in-memory ArchitectureContext state; no backend persistence call needed in File Mode beyond updating the session

**Removed UI Elements**
- "Project Parent Folder" field (auto-derived)
- "Import As Name" field
- "Make imported project active" checkbox (always implicit true)
- "Overwrite existing project?" checkbox (always implicit true)
- "Override Product Name/Folder?" checkbox and its conditional inputs
- ImportModeModal "Append"/"Overwrite" toggle for XLSX

## Existing Code to Leverage

**ContextPickerModal domain-tab UI pattern (`frontend/src/components/ProductView/ContextPickerModal.tsx`)**
- Six-tab layout with `DomainTabStrip` component (Business, Application, Data, Behavioural, UI, Diagrams) using `ALL_DOMAINS` from `architectureDomain.ts`
- `EntityTypeGroup` sub-component with group-level Select All checkbox, individual entity checkboxes, and count badges
- `RelationshipTypeGroup` sub-component with the same pattern for relationships
- Domain-to-collection mappings from `DOMAIN_TO_ENTITY_TYPES` and `DOMAIN_TO_RELATIONSHIP_TYPES` in `contextPickerDomainMappings.ts`
- CSS module `ContextPickerModal.module.css` provides the tab strip, group headers, checkbox rows, and scrollable content styling

**Selection state utilities (`frontend/src/utils/selectionUtils.ts`)**
- `deriveCheckboxState(selectedCount, totalCount)` returns `'checked' | 'unchecked' | 'indeterminate'`
- Used by ContextPickerModal for both section-level and group-level Select All; the cherry-pick merge modal should use the same utility
- The `ref` callback pattern for setting `input.indeterminate` on checkbox elements is established in `EntityTypeGroup`

**TopBar import orchestration (`frontend/src/components/TopBar/TopBar.tsx`)**
- `handleFileChange` (line ~643): JSON file reading, schema validation, snapshot parsing -- this logic should be shared with the new LandingPage direct-load flow
- `handleImportSuccess` (line ~754): post-import model loading and project refresh -- reusable for Flow A and Flow B
- `buildLocalSnapshot` (line ~522): constructs `ProjectSnapshotDto` from current ArchitectureContext state -- reused for File Mode save-before-replace
- `executeXlsxImport` (line ~919): XLSX import execution and dispatch -- will be refactored to feed into the cherry-pick modal instead of directly dispatching

**LandingPage import entry point (`frontend/src/components/LandingPage/LandingPage.tsx`)**
- Already has JSON file input, `handleFileChange` with schema validation, and `ImportProjectSnapshotModal` integration
- For Flow A, replace the `ImportProjectSnapshotModal` usage with direct load logic (skip modal, call backend, dispatch `LOAD_MODEL`)

**Snapshot and Session API clients (`frontend/src/api/projectSnapshotApi.ts`, `frontend/src/api/projectSessionApi.ts`)**
- `importProjectSnapshot(req)` for DB mode persistence with `ProjectSnapshotImportRequestDto`
- `importToSession(req)` for session/File Mode persistence
- Both return `ProjectSnapshotImportResultDto` with project details -- used to refresh ProjectContext after import

## Out of Scope
- Export JSON flow (unchanged by this spec)
- Backward compatibility with older JSON snapshot formats
- Merging `work_items` or `artifacts` from imported snapshots (only architecture entities, relationships, and diagrams are mergeable)
- Flow A from TopBar (LandingPage blocks TopBar access when no project is active)
- XLSX import of relationships or diagrams (XLSX format only contains architecture entities)
- Undo/revert functionality after a merge operation
- Conflict resolution UI showing individual conflicts to the user (conflicts are resolved automatically via new ID generation)
- Changes to the backend `importProjectSnapshot` or `importToSession` endpoints (all changes are frontend-only)
- Drag-and-drop file import (file selection remains via file input click)
- Any changes to the ExportProjectNameModal or export flows
