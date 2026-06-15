# Spec Requirements: UX Designer User Journey Save Pipeline

## Initial Description

Enable the UX Designer "Define User Journeys" task to persist USER_JOURNEY and ACTIVITY_STEP entities via a deterministic MCP save pipeline, using the structured output from Increment 3. This increment completes the loop: spreadsheet -> LLM interpretation -> validated structure -> persisted meta-model.

The platform requires a deterministic, enterprise-grade save mechanism (aligned with existing MCP/tool patterns) so that LLM output becomes authoritative architecture data.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea proposes a brand new MCP tool (`save_user_journeys_and_activity_steps`). The existing `save_users_interactions` already handles the "foundation" entities (business_users, business_processes, process_activities, ui_screens) via GET-merge-PUT against the JSON model. Should the new tool follow the same GET-merge-PUT pattern (fetch model, merge user_journeys/activity_steps arrays into the model JSON, PUT back), or should it bypass the JSON model and write directly to the user_journeys/activity_steps DB tables via a new dedicated REST endpoint on the architecture-model-service?

**Answer:** Follow the existing GET-merge-PUT pattern for Increment 4 so it stays aligned with the current save architecture and uses the model JSON as the merge surface rather than introducing a separate direct-to-DB path.

**Q2:** The raw idea calls for resolving primary_business_user_name to primary_business_user_id, parent_business_process_name to parent_business_process_id, etc. In the GET-merge-PUT pattern, the existing model JSON already contains all entities with their IDs, so name-to-ID resolution can happen in the MCP service (TypeScript). However, if a new dedicated REST endpoint on the architecture-model-service (Java) were preferred, the resolution would happen server-side with direct DB lookups. Should name-to-ID resolution happen in the MCP service (TypeScript)?

**Answer:** Keep name-to-ID resolution in the MCP service (TypeScript) using the already-fetched model JSON, matching existing save_users_interactions-style patterns.

**Q3:** Currently the task config for ux-designer--users-interactions has "artifacts": [] (empty) and the prompt explicitly prohibits saving. The new spec calls for a confirmation step before saving. Should this follow the existing generate/save-artifact two-step pattern (where the frontend calls /generate to extract JSON from the conversation, then /save-artifact to persist it), with a new artifactType like 'user-journeys'? Or should the LLM directly invoke the MCP tool during the conversation (tool-calling mode)?

**Answer:** Use the existing generate/save-artifact two-step pattern with a new artifactType such as 'user-journeys'; do not introduce direct in-conversation MCP tool invocation as a new pattern here.

**Q4:** The existing save_users_interactions flow saves foundation entities (business users, processes, activities, screens) as part of the same UX Designer conversation. Should the user journey save be a second save in the same conversation (bundled with the foundation save), or a separate save action that occurs after the foundation entities have already been persisted?

**Answer:** Make user journey save a separate subsequent save action that happens after the foundation entities already exist/persist and after the Increment 3 summary/clarification is complete; do not bundle it into the earlier foundation save.

**Q5:** The existing flow has USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE that extracts {business_users, business_processes, process_activities, ui_screens} from the conversation transcript. For user journeys, will we need a new, separate generation prompt template that extracts {user_journeys, activity_steps}?

**Answer:** Correct: add a new dedicated generation prompt template for extracting {user_journeys, activity_steps}; it is additive and does not replace the existing foundation-generation template.

**Q6:** The raw idea's input schema for activity_steps includes activity_related_issues and ui_related_issues, but the existing ActivityStepEntity has no such columns. The UX Designer prompt (Increment 3) explicitly says these fields must NOT be extracted. Should we add these columns to the entity/table, or drop them from the tool's input schema?

**Answer:** Drop activity_related_issues and ui_related_issues from the Increment 4 save tool input schema for now so it matches the actual persisted schema implemented by the existing entity model.

**Q7:** The raw idea says USER_JOURNEY uniqueness is by name within project, and ACTIVITY_STEP uniqueness is by (user_journey_id, sequence_order). Should the MCP service do name/key-based upsert and report CREATED vs UPDATED per entity, or should we always replace (delete-all-then-insert)?

**Answer:** The MCP service should do name/key-based upsert and report CREATED vs UPDATED per entity; do not use replace-all/delete-then-insert because that is riskier and breaks stable IDs unnecessarily.

