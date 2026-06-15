# Task Breakdown: Implement Assistant Stage 6b - Execute Handoff by Calling External Orchestration API

## Overview
Total Tasks: 27 (across 4 task groups)

This feature enables users to execute implementation of their handoff plan by calling an external Orchestration Service API. The implementation spans Gateway configuration, a new HTTP client module, a Gateway route, frontend API client, and UI integration with the existing ImplementationAssistantPanel.

## Task List

### Gateway Layer

#### Task Group 1: Gateway Configuration and Orchestration Client
**Dependencies:** None

- [x] 1.0 Complete Gateway configuration and orchestration client
  - [x] 1.1 Write 4-6 focused tests for orchestration client functionality
    - Test `executeOrchestration` returns success result on HTTP 200 response
    - Test `executeOrchestration` returns error result on HTTP 422 validation error
    - Test `executeOrchestration` returns error result on network timeout (60s)
    - Test `executeOrchestration` returns error result on HTTP 5xx server error
    - Test request body is correctly formed with company, project, feature_descriptions
    - Test logging includes request metadata without full descriptions
  - [x] 1.2 Add `ORCHESTRATION_SERVICE_BASE_URL` to Gateway config
    - Add property to `Config` interface in `gateway/src/config.ts`
    - Add to `loadConfig()` function with default `http://localhost:8085`
    - Follow existing `architectureModelServiceBaseUrl` pattern
    - No validation required (optional service, fails gracefully)
  - [x] 1.3 Create orchestration client module
    - Create new file `gateway/src/services/orchestrationClient.ts`
    - Define `OrchestrationRequest` interface: `{ company: string; project: string; feature_descriptions: string[] }`
    - Define `OrchestrationResult` interface: `{ success: boolean; data?: unknown; error?: { code: number; message: string; details?: unknown } }`
    - Follow pattern from `gateway/src/services/architectureModelClient.ts`
  - [x] 1.4 Implement `executeOrchestration` function
    - Import `getConfig` from `../config`
    - Import `logger` from `./logger`
    - Construct URL: `${config.orchestrationServiceBaseUrl}/api/v1/orchestrations`
    - Use AbortController with 60-second timeout
    - POST with JSON body and `Content-Type: application/json` header
    - Log request metadata (project name, feature_descriptions count, URL) without full descriptions
  - [x] 1.5 Implement error handling in orchestration client
    - HTTP 200: return `{ success: true, data: responseBody }`
    - HTTP 422: return `{ success: false, error: { code: 422, message: "Validation error", details: responseBody } }`
    - Network/timeout: return `{ success: false, error: { code: 503, message: "Orchestration service unavailable" } }`, log full error server-side
    - HTTP 5xx: return `{ success: false, error: { code: 502, message: "Orchestration service error" } }`, log details
  - [x] 1.6 Export orchestration client from services index
    - Add export to `gateway/src/services/index.ts`
  - [x] 1.7 Ensure Gateway configuration and client tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify config loads correctly with new property
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `ORCHESTRATION_SERVICE_BASE_URL` config property works with default value
- `executeOrchestration` function handles all response scenarios
- Timeout of 60 seconds is correctly applied
- Logging includes metadata without sensitive data

---

#### Task Group 2: Gateway Orchestration Route
**Dependencies:** Task Group 1

