# Specification: Trigger Global Standards Generation

## Goal
Extend the Create Organisation flow so that, after a successful database save, the system calls an external global standards generation API and updates the organisation's `techStandardsGenerated` flag based on the outcome.

## User Stories
- As a user creating an organisation, I want the system to automatically generate global standards after creation so that my organisation is ready to use with pre-configured technical standards.
- As a user, I want clear feedback about whether standards generation succeeded or failed so that I understand the state of my organisation.

## Specific Requirements

**Sequential Flow After Organisation Creation**
- After `createOrganisationFull` succeeds and returns the created organisation, immediately trigger standards generation
- The modal remains open during standards generation with a "Generating standards..." state
- Only close the modal after the standards generation call completes (success or failure)
- The organisation is always persisted even if standards generation fails

**Frontend Loading State in CreateOrganisationModal**
- Add new state variable `isGeneratingStandards` to track the standards generation phase
- Add new state variable `standardsError` to capture standards generation error messages
- When `isGeneratingStandards=true`, display "Generating standards..." text and spinner inside the modal
- All form inputs, buttons (Cancel, Create), and overlay click remain disabled during this phase
- The Create button text changes to "Generating standards..." during this phase

**Gateway Route for Standards Generation**
- Add new route `POST /api/v1/standards/global/generate` in gateway
- Create new route file `gateway/src/routes/standardsGenerate.ts` following shapeSpec.ts patterns
- Add config for external standards service base URL: `STANDARDS_SERVICE_BASE_URL` (env var)
- Add config for API key: `STANDARDS_SERVICE_BEARER_TOKEN` (env var)
- Gateway forwards request to external service with Bearer token in Authorization header
- Return 200/201 on success, or the upstream error status (transformed to 502 for auth failures)

**Request Body Mapping for External API**
- External endpoint: `POST /api/v1/standards/global/generate`
- Map organisation fields to external API format:
  - `company`: organisation.name
  - `sources`: organisation.docsAppliedToAllSources
  - `technical_documents.tech_stack`: organisation.docsAppliedToTechStack
  - `technical_documents.coding_style`: organisation.docsAppliedToCodingStyles
  - `technical_documents.conventions`: organisation.docsAppliedToConventions
  - `technical_documents.error_handling`: organisation.docsAppliedToErrorHandling
  - `technical_documents.validation`: organisation.docsAppliedToValidation
- All `docsAppliedTo*` fields are string arrays (List<String>)

**Backend PATCH Endpoint for Flag Update**
- Add PATCH endpoint `PATCH /api/v1/organisations/{id}` in OrganisationController
- Accepts request body with optional `techStandardsGenerated` boolean field
- Updates only the provided fields (partial update)
- Returns updated OrganisationDto with 200 status
- Add corresponding service method `updateOrganisation(String id, UpdateOrganisationRequest request)`

**Gateway Orchestration of Flag Update**
- Gateway receives standards generation result and calls backend PATCH endpoint
- HTTP 200/201 from external service: PATCH with `techStandardsGenerated=true`
- Any non-200/201 response: leave flag as false (no PATCH call needed)
- Frontend API function `generateGlobalStandards(organisationId, payload)` calls gateway endpoint
- Gateway returns final status to frontend for toast decision

**Toast Notification Requirements**
- Add reusable toast notification component or extend existing TopBar notification pattern
- Success toast: green background (#4caf50), auto-dismiss after ~5 seconds
- Error toast: red background (#c62828), persists until manually dismissed (or ~30s timeout)
- Toast messages: "Organisation created and standards generated successfully" (success), "Organisation created but standards generation failed" (error)
- Position: fixed bottom center, same z-index pattern as TopBar notification

**Frontend API Function**
- Add `generateGlobalStandards(organisationId: string, payload: StandardsGenerationPayload): Promise<void>` to organisationsApi.ts
- Create `StandardsGenerationPayload` interface matching external API request format
- Throws on non-200/201 response for caller to handle

## Visual Design
No visual mockups provided. The modal uses existing CreateOrganisationModal styling with these additions:
- "Generating standards..." loading state uses same disabled styling as "Creating..." state
- Spinner can be simple CSS animation or inline "..." animation
- Error toast uses error color scheme (#c62828) consistent with existing error styling

## Existing Code to Leverage

**CreateOrganisationModal Component (frontend/src/components/Organisation/CreateOrganisationModal.tsx)**
- Existing modal structure with form state, loading state (`isSubmitting`), and error handling
- `handleCreate` function to extend with standards generation call after successful creation
- Existing pattern: `setIsSubmitting(true)` -> API call -> success/error handling -> close modal
- Extend with second phase: after create succeeds, set `isGeneratingStandards=true` -> call standards API -> handle result -> show toast -> close modal

**shapeSpecUpstreamClient (gateway/src/services/shapeSpecUpstreamClient.ts)**
- Pattern for authenticated upstream requests with Bearer token injection
- `shapeSpecFetch` wrapper can be adapted for `standardsServiceFetch` function
- Handles token configuration, Authorization header injection, and error logging

**Gateway Route Patterns (gateway/src/routes/shapeSpec.ts)**
- Pattern for proxying requests to external services
- Error handling: returns 502 for auth failures (401/403), 503 for network errors
- Does not expose internal auth details to frontend

**TopBar Notification (frontend/src/components/TopBar/TopBar.tsx)**
- Existing notification state: `const [notification, setNotification] = useState<string | null>(null)`
- Auto-dismiss pattern: `setTimeout(() => setNotification(null), 3000)`
- Rendering: conditional `{notification && <div className={styles.notification}>...}</div>}`
- CSS styles in TopBar.module.css: fixed position, bottom center, green success color

**Gateway Config (gateway/src/config.ts)**
- Pattern for adding new environment variables with defaults
- `shapeSpecBearerToken` as example of service-specific auth token configuration
- `orchestrationServiceBaseUrl` as example of external service URL configuration

## Out of Scope
- Async job queue or background job orchestration for standards generation
- Retry logic or automatic re-generation on failure
- UI to re-run standards generation after initial failure
- Editing organisations beyond setting the `techStandardsGenerated` flag after create
- Changes to Iteration 1 database schema (schema already includes `tech_standards_generated` column)
- Polling for long-running standards generation (call is synchronous)
- Standards generation for existing organisations (only triggered on create)
- Rollback of organisation if standards generation fails
- Detailed error messages from external service (use generic failure message)
