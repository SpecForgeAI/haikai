# Task Breakdown: Planner to Implementor Handoff via Orchestrations API

## Overview
Total Tasks: 24

This specification enables a deterministic handoff from the Planner LLM conversation to the external Orchestrations Service. The implementation extracts the final proposed feature definition from Planner messages, transforms it into a shape-spec payload, calls the Orchestrations API with proper headers, and confirms implementation status to the user.

## Task List

### Gateway Layer

#### Task Group 1: Gateway Proxy Route for Orchestrations API
**Dependencies:** None

- [x] 1.0 Complete gateway orchestrations proxy route
  - [x] 1.1 Write 4-6 focused tests for the new POST /api/v1/orchestrations proxy route
    - Test successful proxy to external service returns 2xx response
    - Test Authorization header is forwarded unchanged
    - Test User-Agent header is set/overridden to "Rivvy-Portal-UI"
    - Test request body is forwarded with correct structure (company, project, spec_intents, options)
    - Test error responses (non-2xx) are transparently returned to frontend
    - Test network/timeout errors return appropriate error response
  - [x] 1.2 Add new route handler in `gateway/src/routes/orchestrations.ts`
    - New POST `/api/v1/orchestrations` route (distinct from existing `/execute` route)
    - Accept request body with: company, project, spec_intents[], options object
    - Follow existing route patterns from orchestrationsRouter
  - [x] 1.3 Implement header handling in the proxy route
    - Forward Authorization header from incoming request unchanged
    - Set/override User-Agent header to exactly "Rivvy-Portal-UI"
    - Set Content-Type: application/json
    - Set Accept: */*
  - [x] 1.4 Implement request body transformation and forwarding
    - Construct request body with company, project, spec_intents array
    - Include options object: stop_on_error=true, retry_on_failure=true, max_retries=1, timeout_seconds=0
    - Omit spec_ids field unless explicitly required
    - Use existing orchestrationServiceBaseUrl from `gateway/src/config.ts`
  - [x] 1.5 Implement response handling
    - Return Orchestrations service response status and body transparently
    - Handle HTTP 2xx success responses
    - Handle non-2xx error responses
    - Handle network errors and timeouts (use existing patterns from `gateway/src/services/orchestrationClient.ts`)
  - [x] 1.6 Add request validation
    - Validate company is provided and non-empty
    - Validate project is provided and non-empty
    - Validate spec_intents is an array with at least one element
    - Validate each spec_intent is a non-empty string
    - Return 400 with descriptive error on validation failure
  - [x] 1.7 Ensure gateway proxy route tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all proxy behaviors work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- POST /api/v1/orchestrations proxies requests to external Orchestrations service
- Authorization header forwarded, User-Agent set to "Rivvy-Portal-UI"
- Request body correctly structured with options object
- Response transparently returned to frontend

### Frontend API Layer

#### Task Group 2: Frontend Orchestrations API Client
**Dependencies:** Task Group 1

- [x] 2.0 Complete frontend API client for direct Orchestrations API call
  - [x] 2.1 Write 3-5 focused tests for the new orchestrations API function
    - Test successful API call returns success response
    - Test request body is correctly structured with company, project, spec_intents, options
    - Test error responses are correctly handled and returned
    - Test Authorization header is included from existing auth mechanism
  - [x] 2.2 Add new types in `frontend/src/api/orchestrationApi.ts`
    - Add `StartOrchestrationRequest` interface with company, project, spec_intents[], options
    - Add `StartOrchestrationResponse` interface with success, data?, error?
    - Add `OrchestrationOptions` interface with stop_on_error, retry_on_failure, max_retries, timeout_seconds
  - [x] 2.3 Implement `startOrchestration` function in `frontend/src/api/orchestrationApi.ts`
    - POST to `/api/v1/orchestrations` endpoint
    - Include Authorization Bearer token using existing auth mechanism
    - Set Content-Type: application/json, Accept: */*
    - Set User-Agent: "Rivvy-Portal-UI" (gateway will override if needed)
    - Handle success (2xx) and error responses
    - Return typed response object
  - [x] 2.4 Ensure frontend API client tests pass
    - Run ONLY the 3-5 tests written in 2.1
    - Verify API call structure is correct
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-5 tests written in 2.1 pass
- New `startOrchestration` function properly calls gateway proxy endpoint
- Request body includes all required fields
- Authorization header included correctly

### Frontend Extraction Logic

#### Task Group 3: Proposed Definition Extraction and Transformation
**Dependencies:** None (can be developed in parallel with Task Groups 1-2)

- [x] 3.0 Complete extraction and transformation logic
  - [x] 3.1 Write 4-6 focused tests for extraction and transformation functions
    - Test extraction finds "--- Part 4: Proposed Final Feature Definition ---" marker
    - Test extraction finds "PROPOSED -" marker and extracts following text
    - Test extraction returns null/empty when markers are missing
    - Test transformation converts PROPOSED content to shape-spec format
    - Test transformed payload starts with "title: ..."
    - Test transformed payload does NOT include "/agent-os:shape-spec" prefix
  - [x] 3.2 Create extraction utility module
    - Create `frontend/src/utils/proposedDefinitionExtractor.ts`
    - Implement `extractProposedDefinition(messages: ChatMessage[]): string | null`
    - Search for most recent assistant message containing Part 4 marker
    - Extract text after "PROPOSED -" marker
    - Return null if markers not found
    - Deterministic logic (no LLM inference)
  - [x] 3.3 Implement shape-spec transformation
    - Implement `transformToShapeSpec(proposed: string): string`
    - Convert PROPOSED content to shape-spec format starting with "title: ..."
    - Include sections: context, goal, scope, requirements, acceptance_criteria, non_goals
    - Output must be declarative, execution-ready
    - No conversational framing or planner commentary
    - Return single string suitable for spec_intents array
  - [x] 3.4 Ensure extraction and transformation tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify extraction handles edge cases
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Extraction correctly identifies Part 4 and PROPOSED markers
- Returns null when markers missing
- Transformation produces valid shape-spec format
- No "/agent-os:shape-spec" prefix in output