- [x] 2.0 Complete Gateway orchestration route
  - [x] 2.1 Write 4-6 focused tests for orchestration route
    - Test POST `/api/orchestrations/execute` returns 200 with success result on valid request
    - Test route returns 400 on empty activeProjectName
    - Test route returns 400 on empty handoff_intents array
    - Test route returns 400 on handoff_intent with empty intent field
    - Test route correctly transforms handoff_intents to feature_descriptions array
    - Test route hardcodes company to "Global"
  - [x] 2.2 Define orchestration route request/response types
    - Add to `gateway/src/types/chat.ts` or new `gateway/src/types/orchestration.ts`:
      - `ExecuteOrchestrationRequest`: `{ activeProjectName: string; featureId: string; featureTitle: string; handoff_intents: HandoffIntent[] }`
      - `ExecuteOrchestrationResponse`: `{ success: boolean; data?: unknown; error?: { code: number; message: string; details?: unknown } }`
    - Reuse existing `HandoffIntent` type from `gateway/src/types/chat.ts`
  - [x] 2.3 Create orchestrations route file
    - Create new file `gateway/src/routes/orchestrations.ts`
    - Import Router from express
    - Import `executeOrchestration` from services
    - Import `logger` from services
    - Import types
    - Export `orchestrationsRouter`
  - [x] 2.4 Implement input validation middleware/logic
    - Validate `activeProjectName` is non-empty string after trim
    - Validate `handoff_intents` is array with length >= 1
    - Validate each `handoff_intents[].intent` is non-empty after trim
    - Return 400 with descriptive error message on validation failure
    - Do NOT call external API on validation failure
  - [x] 2.5 Implement request transformation logic
    - Extract `intent` field from each handoff_intent to build `feature_descriptions[]`
    - Preserve order of intents
    - Trim each description
    - Construct external request: `{ company: "Global", project: activeProjectName, feature_descriptions }`
    - Log featureId and featureTitle for diagnostics (do not send to external API)
  - [x] 2.6 Implement route handler
    - POST `/execute` endpoint
    - Call `executeOrchestration` with constructed request
    - Return orchestration result to frontend
    - Log request/response metadata
  - [x] 2.7 Register route in main app
    - Update `gateway/src/routes/index.ts` to export `orchestrationsRouter`
    - Update `gateway/src/app.ts` (or main entry) to mount at `/api/orchestrations`
  - [x] 2.8 Ensure Gateway route tests pass
    - Run ONLY the 4-6 tests written in 2.1
    - Verify validation and transformation work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 2.1 pass
- Route validates all input constraints
- Transformation correctly maps handoff_intents to feature_descriptions
- Company is always hardcoded to "Global"
- Error responses are descriptive and consistent

---

### Frontend Layer

#### Task Group 3: Frontend API Client and UI Integration
**Dependencies:** Task Group 2

- [x] 3.0 Complete frontend API client and UI integration
  - [x] 3.1 Write 4-6 focused tests for frontend orchestration features
    - Test `executeOrchestration` API function sends correct request to Gateway
    - Test `executeOrchestration` API function handles success response
    - Test `executeOrchestration` API function handles error response
    - Test Execute button renders when handoffPlan is non-null
    - Test Execute button is disabled when isExecuting is true
    - Test success result displays with green styling
  - [x] 3.2 Create frontend orchestration API client
    - Create new file `frontend/src/api/orchestrationApi.ts`
    - Follow pattern from `frontend/src/api/chatApi.ts`
    - Define `ExecuteOrchestrationRequest` interface matching Gateway
    - Define `ExecuteOrchestrationResponse` interface matching Gateway
    - Export `executeOrchestration(request)` function
    - POST to `${GATEWAY_BASE}/api/orchestrations/execute`
  - [x] 3.3 Add execution state to ImplementationAssistantPanel
    - Add `isExecuting` state (boolean, initial: false)
    - Add `executionResult` state: `{ success: boolean; data?: unknown; error?: string } | null`
    - Add to `ImplementChatUiState` in `ProductUiStateContext.tsx` for persistence
    - Update `areChatStatesEquivalent` to compare new fields
  - [x] 3.4 Implement Execute button in UI
    - Add Execute button after handoffPlanPanel section
    - Visible only when `handoffPlan` is non-null
    - Styled with orange/amber color to differentiate from Implement button
    - Button text: "Execute"
    - Disabled when `isExecuting` is true
    - Add `data-testid="execute-button"`
  - [x] 3.5 Implement handleExecute callback
    - Create `handleExecute` callback with useCallback
    - Set `isExecuting` to true at start
    - Call `executeOrchestration` with:
      - `activeProjectName`: from `projectId` prop
      - `featureId`: from `workItemId` prop
      - `featureTitle`: from `workItemTitle` prop
      - `handoff_intents`: from `handoffPlan.handoff_intents`
    - On success: set `executionResult` with success data
    - On error: set `executionResult` with error message, preserve handoffPlan
    - Set `isExecuting` to false in finally block
  - [x] 3.6 Add execution result display panel
    - Display below handoff plan panel
    - On success: green-styled panel with heading "Execution Successful"
    - Include JSON viewer component for `executionResult.data` (use `<pre>` with formatted JSON)
    - On failure: red-styled error message panel
    - Error panel shows `executionResult.error` message
    - Follow existing error styling conventions (`.errorMessage` pattern)
  - [x] 3.7 Add CSS styles for Execute button and result panels
    - Add `.executeButton` class with orange/amber styling (`#ff9800` or similar)
    - Add `.executeButton:hover:not(:disabled)` hover state
    - Add `.executeButton:disabled` disabled state
    - Add `.executionResultPanel` with green accent (similar to `.specsPanel`)
    - Add `.executionResultPanelHeader` with success indicator
    - Add `.executionErrorPanel` with red accent (similar to `.errorMessage`)
    - Add `.jsonViewer` for formatted JSON display
  - [x] 3.8 Ensure frontend tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify API client and UI integration work correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- Execute button appears only when handoffPlan exists
