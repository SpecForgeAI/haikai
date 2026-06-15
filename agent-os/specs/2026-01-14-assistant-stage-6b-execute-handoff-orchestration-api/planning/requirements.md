---
title: Implement Assistant Stage 6b — Execute Handoff by Calling External Orchestration API

context:
  The Implement Assistant supports a planning handoff step that produces one or more
  implementation-ready feature intents (handoff intents). Actual code implementation is
  performed by an external Orchestration Service deployed separately (different server/port)
  and exposed via an HTTP API. The system must invoke this external API when the user chooses
  to execute implementation, sending the final intents as an array of feature descriptions.

goal:
  When the user triggers implementation execution after handoff planning, the Gateway must call
  the external Orchestration Service endpoint:
    POST <orchestration_service_base_url>/api/v1/orchestrations
  with a request body containing:
    - company: hardcoded string "Global"
    - project: active project name
    - feature_descriptions: array<string> derived from the final handoff intents

scope:
  - Gateway: add configuration + HTTP client + endpoint invocation + error handling
  - Frontend: minimal wiring to trigger execution using the already-generated handoff plan
  - No changes to how the handoff plan is generated (handled by the prior stage)
  - No status tracking UI or persistence beyond displaying the orchestration response
  - No changes to architecture model service

external_api_contract:
  endpoint:
    - Method: POST
    - Path: /api/v1/orchestrations
    - Base URL: configured (see configuration section)
  request_body:
    - company: string (must be "Global")
    - project: string (active project name)
    - feature_descriptions: array<string> (required, length >= 1)
    - Ignore "spec_ids" (not required for this integration)
  responses:
    - 200: success response object (shape may include orchestration results/logs)
    - 422: validation error response object (return to client as a failure with details)

requirements:
  configuration:
    - Add a new Gateway configuration setting for the Orchestration Service base URL, e.g.:
        ORCHESTRATION_SERVICE_BASE_URL
      This must support values such as:
        http://localhost:8085
      The Gateway must construct the full URL by appending:
        /api/v1/orchestrations

  gateway:
    - Implement a new Orchestration client module responsible for:
        - constructing requests
        - calling the external API
        - returning parsed responses
        - applying timeouts and safe error handling
    - Add (or extend) a Gateway route to trigger orchestration execution from the UI.
      The route MUST accept the following input:
        - activeProjectName (string)
        - featureId (string) and featureTitle (string) for logging/diagnostics
        - handoff_intents: array of objects produced by the Planner handoff planning step
          (must include at minimum a final intent string field used to populate feature_descriptions)
    - Transform input into the external API request body:
        - company = "Global"
        - project = activeProjectName
        - feature_descriptions = array<string> where each element is the final intent text of
          the corresponding handoff intent, preserving order
    - Validate before calling external API:
        - activeProjectName is non-empty
        - feature_descriptions length >= 1
        - each description is non-empty after trimming
      If validation fails:
        - return an error response to the frontend without calling the external API
    - Call:
        POST {ORCHESTRATION_SERVICE_BASE_URL}/api/v1/orchestrations
      with JSON body defined above.
    - Handle responses:
        - On HTTP 200:
            - return the orchestration response object to the frontend
        - On HTTP 422:
            - return a failure response to the frontend containing validation details from the API
        - On network/timeout/5xx:
            - return a failure response with a safe message
            - log server-side details for diagnosis
    - The Gateway must never send the full planner chat transcript to the Orchestration Service;
      only feature_descriptions and required metadata defined above.

  frontend:
    - After a handoff plan has been generated and displayed (view-only), provide a single action
      to execute implementation that calls the Gateway orchestration execution route.
    - The frontend must supply:
        - active project name
        - the validated handoff_intents from the plan response
    - Display success/failure:
        - On success: show a compact summary of orchestration results (or a raw JSON viewer if no
          UI exists yet)
        - On failure: show a clear error message and preserve the handoff plan for retry

observability:
  - Gateway logs must include:
      - featureId / featureTitle
      - count of feature_descriptions sent
      - external API URL (base redacted if needed) and response status code
  - Do not log full feature_descriptions content by default (avoid leaking sensitive details);
    log only counts and truncated snippets if necessary.

acceptance_criteria:
  - Given a handoff plan with one intent:
      - Executing implementation calls the external API with feature_descriptions length = 1.
  - Given a handoff plan with multiple intents:
      - Executing implementation calls the external API with feature_descriptions length > 1,
        preserving order.
  - company is always "Global" and project is the active project name.
  - Successful 200 response is returned to the UI and displayed.
  - 422 validation errors are surfaced to the UI without crashing.
  - Network/timeouts/5xx errors are handled gracefully and logged server-side.

non_goals:
  - No sub-intent status tracking or job polling
  - No persistence of orchestration results beyond immediate UI display
  - No changes to Planner LLM prompts or handoff plan generation logic
  - No changes to architecture meta-model or diagram features
---
