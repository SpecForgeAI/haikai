# Task Breakdown: UX Designer User Journey Save Pipeline

## Overview
Total Tasks: 40 (across 5 task groups)

This spec implements the `save_user_journeys` MCP tool and wires it into the existing generate/save-artifact two-step flow for the UX Designer "Define User Journeys" task. The pipeline follows the GET-merge-PUT pattern: fetch the full model JSON, merge user_journeys and activity_steps arrays, PUT the whole model back.

**Key constraint:** No changes are needed to `architecture-model-service` -- the DB schema, JPA entities, repositories, and `PUT /api/model` endpoint already support `user_journeys` and `activity_steps` arrays (implemented in Increment 1).

## File Map

**New files (3):**
- `mcp-server/src/types/saveUserJourneys.ts`
- `mcp-server/src/services/userJourneysService.ts`
- `mcp-server/src/routes/saveUserJourneysRoute.ts`

**Modified files (7):**
- `gateway/src/types/tools.ts`
- `gateway/src/services/toolExecutor.ts`
- `mcp-server/src/routes/tools.ts`
- `gateway/src/services/promptBuilder.ts`
- `gateway/src/routes/chatV2.ts`
- `gateway/src/config/tasks/ux-designer--users-interactions.json`
- `gateway/src/config/prompts/ux-designer.users-interactions.task.md`

## Task List

### MCP Server Layer (Types, Service, Route)

#### Task Group 1: TypeScript Types for save_user_journeys
**Dependencies:** None

- [x] 1.0 Complete type definitions for save_user_journeys
  - [x] 1.1 Create `mcp-server/src/types/saveUserJourneys.ts` with all interfaces
    - Follow the pattern from `mcp-server/src/types/saveUsersInteractions.ts`
    - `SaveUserJourneysRequest` interface: `sessionId: string`, `projectId: string`, `userJourneysJson: string`
    - `UserJourneysInput` interface: `user_journeys: UserJourneyInput[]`, `activity_steps?: ActivityStepInput[]`
    - `UserJourneyInput` interface: `name: string`, `description?: string`, `primary_business_user_name?: string`, `parent_business_process_name?: string`
    - `ActivityStepInput` interface: `user_journey_name: string`, `process_activity_name: string`, `business_user_name: string`, `application_name: string`, `sequence_order?: number`, `description?: string`
    - `SaveUserJourneysResponse` interface with `success`, `projectId`, `filename`, `summary` (created/updated counts per entity type), `entities` (per-entity arrays with name, id, and CREATED/UPDATED status)
    - Error response type: `{ success: false, errors: Array<{ type: string, message: string, context: string }> }`
  - [x] 1.2 Export the new types from `mcp-server/src/types/index.ts` (if barrel file exists) or verify they are importable

**Acceptance Criteria:**
- All interfaces compile without errors
- Types match the input/output schema defined in the spec (name-based FK references, no `activity_related_issues` or `ui_related_issues`)
- Response type includes per-entity CREATED/UPDATED status tracking

---

#### Task Group 2: MCP Service -- Core Business Logic
**Dependencies:** Task Group 1

