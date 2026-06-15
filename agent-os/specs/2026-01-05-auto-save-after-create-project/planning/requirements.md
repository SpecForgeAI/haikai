# Requirements: Auto-Save After Create Project

## Title
After Create Project, auto-save model using project name so active filename displays

## Intent
When a user creates a Project (name + parent folder), the tool should behave as if the user also ran
File -> Save with the Filename equal to the Project name. This ensures the top-right "current file"
display updates immediately after project creation (same as after Save).

## Scope
- frontend only (or minimal backend only if existing Save endpoint requires it)
- no changes to Project schema or Create Project API contract
- reuse existing Save flow and persistence behavior

## Requirements

### Behavior
- On successful Create Project:
  1) The Project row is persisted (already working)
  2) The tool immediately performs the same "Save" operation as File -> Save, using:
     - filename = project.name
  3) The top-right filename indicator updates to show the project name (without user manually clicking Save)
- If the auto-save fails:
  - The project creation remains successful
  - Show a non-blocking error message indicating "Project created but initial save failed"
  - The modal closes (project creation is not rolled back)

### Constraints
- Do not rename any internal identifiers or UI text unrelated to this behavior
- Do not duplicate save logic; call the same function used by File -> Save
- Avoid introducing new UX steps; no extra prompts after Create

## Implementation

### Frontend
1) Locate the existing Save implementation used by File -> Save
- Identify the function invoked by the File menu "Save" action (e.g., saveModel(), handleSave(), or similar),
  which:
  - calls the backend save endpoint
  - updates the "current filename" state used by the top-right display

2) Wire Create Project success to invoke the Save flow
- In CreateProjectModal (or wherever createProject() is handled):
  - After createProject(...) resolves successfully:
    - call the existing save function with filename = createdProject.name
      - If Save normally opens the "Save Model As" modal, bypass that modal in this path by calling the
        underlying save API method directly (the same one the modal's OK button triggers), supplying the filename.
    - Ensure the same state updates occur as a normal Save:
      - setCurrentFilename(createdProject.name) (or whatever state/store updates the top-right label)
      - refresh available file list if Save does that today

3) Ensure ordering and state correctness
- Create Project should:
  - set activeProject in project context/state (already done)
  - then trigger save using the project name
- Guard against double-save if the user immediately clicks Save afterward (idempotent behavior is fine)

4) Error handling
- If save fails:
  - display a toast/banner in the modal (or global notification) saying:
    "Project created, but initial save failed. You can retry via File > Save."
  - do NOT revert the project creation
  - still close the Create Project modal (unless your existing pattern keeps it open on errors;
    in that case, close on create success but show the error globally)

### Backend
- No changes required if an existing "Save" endpoint already supports saving a new model by filename.
- If backend currently requires an "open model" before save:
  - update backend save handler to allow saving a new empty model given a filename (same behavior as Save Model As OK button)

## Acceptance Criteria
- After creating a project named "sdd-test", the top-right filename display shows "sdd-test" immediately,
  without the user clicking File -> Save.
- The created filename appears in the "Save Model As" available files list afterward.
- Create Project continues to work even if Save fails; user receives a clear non-blocking error and can retry Save manually.
- No regression to existing File -> Save and File -> Open behaviors.
