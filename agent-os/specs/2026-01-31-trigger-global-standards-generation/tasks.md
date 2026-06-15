# Task Breakdown: Trigger Global Standards Generation

## Overview
Total Tasks: 6 Task Groups (approximately 30 sub-tasks)

This feature extends the Create Organisation flow to trigger external global standards generation after successful database save, update the organisation's `techStandardsGenerated` flag, and provide user feedback via toast notifications.

## Task List

### Backend Layer

#### Task Group 1: Backend PATCH Endpoint for Flag Update
**Dependencies:** None

- [x] 1.0 Complete backend PATCH endpoint for organisation updates
  - [x] 1.1 Write 2-4 focused tests for PATCH endpoint functionality
    - Test successful partial update with `techStandardsGenerated=true`
    - Test 404 response when organisation ID not found
    - Test that only provided fields are updated (other fields remain unchanged)
    - Test validation of request body
  - [x] 1.2 Create `UpdateOrganisationRequest` record in OrganisationController
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java`
    - Field: `Boolean techStandardsGenerated` (optional)
    - Support JSON alias for snake_case: `tech_standards_generated`
  - [x] 1.3 Add `updateOrganisation` method to OrganisationService
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java`
    - Signature: `OrganisationDto updateOrganisation(String id, Boolean techStandardsGenerated)`
    - Only update provided fields (partial update pattern)
    - Throw `ResourceNotFoundException` if ID not found
  - [x] 1.4 Add PATCH endpoint to OrganisationController
    - Endpoint: `PATCH /api/v1/organisations/{id}`
    - Accept `UpdateOrganisationRequest` body
    - Return updated `OrganisationDto` with HTTP 200
    - Follow existing controller patterns
  - [x] 1.5 Ensure backend PATCH endpoint tests pass
    - Run ONLY the tests written in 1.1
    - Verify endpoint responds correctly

**Acceptance Criteria:**
- PATCH endpoint accepts partial updates with `techStandardsGenerated` field
- Returns 200 with updated OrganisationDto on success
- Returns 404 when organisation not found
- Existing organisation fields are preserved when not included in request

---

### Gateway Layer

#### Task Group 2: Gateway Configuration for Standards Service
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete gateway configuration for standards service
  - [x] 2.1 Write 2-3 focused tests for configuration loading
    - Test `STANDARDS_SERVICE_BASE_URL` loads from environment
    - Test `STANDARDS_SERVICE_BEARER_TOKEN` loads from environment
    - Test defaults when environment variables not set
  - [x] 2.2 Add standards service configuration to Config interface
    - File: `gateway/src/config.ts`
    - Add `standardsServiceBaseUrl: string` to Config interface
    - Add `standardsServiceBearerToken: string` to Config interface
  - [x] 2.3 Add environment variable parsing in loadConfig()
    - `STANDARDS_SERVICE_BASE_URL` (default: 'http://localhost:8000')
    - `STANDARDS_SERVICE_BEARER_TOKEN` (default: '')
    - Follow existing `orchestrationServiceBaseUrl` and `shapeSpecBearerToken` patterns
  - [x] 2.4 Update gateway .env.example with new variables
    - File: `gateway/.env.example`
    - Add `STANDARDS_SERVICE_BASE_URL=`
    - Add `STANDARDS_SERVICE_BEARER_TOKEN=`
  - [x] 2.5 Ensure configuration tests pass
    - Run ONLY the tests written in 2.1

**Acceptance Criteria:**
- New environment variables are documented in .env.example
- Config interface includes new standards service properties
- Default values work when environment variables not set

---

#### Task Group 3: Gateway Standards Service Client and Route
**Dependencies:** Task Group 2

- [x] 3.0 Complete gateway standards generation route
  - [x] 3.1 Write 3-5 focused tests for standards generation endpoint
    - Test successful proxy to external service (200/201 response)
    - Test request body mapping (organisation fields to external API format)
    - Test 502 response on upstream auth failure (401/403)
    - Test 503 response on network errors
    - Test token not configured returns 500
  - [x] 3.2 Create standardsServiceClient.ts upstream client
    - File: `gateway/src/services/standardsServiceClient.ts`
    - Follow `shapeSpecUpstreamClient.ts` pattern
    - Create `standardsServiceFetch(path, options)` function
    - Auto-inject Bearer token from config
    - Log requests/errors appropriately
  - [x] 3.3 Create standardsGenerate.ts route file
    - File: `gateway/src/routes/standardsGenerate.ts`
    - Follow `shapeSpec.ts` route patterns
    - Create `standardsGenerateRouter` using Express Router
  - [x] 3.4 Implement POST /generate endpoint
    - Map request body to external API format:
      - `company` <- organisation.name
      - `sources` <- organisation.docsAppliedToAllSources
      - `technical_documents.tech_stack` <- organisation.docsAppliedToTechStack
      - `technical_documents.coding_style` <- organisation.docsAppliedToCodingStyles
      - `technical_documents.conventions` <- organisation.docsAppliedToConventions
      - `technical_documents.error_handling` <- organisation.docsAppliedToErrorHandling
      - `technical_documents.validation` <- organisation.docsAppliedToValidation
    - Forward to external service: `POST /api/v1/standards/global/generate`
    - Return 200/201 on success
    - Return 502 for auth failures (401/403 from upstream)
    - Return 503 for network errors
    - Return 500 for missing token configuration
  - [x] 3.5 Implement backend PATCH orchestration in route
    - On 200/201 from external service: call backend PATCH with `techStandardsGenerated=true`
    - On failure: do not call backend PATCH (flag remains false)
    - Return final status to frontend
  - [x] 3.6 Register route in gateway server
    - File: `gateway/src/server.ts`
    - Mount at `/api/v1/standards/global`
    - Update `gateway/src/routes/index.ts` to export `standardsGenerateRouter`
  - [x] 3.7 Ensure gateway route tests pass
    - Run ONLY the tests written in 3.1

