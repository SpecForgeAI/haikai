# Specification: UX Designer User Journey Save Pipeline

## Goal
Enable the UX Designer "Define User Journeys" task to persist USER_JOURNEY and ACTIVITY_STEP entities via a deterministic MCP save pipeline, completing the loop from spreadsheet ingestion through LLM interpretation to persisted meta-model data.

## User Stories
- As a UX Designer, I want to save the user journeys and activity steps I defined during the spreadsheet ingestion conversation so that they become authoritative architecture data in the meta-model.
- As a UX Designer, I want clear feedback on what was created vs. updated and immediate notification of any validation errors so that I can correct issues before re-saving.

## Specific Requirements

**New MCP tool: save_user_journeys**
- Create a new MCP tool named `save_user_journeys` that accepts `sessionId`, `projectId`, and `userJourneysJson` (a JSON string containing `{ user_journeys, activity_steps }` arrays)
- The tool follows the GET-merge-PUT pattern: fetch the full model JSON via `archModelClient.getModel()`, merge user_journeys and activity_steps arrays into the model, then PUT the whole model back via `archModelClient.putModel()`
- Input schema uses human-readable names for all FK references (not IDs); name-to-ID resolution happens in the service layer
- `activity_related_issues` and `ui_related_issues` fields are excluded from the input schema to match the actual DB/entity schema
- The tool returns a structured response with `success`, `projectId`, `filename`, per-entity `summary` (created/updated counts), and `entities` (with name, id, and CREATED/UPDATED status per item)
- Error responses return `{ success: false, errors: [{ type, message, context }] }` with all validation errors collected (not just the first)

**Name-to-ID resolution in MCP service (TypeScript)**
- All name-based reference lookups happen in `userJourneysService.ts` using the model JSON fetched via `archModelClient.getModel()`
- `user_journeys[].primary_business_user_name` resolves against `metaModel.entities.business_users[].name`
- `user_journeys[].parent_business_process_name` resolves against `metaModel.entities.business_processes[].name`
- `activity_steps[].user_journey_name` resolves against both the incoming payload's user_journeys AND existing model user_journeys
- `activity_steps[].process_activity_name` resolves against `metaModel.entities.process_activities[].name`
- `activity_steps[].business_user_name` resolves against `metaModel.entities.business_users[].name`
- `activity_steps[].application_name` resolves against `metaModel.entities.applications[].name`
- Name matching must be consistent with existing `save_users_interactions` behavior; if a referenced name is not found and the field is required, the entire payload is rejected

**Upsert/deduplication behavior with CREATED/UPDATED reporting**
- USER_JOURNEY upsert key: `name` matched against existing `metaModel.entities.user_journeys[]`; if match found, preserve existing `id` and update all other fields (status: UPDATED); if no match, generate new ID with `uj-` prefix via `generateId('uj-')` (status: CREATED)
- ACTIVITY_STEP upsert key: `(user_journey_id, sequence_order)` matched against existing `metaModel.entities.activity_steps[]`; if match found, preserve existing `id` and update all other fields (status: UPDATED); if no match, generate new ID with `as-` prefix via `generateId('as-')` (status: CREATED)
- Re-running the same payload must be idempotent: all statuses become UPDATED, no new IDs are generated, no duplicates are created
- The `name` field for activity_steps should be derived from the process_activity_name or description

**All-or-nothing atomic validation**
- Phase 1 (route layer): validate `sessionId` is non-empty string, `projectId` is valid UUID v4, `userJourneysJson` is non-empty string that parses as valid JSON
- Phase 2 (service layer, after JSON parse): `user_journeys` array must exist and be non-empty; each user_journey must have non-empty `name`; each activity_step must have non-empty `user_journey_name`, `process_activity_name`, `business_user_name`, `application_name`; `sequence_order` must be a positive integer when present; no duplicate `sequence_order` within the same `user_journey_name`; every activity_step's `user_journey_name` must reference a journey in the payload
- Phase 3 (service layer, after model fetch): all required FK name references must resolve to existing entities in the model; optional fields (`primary_business_user_name`, `parent_business_process_name`) can be null/empty and result in null IDs
- If ANY validation error is found in any phase, the entire payload is rejected, no entities are persisted, and all errors are collected and returned

