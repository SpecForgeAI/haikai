# Specification: Organisations Iteration 2 - Mandatory Organisation Autocomplete in Create Project Modal

## Goal
Enhance the Create Project modal to require an Organisation Name selection via autocomplete, ensuring every created project is linked to an organisation (either existing or newly created).

## User Stories
- As a user, I want to select an existing organisation from a dropdown when creating a project so that my project is properly categorized
- As a user, I want to type a new organisation name when creating a project so that a new organisation is created and linked automatically

## Specific Requirements

**Organisation Name Autocomplete Field**
- Add new field at the TOP of the modal form, before Project Name
- Field label: "Organisation Name" (required)
- Field type: text input with datalist for autocomplete suggestions
- Dropdown options populated from cached organisations list (fetched on modal open)
- User can select an existing organisation OR type a new organisation name
- Use native HTML5 datalist element for autocomplete (simpler than custom typeahead)

**Organisations API Client (organisationsApi.ts)**
- Create new file `frontend/src/api/organisationsApi.ts`
- Follow patterns from `projectsApi.ts` and `workItemsApi.ts` (snake_case mapping, API_BASE, error handling)
- Define `OrganisationDto` interface: `{ id: string; name: string; description: string | null }`
- Implement `listOrganisations()`: GET /api/v1/organisations, returns `OrganisationDto[]`
- Implement `createOrganisation(name: string)`: POST /api/v1/organisations with `{ name, description: null }`, returns `OrganisationDto`
- Handle 409 Conflict response specially in createOrganisation (throw identifiable error)

**Form State Changes**
- Add `organisationName` state (string, initially empty)
- Add `organisations` state (array, for cached list)
- Add `organisationsLoading` state (boolean, for load indicator)
- Add `organisationsError` state (string | null, for non-blocking error)
- Update `isFormValid` to: `organisationName.trim().length > 0 && projectName.trim().length > 0 && parentFolder.trim().length > 0`

**Load Organisations on Modal Open**
- Fetch organisations via `listOrganisations()` when modal opens (in useEffect with isOpen dependency)
- Store results in `organisations` state for autocomplete suggestions
- If fetch fails: set `organisationsError` with message, but allow user to proceed (non-blocking)
- Show subtle error indicator near the field if load failed

**Create Flow Logic (handleCreate)**
- Step 1: Resolve organisation ID from entered name
  - Check if `organisationName` matches an existing organisation in cached list (case-sensitive exact match on name)
  - If match found: use that organisation's `id`
  - If no match: call `createOrganisation(organisationName.trim())`
    - On success: use returned `id`
    - On 409 Conflict: re-fetch organisations list, find matching name, use that `id`
    - On other error: show "Failed to create organisation" error, abort flow
- Step 2: Call `createProject` with `organisationId` parameter
- Step 3-4: Existing behavior (refreshActiveProject, saveModelToBackend, onClose)

**Update projectsApi.createProject**
- Add optional `organisationId?: string` parameter to `createProject` function signature
- Include `organisation_id` in the request body when provided (snake_case for API)
- No changes to response handling

**Validation and Error Display**
- Show inline validation error "Organisation Name is required" if field is empty on submit attempt
- Create button remains disabled until all three required fields are non-empty
- Display API errors in existing `errorMessage` div pattern

**CSS Styling**
- Reuse existing `inputGroup`, `inputLabel`, `input`, `inputHint` classes from CreateProjectModal.module.css
- Add subtle loading indicator style for when organisations are being fetched
- Add non-blocking warning style for when organisation load failed

## Visual Design
No visual mockups provided. Follow existing CreateProjectModal field patterns exactly.

## Existing Code to Leverage

**CreateProjectModal.tsx (frontend/src/components/Project/CreateProjectModal.tsx)**
- Reuse form state pattern: useState for each field, error, isSubmitting
- Reuse useEffect pattern for modal open reset and keyboard handling
- Reuse inputGroup/inputLabel/input/inputHint structure for new Organisation Name field
- Reuse handleCreate async pattern with try/catch and setIsSubmitting
- Reuse error display pattern with `styles.errorMessage`

**projectsApi.ts (frontend/src/api/projectsApi.ts)**
- Follow API_BASE pattern for environment variable
- Follow snake_case request body pattern (organisation_id)
- Follow error extraction pattern (try to parse JSON error body)
- Follow mapping functions pattern (mapProjectFromSnake)

**workItemsApi.ts (frontend/src/api/workItemsApi.ts)**
- Reference for clean API client structure with DTOs and mapping functions
- Reference for error message formatting pattern

**TypeaheadCell.tsx (frontend/src/components/Grid/TypeaheadCell.tsx)**
- Reference for dropdown filtering pattern if datalist insufficient
- Reference for click-outside handling pattern
- Note: datalist is simpler and sufficient for this use case

**CreateProjectModal.module.css (frontend/src/components/Project/CreateProjectModal.module.css)**
- Reuse all existing input styles directly
- Reference for any new subtle warning/loading indicator styles needed

## Out of Scope
- Changes to Open Project modal
- Changes to Save As modal
- Organisation description field (always null for this iteration)
- Editing existing organisation details
- Organisation management UI (list, edit, delete)
- Case-insensitive organisation name matching (use case-sensitive)
- Custom styled autocomplete dropdown (use native datalist)
- Organisation search/filter beyond basic autocomplete
- Displaying organisation ID anywhere in the UI