**Q8:** The raw idea specifies partial success (valid items persist, invalid ones return in errors). In the GET-merge-PUT pattern, the entire model is saved atomically with a single PUT. Should we validate all references up front, collect errors, build only the valid entities, and PUT the result? Or reject the entire payload if any validation errors exist?

**Answer:** Reject the entire payload if any validation errors exist; do full upfront validation and keep the save atomic rather than allowing partial success in this GET-merge-PUT model.

**Q9:** The current UX Designer prompt has explicit prohibitions against saving and confirmation prompts. Should the LLM format the payload JSON in its confirmation message, or should the payload generation remain entirely within the /generate endpoint?

**Answer:** The LLM should only ask for save confirmation in natural language; the actual payload JSON should be produced by the /generate endpoint/template flow, not manually formatted by the LLM in its confirmation message.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: save_users_interactions MCP tool -- Path: `mcp-server/src/services/usersInteractionsService.ts` (closest pattern for GET-merge-PUT with name-based entity merging)
- Feature: save_users_interactions route -- Path: `mcp-server/src/routes/saveUsersInteractionsRoute.ts` (route validation pattern)
- Feature: save_users_interactions types -- Path: `mcp-server/src/types/saveUsersInteractions.ts` (request/input/response type definitions)
- Feature: architecture baseline service -- Path: `mcp-server/src/services/architectureBaselineService.ts` (another GET-merge-PUT example)
- Feature: chatV2 generate/save-artifact adapters -- Path: `gateway/src/routes/chatV2.ts` (the /generate and /save-artifact adapter patterns, lines ~1688 for users-interactions generation, lines ~2183 for users-interactions save-artifact)
- Feature: generation prompt template -- Path: `gateway/src/services/promptBuilder.ts` (USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE at line ~710)
- Feature: tool definitions -- Path: `gateway/src/types/tools.ts` (ToolName union, TOOL_DEFINITIONS, TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS)
- Feature: tool executor -- Path: `gateway/src/services/toolExecutor.ts` (executeTool and executeToolCall patterns)
- Feature: MCP tools router -- Path: `mcp-server/src/routes/tools.ts` (router.use mount pattern)
- Feature: UX Designer task config -- Path: `gateway/src/config/tasks/ux-designer--users-interactions.json` (task definition with artifacts array)
- Feature: UX Designer prompt -- Path: `gateway/src/config/prompts/ux-designer.users-interactions.task.md` (current prompt with prohibitions to be modified)

**Existing DB schema and JPA entities (already implemented in Increment 1):**
- DB migration: `architecture-model-service/src/main/resources/db/changelog/sql/059-user-journeys-activity-steps.sql`
- JPA entities: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyEntity.java` and `ActivityStepEntity.java`
- DTOs: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/UserJourneyDto.java` and `ActivityStepDto.java`
- Repositories: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/UserJourneyRepository.java` and `ActivityStepRepository.java`
- Model DTO integration: `MetaModelEntitiesDto.java` already includes `user_journeys` and `activity_steps` arrays (lines 136-146)
- ModelService: already handles saveAll for user_journeys and activity_steps during PUT /api/model (lines 1117-1129)

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Key Design Decisions

1. **GET-merge-PUT pattern**: The new MCP tool follows the same architecture as `save_users_interactions` -- fetch the full model JSON, merge user_journeys and activity_steps arrays, PUT back the whole model. No new direct-to-DB REST endpoints on the architecture-model-service.

2. **Name-to-ID resolution in MCP service (TypeScript)**: All name-based reference lookups (business_user_name -> business_user_id, etc.) happen in the MCP service layer using the already-fetched model JSON. The MCP service scans the model's entity arrays to resolve names to IDs.

3. **generate/save-artifact two-step pattern**: Uses the existing frontend flow -- `/generate` endpoint extracts structured JSON from the conversation transcript via a new generation prompt template, `/save-artifact` routes to the new MCP tool via a new artifactType `'user-journeys'`.

4. **Separate save action (not bundled)**: The user journey save is a distinct action that happens after the foundation entities (business_users, processes, activities, screens) have already been persisted and after the Increment 3 summary/clarification is complete.

5. **New generation prompt template**: A new `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` extracts `{user_journeys, activity_steps}` from the conversation. The existing `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE` remains unchanged.

6. **Dropped fields**: `activity_related_issues` and `ui_related_issues` are excluded from the tool's input schema to match the actual DB schema.

7. **Name/key-based upsert**: The MCP service performs upsert by name for USER_JOURNEY (unique key: `name` within model) and by `(user_journey_name, sequence_order)` for ACTIVITY_STEP. Reports CREATED vs UPDATED per entity.

8. **All-or-nothing validation**: If any validation error is found (missing FK reference, invalid data), the entire payload is rejected. No partial success. Full upfront validation before any merge/PUT.

9. **Natural-language confirmation only**: The LLM asks for save confirmation in plain language (e.g., "Would you like me to save these user journeys and activity steps?"). The actual JSON payload is produced by the `/generate` endpoint, not by the LLM.

### Architecture Pattern

```
User confirms save
    |
    v
