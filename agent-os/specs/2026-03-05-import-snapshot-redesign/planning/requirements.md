# Spec Requirements: Import Product Snapshot Redesign

## Initial Description

Redesign the Import Product Snapshot flow. Key changes:

1. Remove "Project Parent Folder" field entirely (folders are now auto-derived from {rootFolder}/{orgName}/{projectName}/)
2. Remove "Import As Name" field entirely
3. Remove "Make imported project active" checkbox
4. Remove "Overwrite existing project?" checkbox

New behavior based on context:

A) NO active project (e.g. landing screen): User picks a JSON file -> it loads directly into the UI. No modal appears at all.

B) Active project exists: User picks a JSON file -> simplified modal with a single toggle between:
   - "Save and close existing, then load imported file" -> saves current project, closes it, loads imported snapshot (imported project keeps its own name)
   - "Merge existing and imported file" -> proceeds to validation/merge modal

C) Merge sub-flow: The existing ImportSummaryModal is repurposed to show BEFORE the merge happens. Validation rules are still tested. User can cherry-pick which parts to merge at both category level AND individual entity level (e.g. "All Services" checkbox at top, plus individual service checkboxes). The cherry-pick UI follows the same pattern as ContextPickerModal used in the Implement screen's "Add Context" button.

## Requirements Discussion

### First Round Questions

**Q1:** For Flow A (no active project, landing screen), the raw idea says "loads directly, no modal." Currently, LandingPage.tsx has its own `handleFileChange` which validates the JSON and then opens ImportProjectSnapshotModal. I assume the new behavior is: after client-side JSON validation passes, we skip the modal entirely and immediately dispatch `LOAD_MODEL` from the snapshot, setting `loadedFileName` to `snapshot.project.name`. Is that correct? And should we also call the backend import endpoint (DB mode: `importProjectSnapshot`, session mode: `importToSession`) or purely load into the frontend state without persisting?

**Answer:** Yes, update DB also. (Load directly into UI AND persist to backend.)

**Q2:** For Flow A from the **TopBar** (not landing page) -- the user could also trigger "Import as JSON" from the Project menu when there happens to be no active project (e.g., they just closed a project). Currently `handleFileChange` in TopBar always opens ImportProjectSnapshotModal. I assume we should apply the same "no modal, load directly" logic here too, detecting the no-active-project state via `!activeProject` or `!state.loadedFileName`. Is that correct?

**Answer:** There is now a landing page that stops the user from accessing the TopBar entry point until there is an active project, so the user cannot see the "Import as JSON" menu item from the Project menu when no project is active. This means Flow A (no active project) only applies via the LandingPage, not via TopBar.

**Q3:** For Flow B ("Save and close existing, then load imported file"), the save step currently uses `saveModelToBackend` which can fail due to validation errors (the validation warning modal). I assume that if the save fails (validation errors or API errors), we should abort the entire import and show the error to the user rather than proceeding to close the existing project. Is that the correct behavior? Also, in File Mode (`includeDatabase=false`), there is no backend save -- should we still offer this "Save and close" option, or should we skip it and just replace the in-memory model directly?

**Answer:** Save fail = import abort and warn user about validation errors of save, which they need to sort out first. (File Mode behavior clarified in Follow-up 1 below.)

**Q4:** For the merge cherry-pick UI (Flow C), the snapshot JSON contains `model.metaModel.entities` (with ~25 entity collection keys like `applications`, `services`, `logical_data_entities`, etc.) and `model.metaModel.relationships` (with ~9 relationship collection keys like `data_movements`, etc.), plus `model.diagrams[]`. I need to understand the grouping level for the cherry-pick UI:

   a) I assume "category level" means each key in `MetaModelEntities` and `MetaModelRelationships` gets its own "Select All" checkbox (e.g., "All Applications (5)", "All Services (12)"), plus individual checkboxes for each entity within that category. Is that correct?

   b) Should diagrams also be cherry-pickable? The snapshot includes `model.diagrams[]` -- should the user be able to select which diagrams to merge?

   c) Should we also include `work_items` and `artifacts` from the snapshot in the cherry-pick UI, or are those always either all-or-nothing or excluded from merge?