- [x] 2.0 Complete the userJourneysService.ts service
  - [x] 2.1 Write 6-8 focused unit tests for the service
    - Test file: `mcp-server/src/__tests__/userJourneysService.test.ts` (or appropriate test directory)
    - Mock `archModelClient.getProjectById`, `archModelClient.getModel`, `archModelClient.putModel`
    - Test: `parseAndValidate` accepts valid input with user_journeys and activity_steps
    - Test: `parseAndValidate` rejects empty user_journeys array
    - Test: `parseAndValidate` rejects activity_step with missing required fields (user_journey_name, process_activity_name, business_user_name, application_name)
    - Test: `parseAndValidate` rejects duplicate sequence_order within same user_journey_name
    - Test: Name-to-ID resolution succeeds when all references exist in the model
    - Test: Name-to-ID resolution rejects payload when a required FK reference is not found (e.g., unknown business_user_name)
    - Test: Upsert -- new journey gets CREATED status with generated `uj-` prefixed ID; existing journey (same name) gets UPDATED status with preserved ID
    - Test: Idempotent re-run produces all UPDATED statuses with no new IDs
  - [x] 2.2 Create `mcp-server/src/services/userJourneysService.ts`
    - Follow the structural pattern of `mcp-server/src/services/usersInteractionsService.ts`
    - Import `generateId` from `../utils/generateId`, types from `../types/saveUserJourneys`, `archModelClient`, `createHttpError`
  - [x] 2.3 Implement `parseAndValidate(userJourneysJson: string)` function
    - Parse JSON string, return errors array if malformed
    - Validate `user_journeys` array exists and is non-empty
    - Validate each user_journey has non-empty `name`
    - Validate each activity_step has non-empty `user_journey_name`, `process_activity_name`, `business_user_name`, `application_name`
    - Validate `sequence_order` is a positive integer when present
    - Reject duplicate `sequence_order` within the same `user_journey_name`
    - Validate every activity_step's `user_journey_name` references a journey in the payload's `user_journeys` array
    - Collect ALL errors (not just the first) before returning
  - [x] 2.4 Implement name-to-ID resolution logic within `saveUserJourneys()` orchestrator
    - After fetching model via `archModelClient.getModel(filename)`, resolve:
      - `user_journeys[].primary_business_user_name` against `metaModel.entities.business_users[].name` (optional -- null/empty yields null ID)
      - `user_journeys[].parent_business_process_name` against `metaModel.entities.business_processes[].name` (optional -- null/empty yields null ID)
      - `activity_steps[].user_journey_name` against both the incoming payload's user_journeys AND existing `metaModel.entities.user_journeys[].name`
      - `activity_steps[].process_activity_name` against `metaModel.entities.process_activities[].name`
      - `activity_steps[].business_user_name` against `metaModel.entities.business_users[].name`
      - `activity_steps[].application_name` against `metaModel.entities.applications[].name`
    - If any required FK reference cannot be resolved, collect error and reject entire payload (all-or-nothing)
    - Use case-insensitive or exact matching consistent with existing `save_users_interactions` behavior
  - [x] 2.5 Implement upsert/deduplication logic with CREATED/UPDATED reporting
    - USER_JOURNEY upsert key: `name` matched against existing `metaModel.entities.user_journeys[]`
      - Match found: preserve existing `id`, update all other fields, status = UPDATED
      - No match: generate new ID via `generateId('uj-')`, status = CREATED
    - ACTIVITY_STEP upsert key: `(user_journey_id, sequence_order)` matched against existing `metaModel.entities.activity_steps[]`
      - Match found: preserve existing `id`, update all other fields, status = UPDATED
      - No match: generate new ID via `generateId('as-')`, status = CREATED
    - Derive `name` field for activity_steps from `process_activity_name` or `description`
  - [x] 2.6 Implement the `saveUserJourneys(projectId, userJourneysJson)` orchestrator function
    - Step 1: Look up project via `archModelClient.getProjectById(projectId)` to get filename
    - Step 2: Call `parseAndValidate(userJourneysJson)` -- reject if errors
    - Step 3: GET existing model via `archModelClient.getModel(filename)`
    - Step 4: Resolve all name-based references to IDs (call resolution logic from 2.4)
    - Step 5: Validate all FK references exist (all-or-nothing -- reject entire payload if any fail)
    - Step 6: Perform upsert with dedup (call upsert logic from 2.5)
    - Step 7: Merge upserted `user_journeys` and `activity_steps` arrays into the model JSON, preserving all other entity arrays
    - Step 8: PUT model via `archModelClient.putModel(filename, mergedModel)`
    - Step 9: Return structured `SaveUserJourneysResponse` with per-entity status
    - Use `ensureArray()` pattern and `createEmptyModelShell()` for safe model initialization (following usersInteractionsService.ts)
  - [x] 2.7 Ensure service unit tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify parse/validate, name resolution, upsert, and orchestrator logic

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- `parseAndValidate` catches all structural/schema errors and collects them
- Name-to-ID resolution correctly resolves all 6 FK reference types
- Upsert correctly distinguishes CREATED vs UPDATED for both entity types
- Re-running the same payload is idempotent (all UPDATED, no new IDs, no duplicates)
- All-or-nothing: a single invalid FK reference prevents any entities from being persisted
- Error responses contain all validation errors, not just the first

