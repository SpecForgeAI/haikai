# Task Breakdown: Organisations Iteration 2 - Mandatory Organisation Autocomplete

## Overview
Total Tasks: 4 Task Groups, ~28 Sub-tasks

This feature adds a mandatory Organisation Name autocomplete field to the Create Project modal. Users can select an existing organisation or type a new name to create one. The implementation follows existing patterns in projectsApi.ts and CreateProjectModal.tsx.

## Task List

### API Layer

#### Task Group 1: Organisations API Client
**Dependencies:** None

- [x] 1.0 Complete Organisations API client
  - [x] 1.1 Write 4-6 focused tests for organisationsApi.ts
    - Test listOrganisations() returns mapped OrganisationDto array
    - Test listOrganisations() throws on non-200 response
    - Test createOrganisation() sends correct snake_case payload and returns mapped result
    - Test createOrganisation() throws OrganisationConflictError on 409 response
    - Test createOrganisation() throws generic error on other failures
    - Test error message extraction from JSON error body
  - [x] 1.2 Create organisationsApi.ts file structure
    - Location: `frontend/src/api/organisationsApi.ts`
    - Add file header comment referencing spec
    - Add API_BASE constant following projectsApi.ts pattern
  - [x] 1.3 Define TypeScript interfaces
    - `OrganisationDto`: `{ id: string; name: string; description: string | null }`
    - `OrganisationDtoSnake`: `{ id: string; name: string; description: string | null }` (private)
    - `OrganisationConflictError` class extending Error with `isConflict: true` property
  - [x] 1.4 Implement mapOrganisationFromSnake function
    - Map snake_case API response to camelCase DTO
    - Follow pattern from projectsApi.ts mapProjectFromSnake
  - [x] 1.5 Implement listOrganisations() function
    - GET /api/v1/organisations
    - Return `OrganisationDto[]`
    - Handle error responses with message extraction
    - Follow fetch pattern from projectsApi.ts
  - [x] 1.6 Implement createOrganisation(name: string) function
    - POST /api/v1/organisations with `{ name, description: null }`
    - Return `OrganisationDto` on success
    - Throw `OrganisationConflictError` on 409 response
    - Throw generic Error on other failures
    - Follow error handling pattern from projectsApi.ts
  - [x] 1.7 Ensure API client tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all functions work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- listOrganisations() fetches and maps organisation list
- createOrganisation() creates organisation and handles 409 conflict
- Error messages are properly extracted from API responses
- Code follows patterns from projectsApi.ts and workItemsApi.ts

---

#### Task Group 2: Update projectsApi.ts
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete projectsApi.ts update
  - [x] 2.1 Write 2-3 focused tests for createProject organisationId parameter
    - Test createProject() includes organisation_id in request body when provided
    - Test createProject() omits organisation_id when not provided
    - Test response mapping unchanged
  - [x] 2.2 Update createProject() function signature
    - Add optional `organisationId?: string` parameter
    - Update JSDoc comment to document new parameter
  - [x] 2.3 Update request body construction
    - Include `organisation_id: organisationId` when organisationId is provided
    - Use snake_case for API request (organisation_id)
    - Omit field entirely when undefined (not null)
  - [x] 2.4 Ensure projectsApi tests pass
    - Run ONLY the 2-3 tests written in 2.1
    - Verify existing functionality unchanged
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 2-3 tests written in 2.1 pass
- createProject() accepts optional organisationId parameter
- organisation_id is included in snake_case request body when provided
- Existing functionality remains unchanged

---

### Frontend Components

#### Task Group 3: CreateProjectModal UI Changes
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Complete CreateProjectModal UI implementation
  - [x] 3.1 Write 6-8 focused tests for CreateProjectModal changes
    - Test Organisation Name field renders at top of form
    - Test datalist populates with organisations on modal open
    - Test Create button disabled when Organisation Name empty
    - Test Create button disabled when any required field empty
    - Test existing organisation selected uses its ID
    - Test new organisation name triggers createOrganisation call
    - Test 409 conflict re-fetches list and finds matching org
    - Test error display for organisation creation failure
  - [x] 3.2 Add new state variables
    - `organisationName: string` (initially empty)
    - `organisations: OrganisationDto[]` (for cached list)
    - `organisationsLoading: boolean` (for load indicator)
    - `organisationsError: string | null` (for non-blocking error)
  - [x] 3.3 Add useEffect for loading organisations on modal open
    - Trigger on `isOpen` becoming true
    - Call listOrganisations() from organisationsApi
    - Store results in `organisations` state
    - Set `organisationsError` on failure (non-blocking)
    - Set `organisationsLoading` appropriately
  - [x] 3.4 Update isFormValid validation
    - Change to: `organisationName.trim().length > 0 && projectName.trim().length > 0 && parentFolder.trim().length > 0`
    - Project Hierarchy remains optional
  - [x] 3.5 Add Organisation Name input field with datalist
    - Position at TOP of form (before Project Name)
    - Label: "Organisation Name" (required indicator implied)
    - Input type: text with list attribute
    - Add datalist element with organisation options
    - Bind to `organisationName` state
    - Reuse inputGroup, inputLabel, input classes
    - Add data-testid for testing
  - [x] 3.6 Update handleCreate flow with organisation resolution
    - Step 1: Find matching organisation in cached list (case-sensitive exact match on name)
    - Step 2a: If match found, use that organisation's `id`
    - Step 2b: If no match, call createOrganisation(organisationName.trim())
      - On success: use returned `id`
      - On 409 Conflict: re-fetch list, find matching name, use that `id`
      - On other error: setError("Failed to create organisation"), abort
    - Step 3: Call createProject with resolved organisationId
    - Step 4-5: Existing behavior (refreshActiveProject, saveModelToBackend, onClose)
  - [x] 3.7 Reset organisationName in modal open useEffect
    - Add `setOrganisationName('')` to the reset logic
    - Clear organisations state for fresh fetch
    - Clear organisationsError
  - [x] 3.8 Add loading indicator for organisations fetch
    - Show subtle indicator when `organisationsLoading` is true
    - Consider spinner or "Loading..." text near field
  - [x] 3.9 Add non-blocking warning for organisations load failure
    - Display subtle warning near field when `organisationsError` is set
    - Allow user to continue (they can still type new org name)
  - [x] 3.10 Ensure CreateProjectModal tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify all new behaviors work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Organisation Name field appears at top of modal