**Answer:**
- (a) Yes -- each collection key gets a "Select All" checkbox plus individual entity checkboxes.
- (b) Yes -- diagrams are also cherry-pickable.
- (c) For now no -- only architecture (entities/relationships) and diagrams can be merged, not work_items or artifacts.

**Q5:** For the merge operation itself, how should ID conflicts be handled? The imported snapshot will have entity IDs (UUIDs). If the existing project already has an entity with the same ID, I assume the merge should treat it as an update (overwrite the existing entity with the imported version). Alternatively, should duplicate IDs be treated as conflicts that are skipped, or should we generate new IDs for imported entities? This is critical for relationships that reference entity IDs by foreign key.

**Answer:** In the extremely unlikely event of merge ID conflict, newly imported items should be given new IDs. Must maintain ID consistency with relationships -- i.e., update imported relationship FKs to reference those updated IDs also.

**Q6:** The existing ImportSummaryModal is currently designed for XLSX imports and shows per-worksheet results (rowsImported, rowsUpdated, rowsSkipped, errors). It uses the `ImportResult` type from `excelOperations.ts`. For the new pre-merge cherry-pick UI, I assume we need a substantially different component that:
   - Shows the imported snapshot's entity/relationship counts BEFORE the merge
   - Provides the checkbox tree UI (following ContextPickerModal patterns)
   - Has a "Merge Selected" button to execute
   - Then optionally shows a post-merge summary

   Should this be a brand new component (e.g., `MergePreviewModal`) that replaces the ImportSummaryModal for this flow, or should we literally modify the existing ImportSummaryModal? I would recommend a new component given the substantially different data shape and interaction pattern.

**Answer:** Do whatever makes most sense for the final outcome. If new components are needed, so be it. (Defers to spec-writer/developer judgment on component structure.)

**Q7:** For the cherry-pick UI, the ContextPickerModal uses a six-tab domain layout (Business, Application, Data, Behavioural, UI, Diagrams) with section-level and group-level Select All checkboxes. Should the merge cherry-pick modal follow this exact same domain-tab layout, or should it use a simpler flat grouping (just list all entity categories with their counts and checkboxes in a scrollable list, since the user does not need the bundle/depth selectors that ContextPickerModal provides)?

**Answer:** Same domain-tab layout as ContextPickerModal.

**Q8:** The current import flow in DB mode calls `importProjectSnapshot` on the backend which creates a new project record. With the "Save and close existing, then load imported" flow, should we:
   a) Call the backend import endpoint (which creates/overwrites the project in DB), then activate it, OR
   b) Just load the snapshot model into the frontend ArchitectureContext (like File Mode does), without creating a new DB project record?

   If (a), the backend endpoint currently supports `overwriteExistingProject` and `setActive` flags -- but we are removing those UI controls. I assume we should always pass `setActive: true` and `overwriteExistingProject: true` implicitly for this flow?

**Answer:** We should call the backend `importProjectSnapshot` endpoint. (Confirms option (a). The implicit flags for `setActive: true` and `overwriteExistingProject: true` were not explicitly confirmed but are implied by the removal of those UI controls and the fact that the import should always activate the project.)

**Q9:** Is there anything that should be explicitly out of scope for this redesign? For example:
   - Should the XLSX import flow (ImportModeModal for Append/Overwrite) remain unchanged?
   - Should the Export JSON flow remain unchanged?
   - Any concerns about backward compatibility with existing JSON snapshot files?

**Answer:**
- XLSX import is **IN SCOPE**: The XLSX will only ever have architecture items, so these should be read, validated, and the user can choose which items to merge, like they do with the JSON import.
- Export JSON flow: **out of scope**.
- Backward compatibility: **out of scope**.

### Existing Code to Reference

**Similar Features Identified:**

Based on codebase analysis, the following existing features have patterns directly relevant to this spec:

