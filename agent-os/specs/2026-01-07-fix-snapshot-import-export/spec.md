# Specification: Fix Project Snapshot Import/Export

## Goal
Fix the project snapshot import failure caused by missing metadata by preserving full snapshot data through export/import, and make name/folder overrides optional via a new checkbox in the import modal.

## User Stories
- As a user, I want to export and re-import project snapshots without errors so that I can backup and restore projects reliably
- As a user, I want to import a snapshot using its original name and folder by default so that I can quickly restore without manual entry

## Specific Requirements

**Backend: Add effectiveProjectParentFolder() Helper**
- Add `effectiveProjectParentFolder()` method to `ProjectSnapshotImportRequestDto.java`
- Return `projectParentFolder` if provided and non-blank
- Fall back to `snapshot.project().projectParentFolder()` if request field is null/blank
- Return null if both are unavailable
- Follow same pattern as existing `effectiveProjectName()` and `effectiveSetActive()` methods

**Backend: Use effectiveProjectParentFolder in Import Service**
- Modify `ProjectSnapshotImportService.validateProjectParentFolder()` to accept effective value
- Change line 75 from `validateProjectParentFolder(request.projectParentFolder())` to `validateProjectParentFolder(request.effectiveProjectParentFolder())`
- Change line 92 to use `request.effectiveProjectParentFolder()` when calling `projectService.createProject()`
- Ensure validation still rejects null/blank after fallback resolution

**Backend: Accept Null Meta for Backward Compatibility**
- Modify `validateSnapshotVersion()` method in `ProjectSnapshotImportService.java`
- If `snapshot.meta()` is null, treat as legacy v1 snapshot and continue (do not throw)
- Log warning: "Importing legacy snapshot without meta"
- If meta exists, validate `snapshotVersion == 1` as currently implemented
- This allows importing older exports that lack meta field

**Backend: Add Backward Compatibility Tests**
- Add test: import succeeds when `project_parent_folder` omitted but `snapshot.project.projectParentFolder` present
- Add test: import succeeds when `snapshot.meta` is null (legacy snapshot)
- Add test: import fails when both request `projectParentFolder` and snapshot `projectParentFolder` are null/blank
- Follow existing test patterns in `ProjectSnapshotImportServiceTest.java`

**Frontend: Fix ProjectSnapshotDto Type Definition**
- Replace outdated `ProductDataDto` / `productData` fields in `projectSnapshotApi.ts`
- Add `meta` field: `{ snapshot_version: number; exported_at: string; export_kind: string }`
- Add `work_items` field: `unknown[]`
- Add `artifacts` field: `unknown[]`
- Remove `productData` and `ProductDataDto` types entirely
- Match backend `ProjectSnapshotDto.java` structure exactly

**Frontend: Preserve Raw Snapshot JSON on Export**
- Modify `exportActiveProjectSnapshot()` to return raw backend JSON without transformation
- Remove `mapSnapshotFromSnake()` call that strips meta/work_items/artifacts
- Return the response JSON directly as `unknown` or a correctly typed interface
- Exported file must contain all fields: meta, project, model, work_items, artifacts

**Frontend: Fix Import to Send Complete Snapshot**
- Modify `importProjectSnapshot()` to send raw snapshot without lossy mapping
- Remove `mapSnapshotToSnake()` call that drops fields
- Pass the parsed JSON file directly in the request body
- Ensure meta, work_items, artifacts are included in POST payload

**Frontend: Add Override Checkbox to Import Modal**
- Add state: `overrideNameFolder: boolean` (default: false)
- Add checkbox below "Make imported project active" with label "Override Project Name/Folder?"
- Checkbox unchecked by default to use snapshot defaults
- When toggled on, initialize fields with snapshot values if currently empty
- Update form validation to not require name/folder when override is unchecked

**Frontend: Conditional Name/Folder Fields**
- When `overrideNameFolder` is false: hide "Import As Name" and "Project Parent Folder" inputs
- When `overrideNameFolder` is true: show both inputs pre-filled with snapshot values
- Pre-fill values: `snapshot.project.name` and `snapshot.project.projectParentFolder`
- Cleared fields when override is checked should be treated as "not overriding"

**Frontend: Update Import Request Payload Logic**
- When override checkbox unchecked: omit `import_as_name` and `project_parent_folder` from request
- When override checkbox checked: include trimmed values (or undefined if empty)
- Keep `set_active` in request regardless of override state
- Import button enabled when snapshot is loaded (no name/folder validation when override unchecked)

## Existing Code to Leverage

**ProjectSnapshotImportRequestDto.java**
- Already has `effectiveProjectName()` and `effectiveSetActive()` helper methods
- Follow same pattern for new `effectiveProjectParentFolder()` method
- Uses `@JsonProperty` and `@JsonAlias` for snake/camel case support

**ProjectSnapshotImportService.java**
- Contains `validateSnapshotVersion()` and `validateProjectParentFolder()` methods to modify
- Uses `SUPPORTED_SNAPSHOT_VERSION = 1` constant
- Transactional import with rollback on failure

**projectSnapshotApi.ts**
- Has existing snake/camel case mapping functions to remove/simplify
- Export function at line 202, import function at line 245
- Type definitions at top of file need complete replacement

**ImportProjectSnapshotModal.tsx**
- Has existing checkbox pattern with `setActive` state (line 56)
- CSS module already has `.checkboxGroup`, `.checkbox`, `.checkboxLabel` styles
- Conditional rendering can follow pattern of error message (line 252)

**ProjectSnapshotImportServiceTest.java**
- Has Nested test classes for organization (SuccessfulImportTests, ValidationTests, ConflictTests)
- Uses Mockito with `@ExtendWith(MockitoExtension.class)`
- Helper method `createEmptyModel()` for test fixtures

## Out of Scope
- Creating new snapshot export formats or versions
- Merging imported data with existing projects
- UI for editing snapshot metadata
- Batch import of multiple snapshots
- Automatic backup/export functionality
- Project artifact content editing during import
- Work item editing during import
- Snapshot compression or encryption
- Cloud storage integration for snapshots
- Version migration for snapshots beyond v1
