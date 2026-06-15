# Spec Initialization

## Title
Iteration 3 — Trigger global standards generation after organisation creation

## Raw Idea/Intent

```yaml
intent:
  Extend the Create Organisation flow so that, after a successful database save,
  the system calls the external global standards generation API.
  On success, mark the organisation as having generated standards; on failure,
  keep the organisation created and leave the flag false.

scope:
  in_scope:
    - Frontend: extend Create Organisation "Create" action to perform a second API call after DB save
    - Gateway: add or reuse a route that forwards requests to the external standards service
    - Frontend: build and send correct request body to POST /api/v1/standards/global/generate
    - Backend (Architecture Model Service): update techStandardsGenerated flag based on result
    - User feedback for success/failure of standards generation
  out_of_scope:
    - Async job orchestration or polling
    - Retry logic or background re-generation
    - Editing organisations or re-running generation from UI
    - Any changes to Iteration 1 DB schema or Iteration 2 modal UI

sequence:
  1) User clicks Create in Create Organisation modal.
  2) Frontend calls Gateway → Architecture Model Service to create Organisation (same as Iteration 2).
  3) If DB save succeeds:
       - Immediately call Gateway → External Service:
         POST /api/v1/standards/global/generate
  4) Handle response:
       - HTTP 200 or 201 → update Organisation.techStandardsGenerated = true
       - Any non-200/201 → leave techStandardsGenerated = false
  5) Close modal and surface outcome to user.

external_api_call:
  endpoint:
    - POST /api/v1/standards/global/generate
  request_body:
    company: <organisation.name>
    sources: <docsAppliedToAllSources>
    technical_documents:
      tech_stack: <docsAppliedToTechStack>
      coding_style: <docsAppliedToCodingStyles>
      conventions: <docsAppliedToConventions>
      error_handling: <docsAppliedToErrorHandling>
      validation: <docsAppliedToValidation>

data_mapping:
  organisation_entity_fields:
    - docsAppliedToAllSources → sources
    - docsAppliedToTechStack → technical_documents.tech_stack
    - docsAppliedToCodingStyles → technical_documents.coding_style
    - docsAppliedToConventions → technical_documents.conventions
    - docsAppliedToErrorHandling → technical_documents.error_handling
    - docsAppliedToValidation → technical_documents.validation

status_update_rules:
  - techStandardsGenerated is set to true only if the external API returns HTTP 200 or 201.
  - For any other HTTP status or network/error condition:
      - Organisation remains created
      - techStandardsGenerated remains false
      - No rollback of Organisation data

frontend_behavior:
  - While standards generation call is in progress, show a non-blocking loading indicator.
  - On success:
      - Show a success toast/banner indicating standards generation completed.
  - On failure:
      - Show a warning/error toast/banner indicating standards generation failed.
      - Do not reopen modal or block user flow.

gateway_responsibilities:
  - Accept request from frontend with organisation-derived payload.
  - Forward request to external standards service with required authentication.
  - Return status code and minimal response needed for frontend decision logic.

backend_responsibilities:
  - Expose an update mechanism (existing or new) to set techStandardsGenerated on the Organisation entity.
  - Persist the updated flag reliably.

tests:
  add_or_update:
    - Successful DB save followed by mocked 200 response sets techStandardsGenerated=true.
    - Successful DB save followed by mocked non-200 response leaves techStandardsGenerated=false.
    - Organisation remains persisted even when external call fails.
    - Correct request body mapping sent to external endpoint.

acceptance_criteria:
  - Creating an organisation always persists it to the DB first.
  - Standards generation is attempted immediately after creation.
  - HTTP 200/201 from external service results in techStandardsGenerated=true.
  - Any failure leaves techStandardsGenerated=false without deleting the organisation.
  - User receives clear feedback about the standards generation outcome.
```

## Status
Initialized - Ready for requirements research