**Acceptance Criteria:**
- Gateway proxies requests to external standards service with Bearer auth
- Request body correctly maps organisation fields to external API format
- Gateway orchestrates backend PATCH call on successful standards generation
- Appropriate error responses (502, 503, 500) for different failure modes
- No internal auth details exposed to frontend

---

### Frontend Layer

#### Task Group 4: Frontend API Function for Standards Generation
**Dependencies:** Task Group 3

- [x] 4.0 Complete frontend API function
  - [x] 4.1 Write 2-3 focused tests for API function
    - Test successful call resolves without error
    - Test non-200/201 response throws error
    - Test request body format matches expected structure
  - [x] 4.2 Create StandardsGenerationPayload interface
    - File: `frontend/src/api/organisationsApi.ts`
    - Define interface matching the request body structure:
      ```typescript
      interface StandardsGenerationPayload {
        organisationId: string;
        name: string;
        docsAppliedToAllSources: string[];
        docsAppliedToTechStack: string[];
        docsAppliedToCodingStyles: string[];
        docsAppliedToConventions: string[];
        docsAppliedToErrorHandling: string[];
        docsAppliedToValidation: string[];
      }
      ```
  - [x] 4.3 Implement generateGlobalStandards function
    - Signature: `generateGlobalStandards(payload: StandardsGenerationPayload): Promise<void>`
    - POST to `/api/v1/standards/global/generate`
    - Map payload to external API request format
    - Throw error on non-200/201 response
    - Follow existing API function patterns from organisationsApi.ts
  - [x] 4.4 Ensure frontend API tests pass
    - Run ONLY the tests written in 4.1

**Acceptance Criteria:**
- API function correctly calls gateway endpoint
- Request body format matches expected external API structure
- Throws on error responses for caller to handle

---

#### Task Group 5: Toast Notification Component
**Dependencies:** None (can run in parallel with Task Groups 1-4)