Frontend calls POST /api/chat/v2/generate
    - artifactType: 'user-journeys'
    - Extracts {user_journeys, activity_steps} from conversation via USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE
    - Returns structured JSON to frontend
    |
    v
Frontend calls POST /api/chat/v2/save-artifact
    - artifactType: 'user-journeys'
    - content: the JSON string from /generate
    |
    v
chatV2 /save-artifact adapter
    - Calls executeToolCall('save_user_journeys', { projectId, userJourneysJson: content })
    |
    v
Gateway toolExecutor
    - Routes to MCP server POST /mcp/tools/save_user_journeys
    |
    v
MCP server route (saveUserJourneysRoute.ts)
    - Validates sessionId, projectId, userJourneysJson
    - Calls service function
    |
    v
MCP server service (userJourneysService.ts)
    1. Look up project -> get filename
    2. Parse and validate input JSON
    3. GET existing model (archModelClient.getModel)
    4. Resolve all name-based references to IDs using model entity arrays
    5. Validate all FK references exist (all-or-nothing)
    6. Upsert: match existing user_journeys by name, activity_steps by (journey_name, sequence_order)
    7. For new entities: generate IDs; for existing: preserve IDs and update fields
    8. Merge into model JSON
    9. PUT model (archModelClient.putModel)
    10. Return structured response with CREATED/UPDATED status per entity
