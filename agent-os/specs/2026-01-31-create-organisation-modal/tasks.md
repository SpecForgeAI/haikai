# Task Breakdown: Create Organisation Modal

## Overview
Total Tasks: 24

This spec adds a global "Create Organisation" modal accessible via Ctrl+Shift+M keyboard shortcut. The modal collects organisation fields (name, description, standards document lists) with client-side validation, persists to the Architecture Model Service, and makes the new organisation immediately available in the Create Project UI.

## Task List

### Reusable Component Layer

#### Task Group 1: MultiValueChipsInput Component
**Dependencies:** None

- [x] 1.0 Complete MultiValueChipsInput reusable component
  - [x] 1.1 Write 2-6 focused tests for MultiValueChipsInput functionality
    - Test chip addition via Enter key press
    - Test chip addition via delimiter input (comma, semicolon, pipe)
    - Test chip removal via x button click
    - Test chip removal via Backspace when input empty
    - Test de-duplication (case-insensitive, keep first occurrence)
    - Test paste handling with multiple values
  - [x] 1.2 Create MultiValueChipsInput.tsx component
    - New file: `frontend/src/components/common/MultiValueChipsInput.tsx`
    - Props: values (string[]), onChange (callback), placeholder (string), disabled (boolean), label (string)
    - Render chips inline before input caret within a styled container
    - Each chip displays value text and an "x" remove button
  - [x] 1.3 Implement value addition logic
    - Add on ENTER key press (if input non-empty after trim)
    - Add on delimiter typing: "|", ",", ";"
    - Add on paste: split by delimiters, process all tokens
    - Normalization: trim whitespace, ignore empty tokens
    - De-duplicate case-insensitively (keep first occurrence, preserve original casing)
  - [x] 1.4 Implement value removal logic
    - Click x button on chip to remove that specific value
    - Backspace key when input is empty removes last chip
  - [x] 1.5 Create MultiValueChipsInput.module.css styles
    - New file: `frontend/src/components/common/MultiValueChipsInput.module.css`
    - Container styled like text input (border, padding, focus state)
    - Chip styling: inline-block, pill/bubble shape, subtle background
    - Remove button styling: small, subtle, hover state
    - Follow color scheme from CreateProjectModal.module.css (primary #1976D2, borders #ccc/#e0e0e0)
  - [x] 1.6 Ensure MultiValueChipsInput tests pass
    - Run ONLY the tests written in 1.1
    - Verify all chip interactions work correctly

**Acceptance Criteria:**
- The 2-6 tests written in 1.1 pass
- Chips display inline before input caret
- Values can be added via Enter, delimiters, and paste
- Values can be removed via x button and Backspace
- De-duplication works case-insensitively
- Component is disabled when disabled prop is true

### API Layer

#### Task Group 2: Organisations API Extension
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete API layer extensions
  - [x] 2.1 Write 2-4 focused tests for createOrganisationFull API function
    - Test successful creation with full payload (name, description, all six docs fields)
    - Test 409 conflict error handling (throws OrganisationConflictError)
    - Test general error handling for non-409 errors
  - [x] 2.2 Define CreateOrganisationPayload interface
    - File: `frontend/src/api/organisationsApi.ts`
    - Fields: name (string), description (string | null)
    - Fields: docsAppliedToAllSources (string[]), docsAppliedToTechStack (string[])
    - Fields: docsAppliedToCodingStyles (string[]), docsAppliedToConventions (string[])
    - Fields: docsAppliedToErrorHandling (string[]), docsAppliedToValidation (string[])
  - [x] 2.3 Implement createOrganisationFull function
    - File: `frontend/src/api/organisationsApi.ts`
    - POST /api/v1/organisations with full payload body
    - Map camelCase to snake_case for API request (if backend expects snake_case)
    - Handle 409 response: throw OrganisationConflictError
    - Handle other errors: throw Error with server message
    - Return created OrganisationDto on success
  - [x] 2.4 Ensure API tests pass
    - Run ONLY the tests written in 2.1
    - Verify payload serialization and error handling

**Acceptance Criteria:**
- The 2-4 tests written in 2.1 pass
- CreateOrganisationPayload interface defined with all required fields
- createOrganisationFull sends complete payload to API
- 409 errors throw OrganisationConflictError
- Other errors throw generic Error with message

### Modal Component Layer

#### Task Group 3: CreateOrganisationModal Component
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete CreateOrganisationModal component
  - [x] 3.1 Write 2-6 focused tests for CreateOrganisationModal
    - Test modal renders when isOpen=true, does not render when isOpen=false
    - Test name validation (required, shows error when empty)
    - Test name uniqueness validation (shows error when duplicate)
    - Test Create button disabled when form invalid or submitting
    - Test successful submission calls onCreated callback
    - Test Escape key and overlay click close modal
  - [x] 3.2 Create directory and component file
    - New directory: `frontend/src/components/Organisation/`
    - New file: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
    - Props: isOpen (boolean), onClose (callback), onCreated (optional callback)
    - Follow CreateProjectModal.tsx structure pattern
  - [x] 3.3 Implement modal structure and basic form
    - Overlay with click-to-close (unless submitting)
    - Modal container with header (title: "Create Organisation", close button)
    - Content area with form fields
    - Footer with Cancel and Create buttons
    - Return null if isOpen=false
  - [x] 3.4 Implement Name and Description fields
    - Name: text input, required, auto-focus on modal open (useRef + setTimeout)
    - Description: textarea, height ~72px (3 lines), overflow-y: auto, resize: none
    - Follow inputGroup/inputLabel/input class patterns from CreateProjectModal
  - [x] 3.5 Implement Standards section with MultiValueChipsInput fields
    - Bordered box container with "Standards" header
    - Intro text: "Documents applied to standards generation (optional). Enter URLs, file paths, or document references."
    - Six MultiValueChipsInput fields in order:
      - All (maps to docsAppliedToAllSources)
      - Tech Stack (maps to docsAppliedToTechStack)
      - Coding Styles (maps to docsAppliedToCodingStyles)
      - Conventions (maps to docsAppliedToConventions)
      - Error Handling (maps to docsAppliedToErrorHandling)
      - Validation (maps to docsAppliedToValidation)
  - [x] 3.6 Implement form validation
    - Fetch organisations via listOrganisations() on modal open
    - Name required: invalid if empty/whitespace-only after trim
    - Name uniqueness: compare case-insensitively against fetched organisations
    - Show inline red error under Name field when invalid
    - Compute isFormValid for button disable state
    - Error messages: "Organisation name is required", "Organisation with this name already exists"
  - [x] 3.7 Implement form submission
    - Call createOrganisationFull with payload on Create click
    - Disable form while submitting (isSubmitting state)
    - On success: call onCreated callback if provided, then onClose
    - On 409 error: show inline name error, keep modal open
    - On other errors: show error message in modal (errorMessage state)
  - [x] 3.8 Implement keyboard and close handlers
    - Escape key closes modal (document keydown listener with cleanup)
    - Overlay click closes modal (unless submitting)
    - Close button closes modal
    - Cancel button closes modal
  - [x] 3.9 Create CreateOrganisationModal.module.css styles
    - New file: `frontend/src/components/Organisation/CreateOrganisationModal.module.css`
    - Copy base styles from CreateProjectModal.module.css
    - Add textarea-specific styles (fixed height, no resize)
    - Add standardsSection styles (bordered box, header, intro text)
    - Add standardsField styles for chip input rows with labels
    - Add inlineError styles for validation messages under Name field
  - [x] 3.10 Ensure CreateOrganisationModal tests pass
    - Run ONLY the tests written in 3.1
    - Verify modal rendering, validation, and submission

**Acceptance Criteria:**
- The 2-6 tests written in 3.1 pass
- Modal opens/closes correctly based on isOpen prop
- Name validation works (required + uniqueness)
- All six standards fields render with MultiValueChipsInput
- Create button disabled when invalid or submitting
- Successful submission calls onCreated and closes modal
- Errors display appropriately (inline for name, general for other)

### App Integration Layer

#### Task Group 4: Global Keyboard Shortcut and Modal Mount
**Dependencies:** Task Group 3

- [x] 4.0 Complete App integration
  - [x] 4.1 Write 2-4 focused tests for global keyboard shortcut
    - Test Ctrl+Shift+M opens modal when not already open
    - Test shortcut does nothing when modal already open
    - Test shortcut ignored when focus is on input/textarea/contenteditable
    - Test both Ctrl (Windows) and Cmd/metaKey (Mac) work
  - [x] 4.2 Add modal state to AppContent component
    - File: `frontend/src/App.tsx`
    - Add useState for isCreateOrgModalOpen (boolean, default false)
    - Import CreateOrganisationModal component
  - [x] 4.3 Implement global keyboard shortcut listener
    - Add useEffect with document.addEventListener('keydown', handleKeyDown)
    - Check for (e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'M'
    - Skip if document.activeElement is input, textarea, or contenteditable
    - Prevent default browser behavior when shortcut triggered
    - Set isCreateOrgModalOpen to true (no-op if already true)
    - Return cleanup function to remove listener
  - [x] 4.4 Mount CreateOrganisationModal in AppContent
    - Render CreateOrganisationModal with isOpen={isCreateOrgModalOpen}
    - Pass onClose={() => setIsCreateOrgModalOpen(false)}
    - onCreated callback optional (not strictly needed per spec)
  - [x] 4.5 Ensure App integration tests pass
    - Run ONLY the tests written in 4.1
    - Verify keyboard shortcut opens modal correctly

**Acceptance Criteria:**
- The 2-4 tests written in 4.1 pass
- Ctrl+Shift+M opens Create Organisation modal from anywhere in app
- Cmd+Shift+M works on Mac
- Shortcut ignored when typing in input fields
- Modal can be closed and reopened via shortcut

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 2-6 tests from MultiValueChipsInput (Task 1.1) - 13 tests implemented
    - Review 2-4 tests from organisationsApi (Task 2.1) - 4 tests implemented
    - Review 2-6 tests from CreateOrganisationModal (Task 3.1) - 10 tests implemented
    - Review 2-4 tests from App integration (Task 4.1) - 7 tests implemented
    - Total existing tests: 34 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows lacking coverage - All covered
    - Focus on end-to-end: shortcut -> modal -> form -> submit -> close - Covered
    - Check integration between MultiValueChipsInput and modal form state - Covered
    - Verify error state flows are tested - Covered (409, general errors)
  - [x] 5.3 Write up to 8 additional strategic tests if needed
    - No additional tests needed - existing 34 tests provide comprehensive coverage
    - All critical workflows are tested
    - Edge cases covered (paste, delimiters, disabled state, de-duplication)
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature - All 34 tests pass
    - Expected total: approximately 16-28 tests maximum - Actual: 34 tests
    - Verify all critical workflows pass - All pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-28 tests) - 34 tests pass
- Critical user workflows covered (shortcut -> create -> available in project modal)
- No more than 8 additional tests added - No additional tests needed
- Testing focused exclusively on Create Organisation Modal feature

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: MultiValueChipsInput Component** - Standalone reusable component with no dependencies
2. **Task Group 2: Organisations API Extension** - Can run in parallel with Task Group 1
3. **Task Group 3: CreateOrganisationModal Component** - Depends on Task Groups 1 and 2
4. **Task Group 4: Global Keyboard Shortcut and Modal Mount** - Depends on Task Group 3
5. **Task Group 5: Test Review and Gap Analysis** - Final verification after all implementation

## File Reference

### New Files to Create
- `frontend/src/components/common/MultiValueChipsInput.tsx`
- `frontend/src/components/common/MultiValueChipsInput.module.css`
- `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
- `frontend/src/components/Organisation/CreateOrganisationModal.module.css`

### Existing Files to Modify
- `frontend/src/api/organisationsApi.ts` - Add CreateOrganisationPayload interface and createOrganisationFull function
- `frontend/src/App.tsx` - Add modal state, keyboard listener, and mount CreateOrganisationModal

### Reference Files (patterns to follow)
- `frontend/src/components/Project/CreateProjectModal.tsx` - Modal structure, validation, error handling patterns
- `frontend/src/components/Project/CreateProjectModal.module.css` - CSS class patterns and color scheme
- `frontend/src/components/common/Modal.tsx` - Basic modal structure reference

## Implementation Summary

All 5 Task Groups have been completed:

### Task Group 1: MultiValueChipsInput Component
- Created `frontend/src/components/common/MultiValueChipsInput.tsx`
- Created `frontend/src/components/common/MultiValueChipsInput.module.css`
- Created `frontend/src/__tests__/MultiValueChipsInput.test.tsx` (13 tests)

### Task Group 2: Organisations API Extension
- Updated `frontend/src/api/organisationsApi.ts` with CreateOrganisationPayload and createOrganisationFull
- Created `frontend/src/__tests__/organisationsApi.createFull.test.ts` (4 tests)

### Task Group 3: CreateOrganisationModal Component
- Created `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
- Created `frontend/src/components/Organisation/CreateOrganisationModal.module.css`
- Created `frontend/src/__tests__/CreateOrganisationModal.test.tsx` (10 tests)

### Task Group 4: Global Keyboard Shortcut and Modal Mount
- Updated `frontend/src/App.tsx` with modal state, keyboard listener, and modal mount
- Created `frontend/src/__tests__/createOrgModalKeyboardShortcut.test.tsx` (7 tests)

### Task Group 5: Test Review and Gap Analysis
- Reviewed all 34 tests from Task Groups 1-4
- All critical workflows covered
- No additional tests needed
- All 34 tests pass