---

#### Task Group 3: MCP Route and Tool Registration
**Dependencies:** Task Group 2

- [x] 3.0 Complete route handler and wire up tool across gateway and mcp-server
  - [x] 3.1 Write 3-4 focused tests for route validation and tool registration
    - Test: Route rejects request with missing/empty sessionId (400)
    - Test: Route rejects request with invalid projectId (non-UUID) (400)
    - Test: Route rejects request with missing/empty userJourneysJson (400)
    - Test: Tool definition `save_user_journeys` exists in `TOOL_DEFINITIONS` with correct required params
  - [x] 3.2 Create `mcp-server/src/routes/saveUserJourneysRoute.ts`
    - Follow the exact pattern of `mcp-server/src/routes/saveUsersInteractionsRoute.ts`
    - Express Router with `POST /` handler
    - Extract `sessionId`, `projectId`, `userJourneysJson` from `req.body`
    - Validate: `sessionId` is non-empty string, `projectId` matches UUID v4 regex, `userJourneysJson` is non-empty string
    - Call `getOrCreateSession(sessionId)`
    - Call `saveUserJourneys(projectId, userJourneysJson)` from the service
    - Handle errors: 400 for validation (pass through JSON-parsed errors), 502 for upstream failures
  - [x] 3.3 Mount the route in `mcp-server/src/routes/tools.ts`
    - Import `saveUserJourneysRouter` from `'./saveUserJourneysRoute'`
    - Add `toolsRouter.use('/save_user_journeys', saveUserJourneysRouter)`
  - [x] 3.4 Register the tool in `gateway/src/types/tools.ts`
    - Add `'save_user_journeys'` to the `ToolName` union type
    - Add `'save_user_journeys'` to the `ALLOWED_TOOL_NAMES` array
    - Add `SaveUserJourneysParams` interface: `{ projectId: string; userJourneysJson: string }`
    - Add `SaveUserJourneysParams` to the `ToolParams` union type
    - Add a `ToolDefinition` entry to `TOOL_DEFINITIONS` array with `name: 'save_user_journeys'`, description, and `required: ['projectId', 'userJourneysJson']`
  - [x] 3.5 Register the tool in `gateway/src/services/toolExecutor.ts`
    - Import `SaveUserJourneysParams` from `'../types'`
    - Add endpoint mapping: `save_user_journeys: '/mcp/tools/save_user_journeys'` to `TOOL_ENDPOINTS`
    - Add required params: `save_user_journeys: ['projectId', 'userJourneysJson']` to `TOOL_REQUIRED_PARAMS`
  - [x] 3.6 Ensure route and registration tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify route validation rejects bad inputs
    - Verify tool is discoverable in TOOL_DEFINITIONS

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Route correctly validates all three input fields and returns 400 for invalid requests
- Route delegates to the service and returns structured success/error responses
- Tool is registered in the gateway's ToolName union, TOOL_DEFINITIONS, TOOL_ENDPOINTS, and TOOL_REQUIRED_PARAMS
- Tool is mounted in the MCP server's tools router at `/save_user_journeys`

---

### Gateway Layer (Generate/Save-Artifact Flow)

#### Task Group 4: Generation Prompt Template and chatV2 Adapter Branches
**Dependencies:** Task Group 3