```

### MCP Tool Input/Output Schema

**Tool name:** `save_user_journeys` (or `save_user_journeys_and_activity_steps` per the raw idea -- final name TBD)

**Input (received as `userJourneysJson` string, parsed to):**
```json
{
  "user_journeys": [
    {
      "name": "string (required, unique key within project)",
      "description": "string (optional)",
      "primary_business_user_name": "string (optional, resolved to ID via model lookup)",
      "parent_business_process_name": "string (optional, resolved to ID via model lookup)"
    }
  ],
  "activity_steps": [
    {
      "user_journey_name": "string (required, resolved to user_journey ID)",
      "process_activity_name": "string (required, resolved to process_activity ID)",
      "business_user_name": "string (required, resolved to business_user ID)",
      "application_name": "string (required, resolved to application ID)",
      "sequence_order": "integer (optional but recommended, used as part of uniqueness key)",
      "description": "string (optional)"
    }
  ]
}
```

Note: `activity_related_issues` and `ui_related_issues` are intentionally excluded.

**Output:**
```json
{
  "success": true,
  "projectId": "string",
  "filename": "string",
  "summary": {
    "userJourneys": { "created": 0, "updated": 0 },
    "activitySteps": { "created": 0, "updated": 0 }
  },
  "entities": {
    "userJourneys": [
      { "name": "string", "id": "string", "status": "CREATED|UPDATED" }
    ],
    "activitySteps": [
      { "userJourneyName": "string", "sequenceOrder": 1, "id": "string", "status": "CREATED|UPDATED" }
    ]
  }
}
```

**Error output (all-or-nothing rejection):**
```json
{
  "success": false,
  "errors": [
    { "type": "VALIDATION_ERROR", "message": "Business user 'Unknown User' not found in model", "context": "activity_steps[2].business_user_name" },
    { "type": "VALIDATION_ERROR", "message": "Application 'App Z' not found in model", "context": "activity_steps[5].application_name" }
  ]
}
```

### Name-to-ID Resolution Rules

Resolution happens in the MCP service (TypeScript) using the model JSON fetched via `archModelClient.getModel()`:

| Input Field | Resolves Against | Model Array Path |
|---|---|---|
| `user_journeys[].primary_business_user_name` | business_users[].name | `metaModel.entities.business_users` |
| `user_journeys[].parent_business_process_name` | business_processes[].name | `metaModel.entities.business_processes` |
| `activity_steps[].user_journey_name` | user_journeys[].name | Resolved against the incoming payload's user_journeys AND existing model `metaModel.entities.user_journeys` |
| `activity_steps[].process_activity_name` | process_activities[].name | `metaModel.entities.process_activities` |
| `activity_steps[].business_user_name` | business_users[].name | `metaModel.entities.business_users` |
| `activity_steps[].application_name` | applications[].name | `metaModel.entities.applications` |

- Name matching should be case-insensitive or exact (consistent with existing save_users_interactions behavior).
- If a referenced name is not found, the entire payload is rejected with a descriptive error.
- Optional fields (primary_business_user_name, parent_business_process_name) that are null/empty are allowed and result in null ID values.

### Upsert/Deduplication Behavior

**USER_JOURNEY upsert:**
- Match by `name` against existing `metaModel.entities.user_journeys[]` in the model.
- If match found: preserve existing `id`, update all other fields. Status: UPDATED.
- If no match: generate new ID (e.g., `uj-` prefix + UUID). Status: CREATED.

**ACTIVITY_STEP upsert:**
- Match by `(user_journey_id, sequence_order)` against existing `metaModel.entities.activity_steps[]` in the model.
- `user_journey_id` is the resolved ID from the journey (either existing or newly created in this payload).
- If match found: preserve existing `id`, update all other fields. Status: UPDATED.
- If no match: generate new ID (e.g., `as-` prefix + UUID). Status: CREATED.
- The `name` field for activity_steps should be derived or provided (e.g., from process_activity_name or from the step description).

### Validation Rules (All-or-Nothing)

**Phase 1: Input structure validation (MCP route layer)**
- `sessionId`: required, non-empty string
- `projectId`: required, valid UUID v4
- `userJourneysJson`: required, non-empty string, must parse as valid JSON

**Phase 2: Schema validation (MCP service layer, after JSON parse)**
- `user_journeys` array must exist and be non-empty
- Each user_journey must have a non-empty `name`
- Each activity_step must have non-empty `user_journey_name`, `process_activity_name`, `business_user_name`, `application_name`
- `sequence_order` must be a positive integer when present
- No duplicate `sequence_order` within the same `user_journey_name`
- Every activity_step's `user_journey_name` must reference a journey in the payload

**Phase 3: FK reference validation (MCP service layer, after model fetch)**
- All `primary_business_user_name` values must resolve to existing business_users in the model (or be null/empty)
- All `parent_business_process_name` values must resolve to existing business_processes in the model (or be null/empty)
- All `process_activity_name` values must resolve to existing process_activities in the model
- All `business_user_name` values must resolve to existing business_users in the model
- All `application_name` values must resolve to existing applications in the model

**Rejection behavior:** If ANY validation error is found in any phase, the entire payload is rejected. No entities are persisted. All errors are collected and returned in the response.

### Conversation Flow Changes

**Current flow (Increment 3):**
1. LLM requests CSV input
2. User provides spreadsheet data
3. LLM parses, validates, cross-references against architecture context
4. LLM asks clarifying questions (max ~5)
5. LLM presents final markdown summary
6. Conversation ends (prompt prohibits saving)

**New flow (Increment 4):**
1-5. Same as above
6. LLM asks natural-language confirmation: "Would you like me to save these user journeys and activity steps to the architecture model?"
7. User confirms
8. Frontend calls `/generate` with artifactType `'user-journeys'` -> extracts `{user_journeys, activity_steps}` JSON
9. Frontend calls `/save-artifact` with the generated JSON -> routes to new MCP tool
10. LLM receives save result, summarizes created/updated counts
11. If errors, LLM presents them and suggests corrective action

### Prompt Changes Needed

**File: `gateway/src/config/prompts/ux-designer.users-interactions.task.md`**

Changes required:
- Remove the prohibition: "Do NOT call any MCP save tools"
- Remove the prohibition: "Do NOT ask the user to confirm or save"
- Remove: "there is no artifact flow in this task; the conversation ends with the summary"
- Add a new section after FINAL SUMMARY OUTPUT describing the save confirmation step
- The new section should instruct the LLM to ask the user in natural language whether they want to save
- The LLM must NOT format or produce JSON payloads -- it only asks for confirmation
- The LLM must NOT call tools directly

**File: `gateway/src/config/tasks/ux-designer--users-interactions.json`**

Changes required:
- Add an artifact entry to the `artifacts` array:
  ```json
  {
    "artifactId": "user-journeys",
    "tool": "save_user_journeys",
    "description": "User journeys and activity steps",
    "filename": "USER_JOURNEYS"
  }
  ```

**File: `gateway/src/services/promptBuilder.ts`**

Changes required:
- Add a new `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` constant
- Template should instruct the extraction LLM to produce `{user_journeys, activity_steps}` JSON from the conversation transcript
- Schema should match the MCP tool input (names, not IDs; no activity_related_issues/ui_related_issues)
- Template structure should follow the pattern of `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE`

### Functional Requirements

- USER_JOURNEY records are created or updated in the architecture model via GET-merge-PUT
- ACTIVITY_STEP records are created or updated in the architecture model via GET-merge-PUT
- All FK references (business users, business processes, process activities, applications) are validated against existing model entities
- Invalid references cause the entire payload to be rejected with descriptive error messages
- Re-running the same payload does not create duplicates (idempotent upsert)
- The LLM presents a natural-language save confirmation after the Increment 3 summary
- On user confirmation, the frontend triggers /generate then /save-artifact
- The LLM receives and presents the save result (created/updated counts or errors)
- Existing MCP tools and flows are unaffected

### File/Component Changes Needed

**New files:**
- `mcp-server/src/routes/saveUserJourneysRoute.ts` -- Express route handler
- `mcp-server/src/services/userJourneysService.ts` -- Core business logic (parse, validate, resolve, upsert, merge)
- `mcp-server/src/types/saveUserJourneys.ts` -- Request, input, and response type definitions

**Modified files:**
- `gateway/src/types/tools.ts` -- Add `'save_user_journeys'` to ToolName union, ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS, and add SaveUserJourneysParams interface
- `gateway/src/services/toolExecutor.ts` -- Add endpoint and required params for `save_user_journeys` (import new params type)
- `mcp-server/src/routes/tools.ts` -- Import and mount `saveUserJourneysRouter`
- `gateway/src/routes/chatV2.ts` -- Add `'user-journeys'` artifactType branch in both `/generate` and `/save-artifact` handlers
- `gateway/src/services/promptBuilder.ts` -- Add `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` constant
- `gateway/src/config/tasks/ux-designer--users-interactions.json` -- Add artifact entry to the `artifacts` array
- `gateway/src/config/prompts/ux-designer.users-interactions.task.md` -- Remove save prohibitions, add save confirmation instructions

**No changes needed:**
- architecture-model-service (JPA entities, repositories, DTOs, ModelService, DB schema) -- all already implemented in Increment 1
- Existing MCP tools (save_users_interactions, save_architecture_baseline, etc.)
- Frontend UI components (the generate/save-artifact flow is already handled by the existing frontend infrastructure)

### Reusability Opportunities

- The `usersInteractionsService.ts` pattern (parseAndValidate, createEmptyModelShell, ensureArray, name-based dedup, GET-merge-PUT) can be closely followed for the new service
- The `archModelClient.getModel()` and `archModelClient.putModel()` methods are reused directly
- The `archModelClient.getProjectById()` method is reused for project lookup
- The `generateId()` utility from `mcp-server/src/utils/generateId.ts` is reused for ID generation
- The chatV2 `/generate` and `/save-artifact` adapter patterns are extended, not reimplemented
- The `buildConversationTranscript()` helper from `chatValidation.ts` is reused in the generation flow

### Scope Boundaries

**In Scope:**
- New MCP tool for saving user journeys and activity steps (route, service, types)
- Gateway tool registration (ToolName, definitions, endpoints, executor)
- chatV2 /generate adapter branch for artifactType 'user-journeys'
- chatV2 /save-artifact adapter branch for artifactType 'user-journeys'
- New generation prompt template (USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE)
- UX Designer prompt modification (remove prohibitions, add confirmation step)
- Task config update (add artifact entry)
- Name-to-ID resolution logic in MCP service
- Upsert logic with CREATED/UPDATED reporting
- All-or-nothing validation with descriptive errors
- Unit tests for the MCP service (create, update, reject invalid, idempotent re-run)
- Integration tests (generate -> save -> persistence -> result)
- Regression tests (existing MCP tools unaffected)

**Out of Scope:**
- Diagram JSON generation (Increment 5)
- Temporary diagram selection UI
- Native diagram rendering/editor
- Changes to other personas or tasks
- Bulk import endpoints outside the MCP flow
- Advanced conflict resolution UI
- New DB schema changes (tables and entities already exist)
- New architecture-model-service REST endpoints (using existing PUT /api/model)
- Changes to the existing save_users_interactions tool or its generation template
- Frontend UI changes beyond what the existing generate/save-artifact infrastructure already handles
- Adding activity_related_issues or ui_related_issues columns

### Technical Considerations

- The PUT /api/model endpoint performs a full model replace, so the merge must be careful to preserve all existing entity arrays that are not being modified
- The user_journeys and activity_steps arrays in MetaModelEntitiesDto are already supported by the ModelService saveAll logic (lines 1117-1129 in ModelService.java)
- FK constraints in the database (user_journeys -> business_users, business_processes; activity_steps -> user_journeys, process_activities, business_users, applications) mean the MCP service must ensure all referenced entities exist in the model before PUT
- The `fullArchContextTasks` set in chatV2.ts already includes `'ux-designer--users-interactions'`, so architecture context (with all entity names) is already injected into the conversation -- this is what enables the LLM to do cross-referencing in the summary
- The task currently has `"artifacts": []` and is classified as `"mode": "discovery"` -- adding an artifact entry may require verifying that the frontend's generate/save buttons appear correctly for this task
- The existing USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE extracts foundation entities; the new template must extract journey-specific entities from the same conversation transcript, so it needs to be aware that user journeys and activity steps are distinct from the foundation entities

### Acceptance Criteria

1. UX Designer conversation asks for confirmation before saving user journeys (natural language, no JSON in the message)
2. On confirmation, /generate endpoint produces valid {user_journeys, activity_steps} JSON from conversation transcript
3. On /save-artifact, the MCP tool is invoked with the structured payload
4. USER_JOURNEY records are created or updated correctly in the model via GET-merge-PUT
5. ACTIVITY_STEP records are created or updated correctly in the model via GET-merge-PUT
6. All FK references (business users, business processes, process activities, applications) are validated against existing model entities
7. Invalid references cause the entire payload to be rejected with clear error messages listing all violations
8. No partial saves -- the payload is all-or-nothing
9. Re-running the same save does not create duplicates (upsert by name/key preserves IDs)
10. LLM presents clear save result summary (created/updated counts per entity type)
11. If errors, LLM surfaces them and suggests corrective action
12. Saved data is visible in the model's user_journeys and activity_steps arrays (and thus in the UI tables)
13. No diagram generation in this increment
14. Existing MCP tools and flows are unaffected
15. Existing save_users_interactions tool continues to work for foundation entities
16. The task config artifacts array is populated, enabling the frontend generate/save flow

### Testing Requirements

**MCP Service Unit Tests (mcp-server):**
- Parse valid JSON input with user_journeys and activity_steps
- Reject invalid JSON (malformed string)
- Reject missing required fields (journey name, step references)
- Reject duplicate sequence_order within same journey
- Reject activity_step referencing a journey not in the payload
- Name-to-ID resolution: all references resolve correctly
- Name-to-ID resolution: unknown business_user_name causes rejection
- Name-to-ID resolution: unknown application_name causes rejection
- Name-to-ID resolution: unknown process_activity_name causes rejection
- Name-to-ID resolution: optional fields (primary_business_user_name) can be null
- Upsert: new journey creates with generated ID, status CREATED
- Upsert: existing journey (same name) updates fields, preserves ID, status UPDATED
- Upsert: new activity_step creates with generated ID, status CREATED
- Upsert: existing activity_step (same journey + sequence_order) updates, preserves ID, status UPDATED
- Idempotent: re-running same payload produces all UPDATED, no new IDs
- All-or-nothing: one invalid reference causes zero entities to be persisted
- Error response contains all validation errors (not just the first)
- Empty user_journeys array is rejected

**Gateway Integration Tests:**
- /generate with artifactType 'user-journeys' produces valid JSON
- /save-artifact with artifactType 'user-journeys' routes to the correct MCP tool
- Tool definition includes save_user_journeys in TOOL_DEFINITIONS
- Tool executor maps save_user_journeys to correct MCP endpoint

**Regression Tests:**
- Existing save_users_interactions MCP tool continues to work
- Existing /generate for artifactType 'users-interactions' is unaffected
- Existing /save-artifact for artifactType 'users-interactions' is unaffected
- Other persona/task flows are unaffected