**Generate/save-artifact two-step conversation flow**
- Uses the existing frontend flow: `/generate` endpoint extracts structured JSON from the conversation transcript via a new generation prompt template, then `/save-artifact` routes the JSON to the new MCP tool via a new artifactType `'user-journeys'`
- The LLM asks for save confirmation in natural language only (e.g., "Would you like me to save these user journeys and activity steps to the architecture model?"); the LLM must NOT format or produce JSON payloads and must NOT call tools directly
- On user confirmation, the frontend calls POST `/api/chat/v2/generate` with `artifactType: 'user-journeys'`, which uses `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` to extract `{ user_journeys, activity_steps }` from the conversation transcript
- The frontend then calls POST `/api/chat/v2/save-artifact` with `artifactType: 'user-journeys'` and the generated JSON content, which routes to `executeToolCall('save_user_journeys', { projectId, userJourneysJson: content })`
- The LLM receives and presents the save result: created/updated counts per entity type, or validation errors with suggested corrective actions

**New files to create in mcp-server**
- `mcp-server/src/routes/saveUserJourneysRoute.ts`: Express route handler following the pattern of `saveUsersInteractionsRoute.ts` -- validates sessionId, projectId, userJourneysJson, calls service, handles error responses (400 for validation, 502 for upstream)
- `mcp-server/src/services/userJourneysService.ts`: Core business logic -- `parseAndValidate()` for input structure, `saveUserJourneys()` orchestrator that performs project lookup, parse/validate, GET model, resolve names to IDs, validate FK references, upsert with dedup, merge into model, PUT model, return structured response
- `mcp-server/src/types/saveUserJourneys.ts`: TypeScript interfaces for `SaveUserJourneysRequest`, `UserJourneysInput`, `UserJourneyInput`, `ActivityStepInput`, and `SaveUserJourneysResponse` (with per-entity status arrays)

**Gateway tool registration files to modify**
- `gateway/src/types/tools.ts`: Add `'save_user_journeys'` to `ToolName` union and `ALLOWED_TOOL_NAMES` array; add `SaveUserJourneysParams` interface with `projectId: string` and `userJourneysJson: string`; add to `ToolParams` union; add `ToolDefinition` entry to `TOOL_DEFINITIONS` array with `required: ['projectId', 'userJourneysJson']`
- `gateway/src/services/toolExecutor.ts`: Import `SaveUserJourneysParams`; add endpoint mapping `save_user_journeys: '/mcp/tools/save_user_journeys'` to `TOOL_ENDPOINTS`; add required params `save_user_journeys: ['projectId', 'userJourneysJson']` to `TOOL_REQUIRED_PARAMS`
- `mcp-server/src/routes/tools.ts`: Import `saveUserJourneysRouter` from `'./saveUserJourneysRoute'` and mount with `toolsRouter.use('/save_user_journeys', saveUserJourneysRouter)`

**chatV2 generate and save-artifact adapter branches**
- `gateway/src/routes/chatV2.ts` `/generate` handler: Add a new branch for `artifactType === 'user-journeys'` that follows the same pattern as the `'users-interactions'` branch -- filter task messages from thread, build conversation transcript, populate `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE`, call LLM with `jsonMode: true` and `temperature: 0.2`, parse result, retry once on parse failure, return `{ success: true, artifactContent }` or `{ success: false, error }`
- `gateway/src/routes/chatV2.ts` `/save-artifact` handler: Add a new `else if (artifactType === 'user-journeys')` branch that calls `executeToolCall(uuidv4(), 'save_user_journeys', { projectId, userJourneysJson: content }, ...)`, sets `completionArtifactId = 'user-journeys'` and `completionArtifactName = 'USER_JOURNEYS'`

**New generation prompt template**
- Add `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` to `gateway/src/services/promptBuilder.ts` following the structure of `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE`
- The template instructs the extraction LLM to produce `{ user_journeys: [...], activity_steps: [...] }` JSON from the conversation transcript using `{conversationTranscript}` placeholder
- Target schema uses name-based references matching the MCP tool input schema: `user_journeys[].{name, description, primary_business_user_name, parent_business_process_name}` and `activity_steps[].{user_journey_name, process_activity_name, business_user_name, application_name, sequence_order, description}`
- Extraction rules must specify: extract ALL user journeys and activity steps from the conversation, do not fabricate entities, name fields are required, `user_journey_name` in activity_steps must reference a journey in the output, do NOT include `activity_related_issues` or `ui_related_issues`