- Autocomplete shows existing organisations from API
- Create button disabled until all required fields filled
- Existing organisation selection uses existing ID
- New organisation name creates org and links project
- 409 conflict handled gracefully (re-fetch and match)
- Error states displayed appropriately

---

#### Task Group 4: CSS Styling Updates
**Dependencies:** Task Group 3

- [x] 4.0 Complete CSS styling for new elements
  - [x] 4.1 Write 2 focused visual/styling tests (if applicable)
    - Test loading indicator visibility during fetch
    - Test warning message styling on load failure
  - [x] 4.2 Add loading indicator styles to CreateProjectModal.module.css
    - Create `.organisationLoading` class
    - Subtle spinner or text indication
    - Position appropriately relative to input
  - [x] 4.3 Add non-blocking warning styles
    - Create `.organisationWarning` class
    - Muted color (amber/yellow tones)
    - Smaller font size than error message
    - Less prominent than error message style
  - [x] 4.4 Verify existing styles work for new input
    - inputGroup, inputLabel, input classes should apply correctly
    - inputHint class if hint text added
  - [x] 4.5 Ensure styling tests pass
    - Run ONLY the 2 tests written in 4.1 (if applicable)
    - Visual verification of styles
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- Loading indicator styled appropriately
- Warning message styled as non-blocking (less prominent than errors)
- Organisation Name input matches existing field styling
- All styles consistent with existing CreateProjectModal design

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests from organisationsApi (Task 1.1)
    - Review the 2-3 tests from projectsApi update (Task 2.1)
    - Review the 6-8 tests from CreateProjectModal (Task 3.1)
    - Review the 2 tests from CSS styling (Task 4.1)
    - Total existing tests: approximately 14-19 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical user workflows that lack test coverage
    - Focus ONLY on gaps related to organisation autocomplete feature
    - Prioritize end-to-end create flow scenarios
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 6 additional strategic tests maximum
    - Integration test: full happy path (select existing org, create project)
    - Integration test: full happy path (new org name, create project)
    - Integration test: 409 conflict recovery flow
    - Edge case: empty organisation name validation
    - Edge case: whitespace-only organisation name
    - Error recovery: organisation creation fails, project not created
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 20-25 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-25 tests total)
- Critical user workflows for organisation autocomplete are covered
- No more than 6 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1: API Layer (Parallel)
  |
  +-- Task Group 1: organisationsApi.ts (new file)
  |
  +-- Task Group 2: projectsApi.ts update (organisationId param)
  |
  v
Phase 2: UI Implementation
  |
  +-- Task Group 3: CreateProjectModal.tsx changes
  |
  v
Phase 3: Styling
  |
  +-- Task Group 4: CSS updates
  |
  v
Phase 4: Test Review
  |
  +-- Task Group 5: Gap analysis and integration tests
```

**Notes:**
- Task Groups 1 and 2 can be implemented in parallel as they have no dependencies on each other
- Task Group 3 depends on both API groups being complete
- Task Group 4 can begin once Task Group 3 field structure is in place
- Task Group 5 is the final validation phase

## Files to Create/Modify

| File | Action | Task Group |
|------|--------|------------|
| `frontend/src/api/organisationsApi.ts` | CREATE | 1 |
| `frontend/src/api/projectsApi.ts` | MODIFY | 2 |
| `frontend/src/components/Project/CreateProjectModal.tsx` | MODIFY | 3 |
| `frontend/src/components/Project/CreateProjectModal.module.css` | MODIFY | 4 |
| `frontend/src/__tests__/organisationsApi.test.ts` | CREATE | 1 |
| `frontend/src/__tests__/projectsApi.organisationId.test.ts` | CREATE | 2 |
| `frontend/src/__tests__/CreateProjectModal.organisation.test.tsx` | CREATE | 3 |

## Key Implementation Patterns to Follow

### From projectsApi.ts:
- API_BASE constant from environment variable
- Snake_case request body fields (organisation_id)
- Error message extraction from JSON response body
- mapFromSnake helper functions for response mapping

### From CreateProjectModal.tsx:
- useState for each form field
- useEffect with isOpen dependency for reset/fetch
- inputGroup/inputLabel/input/inputHint styling pattern
- handleCreate async with try/catch and setIsSubmitting
- styles.errorMessage for error display

### From workItemsApi.ts:
- Clean DTO interfaces (public and private snake_case)
- Mapping functions for request/response transformation
- Consistent error message formatting