- Button is properly disabled during execution
- Success result displays with green styling and JSON viewer
- Failure result displays with red styling and preserves handoffPlan for retry
- Execution state persists across tab switches

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Gateway engineer (Task 1.1)
    - Review the 4-6 tests written by Gateway route engineer (Task 2.1)
    - Review the 4-6 tests written by Frontend engineer (Task 3.1)
    - Total existing tests: approximately 12-18 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on gaps related to orchestration execution feature
    - Prioritize integration points between Gateway and Frontend
    - Check for missing error boundary scenarios
  - [x] 4.3 Write up to 8 additional strategic tests maximum
    - Add end-to-end test: full flow from Execute button click to result display
    - Add integration test: Gateway route calls orchestrationClient correctly
    - Add test: 60-second timeout behavior verification
    - Add test: Retry after failure preserves handoffPlan state
    - Add test: Context persistence of executionResult across tab switches
    - Skip edge cases, performance tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, and 4.3)
    - Expected total: approximately 20-26 tests maximum
    - Do NOT run the entire application test suite
    - Verify critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests total)
- End-to-end workflow from UI to external API is covered
- Error handling scenarios are tested
- No more than 8 additional tests added when filling in gaps
- Testing focused exclusively on orchestration execution feature

---

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Gateway Configuration and Orchestration Client** - Foundation for external API communication
2. **Task Group 2: Gateway Orchestration Route** - Exposes functionality to frontend
3. **Task Group 3: Frontend API Client and UI Integration** - User-facing implementation
4. **Task Group 4: Test Review and Gap Analysis** - Final validation and coverage

---

## Key Files to Create/Modify

### New Files
| File Path | Description |
|-----------|-------------|
| `gateway/src/services/orchestrationClient.ts` | HTTP client for Orchestration Service API |
| `gateway/src/routes/orchestrations.ts` | Gateway route for `/api/orchestrations/execute` |
| `frontend/src/api/orchestrationApi.ts` | Frontend API client for Gateway orchestrations route |

### Modified Files
| File Path | Changes |
|-----------|---------|
| `gateway/src/config.ts` | Add `orchestrationServiceBaseUrl` config property |
| `gateway/src/services/index.ts` | Export orchestration client |
| `gateway/src/routes/index.ts` | Export orchestrations router |
| `gateway/src/app.ts` | Mount orchestrations router at `/api/orchestrations` |
| `gateway/src/types/chat.ts` or new types file | Add orchestration request/response types |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add Execute button, execution state, result display |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` | Add styles for Execute button and result panels |
| `frontend/src/contexts/ProductUiStateContext.tsx` | Add executionResult to ImplementChatUiState |

---

## Reference Patterns

### Gateway HTTP Client Pattern
Follow `gateway/src/services/architectureModelClient.ts`:
- Use `getConfig()` for configuration
- Use `fetch()` with appropriate headers
- Structured error handling with logging
- Type assertions for response data

### Gateway Route Pattern
Follow `gateway/src/routes/chat.ts`:
- Use Express Router
- Middleware for validation
- Async route handlers with try/catch
- Consistent error response format

### Frontend API Client Pattern
Follow `frontend/src/api/chatApi.ts`:
- Use `GATEWAY_BASE` from environment
- Export interface definitions with function
- Use `fetch()` with JSON body
- Throw Error on non-ok response

### UI State Management Pattern
Follow existing `handoffPlan` state in `ImplementationAssistantPanel.tsx`:
- useState for local state
- Persist to ProductUiStateContext
- Hydrate from context on mount
- Debounce persistence to avoid loops

---

## Out of Scope (Per Spec)

- Job status polling or progress tracking after execution
- Persistence of orchestration results beyond UI session state
- Changes to handoff plan generation logic or LLM prompts
- Sub-intent level status tracking (all-or-nothing execution)
- Retry logic with exponential backoff
- Queue management or batch execution
- Authentication/authorization for orchestration service calls
- Changes to architecture meta-model or diagram features
- Orchestration result history or audit log
- Cancellation of in-flight orchestration requests
