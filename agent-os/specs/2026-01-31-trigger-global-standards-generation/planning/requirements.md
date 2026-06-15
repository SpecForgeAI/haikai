# Spec Requirements: Iteration 3 - Trigger Global Standards Generation

## Initial Description

Extend the Create Organisation flow so that, after a successful database save, the system calls the external global standards generation API. On success, mark the organisation as having generated standards; on failure, keep the organisation created and leave the flag false.

**Sequence:**
1. User clicks Create in Create Organisation modal
2. Frontend calls Gateway -> Architecture Model Service to create Organisation (same as Iteration 2)
3. If DB save succeeds, immediately call Gateway -> External Service: POST /api/v1/standards/global/generate
4. Handle response: HTTP 200/201 -> update Organisation.techStandardsGenerated = true; Any non-200/201 -> leave techStandardsGenerated = false
5. Close modal and surface outcome to user

**External API Call:**
- Endpoint: POST /api/v1/standards/global/generate
- Request body mapping:
  - company: organisation.name
  - sources: docsAppliedToAllSources
  - technical_documents.tech_stack: docsAppliedToTechStack
  - technical_documents.coding_style: docsAppliedToCodingStyles
  - technical_documents.conventions: docsAppliedToConventions
  - technical_documents.error_handling: docsAppliedToErrorHandling
  - technical_documents.validation: docsAppliedToValidation

## Requirements Discussion

### First Round Questions

**Q1:** Where is the CreateOrganisationModal currently mounted? I assume it's part of Iteration 2 and lives within a product/settings view component. Is that correct, or is it mounted globally at app root level?
**Answer:** Yes - Iteration 2 adds it. It's mounted globally at the App root (App.tsx or a top-level provider) as a CreateOrganisationModal component.

