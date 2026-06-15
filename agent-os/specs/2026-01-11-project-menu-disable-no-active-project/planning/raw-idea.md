title: Disable Project menu actions when no active project (only Create/Open/Delete enabled)
date: 2026-01-11
owner: project-management-ui
type: fix

## Goal
Update the **Project** dropdown menu so that when the app has **no active project loaded**, only actions that make sense without an active project remain enabled.

## Required behaviour

### When NO active project is loaded
Enabled (clickable):
1. Create
2. Open
3. Delete

Disabled (greyed out / not clickable):
- Save
- Save As
- Import as JSON
- Export as JSON
- Import as XLSX
- Export as XLSX

### When an active project IS loaded
- All 9 items are enabled:
  - Create, Open, Save, Save As, Delete, Import as JSON, Export as JSON, Import as XLSX, Export as XLSX

## Rationale
All actions except Create/Open/Delete require an active project context. Delete is still valid without an active project because it selects a saved project via the Delete modal.

## Implementation requirements (frontend)

### 1) Single source of truth for "active project exists"
- Determine the canonical "active project" signal used by the UI (e.g., active project name/filename in global state/context).
- Implement a helper boolean:
  - `hasActiveProject: boolean`

### 2) Apply enable/disable rules in the Project menu component
- Add per-item `disabled` state:
  - `Create`: always enabled
  - `Open`: always enabled
  - `Delete`: always enabled
  - All others: disabled when `hasActiveProject === false`

### 3) Prevent invocation when disabled
- Ensure disabled items do not trigger handlers (no accidental clicks / keyboard activation).

### 4) Reactive updates
The enabled/disabled state must update immediately when:
- a project is opened
- a project is created
- the active project is cleared (e.g., after deleting the active project)

## Testing / Verification
- Manual:
  1) Start app with no active project: confirm only Create/Open/Delete enabled.
  2) Open a project: confirm all items enabled.
  3) Delete the active project (if supported): confirm menu reverts to only Create/Open/Delete enabled.

- Automated (if existing menu tests exist):
  - Add assertions for disabled/enabled state based on presence/absence of active project.

## Acceptance criteria
1. On fresh start with no active project, only Create/Open/Delete are enabled.
2. With an active project loaded, all 9 menu items are enabled.
3. Disabled items are visibly greyed out and cannot be invoked.
4. State updates immediately as active project state changes.
