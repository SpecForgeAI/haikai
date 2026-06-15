# Task Breakdown: Project-level Standards Generation

## Overview
Total Tasks: 5 Task Groups (approximately 25 sub-tasks)

This feature adds a "Generate Standards" menu item to the Project menu that opens a modal to collect source URLs/paths, then calls the external standards service to generate project-level standards using the active project's organisation and project names.

## Task List

### Gateway Layer

#### Task Group 1: Gateway Route for Project Standards Generation
**Dependencies:** None

- [x] 1.0 Complete gateway route for project standards generation
  - [x] 1.1 Write 3-5 focused tests for project standards generation endpoint
    - Test successful proxy to external service (200/201 response)
    - Test request body mapping (company, project, sources fields)
    - Test 502 response on upstream auth failure (401/403)
    - Test 503 response on network errors
    - Test 500 response when token not configured
  - [x] 1.2 Create projectStandardsGenerate.ts route file
    - New file: `gateway/src/routes/projectStandardsGenerate.ts`
    - Create `projectStandardsGenerateRouter` using Express Router
    - Follow existing `standardsGenerate.ts` route patterns
  - [x] 1.3 Implement POST /generate endpoint
    - Validate request body: company (required string), project (required string), sources (optional string[])
    - Reuse `standardsServiceFetch` from `standardsServiceClient.ts` (same service, same auth)
    - Forward to external service: `POST /api/v1/standards/product/generate`
    - Return 200/201 on success
    - Return 502 for auth failures (401/403 from upstream)
    - Return 503 for network errors
    - Return 500 for missing token configuration
  - [x] 1.4 Register route in gateway server
    - File: `gateway/src/routes/index.ts` - Export `projectStandardsGenerateRouter`
    - File: `gateway/src/server.ts` - Mount at `/api/v1/standards/product`
  - [x] 1.5 Ensure gateway route tests pass
    - Run ONLY the tests written in 1.1

**Acceptance Criteria:**
- Gateway proxies requests to external standards service with Bearer auth
- Request body correctly maps company, project, and sources fields
- Appropriate error responses (502, 503, 500) for different failure modes
- No internal auth details exposed to frontend

---

### Frontend API Layer

#### Task Group 2: Frontend API Function for Project Standards Generation
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend API function
  - [x] 2.1 Write 2-3 focused tests for generateProjectStandards API function
    - Test successful call resolves without error
    - Test non-200/201 response throws error with message
    - Test request body format matches expected structure (company, project, sources)
  - [x] 2.2 Define ProjectStandardsPayload interface
    - File: `frontend/src/api/organisationsApi.ts`
    - Fields: `company: string`, `project: string`, `sources: string[]`
  - [x] 2.3 Implement generateProjectStandards function
    - File: `frontend/src/api/organisationsApi.ts`
    - Signature: `generateProjectStandards(payload: ProjectStandardsPayload): Promise<void>`
    - POST to `/api/v1/standards/product/generate`
    - Follow existing `generateGlobalStandards` pattern for error handling
    - Throw error on non-200/201 response
  - [x] 2.4 Ensure frontend API tests pass
    - Run ONLY the tests written in 2.1

**Acceptance Criteria:**
- API function correctly calls gateway endpoint
- Request body format matches expected structure
- Throws on error responses for caller to handle

---

### Frontend Component Layer

#### Task Group 3: GenerateProjectStandardsModal Component
**Dependencies:** Task Group 2