**Q2:** For the external standards service, I assume Gateway already has configuration for the external service base URL (environment variable or config file). Should Gateway supply the API key authentication (Bearer token/Authorization header), or does the frontend need to pass credentials?
**Answer:** Use the external standards service base URL from Gateway config/env (don't hardcode in frontend). It requires the service's API key auth (HTTP Bearer / Authorization header) which Gateway supplies when proxying.

**Q3:** I'm thinking the techStandardsGenerated flag update happens via a PATCH to the existing organisation endpoint after the external call returns. Should we use PATCH on the existing endpoint, or create a dedicated endpoint like POST /organisations/{id}/mark-standards-generated?
**Answer:** Use a PATCH (or existing update) on the organisation endpoint; no dedicated endpoint needed unless PATCH doesn't already exist.

**Q4:** For the loading indicator while the external call is in progress, I assume we keep the modal open with a spinner and "Generating standards..." message, then close only after the call completes (success or failure). Is that correct, or should the modal close immediately with a background toast?
**Answer:** Keep modal open and show a non-blocking spinner/"Generating standards..." state inside it; close only after the external call completes (success or failure).

**Q5:** For success/error feedback, I assume we use dismissible toast notifications. Should success auto-dismiss after 5 seconds while errors persist until manually dismissed?
**Answer:** Yes dismissible. Success auto-dismiss ~5s; errors persist until dismissed (or much longer, e.g., 30s).

**Q6:** Looking at the data mapping, all the docsAppliedTo* fields (docsAppliedToAllSources, docsAppliedToTechStack, etc.) appear to be arrays of document URLs or identifiers. I assume these are string arrays (List<String>) as defined in Iteration 1. Is that correct?
**Answer:** Yes - all docsAppliedTo* fields are string arrays (List<String>) as per Iteration 1.

**Q7:** I assume the backend (Architecture Model Service or Gateway) is responsible for updating techStandardsGenerated based on the external call outcome, rather than frontend making a separate flag-update call. Is that the intended flow, or should frontend orchestrate both calls?
**Answer:** Backend flow: Gateway (or backend) should update techStandardsGenerated based on the external call outcome (frontend should not do a separate flag-update call).

**Q8:** Is there anything that should explicitly NOT be part of this iteration? I've noted async job queue/polling, retries, re-run UI, and org editing beyond the flag update are out of scope. Anything else to exclude?
**Answer:** Exclude async job queue/polling, retries, re-run UI, and any org editing beyond setting the flag after create.

### Existing Code to Reference

No similar existing features identified for reference by the user. However, based on the initialization file:
- **Iteration 2 modal**: CreateOrganisationModal component (App.tsx or top-level provider) - should be extended
- **Gateway routing patterns**: Existing Gateway routes for proxying to Architecture Model Service
- **Organisation entity**: Existing Organisation model with docsAppliedTo* fields from Iteration 1

### Follow-up Questions

No follow-up questions required - all answers were comprehensive and clear.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Frontend (CreateOrganisationModal):**
- Extend the existing "Create" action to perform standards generation after successful organisation creation
- Build and send correct request body to Gateway for standards generation
- Show non-blocking spinner/"Generating standards..." state inside modal during external call
- Keep modal open until external call completes (success or failure)
- Display dismissible toast notifications:
  - Success: auto-dismiss after ~5 seconds
  - Error: persist until dismissed (or ~30 seconds)
- Do NOT make separate flag-update calls - backend handles this

**Gateway:**
- Add or reuse a route that forwards requests to external standards service
- Supply API key authentication (HTTP Bearer / Authorization header) when proxying
- Use external service base URL from Gateway config/env (not hardcoded)
- Return status code and minimal response needed for frontend decision logic

**Backend (Architecture Model Service):**
- Update techStandardsGenerated flag based on external call outcome
- Use existing PATCH (or update) on organisation endpoint
- Persist the updated flag reliably
- HTTP 200/201 from external service -> techStandardsGenerated = true
- Any other status -> techStandardsGenerated = false (organisation still persists)

**External API Integration:**
- Endpoint: POST /api/v1/standards/global/generate
- Request body structure:
  ```json
  {
    "company": "<organisation.name>",
    "sources": "<docsAppliedToAllSources>",
    "technical_documents": {
      "tech_stack": "<docsAppliedToTechStack>",
      "coding_style": "<docsAppliedToCodingStyles>",
      "conventions": "<docsAppliedToConventions>",
      "error_handling": "<docsAppliedToErrorHandling>",
      "validation": "<docsAppliedToValidation>"
    }
  }
  ```
- All docsAppliedTo* fields are string arrays (List<String>)

### Reusability Opportunities

- Existing CreateOrganisationModal component from Iteration 2
- Existing Gateway routing patterns for service proxying
- Existing Organisation entity and PATCH endpoint
- Existing toast notification system (if available)

### Scope Boundaries

**In Scope:**
- Frontend: extend Create Organisation "Create" action to trigger standards generation after DB save
- Gateway: add/reuse route forwarding to external standards service with auth
- Frontend: build and send correct request body to POST /api/v1/standards/global/generate
- Backend: update techStandardsGenerated flag based on result
- User feedback for success/failure of standards generation
- Non-blocking loading indicator inside modal
- Dismissible toast notifications with appropriate timing

**Out of Scope:**
- Async job orchestration or polling
- Retry logic or background re-generation
- Re-run UI for standards generation
- Editing organisations beyond setting the flag after create
- Any changes to Iteration 1 DB schema
- Any changes to Iteration 2 modal UI (beyond adding the standards generation flow)

### Technical Considerations

- Gateway supplies Bearer token authentication to external service
- External service base URL configured in Gateway config/env
- Frontend does not handle flag updates - backend/Gateway orchestrates this
- Modal remains open during standards generation call
- Organisation is always persisted first, even if standards generation fails
- No rollback of organisation data on standards generation failure

### Testing Requirements

- Successful DB save followed by mocked 200 response sets techStandardsGenerated=true
- Successful DB save followed by mocked non-200 response leaves techStandardsGenerated=false
- Organisation remains persisted even when external call fails
- Correct request body mapping sent to external endpoint
- Loading indicator displays during standards generation
- Success toast appears and auto-dismisses after ~5s
- Error toast appears and persists until dismissed

### Acceptance Criteria

- Creating an organisation always persists it to the DB first
- Standards generation is attempted immediately after creation
- HTTP 200/201 from external service results in techStandardsGenerated=true
- Any failure leaves techStandardsGenerated=false without deleting the organisation
- User receives clear feedback about the standards generation outcome
- Modal shows loading state during standards generation
- Appropriate toast notifications display based on outcome
