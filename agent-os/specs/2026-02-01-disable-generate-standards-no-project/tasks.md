# Task Breakdown: Disable Generate Standards When No Active Project

## Overview
Total Tasks: 8

This is a focused frontend change to ensure the "Generate Standards" menu item is disabled when no active project is loaded, matching the existing behavior of "Save" and "Save As" menu items.

## Task List

### Frontend Logic

#### Task Group 1: Update Disabled State Logic
**Dependencies:** None

- [x] 1.0 Complete disabled state logic update
  - [x] 1.1 Write 3 focused tests for Generate Standards disabled behavior
    - Test 1: Verify Generate Standards is disabled when `loadedFileName` is null/empty (no project loaded)
    - Test 2: Verify Generate Standards is disabled when `activeProject` is null
    - Test 3: Verify Generate Standards is enabled when both `loadedFileName` exists AND `activeProject` with `organisationId` exists
    - Reference existing test patterns in `frontend/src/__tests__/project-menu-disable.test.tsx`
    - Reference existing test patterns in `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx`
  - [x] 1.2 Modify `generateStandardsDisabled` computation in TopBar.tsx
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Location: Line 228
    - Current logic: `const generateStandardsDisabled = !activeProject || !activeProject.organisationId;`
    - New logic: `const generateStandardsDisabled = !state.loadedFileName || !activeProject || !activeProject.organisationId;`
    - Pattern reference: Line 216 `saveAsDisabled = !state.loadedFileName`
  - [x] 1.3 Ensure disabled state logic tests pass
    - Run ONLY the 3 tests written in 1.1
    - Verify the disabled state correctly reflects when no project is loaded
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 1.1 pass
- Generate Standards is disabled when `state.loadedFileName` is falsy
- Generate Standards is disabled when `activeProject` is null/undefined
- Generate Standards is disabled when `activeProject.organisationId` is missing
- Generate Standards is enabled only when all three conditions are satisfied
- No changes made to FileMenu.tsx component (it already handles disabled prop correctly)

### Testing

#### Task Group 2: Test Review and Integration Verification
**Dependencies:** Task Group 1

- [x] 2.0 Review existing tests and verify integration
  - [x] 2.1 Review tests from Task Group 1
    - Review the 3 tests written in 1.1
    - Ensure they cover the critical disabled state scenarios
  - [x] 2.2 Analyze test coverage gaps for THIS feature only
    - Verify disabled styling is applied (className contains `menuItemDisabled`)
    - Verify handler is not called when clicking disabled Generate Standards
    - Check existing tests in `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx` for overlap
  - [x] 2.3 Write up to 3 additional strategic tests if gaps exist
    - Test 4 (if needed): Verify clicking disabled Generate Standards does not open modal
    - Test 5 (if needed): Verify disabled CSS class is applied when no active project
    - Test 6 (if needed): Verify consistency with Save/Save As disabled states
    - Skip if existing tests already cover these scenarios adequately
  - [x] 2.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Run tests from `frontend/src/__tests__/project-menu-disable.test.tsx`
    - Run tests from `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx`
    - Expected total: approximately 3-6 new/modified tests
    - Do NOT run the entire application test suite
    - Verify all disabled state scenarios pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 3-6 tests total)
- Generate Standards disabled behavior matches Save and Save As disabled behavior
- Clicking disabled Generate Standards does not trigger any action
- No regressions in existing Generate Standards functionality when enabled

## Execution Order

Recommended implementation sequence:
1. Frontend Logic (Task Group 1) - Modify disabled state computation
2. Test Review and Integration Verification (Task Group 2) - Ensure comprehensive coverage

## Implementation Notes

### Files to Modify
- `frontend/src/components/TopBar/TopBar.tsx` - Line 228 only

### Files to Reference (No Modification Needed)
- `frontend/src/components/TopBar/FileMenu.tsx` - Already handles disabled prop correctly
- `frontend/src/__tests__/project-menu-disable.test.tsx` - Existing test patterns
- `frontend/src/components/TopBar/FileMenu.generateStandards.test.tsx` - Existing Generate Standards tests

### Key Patterns to Follow
- Use `state.loadedFileName` from ArchitectureContext (same as saveAsDisabled on line 216)
- Preserve existing `!activeProject || !activeProject.organisationId` checks
- The change is additive (adding a condition), not replacing existing logic

## Out of Scope Reminders
- No backend/gateway changes
- No changes to FileMenu.tsx component code
- No changes to the Generate Standards modal behavior
- No changes to the organisationId validation logic
- No changes to ArchitectureContext or ProjectContext