- Feature: ContextPickerModal - Path: `frontend/src/components/ProductView/ContextPickerModal.tsx`
  - Cherry-pick UI with domain tabs, section-level Select All, group-level Select All, individual checkboxes
  - Uses `deriveCheckboxState` utility from `frontend/src/utils/selectionUtils.ts` for indeterminate checkbox states
  - CSS module: `frontend/src/components/ProductView/ContextPickerModal.module.css`

- Feature: ImportProjectSnapshotModal (to be replaced/simplified) - Path: `frontend/src/components/Project/ImportProjectSnapshotModal.tsx`
  - Current import modal with all the fields being removed
  - CSS module: `frontend/src/components/Project/ImportProjectSnapshotModal.module.css`

- Feature: ImportSummaryModal (to be repurposed or replaced) - Path: `frontend/src/components/common/ImportSummaryModal.tsx`
  - Current post-import summary for XLSX; data shape will change for JSON merge preview
  - CSS module: `frontend/src/components/common/ImportSummaryModal.module.css`

- Feature: ImportModeModal (XLSX import, now replaced by cherry-pick flow) - Path: `frontend/src/components/common/ImportModeModal.tsx` (if exists)
  - Current Append/Overwrite mode selection for XLSX import; to be replaced entirely by cherry-pick merge pattern

- Feature: LandingPage - Path: `frontend/src/components/LandingPage/LandingPage.tsx`
  - Landing page with "Import JSON" card; flow needs to change for no-modal direct load
  - Now the sole entry point for Flow A (no active project)

- Feature: TopBar import flow - Path: `frontend/src/components/TopBar/TopBar.tsx`
  - `handleFileChange` (line ~643), `handleImportSuccess` (line ~754), and all snapshot modal state
  - Only used when active project exists (Flow B), since LandingPage blocks TopBar access otherwise

- Feature: FileMenu - Path: `frontend/src/components/TopBar/FileMenu.tsx`
  - "Import as JSON" menu item trigger

- Feature: MetaModelEntities/MetaModelRelationships types - Path: `frontend/src/types/model.ts`
  - Defines all entity collection keys (~25 entities, ~9 relationships) that map to cherry-pick categories
  - `EntityType` and `RelationshipType` union types for type-safe iteration

- Feature: Snapshot API clients:
  - DB mode: `frontend/src/api/projectSnapshotApi.ts` (importProjectSnapshot)
  - Session mode: `frontend/src/api/projectSessionApi.ts` (importToSession)

- Feature: AppConfigContext - Path: `frontend/src/contexts/AppConfigContext.tsx`
  - `useIncludeDatabase()` hook for DB mode vs File Mode branching

- Feature: Excel operations - Path: `frontend/src/utils/excelOperations.ts` (or similar)
  - Current XLSX parsing and import logic; will need to be refactored to produce cherry-pickable data shape

### Follow-up Questions

**Follow-up 1:** For Flow B in File Mode (`includeDatabase=false`), the "Save and close existing" option was asked about in Q3 but not answered for the File Mode case specifically. In File Mode there is no backend save -- only a JSON file download. Should the "Save and close existing, then load imported" option in File Mode:
   (a) Trigger a JSON file download (save-as-file) for the current project, then load the imported snapshot into memory, OR
   (b) Simply replace the in-memory model without any save prompt (since the user is in file-only mode and can always manually save first), OR
   (c) Should File Mode not be considered at all for this spec (i.e., the import redesign only applies to DB mode)?

**Answer:** (a) -- Trigger a JSON file download for the current project first, then load the imported snapshot into memory.

**Follow-up 2:** XLSX import is now in scope. I need to understand the scope of the XLSX redesign:
   (a) Currently, XLSX import offers "Append" and "Overwrite" modes (via ImportModeModal). Should these modes be **replaced entirely** by the new cherry-pick merge flow, or should "Overwrite" remain as a quick option alongside a new "Merge/Cherry-pick" option?
   (b) You said XLSX "will only ever have architecture items." Does "architecture items" mean only entities (applications, services, etc.), or does it also include relationships (data_movements, etc.)?
   (c) After the XLSX is parsed and validated, should the cherry-pick UI be the **exact same domain-tab modal** used for JSON merge, just populated from XLSX data instead of JSON snapshot data? (This would unify the experience.)
   (d) Does XLSX import also need the Flow A/B branching (no active project vs. active project), or does XLSX import always assume an active project exists (merge into existing)?

