# Specification: Create Organisation Modal

## Goal
Add a global "Create Organisation" modal accessible via Ctrl+Shift+M keyboard shortcut that collects organisation fields (name, description, standards document lists) with client-side validation, persists to the Architecture Model Service, and makes the new organisation immediately available in the Create Project UI.

## User Stories
- As a user, I want to create a new organisation from anywhere in the application using a keyboard shortcut so that I can quickly add organisations without navigating away from my current context
- As a user, I want to define standards document lists for an organisation so that projects under this organisation can inherit coding standards configuration

## Specific Requirements

**Global Keyboard Shortcut (Ctrl+Shift+M)**
- Register keydown listener at App root level (AppContent component in App.tsx)
- Check for Ctrl+Shift+M combination (e.ctrlKey && e.shiftKey && e.key === 'M')
- Skip shortcut if document.activeElement is input, textarea, or contenteditable element
- Prevent default browser behavior when shortcut is triggered
- If modal already open, shortcut does nothing (no-op)
- Support both Windows (Ctrl) and Mac (Cmd via metaKey) for cross-platform compatibility

**CreateOrganisationModal Component**
- New file: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
- New file: `frontend/src/components/Organisation/CreateOrganisationModal.module.css`
- Props: isOpen (boolean), onClose (callback), onCreated (optional callback after success)
- Follow CreateProjectModal.tsx structure: overlay, modal container, header, content, footer
- Escape key closes modal (same as Cancel button via document keydown listener)
- Overlay click closes modal (unless submitting)

**Form Fields Layout**
- Name: single-line text input, required, first field with auto-focus on modal open
- Description: textarea fixed at 3 visible lines (height ~72px), overflow-y: auto, resize: none
- Standards section: bordered box with header "Standards" containing intro text and six MultiValueChipsInput fields
- Intro text: "Documents applied to standards generation (optional). Enter URLs, file paths, or document references."
- Six chip inputs in order: All, Tech Stack, Coding Styles, Conventions, Error Handling, Validation

**MultiValueChipsInput Reusable Component**
- New file: `frontend/src/components/common/MultiValueChipsInput.tsx`
- New file: `frontend/src/components/common/MultiValueChipsInput.module.css`
- Props: values (string[]), onChange (callback with new values), placeholder (string), disabled (boolean), label (string)
- Renders like a text input with chip/bubble values displayed inline before the input caret
- Add value triggers: PASTE (from clipboard), TYPE (on delimiters: "|", ",", ";"), ENTER key
- Normalization: trim whitespace, de-duplicate case-insensitively (keep first occurrence), preserve original casing
- Ignore empty or whitespace-only tokens
- Backspace when input is empty removes last chip
- Each chip displays an "x" button to remove it

**Form Validation**
- Name required: invalid if empty or whitespace-only after trim
- Name uniqueness: fetch organisations via listOrganisations() on modal open, compare case-insensitively
- Show inline red validation error directly under Name field when invalid
- Create button disabled when: form invalid OR save in progress
- Validation message examples: "Organisation name is required", "Organisation with this name already exists"

**API Integration**
- Extend existing createOrganisation function in organisationsApi.ts to accept full payload
- New interface CreateOrganisationPayload: name, description, docsAppliedToAllSources, docsAppliedToTechStack, docsAppliedToCodingStyles, docsAppliedToConventions, docsAppliedToErrorHandling, docsAppliedToValidation
- Add createOrganisationFull function (or rename/extend existing) that sends all fields
- On 409 duplicate error: show inline name error, keep modal open
- On other errors: show error message in modal (similar to CreateProjectModal error pattern)
- Set techStandardsGenerated: false in payload (or omit if backend defaults)

**State Refresh After Success**
- No new OrganisationsContext (keep simple per requirements)
- After successful create, call listOrganisations() to refresh data where needed
- CreateProjectModal already fetches organisations on open, so new org will appear on next open
- Optionally call onCreated callback prop if provided for additional refresh logic

**Data Field Mapping**
- All -> docsAppliedToAllSources: string[]
- Tech Stack -> docsAppliedToTechStack: string[]
- Coding Styles -> docsAppliedToCodingStyles: string[]
- Conventions -> docsAppliedToConventions: string[]
- Error Handling -> docsAppliedToErrorHandling: string[]
- Validation -> docsAppliedToValidation: string[]

## Existing Code to Leverage

**CreateProjectModal.tsx (frontend/src/components/Project/CreateProjectModal.tsx)**
- Modal structure pattern: overlay, modal container, header with title and close button, content area, footer with Cancel/Create buttons
- Escape key handling via document keydown listener
- Form validation pattern with isFormValid computed value
- Error display pattern with errorMessage state and conditional rendering
- Focus management with useRef and setTimeout for initial input focus

**CreateProjectModal.module.css (frontend/src/components/Project/CreateProjectModal.module.css)**
- CSS class patterns: .overlay, .modal, .header, .title, .closeButton, .content, .inputGroup, .inputLabel, .input, .inputHint, .errorMessage, .footer, .cancelButton, .createButton
- Color scheme: primary #1976D2, error #c62828, borders #e0e0e0/#ccc
- Button styling with :hover:not(:disabled) and :disabled states

**organisationsApi.ts (frontend/src/api/organisationsApi.ts)**
- listOrganisations() function for fetching existing organisations
- createOrganisation(name) function to extend with full payload support
- OrganisationConflictError class for 409 handling
- API_BASE pattern using import.meta.env.VITE_API_BASE_URL

**App.tsx (frontend/src/App.tsx)**
- AppContent component as ideal location for global modal mount and keyboard listener
- Provider hierarchy: AppConfigProvider > ProjectProvider > ArchitectureProvider
- Pattern for adding global state (useState for modal open state, useEffect for keyboard listener)

**DiagramsView.tsx keyboard handling pattern**
- useEffect with document.addEventListener('keydown', handleKeyDown) and cleanup return
- e.key comparison for specific key detection
- e.preventDefault() to stop default browser behavior

## Out of Scope
- Calling external POST /api/v1/standards/global/generate endpoint
- Any async orchestration or job handling for standards generation
- Organisation edit/update UI (this spec is create-only)
- Changing Create Project flow beyond making new org available after creation
- New OrganisationsContext or global state management (use simple re-fetch approach)
- Backend changes (assumed completed in prior iteration)
- Persisting modal open state across page refresh
- Organisation deletion functionality
- Drag-and-drop reordering of chips in MultiValueChipsInput
- Rich text or markdown support in Description field