- [x] 4.0 Complete the generate/save-artifact flow and prompt/config changes
  - [x] 4.1 Write 4-6 focused tests for the generate and save-artifact adapters
    - Test: `/generate` with artifactType `'user-journeys'` calls LLM with the correct prompt template and returns parsed JSON
    - Test: `/generate` with artifactType `'user-journeys'` retries once on JSON parse failure
    - Test: `/save-artifact` with artifactType `'user-journeys'` calls `executeToolCall` with `'save_user_journeys'` and correct params
    - Test: `/save-artifact` with artifactType `'user-journeys'` sets `completionArtifactId = 'user-journeys'` and `completionArtifactName = 'USER_JOURNEYS'`
    - Test: Existing `'users-interactions'` artifactType still routes correctly (regression)
    - (Optional) Test: Task config artifact entry is correctly read and produces artifactType `'user-journeys'`
  - [x] 4.2 Add `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` to `gateway/src/services/promptBuilder.ts`
    - Follow the structure of `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE` (line ~710)
    - Include `{conversationTranscript}` placeholder
    - TARGET SCHEMA section: `{ user_journeys: [...], activity_steps: [...] }` with name-based FK references
    - FIELD REFERENCE section documenting all fields:
      - `user_journeys[].name` (required), `.description` (optional), `.primary_business_user_name` (optional), `.parent_business_process_name` (optional)
      - `activity_steps[].user_journey_name` (required), `.process_activity_name` (required), `.business_user_name` (required), `.application_name` (required), `.sequence_order` (optional), `.description` (optional)
    - EXTRACTION RULES section: extract ALL user journeys and activity steps from the conversation, do not fabricate entities, name fields are required, `user_journey_name` in activity_steps must reference a journey in the output, do NOT include `activity_related_issues` or `ui_related_issues`
    - OUTPUT FORMAT section: return ONLY valid JSON, no markdown/prose/code blocks
  - [x] 4.3 Add `/generate` branch for artifactType `'user-journeys'` in `gateway/src/routes/chatV2.ts`
    - Follow the exact pattern of the `artifactType === 'users-interactions'` branch (lines ~1688-1769)
    - Filter task messages from thread by taskId, map to OpenAI messages
    - Build conversation transcript via `buildConversationTranscript(taskMessages)`
    - Populate `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` with transcript
    - Call LLM with `jsonMode: true`, `temperature: 0.2`, `maxTokens: 16000`
    - Parse result as JSON object; retry once on parse failure with corrective prompt asking for `user_journeys` and `activity_steps` arrays
    - Return `{ success: true, artifactContent: JSON.stringify(parsedJson) }` or `{ success: false, error }`
    - Add the branch AFTER the existing `'users-interactions'` branch and BEFORE the `'backlog'` branch
  - [x] 4.4 Add `/save-artifact` branch for artifactType `'user-journeys'` in `gateway/src/routes/chatV2.ts`
    - Follow the exact pattern of the `artifactType === 'users-interactions'` branch (lines ~2183-2196)
    - Call `executeToolCall(uuidv4(), 'save_user_journeys', { projectId, userJourneysJson: content }, mcpSessionId, requestId, 'v2-save-' + threadKeyStr)`
    - Set `completionContent = 'User journeys and activity steps saved to architecture.'`
    - Set `completionArtifactId = 'user-journeys'`
    - Set `completionArtifactName = 'USER_JOURNEYS'`
    - Add the branch AFTER the existing `'users-interactions'` branch and BEFORE the `'backlog'` branch
  - [x] 4.5 Update task config: `gateway/src/config/tasks/ux-designer--users-interactions.json`
    - Change `"artifacts": []` to `"artifacts": [{ "artifactId": "user-journeys", "tool": "save_user_journeys", "description": "User journeys and activity steps", "filename": "USER_JOURNEYS" }]`
  - [x] 4.6 Update UX Designer prompt: `gateway/src/config/prompts/ux-designer.users-interactions.task.md`
    - In the PROHIBITIONS section, REMOVE these three lines:
      - `Do NOT call any MCP save tools -- this conversation is for ingestion and validation only, not persistence`
      - `Do NOT ask the user to confirm or save -- there is no artifact flow in this task; the conversation ends with the summary`
    - ADD a new section `## SAVE CONFIRMATION` after the `## FINAL SUMMARY OUTPUT` section and before `## PROHIBITIONS`
    - The new section instructs the LLM to:
      - After presenting the final summary, ask the user in natural language whether they want to save the user journeys and activity steps to the architecture model
      - Example phrasing: "Would you like me to save these user journeys and activity steps to the architecture model?"
      - The LLM must NOT format or produce JSON payloads
      - The LLM must NOT call tools directly
      - On user confirmation, the frontend handles the save automatically
    - Keep remaining prohibitions intact (no diagram JSON, no mermaid/PlantUML, no structured-questions format)
  - [x] 4.7 Ensure adapter and config tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify generate branch produces valid JSON extraction
    - Verify save-artifact branch routes to the correct tool
    - Verify existing users-interactions flow is not broken

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- `/generate` with artifactType `'user-journeys'` extracts `{user_journeys, activity_steps}` JSON from conversation via the new prompt template
- `/save-artifact` with artifactType `'user-journeys'` routes to `save_user_journeys` MCP tool with correct params
- Task config has the artifact entry enabling the frontend generate/save buttons
- UX Designer prompt asks for save confirmation in natural language without producing JSON or calling tools
- Existing `'users-interactions'` generate and save-artifact branches are unaffected

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 6-8 service tests from Task Group 2 (2.1)
    - Review the 3-4 route/registration tests from Task Group 3 (3.1)
    - Review the 4-6 adapter/config tests from Task Group 4 (4.1)
    - Total existing tests: approximately 13-18 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritize integration points: generate -> save-artifact -> MCP tool -> model persistence
    - Do NOT assess entire application test coverage
  - [x] 5.3 Write up to 10 additional strategic tests maximum to fill identified gaps
    - Potential gap: All-or-nothing rejection -- one invalid FK reference causes zero entities persisted AND error response contains all validation errors
    - Potential gap: Activity step upsert by `(user_journey_id, sequence_order)` composite key -- verify match and non-match
    - Potential gap: Optional fields (`primary_business_user_name`, `parent_business_process_name`) being null/empty result in null IDs (not rejection)
    - Potential gap: Merge preserves all existing entity arrays that are NOT user_journeys or activity_steps
    - Potential gap: Error response for upstream model PUT failure returns 502
    - Potential gap: Regression -- existing `save_users_interactions` tool continues to work independently
    - Potential gap: Activity step `name` field derivation from process_activity_name or description
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 23-28 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 23-28 tests total)
- Critical user workflows for this feature are covered: parse -> validate -> resolve -> upsert -> merge -> persist -> respond
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Existing save_users_interactions flow is confirmed unaffected by regression test

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: TypeScript Types** -- No dependencies. Creates the type foundation that both service and route depend on.
2. **Task Group 2: MCP Service** -- Depends on types. Implements the core business logic (parse, validate, resolve, upsert, merge, persist). This is the most complex group.
3. **Task Group 3: MCP Route and Tool Registration** -- Depends on service. Wires the service into the Express route and registers the tool across gateway and mcp-server.
4. **Task Group 4: Gateway Adapters and Config** -- Depends on tool registration. Adds the generate/save-artifact adapter branches, prompt template, task config, and prompt modifications. Completes the end-to-end flow.
5. **Task Group 5: Test Review and Gap Analysis** -- Depends on all other groups. Reviews coverage, fills critical gaps, runs all feature tests.

```
Task Group 1 (Types)
    |
    v
Task Group 2 (Service Logic)
    |
    v
Task Group 3 (Route + Registration)
    |
    v
Task Group 4 (Gateway Adapters + Config)
    |
    v
Task Group 5 (Test Review + Gap Analysis)
```

## Key Implementation Notes

- **Pattern to follow:** `usersInteractionsService.ts` is the closest existing pattern, but the new service extends it with name-to-ID resolution (not present in the foundation tool) and upsert semantics (the foundation tool skips existing names rather than updating them).
- **Merge safety:** The PUT /api/model endpoint performs a full model replace, so the merge must preserve all existing entity arrays that are not being modified (use deep-copy of existing model as base).
- **No frontend UI changes:** The existing generate/save-artifact frontend infrastructure already handles the flow. Adding the artifact entry to the task config enables the save buttons automatically.
- **No architecture-model-service changes:** All DB schema, JPA entities, repositories, and the ModelService saveAll logic for user_journeys and activity_steps already exist from Increment 1.