**Answer:**
- (a) The current "Append" and "Overwrite" modes (ImportModeModal) should be **replaced entirely** by the new cherry-pick merge flow.
- (b) "Architecture items" means whatever the spreadsheet contains, which is architecture entities. (Implied: entities only, not relationships, since that is what the XLSX format supports.)
- (c) Yes, the same domain-tab cherry-pick modal should be used for both JSON and XLSX, just populated from XLSX data. (Implied by the answer to 2a: same cherry-pick pattern, unified experience.)
- (d) Not explicitly answered. (See note in Requirements Summary -- XLSX import is only available from TopBar when an active project exists, so it is always a merge-into-existing operation.)

**Follow-up 3:** For the merge cherry-pick UI showing diagrams (Q4b confirmed diagrams are cherry-pickable): when a diagram is selected for merge and it references entities that were NOT selected for merge, should we:
   (a) Auto-select the referenced entities (pull in dependencies),
   (b) Import the diagram but strip out references to unselected entities, OR
   (c) Warn the user about missing references and let them decide?

**Answer:** (a) -- Auto-select the referenced entities (pull in dependencies automatically). When a user selects a diagram for merge, any entities referenced by that diagram's nodes should be automatically selected as well.

## Visual Assets

### Files Provided:
No visual assets provided (bash check of `agent-os/specs/2026-03-05-import-snapshot-redesign/planning/visuals/` found no image files).

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**Flow A - Direct Load (No Active Project, LandingPage Only):**
- User picks a JSON file from the LandingPage
- Client-side JSON validation runs
- If valid, load directly into UI without any modal -- dispatch LOAD_MODEL from snapshot
- Also persist to backend by calling the `importProjectSnapshot` endpoint (DB mode)
- LandingPage is the sole entry point for Flow A; TopBar is not accessible when no project is active

**Flow B - Active Project Exists (TopBar Only):**
- User picks a JSON or XLSX file from TopBar Project menu
- Simplified modal appears with two options:
  - **"Save and close existing, then load imported file"** (JSON only): Save current project, close it, then load imported snapshot. In DB mode, save via `saveModelToBackend` and load via `importProjectSnapshot` endpoint. In File Mode, trigger a JSON file download of the current project first, then load the imported snapshot into memory. If save fails (DB mode validation errors), abort the entire import and show the error.
  - **"Merge existing and imported file"**: Proceed to the cherry-pick merge modal (Flow C)

**Flow C - Merge Cherry-Pick Sub-flow (JSON and XLSX):**
- Domain-tab layout matching ContextPickerModal (Business, Application, Data, Behavioural, UI, Diagrams tabs)
- Each entity/relationship collection key gets a "Select All" checkbox plus individual entity checkboxes
- Diagrams are also cherry-pickable as individual items (JSON import only; XLSX does not contain diagrams)
- When a diagram is selected for merge, any entities referenced by that diagram's nodes are automatically selected as dependencies
- work_items and artifacts are excluded from merge (not shown in cherry-pick UI)
- ID conflict resolution: imported items with conflicting IDs get new generated IDs; all imported relationship FKs are cascaded to reference the new IDs
- Validation runs before merge; results shown to user

**XLSX Import (In Scope -- Replaces ImportModeModal):**
- The current "Append" and "Overwrite" modes (ImportModeModal) are replaced entirely by the new cherry-pick merge flow
- XLSX files contain only architecture entities (not relationships or diagrams)
- After XLSX is parsed and validated, the same domain-tab cherry-pick modal (Flow C) is shown, populated from XLSX data
- XLSX import is only available from TopBar when an active project exists (always a merge-into-existing operation)
- Unified user experience: same cherry-pick UI for both JSON and XLSX imports

