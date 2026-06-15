# Task Breakdown: Organisations Iteration 4 - Update Project Save As Modal

## Overview
Total Tasks: 20 sub-tasks across 4 task groups

**Objective:** Transform the Save As modal from a simple filename-based file picker to an organisation-aware project save dialog with four form fields (Organisation Name, Project Name, Parent Folder, Project Hierarchy), a 2-level grouped project list, and organisation resolution logic on save.

## Task List

### State and Data Layer

#### Task Group 1: State Management and Data Fetching Updates
**Dependencies:** None

- [x] 1.0 Complete state management and data fetching layer
  - [x] 1.1 Write 2-6 focused tests for saveAs mode state and data fetching
    - Test: New state variables initialize correctly when modal opens in saveAs mode
    - Test: loadData() fetches both listProjects() and listOrganisations() in parallel for saveAs mode
    - Test: organisationMap is built correctly from organisations list
    - Test: Form state resets properly when modal reopens (organisationName, parentFolder, projectHierarchy cleared)
    - Test: organisationsLoading state updates correctly during fetch
    - Test: organisationsError state captures load failures with non-blocking warning
  - [x] 1.2 Add new state variables to ModelFileDialog.tsx for saveAs mode
    - Add `organisationName: string` state (default empty string)
    - Add `parentFolder: string` state (default empty string)
    - Add `projectHierarchy: string` state (default empty string)
    - Add `organisationsLoading: boolean` state (default false)
    - Add `organisationsError: string | null` state (default null)
    - Keep existing `organisations` state already present for open mode
    - Pattern: Follow CreateProjectModal.tsx state declarations
  - [x] 1.3 Update loadData() to fetch projects and organisations for saveAs mode
    - Change saveAs mode to use Promise.all([listProjects(), listOrganisations()]) instead of fetchModelFilenames()
    - Remove files state usage in saveAs mode (no longer needed)
    - Set organisationsLoading true before fetch, false after
    - Capture organisationsError if listOrganisations() fails (non-blocking, still allow form input)
    - Pattern: Follow existing open mode loadData() implementation
  - [x] 1.4 Update useEffect to reset all form state when modal opens
    - Reset organisationName to empty string
    - Reset parentFolder to empty string
    - Reset projectHierarchy to empty string
    - Keep existing selectedFilename reset (now represents projectName)
    - Reset organisationsLoading and organisationsError
    - Pattern: Follow CreateProjectModal.tsx useEffect reset pattern
  - [x] 1.5 Ensure state management tests pass
    - Run ONLY the 2-6 tests written in 1.1
    - Verify state initializes and resets correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 1.1 pass
- State variables for organisation fields exist and initialize correctly
- loadData() fetches both projects and organisations for saveAs mode
- Form state resets completely when modal reopens

### Form Fields Layer

#### Task Group 2: Transform saveAs Mode Form Fields
**Dependencies:** Task Group 1

- [x] 2.0 Complete form fields transformation
  - [x] 2.1 Write 2-6 focused tests for form fields and validation
    - Test: Organisation Name input renders with autocomplete/datalist
    - Test: Project Name label replaces "Filename" label
    - Test: Parent Folder and Project Hierarchy inputs render
    - Test: Form validation disables Save until organisationName + projectName + parentFolder non-empty
    - Test: Organisation loading indicator displays while fetching
    - Test: Organisation warning displays on load failure (non-blocking)
  - [x] 2.2 Replace single "Filename" input with four form fields
    - Add Organisation Name input as first field with datalist for autocomplete
    - Rename existing "Filename" label to "Project Name" (keep same inputValue state)
    - Add Parent Folder input field below Project Name
    - Add Project Hierarchy input field below Parent Folder
    - Use inputGroup, inputLabel, input CSS classes
    - Pattern: Copy form structure from CreateProjectModal.tsx
  - [x] 2.3 Implement Organisation Name autocomplete behavior
    - Add datalist element with id="organisations-datalist"
    - Populate datalist options from organisations array
    - Wire input to organisationName state
    - Show loading indicator when organisationsLoading is true
    - Show warning message when organisationsError is set
    - Pattern: Copy exact datalist implementation from CreateProjectModal.tsx
  - [x] 2.4 Update form validation logic
    - Create isFormValid computed value: organisationName.trim().length > 0 && inputValue.trim().length > 0 && parentFolder.trim().length > 0
    - Use isFormValid to control Save button disabled state
    - projectHierarchy is optional (not included in validation)
    - Pattern: Follow CreateProjectModal.tsx isFormValid pattern
  - [x] 2.5 Add CSS styles to ModelFileDialog.module.css
    - Add inputGroup, input, inputHint classes (copy from CreateProjectModal.module.css)
    - Add organisationLoading and organisationWarning classes
    - Add saveButton class (alias of okButton or new style matching okButton)
    - Ensure disabled state styling for saveButton
  - [x] 2.6 Ensure form fields tests pass
    - Run ONLY the 2-6 tests written in 2.1
    - Verify all four form fields render correctly
    - Verify validation logic works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 2.1 pass
