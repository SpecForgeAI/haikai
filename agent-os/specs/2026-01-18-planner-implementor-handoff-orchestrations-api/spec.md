# Specification: Planner to Implementor Handoff via Orchestrations API

## Goal
Enable a deterministic handoff from the Planner LLM conversation to the external Orchestrations Service by extracting the final proposed feature definition, transforming it into a shape-spec payload, calling the Orchestrations API with proper headers and request body, and confirming implementation status to the user.

## User Stories
- As a product manager, I want the "Implement" button to automatically trigger implementation based on the finalized feature definition so that I do not need to manually copy content between tools.
- As a developer, I want the system to reliably extract the agreed-upon feature intent and forward it to the orchestration service so that implementation can begin immediately after planning approval.

## Specific Requirements

**Extract Final Proposed Definition**
- Identify the most recent Planner assistant message containing the marker "--- Part 4: Proposed Final Feature Definition ---"
- Within that message, extract only the text content following the "PROPOSED -" marker as the authoritative final feature intent
- If the marker or PROPOSED block is missing, disable the Implement button OR display a blocking error "Cannot implement: final proposed feature definition not found."
- The extraction logic should be deterministic and not rely on LLM inference

**Transform to Shape-Spec Payload**
- Convert the extracted PROPOSED content into a shape-spec text payload starting with "title: ..."
- Include required sections: context, goal, scope, requirements, acceptance_criteria, non_goals
- Payload must be declarative and execution-ready with no conversational framing or planner commentary
- MUST NOT include the "/agent-os:shape-spec" command prefix in the payload
- The generated shape-spec payload must be a single string suitable for the spec_intents array

**Orchestrations API Call Configuration**
- Call POST <orchestrations_base_url_from_config>/api/v1/orchestrations on Implement button click
- Use existing gateway configuration value orchestrationServiceBaseUrl from gateway/src/config.ts
- Request body JSON fields: company (organisation name), project (project name), spec_intents array (one element), options object
- Options object must include: stop_on_error=true, retry_on_failure=true, max_retries=1, timeout_seconds=0
- spec_ids field must be omitted unless explicitly required by the Orchestrations service

**Request Headers Configuration**
- Include Authorization header with Bearer token using existing authentication mechanism
- Set Content-Type: application/json and Accept: */*
- Set User-Agent header to exactly "Rivvy-Portal-UI" (must not be PostmanRuntime or browser default)
- Gateway must override User-Agent if not provided by the client

**Gateway Proxy Route**
- Implement or extend gateway route that proxies frontend request to Orchestrations service
- Route: POST /api/v1/orchestrations (gateway) proxies to POST <orchestrations_base_url>/api/v1/orchestrations
- Forward Authorization header unchanged, set/override User-Agent to "Rivvy-Portal-UI"
- Return Orchestrations response status and body transparently to the frontend

**Planner Confirmation Message**
- On successful HTTP 2xx response, append Planner assistant message: "The Implementation Assistant has begun to implement this feature."
- On failure (non-2xx or network error), display error message in chat UI: "Failed to start implementation: <status/message>"
- Do not append success confirmation message on failure

**UI States and Safety**
- Disable the Implement button while Orchestrations request is in flight to prevent duplicate submissions
- Ignore additional clicks until the current request completes
- Log the generated shape-spec payload locally for debugging but do not display to user unless debug mode is enabled

## Visual Design
No visual mockups were provided for this specification.

## Existing Code to Leverage

**frontend/src/api/orchestrationApi.ts**
- Contains ExecuteOrchestrationRequest and ExecuteOrchestrationResponse interfaces
- executeOrchestration function makes POST to /api/orchestrations/execute with proper error handling
- Use this as the foundation for the new direct Orchestrations API call pattern

**frontend/src/components/ProductView/ImplementationAssistantPanel.tsx**
- Contains handleImplement function that triggers generate_specs intent
- Contains handleExecute function that calls executeOrchestration with handoff_intents
- Messages state management with append pattern for confirmation messages
- isExecuting state and canExecute computed property for button disable logic

**gateway/src/routes/orchestrations.ts**
- POST /execute route handler with validation and error handling patterns
- ExecuteOrchestrationRequest interface with sessionId, activeProjectName, featureId, featureTitle, handoff_intents
- buildOrchestrationEntryContent function for transcript persistence

**gateway/src/services/orchestrationClient.ts**
- executeOrchestration function calling external Orchestration Service API
- OrchestrationRequest interface with company, project, feature_descriptions fields
- Timeout handling with AbortController, error classification (422, 5xx, network errors)

**gateway/src/config.ts**
- orchestrationServiceBaseUrl configuration loaded from ORCHESTRATION_SERVICE_BASE_URL environment variable
- Default value http://localhost:8085 - use same config pattern for new endpoint

## Out of Scope
- Multi-intent splitting into multiple spec_intents entries (handled by separate specification)
- Implementation progress tracking or status polling UI
- Changes to the external Orchestrations Service behavior or authentication scheme
- Changes to the Planner chat generation logic beyond extracting the PROPOSED block
- Editing or modifying the PROPOSED content before submission
- User confirmation dialog before triggering implementation
- Retry UI for failed orchestration calls
- Rollback or cancellation of in-flight orchestration requests
- Storing orchestration request history in the database
- Webhook callbacks from Orchestrations service for completion notification