- [x] 5.0 Complete toast notification system
  - [x] 5.1 Write 2-3 focused tests for toast component
    - Test success toast renders with correct styling (#4caf50)
    - Test error toast renders with correct styling (#c62828)
    - Test auto-dismiss behavior (success: ~5s, error: ~30s or manual)
  - [x] 5.2 Create or extend toast notification component
    - Option A: Extend existing TopBar notification pattern
    - Option B: Create new reusable Toast component
    - File: `frontend/src/components/common/Toast.tsx` (if new component)
    - Or modify: `frontend/src/components/TopBar/TopBar.tsx` (if extending)
  - [x] 5.3 Implement toast styling
    - Success toast: green background (#4caf50), white text
    - Error toast: red background (#c62828), white text
    - Position: fixed bottom center
    - z-index: 1100 (consistent with TopBar notification)
    - Animation: slideUp (reuse existing keyframes)
  - [x] 5.4 Implement auto-dismiss behavior
    - Success toast: auto-dismiss after ~5 seconds
    - Error toast: persist until manually dismissed (or ~30s timeout)
    - Add optional close button for error toasts
  - [x] 5.5 Export toast state management hook or context if needed
    - Consider creating `useToast` hook for reusable toast triggering
    - Or use prop-based approach in CreateOrganisationModal
  - [x] 5.6 Ensure toast component tests pass
    - Run ONLY the tests written in 5.1

**Acceptance Criteria:**
- Toast notifications render correctly with specified colors
- Success toasts auto-dismiss after ~5 seconds
- Error toasts persist longer and can be dismissed
- Position is fixed bottom center with correct z-index

---

#### Task Group 6: CreateOrganisationModal Integration
**Dependencies:** Task Groups 3, 4, 5

- [x] 6.0 Complete modal integration with standards generation flow
  - [x] 6.1 Write 3-5 focused tests for modal integration
    - Test `isGeneratingStandards` state shows "Generating standards..." text
    - Test all inputs/buttons disabled during standards generation phase
    - Test success flow: create -> generate -> success toast -> close modal
    - Test failure flow: create -> generate fails -> error toast -> close modal
    - Test organisation is persisted even if standards generation fails
  - [x] 6.2 Add new state variables to CreateOrganisationModal
    - File: `frontend/src/components/Organisation/CreateOrganisationModal.tsx`
    - Add: `const [isGeneratingStandards, setIsGeneratingStandards] = useState(false)`
    - Add: `const [standardsError, setStandardsError] = useState<string | null>(null)`
  - [x] 6.3 Update handleCreate function for sequential flow
    - After successful `createOrganisationFull`:
      1. Store created organisation (need ID for standards call)
      2. Set `isGeneratingStandards=true`
      3. Call `generateGlobalStandards(payload)`
      4. On success: show success toast, close modal
      5. On failure: set `standardsError`, show error toast, close modal
    - Organisation is always persisted regardless of standards generation outcome
  - [x] 6.4 Update modal UI for generating standards state
    - When `isGeneratingStandards=true`:
      - Display "Generating standards..." text (can reuse loading spinner pattern)
      - Disable all form inputs
      - Disable Cancel button
      - Disable overlay click (prevent accidental close)
      - Change Create button text to "Generating standards..."
  - [x] 6.5 Update disabled state logic
    - Inputs disabled when: `isSubmitting || isGeneratingStandards`
    - Cancel button disabled when: `isSubmitting || isGeneratingStandards`
    - Create button disabled when: `!isFormValid || isSubmitting || isGeneratingStandards`
    - Overlay click disabled when: `isSubmitting || isGeneratingStandards`
    - Escape key disabled when: `isSubmitting || isGeneratingStandards`
  - [x] 6.6 Integrate toast notifications
    - Import toast component/hook
    - On standards success: show success toast with "Organisation created and standards generated successfully"
    - On standards failure: show error toast with "Organisation created but standards generation failed"
    - Then close modal and call `onCreated` callback
  - [x] 6.7 Update onCreated callback timing
    - Ensure `onCreated` is called after both phases complete
    - Organisation list should refresh with the new organisation
  - [x] 6.8 Ensure modal integration tests pass
    - Run ONLY the tests written in 6.1

**Acceptance Criteria:**
- Modal shows "Generating standards..." state after create succeeds
- All inputs and buttons are properly disabled during standards generation
- Success toast appears when standards generation succeeds
- Error toast appears when standards generation fails (but org still created)
- Modal closes after standards generation completes (success or failure)
- Organisation appears in list regardless of standards generation outcome

---

### Testing

#### Task Group 7: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps only
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 2-4 tests from backend PATCH endpoint (Task 1.1)
    - Review 2-3 tests from gateway config (Task 2.1)
    - Review 3-5 tests from gateway route (Task 3.1)
    - Review 2-3 tests from frontend API (Task 4.1)
    - Review 2-3 tests from toast component (Task 5.1)
    - Review 3-5 tests from modal integration (Task 6.1)
    - Total existing tests: approximately 14-23 tests
  - [x] 7.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize integration points between gateway and backend
  - [x] 7.3 Write up to 5 additional strategic tests maximum
    - Add maximum of 5 new tests to fill identified critical gaps
    - Focus on:
      - End-to-end flow: modal submit -> gateway -> external service -> backend PATCH
      - Error propagation: external service failure -> appropriate toast
      - State consistency: organisation persisted even on standards failure
  - [x] 7.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 19-28 tests maximum
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
Phase 1 (Parallel - Foundation):
  - Task Group 1: Backend PATCH Endpoint
  - Task Group 2: Gateway Configuration
  - Task Group 5: Toast Notification Component

Phase 2 (Sequential - Gateway):
  - Task Group 3: Gateway Standards Route (depends on Task Group 2)

Phase 3 (Sequential - Frontend API):
  - Task Group 4: Frontend API Function (depends on Task Group 3)

Phase 4 (Sequential - Integration):
  - Task Group 6: Modal Integration (depends on Task Groups 3, 4, 5)

Phase 5 (Final):
  - Task Group 7: Test Review and Gap Analysis (depends on all above)
```

## File Summary

**Backend Files:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/OrganisationController.java` - Add PATCH endpoint
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/OrganisationService.java` - Add updateOrganisation method
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/OrganisationPatchEndpointTest.java` - PATCH endpoint tests

**Gateway Files:**
- `gateway/src/config.ts` - Add standards service config
- `gateway/.env.example` - Document new environment variables
- `gateway/src/services/standardsServiceClient.ts` - New upstream client
- `gateway/src/routes/standardsGenerate.ts` - New route file
- `gateway/src/routes/index.ts` - Export new router
- `gateway/src/server.ts` - Register new route
- `gateway/src/__tests__/standardsConfig.test.ts` - Configuration tests
- `gateway/src/routes/__tests__/standardsGenerate.test.ts` - Route tests

**Frontend Files:**
- `frontend/src/api/organisationsApi.ts` - Add generateGlobalStandards function
- `frontend/src/api/generateGlobalStandards.test.ts` - API function tests
- `frontend/src/components/Organisation/CreateOrganisationModal.tsx` - Add standards generation flow
- `frontend/src/components/Organisation/CreateOrganisationModal.standards.test.tsx` - Modal integration tests
- `frontend/src/components/common/Toast.tsx` - New toast component
- `frontend/src/components/common/Toast.module.css` - Toast styles
- `frontend/src/components/common/Toast.test.tsx` - Toast component tests