### Frontend UI Integration

#### Task Group 4: Implement Button Integration and UI States
**Dependencies:** Task Groups 2, 3

- [x] 4.0 Complete UI integration for Implement button
  - [x] 4.1 Write 4-6 focused tests for Implement button integration
    - Test Implement button is disabled when PROPOSED marker not found
    - Test Implement button is disabled during API request
    - Test duplicate clicks are prevented while request in flight
    - Test successful response appends confirmation message to chat
    - Test failure response displays error message in chat
    - Test generated shape-spec payload is logged for debugging
  - [x] 4.2 Enhance handleImplement function in `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Import extraction and transformation utilities from `frontend/src/utils/proposedDefinitionExtractor.ts`
    - Extract PROPOSED definition from messages when Implement clicked
    - If extraction fails, show error: "Cannot implement: final proposed feature definition not found."
    - Transform PROPOSED to shape-spec payload
    - Log payload for debugging (console.debug)
  - [x] 4.3 Integrate startOrchestration API call
    - Import startOrchestration from orchestrationApi
    - Build request with: company (organisation name), project (project name), spec_intents (transformed payload)
    - Include options: stop_on_error=true, retry_on_failure=true, max_retries=1, timeout_seconds=0
    - Call startOrchestration on Implement button click
  - [x] 4.4 Implement UI state management
    - Add `isImplementing` state variable
    - Set true when API call starts, false when completes
    - Update `canImplement` computed property to include extraction check
    - Disable Implement button when isImplementing is true
    - Prevent duplicate submissions by checking isImplementing
  - [x] 4.5 Implement confirmation and error messages
    - On HTTP 2xx success: append assistant message "The Implementation Assistant has begun to implement this feature."
    - On failure (non-2xx or network error): display "Failed to start implementation: <status/message>"
    - Use existing setMessages pattern for appending messages
    - Do not append success message on failure
  - [x] 4.6 Ensure UI integration tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify button states and messages work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- Implement button disabled when PROPOSED marker missing
- Button disabled during API request
- Success/failure messages appear in chat
- Debug logging of payload works

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests written by gateway engineer (Task 1.1) - in `gateway/src/__tests__/orchestrations-proxy-route.test.ts`
    - Review the 3-5 tests written by frontend API engineer (Task 2.1) - in `frontend/src/__tests__/start-orchestration-api.test.ts`
    - Review the 4-6 tests written by extraction logic engineer (Task 3.1) - in `frontend/src/__tests__/proposed-definition-extractor.test.ts`
    - Review the 4-6 tests written by UI integration engineer (Task 4.1) - in `frontend/src/__tests__/implement-button-integration.test.tsx`
    - Total existing tests: approximately 15-23 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to Planner-to-Implementor handoff
    - Do NOT assess entire application test coverage
    - Prioritize integration points: extraction -> transformation -> API call -> UI update
  - [x] 5.3 Write up to 8 additional strategic tests maximum
    - Add maximum of 8 new tests to fill identified critical gaps
    - Focus on end-to-end workflow: Planner message -> extraction -> API -> confirmation
    - Test edge cases: malformed PROPOSED content, empty messages array
    - Test organisation/project name resolution from context
    - Do NOT write comprehensive coverage for all scenarios
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 23-31 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-31 tests total)
- Critical end-to-end workflow for Planner-to-Implementor handoff is covered
- No more than 8 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements

## Execution Order

Recommended implementation sequence:

1. **Gateway Layer (Task Group 1)** - Implement proxy route first as frontend depends on it
2. **Frontend Extraction Logic (Task Group 3)** - Can be developed in parallel with Task Group 1
3. **Frontend API Layer (Task Group 2)** - Depends on gateway route being available
4. **Frontend UI Integration (Task Group 4)** - Depends on both API client and extraction logic
5. **Test Review and Gap Analysis (Task Group 5)** - Final verification after all implementation complete

## Key Implementation Notes

### Existing Code References

**Gateway patterns to follow:**
- `gateway/src/routes/orchestrations.ts` - Existing POST /execute route structure
- `gateway/src/services/orchestrationClient.ts` - External API call patterns with timeout handling
- `gateway/src/config.ts` - orchestrationServiceBaseUrl configuration

**Frontend patterns to follow:**
- `frontend/src/api/orchestrationApi.ts` - executeOrchestration function structure
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - handleImplement, handleExecute patterns
- `frontend/src/api/chatApi.ts` - ChatMessage types and state management

### Marker Formats

**Part 4 Marker (search for):**
```
--- Part 4: Proposed Final Feature Definition ---
```

**PROPOSED Marker (extract after):**
```
PROPOSED -
```

### Request Body Structure

```json
{
  "company": "<organisation name>",
  "project": "<project name>",
  "spec_intents": ["<shape-spec payload string>"],
  "options": {
    "stop_on_error": true,
    "retry_on_failure": true,
    "max_retries": 1,
    "timeout_seconds": 0
  }
}
```

### Shape-Spec Payload Format

```yaml
title: <feature title>
context: <background context>
goal: <primary goal>
scope: <scope definition>
requirements:
  - <requirement 1>
  - <requirement 2>
acceptance_criteria:
  - <criterion 1>
  - <criterion 2>
non_goals:
  - <non-goal 1>
```

Note: The payload must NOT include the "/agent-os:shape-spec" command prefix.
