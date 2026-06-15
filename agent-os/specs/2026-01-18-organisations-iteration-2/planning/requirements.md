# Requirements: Organisations Iteration 2 — Update Project Create Modal (Mandatory Organisation Autocomplete)

## Overview

**Title:** Organisations Iteration 2 — Update Project Create Modal (Mandatory Organisation Autocomplete)

**Context:** Organisations are now a first-class concept and Projects must be associated to exactly one Organisation. The "Project → Create" modal currently captures Project Name, Parent Folder, and optional Project Hierarchy. It must be updated to require an Organisation Name selection, using an autocomplete backed by the organisations API. The user can select an existing organisation or enter a new organisation name (which will create the organisation and link the new project).

**Goal:** Enhance the Project Create modal so every created project is linked to an organisation by name:
- Organisation Name is mandatory
- Autocomplete lists existing organisations
- Typing a new name creates the organisation (id+name) and links the project to it

## Scope

### In Scope
- Frontend: Project Create modal UI + validation + API calls
- Gateway/API usage: call organisations list + create organisation + create project endpoints

### Out of Scope
- No changes to Open/Save As modals in this iteration

## UI Changes

### Create Modal Fields
- Add a new first field at the top of the modal:
  - **Label:** "Organisation Name" (required)
- **Field type:** autocomplete / combobox:
  - Dropdown options populated from GET /api/v1/organisations (name list)
  - User may select an option OR type a new value

### Required Validation
- The Create button MUST be disabled until:
  - Organisation Name has a non-empty value
  - Project Name has a non-empty value
  - Parent Folder has a non-empty value
- (Project Hierarchy remains optional)

### Visual Feedback
- If Organisation Name is empty on submit attempt, show inline validation error:
  - "Organisation Name is required"
- If typed Organisation Name conflicts with existing name (case-sensitive match):
  - Treat it as selecting the existing organisation (do not create duplicate)

## Behavior

### Load Organisations
- When the Create modal opens:
  - Fetch organisations list from GET /api/v1/organisations
  - Cache results for the modal session
- If loading fails:
  - Show non-blocking error message
  - Allow user to still type an organisation name (creation may still work)

### Create Flow
On clicking Create:
1. **Ensure an Organisation exists for the entered name:**
   - If name matches an existing organisation from the loaded list:
     - Use that organisation id
   - Else:
     - Call POST /api/v1/organisations with { name, description: null }
     - If 409 Conflict:
       - Re-fetch organisations list and select the existing one (race-safe)
2. **Create the project** using existing project create endpoint, providing organisation linkage:
   - Include organisationId OR organisationName per the supported backend contract
   - Prefer passing organisationId if available
3. **Set the newly created project** as the active project (existing behavior)
4. **Close modal and refresh** project UI state (existing behavior)

### Error Handling
- If organisation creation fails (non-409):
  - Show error: "Failed to create organisation"
  - Do not create project
- If project creation fails:
  - Show error: "Failed to create project"
  - Do not leave modal in an inconsistent state

## API Usage

### Endpoints Used
- `GET /api/v1/organisations` -> `[{ id, name }]`
- `POST /api/v1/organisations` -> `{ id, name, description }`
- Existing project create endpoint must be called with organisation association:
  - Either `organisationId` (preferred) or `organisationName` (if that is what backend supports)

**Note:** Do not require any new backend endpoints in this iteration.

## Acceptance Criteria

1. Project Create modal shows a new mandatory "Organisation Name" field at the top
2. Autocomplete dropdown shows existing organisations from the API
3. User can select an existing organisation and create a project successfully; project is linked
4. User can type a new organisation name; the organisation is created and the project is linked
5. Create button remains disabled until Organisation Name, Project Name, and Parent Folder are set
6. Duplicate organisation names are not created; 409 is handled gracefully

## Non-Goals

- No changes to Open modal grouping
- No changes to Save As modal
- No UI for editing organisation description