**Prompt and task config changes**
- `gateway/src/config/prompts/ux-designer.users-interactions.task.md`: In the PROHIBITIONS section, remove the three save-related prohibitions ("Do NOT call any MCP save tools", "Do NOT ask the user to confirm or save", "there is no artifact flow in this task; the conversation ends with the summary"); add a new SAVE CONFIRMATION section after FINAL SUMMARY OUTPUT that instructs the LLM to ask the user in natural language whether they want to save the user journeys and activity steps, with the constraint that the LLM must NOT format JSON payloads and must NOT call tools directly
- `gateway/src/config/tasks/ux-designer--users-interactions.json`: Add an artifact entry to the currently-empty `"artifacts": []` array: `{ "artifactId": "user-journeys", "tool": "save_user_journeys", "description": "User journeys and activity steps", "filename": "USER_JOURNEYS" }`

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`mcp-server/src/services/usersInteractionsService.ts` -- GET-merge-PUT pattern**
- Provides the closest structural template for the new `userJourneysService.ts`: `parseAndValidate()` for input validation, `createEmptyModelShell()` for model initialization, `ensureArray()` for safe array access, and the full GET-merge-PUT orchestration flow
- The new service must extend this pattern with name-to-ID resolution (not present in the foundation tool since it creates entities rather than referencing existing ones) and upsert semantics (the foundation tool skips existing names rather than updating them)
- The `archModelClient.getModel()`, `archModelClient.putModel()`, and `archModelClient.getProjectById()` methods are reused directly

**`mcp-server/src/routes/saveUsersInteractionsRoute.ts` -- Route validation pattern**
- Provides the exact Express route handler pattern to replicate: UUID v4 regex validation for projectId, non-empty string checks for sessionId and JSON payload, structured error response handling (400 for validation, 502 for upstream), and JSON-parsed error passthrough
- The new route simply changes the parameter name from `usersInteractionsJson` to `userJourneysJson` and calls the new service

**`mcp-server/src/types/saveUsersInteractions.ts` -- Type definition pattern**
- Provides the type definition structure to follow: `SaveRequest` interface (sessionId, projectId, jsonPayload), parsed `Input` interface with typed entity arrays, and `Response` interface with success/summary/entities
- The new types add per-entity CREATED/UPDATED status tracking not present in the foundation types

**`gateway/src/routes/chatV2.ts` -- Generate and save-artifact adapter patterns**
- The `artifactType === 'users-interactions'` branch in `/generate` (lines ~1688-1769) provides the exact pattern: filter thread messages by taskId, build transcript, populate template, call LLM with jsonMode, parse with retry, return result
- The `artifactType === 'users-interactions'` branch in `/save-artifact` (lines ~2183-2196) provides the exact pattern: call `executeToolCall` with tool name and params, set completion metadata

**`gateway/src/services/promptBuilder.ts` -- Generation prompt template pattern**
- `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE` (line ~710) provides the exact template structure: role description, `{conversationTranscript}` placeholder, TARGET SCHEMA section with JSON example, FIELD REFERENCE section, EXTRACTION RULES section, and OUTPUT FORMAT section
- The new template follows this structure but targets `{ user_journeys, activity_steps }` extraction with name-based FK references

## Out of Scope
- Diagram JSON generation (this is Increment 5, not Increment 4)
- Temporary diagram selection UI
- Native diagram rendering/editor changes
- Changes to other personas or tasks beyond ux-designer--users-interactions
- Bulk import endpoints outside the MCP tool flow
- Advanced conflict resolution UI
- New DB schema changes (user_journeys and activity_steps tables already exist from Increment 1)
- New architecture-model-service REST endpoints (uses existing PUT /api/model)
- Changes to the existing `save_users_interactions` tool, its generation template, or the foundation entity save flow
- Frontend UI changes beyond what the existing generate/save-artifact infrastructure already handles
- Adding `activity_related_issues` or `ui_related_issues` columns or fields