- Four form fields render in correct order: Organisation Name, Project Name, Parent Folder, Project Hierarchy
- Organisation autocomplete works with datalist
- Save button disables until required fields are filled

### List Integration Layer

#### Task Group 3: Replace Flat File List with OrganisationGroupedProjectList
**Dependencies:** Task Group 2

- [x] 3.0 Complete list integration
  - [x] 3.1 Write 2-6 focused tests for grouped list and selection behavior
    - Test: OrganisationGroupedProjectList renders in saveAs mode (not flat file list)
    - Test: Clicking project populates Organisation Name from organisationMap lookup
    - Test: Clicking project populates Project Name from project.name
    - Test: Clicking project populates Parent Folder from project.projectParentFolder
    - Test: Clicking project populates Project Hierarchy from project.projectHierarchy (or empty string if null)
    - Test: selectedProjectId updates on project click for visual selection highlight
  - [x] 3.2 Replace flat file list rendering with OrganisationGroupedProjectList
    - Remove files.map() rendering block for saveAs mode
    - Add OrganisationGroupedProjectList component for saveAs mode (same as open mode)
    - Pass props: projects, organisationMap, selectedProjectId, onProjectClick, formatDate
    - Pattern: Follow existing open mode OrganisationGroupedProjectList usage
  - [x] 3.3 Implement project selection handler for saveAs mode
    - Create new handleProjectClickSaveAs function (or update handleProjectClick)
    - On project click: lookup organisation name via organisationMap.get(project.organisationId)
    - Set organisationName state to looked-up org name (or empty string if not found)
    - Set inputValue state (project name) to project.name
    - Set parentFolder state to project.projectParentFolder
    - Set projectHierarchy state to project.projectHierarchy || '' (empty string if null)
    - Update selectedProjectId for visual selection
    - Pattern: Extend existing handleProjectClick logic
  - [x] 3.4 Ensure list integration tests pass
    - Run ONLY the 2-6 tests written in 3.1
    - Verify grouped list renders
    - Verify project selection populates all form fields
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 3.1 pass
- OrganisationGroupedProjectList renders in saveAs mode
- Clicking a project populates all four form fields correctly
- Selection highlight updates on project click

### Save Flow Layer

#### Task Group 4: Save Flow with Organisation Resolution and Button Update
**Dependencies:** Task Group 3

- [x] 4.0 Complete save flow and finalize UI
  - [x] 4.1 Write 2-6 focused tests for save flow
    - Test: Save resolves existing organisation by exact name match
    - Test: Save creates new organisation when name not found in list
    - Test: Save handles 409 OrganisationConflictError by re-fetching and finding match
    - Test: Save calls onConfirm with correct parameters after organisation resolution
    - Test: Button label is "Save" not "OK"
    - Test: Save button disabled state respects isFormValid
  - [x] 4.2 Update handleOkClick to implement organisation resolution
    - Rename to handleSaveClick for clarity
    - Add organisation resolution logic before calling onConfirm:
      - Check if trimmed organisationName matches existing org in organisations array
      - If match: use existingOrg.id
      - If no match: call createOrganisation(trimmedOrgName)
      - Handle OrganisationConflictError: re-fetch organisations, find matching org
    - Pass resolved organisationId along with projectName, parentFolder, projectHierarchy to save operation
    - Pattern: Copy exact organisation resolution logic from CreateProjectModal.tsx handleCreate
  - [x] 4.3 Update onConfirm callback signature and save operation integration
    - Current: onConfirm(filename: string)
    - Consideration: May need to extend onConfirm to pass additional parameters (organisationId, parentFolder, projectHierarchy)
    - Alternative: If saveUtils.saveModelToBackend handles organisation association internally, ensure it receives required parameters
    - Document integration point for parent component that receives onConfirm
  - [x] 4.4 Update footer button from "OK" to "Save"
    - Change button text from "OK" to "Save"
    - Optionally add saveButton CSS class (can reuse okButton styling)
    - Update button click handler reference if renamed in 4.2
    - Maintain disabled state styling
  - [x] 4.5 Add error handling and loading state for save operation
    - Show inline error message on organisation resolution failure
    - Show inline error message on save operation failure
    - Optionally add isSubmitting state to prevent double-clicks
    - Pattern: Follow CreateProjectModal.tsx error display pattern
  - [x] 4.6 Ensure save flow tests pass
    - Run ONLY the 2-6 tests written in 4.1
    - Verify organisation resolution works for existing and new orgs
    - Verify 409 conflict handling
    - Verify button label and disabled state
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-6 tests written in 4.1 pass
- Organisation resolution finds existing org or creates new one
- 409 conflict is handled by re-fetching and finding match
- Button displays "Save" and respects disabled state
- Error messages display on failure

