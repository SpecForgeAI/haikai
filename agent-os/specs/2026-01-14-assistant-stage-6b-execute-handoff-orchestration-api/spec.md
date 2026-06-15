# Specification: Implement Assistant Stage 6b - Execute Handoff by Calling External Orchestration API

## Goal
Enable users to execute implementation of their handoff plan by calling an external Orchestration Service API, transforming handoff intents into feature descriptions and displaying execution results.

## User Stories
- As a product owner, I want to execute implementation after reviewing my handoff plan so that the external orchestration service can begin building my feature
- As a developer, I want clear success/failure feedback after triggering execution so that I know if the orchestration request was accepted

## Specific Requirements

**Gateway Configuration for Orchestration Service**
- Add `ORCHESTRATION_SERVICE_BASE_URL` environment variable to Config interface and loadConfig()
- Default value should be `http://localhost:8085`
- Full endpoint path is constructed as: `{ORCHESTRATION_SERVICE_BASE_URL}/api/v1/orchestrations`
- Follow existing pattern in `gateway/src/config.ts` for `architectureModelServiceBaseUrl`
- No environment validation required (optional service, fails gracefully if unavailable)

**Orchestration Client Module (orchestrationClient.ts)**
- Create new file at `gateway/src/services/orchestrationClient.ts`
- Export async function `executeOrchestration(request: OrchestrationRequest): Promise<OrchestrationResult>`
- Define `OrchestrationRequest` interface: `{ company: string; project: string; feature_descriptions: string[] }`
- Define `OrchestrationResult` interface: `{ success: boolean; data?: unknown; error?: { code: number; message: string; details?: unknown } }`
- Use `getConfig()` to retrieve base URL; construct POST request with JSON body
- Apply 60-second timeout using AbortController (orchestration may take time)
- Log request metadata (project name, feature_descriptions count, URL) without logging full descriptions
- Return structured result for both success (200) and failure (422, network, 5xx) cases

**Gateway Route POST /api/orchestrations/execute**
- Create new route in `gateway/src/routes/orchestrations.ts` or extend existing routes
- Accept request body: `{ activeProjectName: string; featureId: string; featureTitle: string; handoff_intents: HandoffIntent[] }`
- Validate input: activeProjectName non-empty, handoff_intents.length >= 1, each intent.intent field non-empty after trim
- On validation failure, return 400 with descriptive error message without calling external API
- Transform handoff_intents array: extract `intent` field from each to build `feature_descriptions: string[]`
- Construct external request: `{ company: "Global", project: activeProjectName, feature_descriptions }`
- Call orchestrationClient and return result to frontend

**Input Transformation and Validation**
- Map `handoff_intents[].intent` to `feature_descriptions[]` preserving order
- Trim each description; reject if any becomes empty string
- Log featureId and featureTitle for diagnostics but do not send to external API
- company is always hardcoded to `"Global"` as per requirements
- Never send conversation history or full handoff plan metadata to orchestration service

**Error Handling Strategy**
- HTTP 200 from external API: return `{ success: true, data: responseBody }` to frontend
- HTTP 422 from external API: return `{ success: false, error: { code: 422, message: "Validation error", details: responseBody } }`
- Network/timeout errors: return `{ success: false, error: { code: 503, message: "Orchestration service unavailable" } }` and log full error server-side
- HTTP 5xx from external API: return `{ success: false, error: { code: 502, message: "Orchestration service error" } }` and log details

**Frontend Execute Button and Trigger**
- Add "Execute" button in ImplementationAssistantPanel, visible only when `handoffPlan` state is non-null
- Button styled distinctly (e.g., orange/amber) to differentiate from Implement button
- Button disabled while execution is in progress (add `isExecuting` state)
- On click, call new API function `executeOrchestration(request)` in `frontend/src/api/orchestrationApi.ts`
- Pass: activeProjectName (from projectId prop), featureId/featureTitle (from workItem), handoffPlan.handoff_intents

**Frontend Orchestration API Client**
- Create `frontend/src/api/orchestrationApi.ts` with `executeOrchestration(request: ExecuteOrchestrationRequest): Promise<ExecuteOrchestrationResponse>`
- Request interface: `{ activeProjectName: string; featureId: string; featureTitle: string; handoff_intents: HandoffIntent[] }`
- Response interface: `{ success: boolean; data?: unknown; error?: { code: number; message: string; details?: unknown } }`
- POST to `${GATEWAY_BASE}/api/orchestrations/execute`

**Success/Failure Display in UI**
- On success: display compact result panel below handoff plan with green styling; show JSON viewer for response data if structured
- On failure: display error message inline with red styling; preserve handoff plan state so user can retry
- Add `executionResult` state to ImplementationAssistantPanel: `{ success: boolean; data?: unknown; error?: string } | null`
- Persist executionResult to ProductUiStateContext alongside handoffPlan

## Visual Design
No visual mockups provided. Follow existing design patterns from:
- Handoff Plan Panel (purple/indigo accent in `ImplementationAssistantPanel.module.css`)
- Specs Panel (green accent for success states)
- Error styling conventions (red accent from `.errorMessage` class)

## Existing Code to Leverage

**gateway/src/services/architectureModelClient.ts**
- Pattern for HTTP client module structure (getConfig, fetch, error handling, logging)
- Use same approach for response type assertions and null/error returns
- Replicate timeout handling pattern if applicable (though architectureModelClient uses default fetch timeout)

**gateway/src/config.ts**
- Add new config property following `architectureModelServiceBaseUrl` pattern
- Use parseIntEnv helper for timeout if adding configurable timeout
- No validation required for optional external service URLs

**gateway/src/types/chat.ts - HandoffIntent interface**
- Reuse HandoffIntent type definition when accepting handoff_intents in request body
- Import from types/chat.ts or define compatible interface in route types

**frontend/src/api/chatApi.ts**
- Pattern for API client function structure (GATEWAY_BASE, fetch, response typing)
- Export interface definitions alongside function
- Throw Error on non-ok response for consistent error handling

**frontend/src/components/ProductView/ImplementationAssistantPanel.tsx**
- Existing handoffPlan state and panel rendering logic
- Add Execute button in new section after handoffPlanPanel
- Follow state management pattern (useState, useCallback, isPersisting ref)

## Out of Scope
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