- [x] 3.0 Complete GenerateProjectStandardsModal component
  - [x] 3.1 Write 3-6 focused tests for GenerateProjectStandardsModal
    - Test modal renders when isOpen=true, does not render when isOpen=false
    - Test modal header displays "Generate Project Standards"
    - Test Generate Standards button disabled when sources is empty
    - Test loading state shows "Generating..." and disables all inputs
    - Test successful submission shows success toast and closes modal
    - Test failed submission shows error toast but keeps modal open for retry
  - [x] 3.2 Create GenerateProjectStandardsModal.tsx component
    - New file: `frontend/src/components/Project/GenerateProjectStandardsModal.tsx`
    - Props: `isOpen: boolean`, `onClose: () => void`, `activeProject: ProjectDto | null`
    - Follow CreateOrganisationModal structure pattern (overlay, container, header, content, footer)
  - [x] 3.3 Implement modal structure and content
    - Modal header: "Generate Project Standards"
    - Body text: "Choose the input documents (local files, external URLs) that will generate the project standards."
    - Note text (smaller, grey #666): "Note - project standards override your company standards if the same topic, otherwise company standards remain."
    - Single MultiValueChipsInput field with label "Sources" and placeholder "Enter URLs or file paths..."
  - [x] 3.4 Implement form state management
    - Use `useState` for sources (string[])
    - Use `useState` for isGenerating (boolean)
    - Use `useState` for error (string | null)
    - Use `useRef<MultiValueChipsInputHandle>` for flush() pattern
    - Manage toast state using pattern from CreateOrganisationModal
  - [x] 3.5 Implement submission logic
    - On "Generate Standards" click: flush MultiValueChipsInput ref, set isGenerating=true, clear previous error
    - Look up organisation name via `getOrganisationById(activeProject.organisationId)`
    - If lookup fails: set error "Failed to resolve organisation", set isGenerating=false, return
    - Build payload: `{ company: organisation.name, project: activeProject.name, sources }`
    - Call `generateProjectStandards(payload)`
    - On success: show success toast "Project standards generated successfully", close modal
    - On failure: show error toast "Project standards generation failed. You can retry or cancel.", keep modal open
  - [x] 3.6 Implement loading state UI
    - Button text changes to "Generating..." during generation
    - All inputs disabled during generation
    - Cancel button disabled during generation
    - Overlay click disabled during generation
    - Escape key disabled during generation
  - [x] 3.7 Create GenerateProjectStandardsModal.module.css styles
    - New file: `frontend/src/components/Project/GenerateProjectStandardsModal.module.css`
    - Copy base styles from CreateOrganisationModal.module.css (overlay, modal, header, footer, buttons)
    - Add `.bodyText` for primary instruction text
    - Add `.noteText` for smaller font (0.9em), grey color (#666), margin-top spacing
    - Add `.sourcesField` container for label + MultiValueChipsInput
  - [x] 3.8 Ensure GenerateProjectStandardsModal tests pass
    - Run ONLY the tests written in 3.1

**Acceptance Criteria:**
- Modal opens/closes correctly based on isOpen prop
- Body text and note text display correctly
- Sources field uses MultiValueChipsInput component
- Loading state properly disables all interactions
- Success/error toasts display with correct messages and timing (success: 5s, error: 30s)
- Organisation name lookup failure handled gracefully

---

### Integration Layer

#### Task Group 4: FileMenu and TopBar Integration
**Dependencies:** Task Group 3

- [x] 4.0 Complete FileMenu and TopBar integration
  - [x] 4.1 Write 2-4 focused tests for menu item and modal integration
    - Test "Generate Standards" menu item renders between "Open" and "Save" when includeDatabase=true
    - Test menu item is disabled when no active project
    - Test menu item click opens GenerateProjectStandardsModal
    - Test menu item does not render when includeDatabase=false
  - [x] 4.2 Add props to FileMenu component
    - File: `frontend/src/components/TopBar/FileMenu.tsx`
    - Add prop: `onGenerateStandards: () => void`
    - Add prop: `generateStandardsDisabled: boolean`
  - [x] 4.3 Add "Generate Standards" menu item to FileMenu
    - Insert between "Open" and "Save" in the Project menu
    - Apply `styles.menuItem` and conditional `styles.menuItemDisabled` class
    - Only render when `includeDatabase` is true (same gating as other DB-dependent items)
    - Click handler: call `onGenerateStandards()` then `onClose()`
  - [x] 4.4 Add modal state and handler to TopBar
    - File: `frontend/src/components/TopBar/TopBar.tsx`
    - Add state: `const [isGenerateProjectStandardsModalOpen, setGenerateProjectStandardsModalOpen] = useState(false)`
    - Add handler: `handleGenerateProjectStandards = () => setGenerateProjectStandardsModalOpen(true)`
    - Compute disabled state: `generateStandardsDisabled = !activeProject`
  - [x] 4.5 Pass props from TopBar to FileMenu
    - Pass `onGenerateStandards={handleGenerateProjectStandards}`
    - Pass `generateStandardsDisabled={generateStandardsDisabled}`
  - [x] 4.6 Mount GenerateProjectStandardsModal in TopBar
    - Import GenerateProjectStandardsModal component
    - Render with `isOpen={isGenerateProjectStandardsModalOpen}`
    - Pass `onClose={() => setGenerateProjectStandardsModalOpen(false)}`
    - Pass `activeProject={activeProject}`
  - [x] 4.7 Ensure integration tests pass
    - Run ONLY the tests written in 4.1

**Acceptance Criteria:**
- "Generate Standards" menu item appears in correct position
- Menu item disabled when no active project loaded
- Menu item click opens modal with active project context
- Modal closes via Cancel, overlay click, or Escape key
- Modal only accessible when includeDatabase=true

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review 3-5 tests from gateway route (Task 1.1)
    - Review 2-3 tests from frontend API (Task 2.1)
    - Review 3-6 tests from GenerateProjectStandardsModal (Task 3.1)
    - Review 2-4 tests from FileMenu/TopBar integration (Task 4.1)
    - Total existing tests: approximately 10-18 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus on: menu click -> modal -> organisation lookup -> API call -> toast
    - Check organisation lookup failure path is tested
    - Verify retry workflow is tested (modal stays open on error)
  - [x] 5.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Focus on:
      - End-to-end flow: menu click -> modal -> submit -> success toast
      - Organisation lookup failure handling
      - Retry workflow after API failure
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 15-23 tests maximum
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass
- Critical end-to-end workflows are covered
- No more than 5 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Phase 1 (Gateway):
  - Task Group 1: Gateway Route for Project Standards Generation

Phase 2 (Frontend API):
  - Task Group 2: Frontend API Function (depends on Task Group 1)

Phase 3 (Modal Component):
  - Task Group 3: GenerateProjectStandardsModal Component (depends on Task Group 2)

Phase 4 (Integration):
  - Task Group 4: FileMenu and TopBar Integration (depends on Task Group 3)

Phase 5 (Testing):
  - Task Group 5: Test Review and Gap Analysis (depends on all above)
```

## File Summary

### New Files to Create
- `gateway/src/routes/projectStandardsGenerate.ts` - Gateway route for project standards generation
- `frontend/src/components/Project/GenerateProjectStandardsModal.tsx` - Modal component
- `frontend/src/components/Project/GenerateProjectStandardsModal.module.css` - Modal styles

### Existing Files to Modify
- `gateway/src/routes/index.ts` - Export `projectStandardsGenerateRouter`
- `gateway/src/server.ts` - Mount route at `/api/v1/standards/product`
- `frontend/src/api/organisationsApi.ts` - Add `ProjectStandardsPayload` interface and `generateProjectStandards` function
- `frontend/src/components/TopBar/FileMenu.tsx` - Add "Generate Standards" menu item
- `frontend/src/components/TopBar/TopBar.tsx` - Add modal state, handler, and mount modal

### Reference Files (patterns to follow)
- `gateway/src/routes/standardsGenerate.ts` - Route structure and error handling patterns
- `gateway/src/services/standardsServiceClient.ts` - Reuse `standardsServiceFetch` for authenticated requests
- `frontend/src/components/Organisation/CreateOrganisationModal.tsx` - Modal structure, MultiValueChipsInput integration, toast patterns
- `frontend/src/components/Organisation/CreateOrganisationModal.module.css` - CSS class patterns and styling
- `frontend/src/api/organisationsApi.ts` - `generateGlobalStandards` function pattern, `getOrganisationById` for lookup