**Removed UI Elements:**
- "Project Parent Folder" field (auto-derived from {rootFolder}/{orgName}/{projectName}/)
- "Import As Name" field
- "Make imported project active" checkbox (always active implicitly)
- "Overwrite existing project?" checkbox (always overwrite implicitly)
- ImportModeModal "Append"/"Overwrite" toggle for XLSX (replaced by cherry-pick merge)

### Reusability Opportunities
- ContextPickerModal domain-tab layout and checkbox patterns for merge cherry-pick UI
- `deriveCheckboxState` utility from `frontend/src/utils/selectionUtils.ts` for indeterminate checkbox states
- Existing modal CSS patterns from ImportProjectSnapshotModal and ImportSummaryModal
- `saveModelToBackend` utility for the "save and close" flow (DB mode)
- JSON file download logic for the "save and close" flow (File Mode)
- Snapshot validation logic from TopBar.handleFileChange (shared between TopBar and LandingPage)
- Excel parsing logic from excelOperations.ts for XLSX import (to be refactored to produce cherry-pickable data shape)
- Backend `importProjectSnapshot` endpoint for DB persistence in both Flow A and Flow B

### Scope Boundaries
**In Scope:**
- JSON import Flow A (direct load from LandingPage, no modal)
- JSON import Flow B (simplified modal when active project exists)
- JSON import Flow C (merge cherry-pick sub-flow with domain-tab layout)
- XLSX import redesign: replace Append/Overwrite ImportModeModal with cherry-pick merge pattern
- File Mode support for Flow B (JSON download save before loading imported snapshot)
- Diagram dependency auto-selection in cherry-pick UI
- Removal of all deprecated modal fields (parent folder, import name, checkboxes)
- ID conflict resolution with new ID generation and FK cascade
- Backend persistence for all import flows (DB mode)

**Out of Scope:**
- Export JSON flow (unchanged)
- Backward compatibility with older JSON snapshot formats
- Merging work_items or artifacts (only architecture entities/relationships and diagrams)
- Flow A from TopBar (LandingPage blocks TopBar when no project active)
- XLSX import of relationships or diagrams (XLSX only contains architecture entities)

### Technical Considerations
- Two modes to support: DB mode (`includeDatabase=true`) and File Mode (`includeDatabase=false`)
  - DB mode: save via `saveModelToBackend`, load via `importProjectSnapshot` endpoint
  - File Mode: save via JSON file download, load into in-memory ArchitectureContext
- Snapshot JSON structure: `{ meta, project, model: { metaModel: { entities, relationships }, diagrams }, work_items, artifacts }`
- MetaModel has ~25 entity collections and ~9 relationship collections for cherry-pick granularity
- Import flow is triggered from: LandingPage (Flow A, JSON only) and TopBar/FileMenu (Flow B, JSON and XLSX)
- Current backend import endpoint returns `ProjectSnapshotImportResultDto` with project, modelSaved, workItemsInserted, etc.
- ContextPickerModal is ~1500 lines with complex selection state management; merge cherry-pick can likely be simpler (no bundle/depth selectors needed)
- ID conflict resolution requires a pre-merge pass to detect UUID collisions, generate replacement IDs, and update all FK references in the imported data before applying the merge
- XLSX import currently uses `excelOperations.ts` with `ImportResult` type -- this will need to be refactored to produce the same cherry-pickable data shape as JSON import, enabling a unified cherry-pick modal
- Backend `importProjectSnapshot` should be called with implicit `setActive: true` and `overwriteExistingProject: true` for all flows (since UI controls for these are being removed)
- Diagram dependency auto-selection: when a diagram is checked in the cherry-pick UI, the system must resolve all entity IDs referenced by that diagram's nodes and auto-check those entities, preventing orphaned diagram node references
- The ImportModeModal component (Append/Overwrite for XLSX) can be removed or deprecated once the new cherry-pick flow replaces it
