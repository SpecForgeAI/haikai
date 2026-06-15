# Specification: Disable Generate Standards When No Active Project

## Goal
Ensure the Project menu item "Generate Standards" is disabled whenever there is no active project loaded, matching the existing disable logic already applied to "Save" and "Save As" on app startup.

## User Stories
- As a user, I want "Generate Standards" to be disabled on app startup so that I understand it requires an active project first
- As a user, I want consistent disabled behavior across Save, Save As, and Generate Standards menu items when no project is loaded

## Specific Requirements

**Extend generateStandardsDisabled computation**
- Modify TopBar.tsx line 228 to include the `!state.loadedFileName` condition
- Current logic: `!activeProject || !activeProject.organisationId`
- New logic: `!state.loadedFileName || !activeProject || !activeProject.organisationId`
- The additional check ensures Generate Standards is disabled in the same scenarios as Save and Save As

**Maintain existing organisationId requirement**
- The existing check for `!activeProject.organisationId` must be preserved
- Generate Standards requires both a loaded project AND a valid organisationId to be enabled
- This is additive behavior, not a replacement

**No changes required to FileMenu component**
- FileMenu.tsx already handles the `generateStandardsDisabled` prop correctly
- The `handleGenerateStandardsClick` handler already guards against disabled state (lines 226-231)
- Menu item styling already applies `menuItemDisabled` class when disabled (line 330)

**Verify handler gating behavior**
- Clicking disabled "Generate Standards" must not open the modal
- The existing handler guard `if (!generateStandardsDisabled && onGenerateStandards)` already prevents this
- No additional code changes needed in the handler

## Visual Design
N/A - This is a behavior change, not a visual change. The visual appearance of disabled menu items is already implemented and working.

## Existing Code to Leverage

**TopBar.tsx disabled logic pattern**
- Line 208: `saveDisabled = !state.loadedFileName || isSaving` shows the loadedFileName pattern
- Line 216: `saveAsDisabled = !state.loadedFileName` is the exact pattern to replicate
- Line 228: `generateStandardsDisabled = !activeProject || !activeProject.organisationId` is the line to modify
- Uses `state.loadedFileName` from ArchitectureContext to determine if a project is loaded
- Consistent pattern ensures all project-dependent menu items behave the same on startup

**FileMenu.tsx component patterns**
- Lines 226-231: `handleGenerateStandardsClick` handler with disabled guard already exists
- Lines 329-335: Generate Standards menu item with conditional disabled class already implemented
- Lines 337-353: Save and Save As menu items use identical disabled styling pattern
- Component correctly handles the disabled prop without modification needed

**Existing test files**
- `frontend/src/__tests__/project-menu-disable.test.tsx`: Testing pattern for disabled menu items
- `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx`: Existing tests for Generate Standards enabled/disabled states
- Test pattern: Verify className contains `menuItemDisabled` when disabled
- Test pattern: Verify handler not called when clicking disabled item

## Out of Scope
- Any backend/gateway changes
- Any change to standards generation API calls
- Any change to menu ordering or labels
- Any change to FileMenu.tsx component code
- Any change to the Generate Standards modal behavior
- Any change to the organisationId validation logic
- Visual styling changes to disabled menu items
- New props or state variables in TopBar.tsx
- Changes to ArchitectureContext or ProjectContext
- Import/Export menu item disable logic changes
