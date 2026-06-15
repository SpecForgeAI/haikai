# Specification: Organisations Iteration 4 - Update Project Save As Modal

## Goal
Update the "Project > Save As" modal to align with the new organisation-based project model, requiring Organisation Name and providing fields consistent with Create Project (Project Name, Parent Folder, Project Hierarchy), while using the 2-level grouped project list from the Open modal.

## User Stories
- As a user, I want to save my project with an organisation association so that my projects are properly organized within the organisation structure.
- As a user, I want to see projects grouped by Organisation and Hierarchy in the Save As modal so that I can easily navigate and overwrite existing projects.

## Specific Requirements

**Transform saveAs Mode Form Fields**
- Replace single "Filename" input with four form fields: Organisation Name, Project Name, Parent Folder, Project Hierarchy
- Organisation Name is a required autocomplete/combobox field (first in form order)
- Project Name replaces the existing "Filename" label (same underlying value, renamed label only)
- Parent Folder is a required text input field
- Project Hierarchy is an optional text input field
- Maintain same visual styling as CreateProjectModal form fields (inputGroup, inputLabel, input classes)

**Organisation Name Autocomplete Behavior**
- Fetch organisations list via listOrganisations() API when modal opens
- Implement autocomplete using HTML datalist pattern (same as CreateProjectModal)
- User may select an existing organisation or type a new name
- Show non-blocking warning if organisations fail to load (user can still type new name)
- Show loading indicator while fetching organisations

**Form Validation Rules**
- Save button disabled until: Organisation Name non-empty, Project Name non-empty, Parent Folder non-empty
- Project Hierarchy is optional (may be empty)
- Use same isFormValid pattern as CreateProjectModal: organisationName.trim().length > 0 && projectName.trim().length > 0 && parentFolder.trim().length > 0
- Show inline error message on submission failure

**Replace Flat File List with OrganisationGroupedProjectList**
- Replace current flat file list (files.map) with OrganisationGroupedProjectList component
- Change data fetching in loadData() to use Promise.all for listProjects() and listOrganisations() (like open mode)
- Build organisationMap from organisations for id-to-name lookup
- Pass projects, organisationMap, selectedProjectId, onProjectClick, formatDate to OrganisationGroupedProjectList

**Project Selection Behavior (Populate Form from Selected Project)**
- When user clicks a project in the grouped list, populate form fields from that project's data
- Set Organisation Name by looking up project.organisationId in organisationMap
- Set Project Name to project.name
- Set Parent Folder to project.projectParentFolder
- Set Project Hierarchy to project.projectHierarchy (or empty string if null)
- Update selectedProjectId state for visual selection highlight

**Save Flow with Organisation Resolution**
- On Save click: First resolve organisation ID using same logic as CreateProjectModal
- If organisationName matches existing org (exact match in organisations list), use its id
- If organisationName is new, call createOrganisation(trimmedOrgName) to create it
- Handle 409 OrganisationConflictError by re-fetching organisations and finding match
- After organisation resolved, call existing save operation with: projectName, parentFolder, projectHierarchy, organisationId

**Button Label Update**
- Change footer button from "OK" to "Save" for clarity
- Rename okButton CSS class reference or add saveButton alias class
- Maintain same disabled state styling (styles.okButton:disabled)

**State Management Updates**
- Add new state variables: organisationName, parentFolder, projectHierarchy, organisations, organisationsLoading, organisationsError
- Keep existing: projects, selectedProjectId, selectedFilename (now represents project name), isLoading, error
- Remove files state (no longer used in saveAs mode)
- Update useEffect to reset all form state when modal opens

## Existing Code to Leverage

**CreateProjectModal.tsx Organisation Autocomplete Pattern**
- Copy organisation state management: organisationName, organisations, organisationsLoading, organisationsError
- Copy datalist implementation with organisations-datalist id
- Copy organisation resolution logic in handleCreate: find existing org or createOrganisation with 409 handling
- Copy organisationLoading and organisationWarning display elements

**OrganisationGroupedProjectList Component**
- Already exists and used in open mode, directly reuse in saveAs mode
- Pass same props interface: projects, organisationMap, selectedProjectId, onProjectClick, formatDate
- No modifications needed to the component itself

**CreateProjectModal.module.css Styles**
- Reuse inputGroup, inputLabel, input, inputHint class patterns for new form fields
- Reuse organisationLoading and organisationWarning styles for organisation state display
- Add equivalent styles to ModelFileDialog.module.css or import from shared location

**organisationsApi.ts Functions**
- Use listOrganisations() to populate autocomplete options
- Use createOrganisation() for new organisation creation in save flow
- Use OrganisationConflictError for 409 conflict handling

**saveUtils.ts saveModelToBackend Function**
- Existing save utility handles model preparation, validation, and backend save
- May need to extend or create new variant that accepts organisation association parameters

## Out of Scope
- Changes to Create Project modal (handled in Iteration 2)
- Changes to Open modal (handled in Iteration 3)
- Backend Save As contract modifications (use existing API, add organisation_id if supported)
- UI for editing organisation description
- Inline validation messages for individual fields (only show error on submission failure)
- Auto-expand organisation/hierarchy sections to show selected project
- Confirmation dialog when overwriting existing project
- Project duplication/rename logic beyond Save As operation