### Testing Layer

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 2-6 tests written for state management (Task 1.1)
    - Review the 2-6 tests written for form fields (Task 2.1)
    - Review the 2-6 tests written for list integration (Task 3.1)
    - Review the 2-6 tests written for save flow (Task 4.1)
    - Total existing tests: approximately 8-24 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to Save As modal functionality
    - Do NOT assess entire application test coverage
    - Prioritize integration tests over additional unit tests
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Consider: End-to-end flow from modal open to successful save
    - Consider: Form field pre-fill from currentFilename prop
    - Consider: Keyboard handling (Enter to save, Escape to cancel)
    - Consider: Empty state when no projects exist
    - Do NOT write exhaustive tests for all edge cases
    - Skip accessibility tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to ModelFileDialog saveAs mode
    - Run ONLY tests from Task Groups 1-4 plus gap tests from 5.3
    - Expected total: approximately 16-32 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-32 tests total)
- Critical Save As workflows are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on Save As modal functionality

## Execution Order

Recommended implementation sequence:
1. **State and Data Layer (Task Group 1)** - Foundation for all other work
2. **Form Fields Layer (Task Group 2)** - UI transformation building on state
3. **List Integration Layer (Task Group 3)** - List replacement and selection behavior
4. **Save Flow Layer (Task Group 4)** - Complete save functionality and button update
5. **Test Review and Gap Analysis (Task Group 5)** - Final validation

## Key Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/file/ModelFileDialog.tsx` | State management, form fields, list integration, save flow |
| `frontend/src/components/file/ModelFileDialog.module.css` | New CSS classes for form inputs and organisation states |
| `frontend/src/__tests__/ModelFileDialog.saveAs.test.tsx` | New test file for saveAs mode functionality |

## Patterns to Follow

| Pattern | Source File |
|---------|-------------|
| Organisation autocomplete with datalist | `CreateProjectModal.tsx` lines 283-318 |
| Organisation resolution logic (existing/new/409) | `CreateProjectModal.tsx` lines 167-200 |
| Form validation (isFormValid) | `CreateProjectModal.tsx` lines 136-139 |
| OrganisationGroupedProjectList usage | `ModelFileDialog.tsx` lines 325-331 (open mode) |
| State management for organisations | `CreateProjectModal.tsx` lines 61-64 |
| CSS input classes | `CreateProjectModal.module.css` lines 77-123 |

## API Dependencies

| API Function | Module | Usage |
|--------------|--------|-------|
| `listProjects()` | `projectsApi.ts` | Fetch projects for grouped list |
| `listOrganisations()` | `organisationsApi.ts` | Fetch organisations for autocomplete and lookup |
| `createOrganisation()` | `organisationsApi.ts` | Create new org when name not found |
| `OrganisationConflictError` | `organisationsApi.ts` | Handle 409 conflict on org creation |

## Out of Scope Reminders

- No changes to CreateProjectModal (Iteration 2)
- No changes to Open modal (Iteration 3)
- No backend Save As contract modifications beyond existing organisation_id support
- No UI for editing organisation description
- No inline validation messages for individual fields (only show error on submission failure)
- No auto-expand to show selected project in grouped list
- No confirmation dialog when overwriting existing project

## Implementation Summary

**Completed on 2026-01-18**

All 5 task groups have been successfully implemented:

1. **Task Group 1: State Management and Data Fetching Updates** - Added new state variables (organisationName, parentFolder, projectHierarchy, organisationsLoading, organisationsError), updated loadData() to fetch both projects and organisations in parallel using Promise.all, and ensured form state resets when modal reopens.

2. **Task Group 2: Transform saveAs Mode Form Fields** - Replaced the single "Filename" input with four form fields (Organisation Name with autocomplete datalist, Project Name, Parent Folder, Project Hierarchy), implemented form validation requiring Organisation Name + Project Name + Parent Folder, and added appropriate CSS styles.

3. **Task Group 3: Replace Flat File List with OrganisationGroupedProjectList** - Replaced the flat file list with OrganisationGroupedProjectList component, implemented project selection handler that populates all form fields from the selected project, including organisation name lookup via organisationMap.

4. **Task Group 4: Save Flow with Organisation Resolution and Button Update** - Implemented handleSaveClick with organisation resolution logic (finds existing org by name or creates new one, handles 409 conflict by re-fetching), updated button label from "OK" to "Save", added error handling and isSubmitting state, and updated onConfirm callback to pass SaveAsResult object.

5. **Task Group 5: Test Review and Gap Analysis** - Created comprehensive test file with 29 tests covering all task groups including state management, form fields, grouped list selection, save flow, and integration tests.

**Key Changes:**
- `frontend/src/components/file/ModelFileDialog.tsx` - Complete rewrite of saveAs mode logic
- `frontend/src/components/file/ModelFileDialog.module.css` - Added new CSS classes for form inputs and states
- `frontend/src/__tests__/ModelFileDialog.saveAs.test.tsx` - New comprehensive test file (29 tests, all passing)

**Test Results:** All 29 tests pass, plus existing 4 organisation tests for open mode continue to pass.
