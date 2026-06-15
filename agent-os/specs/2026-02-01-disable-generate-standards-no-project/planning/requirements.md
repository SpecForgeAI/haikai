# Spec Requirements: Disable Generate Standards When No Active Project

## Initial Description

**Title:** Disable Project -> Generate Standards when no active project

**Intent:** Ensure the Project menu item "Generate Standards" is disabled whenever there is no active project loaded, matching the existing disable logic already applied to "Save" and "Save As" on app startup.

## Requirements Discussion

### First Round Questions

Given the comprehensive requirements provided by the user and the straightforward nature of this change (pattern replication), no clarifying questions were necessary. The user provided detailed scope, requirements, implementation notes, test requirements, and acceptance criteria.

The following key findings from code exploration confirm the implementation path:

**Code Analysis Findings:**

**Q1:** Where is the Project menu component located?
**Answer:** `frontend/src/components/TopBar/FileMenu.tsx` - This is the Project menu dropdown component that renders all menu items including "Generate Standards" (lines 329-335).

**Q2:** Where is the disabled logic for Save/Save As computed?
**Answer:** `frontend/src/components/TopBar/TopBar.tsx` (lines 207-216):
- `saveDisabled = !state.loadedFileName || isSaving` (line 208)
- `saveAsDisabled = !state.loadedFileName` (line 216)
- These use `state.loadedFileName` from ArchitectureContext to determine if a project is loaded.

**Q3:** What is the current Generate Standards disabled logic?
**Answer:** `frontend/src/components/TopBar/TopBar.tsx` (line 228):
- `generateStandardsDisabled = !activeProject || !activeProject.organisationId`
- This checks ProjectContext's `activeProject` rather than `state.loadedFileName`.

**Q4:** How are disabled menu items styled and gated?
**Answer:** FileMenu.tsx uses:
- CSS class `styles.menuItemDisabled` for visual disabled state (lines 330, 339, 348)
- Handler guards that check the disabled prop before calling the action (lines 226-231, 234-239, 241-247)
- The pattern is consistent: `if (!disabled) { handler(); onClose(); }`

### Existing Code to Reference

**Similar Features Identified:**
- Component: FileMenu.tsx - Path: `frontend/src/components/TopBar/FileMenu.tsx`
  - Save menu item disabled pattern (lines 337-344)
  - Save As menu item disabled pattern (lines 346-353)
  - Generate Standards menu item (lines 328-335) - needs update
  - handleGenerateStandardsClick handler (lines 225-231) - already has guard

- Component: TopBar.tsx - Path: `frontend/src/components/TopBar/TopBar.tsx`
  - saveDisabled computation (line 208): `!state.loadedFileName || isSaving`
  - saveAsDisabled computation (line 216): `!state.loadedFileName`
  - generateStandardsDisabled computation (line 228): `!activeProject || !activeProject.organisationId`
  - This is where the change needs to be made

- Test file: `frontend/src/__tests__/project-menu-disable.test.tsx`
  - Existing tests for Save As disabled behavior (tests already exist)
  - Pattern for testing disabled menu items and handler gating

- Test file: `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx`
  - Existing tests for Generate Standards enabled/disabled states
  - Tests for handler not being called when disabled

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This is a behavior change, not a visual change. The visual appearance of disabled menu items is already implemented and working.

## Requirements Summary

### Functional Requirements
- When `activeProject` is null/undefined (no project selected/loaded):
  - Project -> Save is disabled (existing behavior)
  - Project -> Save As is disabled (existing behavior)
  - Project -> Generate Standards is ALSO disabled (NEW)
- When an active project is present:
  - Generate Standards is enabled (subject to existing organisationId rule)
- Clicking a disabled Generate Standards item must do nothing (modal must not open)
- The existing handler guard in `handleGenerateStandardsClick` already prevents action when disabled

### Reusability Opportunities
- Reuse the same boolean condition pattern used for Save/Save As: `!state.loadedFileName`
- The existing `generateStandardsDisabled` logic should be extended to include this condition
- Updated logic: `generateStandardsDisabled = !state.loadedFileName || !activeProject || !activeProject.organisationId`
- Alternatively, since `!state.loadedFileName` correlates with `!activeProject`, the simplest change is just to add the `!state.loadedFileName` check

### Scope Boundaries

**In Scope:**
- Frontend: Update `generateStandardsDisabled` computation in TopBar.tsx to include `!state.loadedFileName` check
- Ensure "Generate Standards" renders disabled in the same state as "Save" and "Save As"
- Verify clicking disabled "Generate Standards" does not open the modal (already gated in handler)
- Add/adjust UI test to cover the disabled state when no active project

**Out of Scope:**
- Any backend/gateway changes
- Any change to standards generation API calls
- Any change to menu ordering or labels
- No change needed to FileMenu.tsx (component already handles disabled prop correctly)

### Technical Considerations
- The change is isolated to TopBar.tsx line 228
- Current logic: `const generateStandardsDisabled = !activeProject || !activeProject.organisationId;`
- New logic: `const generateStandardsDisabled = !state.loadedFileName || !activeProject || !activeProject.organisationId;`
- The FileMenu component and its handler already correctly handle the disabled state
- Existing test files can be extended to cover this scenario

### Test Requirements
- Add/Update UI test asserting:
  - With no active project (no loadedFileName), "Save", "Save As", and "Generate Standards" are all disabled
  - With an active project, "Generate Standards" becomes enabled (when organisationId is also present)
  - Disabled "Generate Standards" does not call the handler/open the modal

### Acceptance Criteria
- On application startup with no active project, the Project menu shows "Generate Standards" disabled, alongside the already-disabled "Save" and "Save As"
- Once a project is opened/active, "Generate Standards" is enabled and behaves normally (subject to organisationId rule)
