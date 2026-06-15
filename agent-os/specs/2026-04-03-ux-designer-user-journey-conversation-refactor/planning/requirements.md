# Spec Requirements: UX Designer User Journey Conversation Refactor

## Initial Description
Refactor the UX Designer persona task from "Define Users & Interactions" to "Define User Journeys", shifting the conversation to spreadsheet-first ingestion, structured interpretation, and minimal clarifying questions (no persistence yet).

The current UX Designer flow attempts to elicit users, processes, activities, and interactions via conversational Q&A (a multi-section structured-questions loop), which is inefficient and does not align with the new structured spreadsheet-driven approach. We now have a defined input model (3 worksheets) and backend entities (USER_JOURNEY, ACTIVITY_STEP). The UX Designer should: (1) request the spreadsheet, (2) interpret it into structured journey/step data, (3) ask only targeted clarifying questions. This increment changes only the conversation contract and prompt behavior, not persistence or diagrams.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea mentions the spreadsheet has 3 worksheets: "Process Activities", "User Journeys", and "Activity Steps". However, the current file upload system only supports CSV, not XLSX (`.xlsx` is not in the accepted file extensions or MIME types). I'm assuming the user will provide CSV files (one per worksheet) or possibly paste tab/comma-separated text directly into the chat. Is that correct, or should we also add `.xlsx` support to the accepted upload types as part of this increment?
**Answer:** Do not add .xlsx support in Increment 3; use the existing file-upload path with CSV inputs (one CSV per worksheet) and also allow pasted tab/comma-separated text as a fallback, with the prompt explicitly explaining the expected three worksheet-equivalent inputs.

**Q2:** The raw idea's `expected_intermediate_structure` includes `activity_related_issues` and `ui_related_issues` fields on `activity_steps`, but the existing backend `ActivityStepEntity` does not have these columns (it only has id, name, description, tags, sequence_order, process_activity_id, business_user_id, application_id, user_journey_id). I'm assuming the LLM prompt should still extract these issue fields from the spreadsheet and include them in the structured summary (since they're useful information), but they would just be displayed and not persisted. Is that correct? Or should we limit the intermediate structure to only fields that match the existing entity schema?
**Answer:** Limit the structured extraction and summary to fields that match the existing persisted/entity schema for this increment; do not invent non-persistable issue fields in the formal summary yet.

**Q3:** The current task uses a strict JSON `responseFormat` with a `phase`/`section`/`questions`/`summary` schema, which drives the StructuredQuestionsRenderer UI (rendering questions as form rows with inputs). The new flow is fundamentally different -- the LLM should produce free-form conversational responses (request spreadsheet, summarize parsed data, ask clarifying questions in prose). I'm assuming we should set `responseFormat: null` on the new task definition so the LLM responds in free text, and the StructuredQuestionsRenderer would not be used for this task. Is that correct, or do you still want some structured JSON response format?
**Answer:** Yes, set responseFormat to null for this task so the LLM can run the spreadsheet-first, minimal-clarification conversation in normal free text rather than the old structured-questions renderer.

**Q4:** The current task has an `artifacts` definition pointing to `save_users_interactions` with filename `USERS_INTERACTIONS`. Since this increment explicitly does NOT persist anything, I'm assuming we should remove the `artifacts` array from the task definition (or set it to `[]`) so the Generate/Save artifact flow is not triggered. Is that correct?
**Answer:** Yes, remove the artifacts/save linkage for this increment (empty/none), because this increment must not trigger Generate/Save behavior.

**Q5:** The raw idea says "Rename: Define Users & Interactions -> Define User Journeys". I'm assuming this means we modify the existing `ux-designer--users-interactions.json` task file in place (updating `menuLabel`, `description`, `taskPromptRef`, etc.) rather than creating a brand new task JSON file with a new ID like `ux-designer--user-journeys`. Reusing the same task ID avoids breaking thread history and any existing references. Is that correct, or do you prefer a new task ID?
**Answer:** Modify the existing ux-designer--users-interactions task in place so the task ID/thread continuity is preserved, while changing the menu label, description, and prompt reference to the new "Define User Journeys" behavior.

**Q6:** The raw idea specifies validation rules like "steps referencing unknown journeys, missing sequence_order, duplicate sequence_order, roles/apps not in meta-model." The LLM currently receives `ARCHITECTURE CONTEXT` (injected via `buildArchitectureContextSection`) which includes existing meta-model entities. I'm assuming the prompt should instruct the LLM to cross-reference the spreadsheet's role names and application names against the architecture context to flag unknown references, and this existing context injection mechanism is sufficient. Is that correct?
**Answer:** Yes, instruct the LLM to cross-reference spreadsheet role/application/process/activity names against the injected architecture context and flag unknown references; the existing context injection mechanism is sufficient for Increment 3.

**Q7:** The raw idea says the conversation should "always start with request for spreadsheet." The current task has no deterministic first-turn short-circuit -- the LLM handles the first turn naturally based on the prompt. I'm assuming we keep this same pattern: the new prompt instructs the LLM to request the spreadsheet on first turn, with no special first-turn code in chatV2.ts. Is that correct?
**Answer:** Yes, handle first-turn behavior purely in the prompt/task instructions: the LLM should naturally request the spreadsheet/CSV inputs on first turn, with no new special first-turn code in chatV2.ts.

**Q8:** The current `UsersInteractionsPreviewBubble.tsx` renders the old structure (business_users, business_processes, process_activities, ui_screens). Since this increment does not persist, the Generate/Save flow should not fire. But for the final structured summary the LLM presents in conversation, I'm assuming it will be rendered as a regular markdown message bubble (not a special preview component). Is that correct, or do you want a new preview bubble component for the user journey summary?
**Answer:** Use a regular markdown message bubble for the final structured journey summary in this increment; do not build a new preview bubble yet and do not reuse the old UsersInteractionsPreviewBubble structure.

**Q9:** Is there anything that should be explicitly excluded from this increment that I haven't mentioned? For example: changes to the `ux-designer--ui-domain` task, modifications to the `ux-designer.identity.md` persona identity prompt, or any changes to the gateway chatV2.ts routing logic beyond what's needed for the prompt/task config changes?
**Answer:** Explicitly exclude changes to the ux-designer--ui-domain task, changes to the ux-designer identity/persona prompt beyond what is strictly necessary for this task's prompt/config, and any gateway chatV2 routing changes beyond minimal task/prompt configuration wiring.

### Existing Code to Reference

No similar existing features identified for reference by the user. However, based on codebase analysis, the following existing patterns are relevant:

- **Task configuration pattern**: All existing task JSON files in `gateway/src/config/tasks/` follow the same schema (`id`, `personaId`, `menuLabel`, `description`, `mode`, `taskPromptRef`, `responseFormat`, `contextNeeds`, `persistence`, `artifacts`, `phases`, `availableFrom`). The `ux-designer--ui-domain.json` task already uses `responseFormat: null` and empty `artifacts: []`, which is the exact pattern needed for the refactored task.
- **Free-text conversation tasks**: `ux-designer--ui-domain` task uses `responseFormat: null` and free-text conversation, serving as the closest existing pattern for the new behavior.
- **File attachment handling**: `buildContentPartsV2()` in `gateway/src/routes/chatV2.ts` (line ~325) handles CSV and text files by decoding base64 and inlining as text with `--- File: filename ---` delimiters. This is the existing mechanism the spreadsheet CSV inputs will flow through.
- **Architecture context injection**: The `fullArchContextTasks` set in `chatV2.ts` (line ~2983) already includes `ux-designer--users-interactions`, so the architecture context will continue to be injected without code changes.
- **Prompt composition pipeline**: `gateway/src/services/promptComposer.ts` composes system prompts from identity + task prompt + resolved context. No changes needed to this pipeline.

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

#### Task Card Configuration Changes
- Modify `gateway/src/config/tasks/ux-designer--users-interactions.json` in place (preserve task ID `ux-designer--users-interactions`)
- Change `menuLabel` from "Define Users & Interactions" to "Define User Journeys"
- Change `description` to: "Ingests structured spreadsheet input to define user journeys, activity steps, and pain points. Validates structure, identifies gaps, and prepares data for persistence into the Business Architecture meta-model."
- Change `taskPromptRef` to point to the new prompt file (e.g., `prompts/ux-designer.users-interactions.task.md` -- same file, rewritten)
- Set `responseFormat` to `null` (remove the existing `phase`/`section`/`questions`/`summary` JSON schema)
- Set `artifacts` to `[]` (remove the `save_users_interactions` linkage)
- Keep `mode: "discovery"`, `contextNeeds: ["mission"]`, `persistence: "hub"`, `availableFrom: ["hub", "panel"]` unchanged

#### New Prompt File Content
- Replace the entire content of `gateway/src/config/prompts/ux-designer.users-interactions.task.md` with the new spreadsheet-first conversation prompt
- The prompt must instruct the LLM to:
  1. On first turn, request the user provide three CSV files (or pasted tab/comma-separated text) corresponding to three worksheet-equivalents: Process Activities, User Journeys, Activity Steps
  2. Describe the expected structure/columns for each CSV if the user asks or does not provide them
  3. Parse the provided CSV data into structured user_journey and activity_step representations
  4. Handle CSV/PSV (pipe-separated) value splitting for multi-value fields (roles, applications)
  5. Cross-reference parsed names against the injected ARCHITECTURE CONTEXT to flag unknown business users, applications, process activities, or business processes
  6. Perform structural validation (see Validation Rules below)
  7. Ask only targeted, gap-filling clarifying questions (max ~5, grouped)
  8. Present a final structured summary in human-readable markdown format (not JSON, not a preview bubble)
  9. NOT call any MCP save tools, NOT emit diagram JSON, NOT attempt to render diagrams

#### Input Format Contract
- Three CSV file attachments (one per worksheet-equivalent), OR pasted tab/comma-separated text in the chat message
- **CSV 1 -- Process Activities**: process activity names, associated business process, actor/role hints, sequence ordering
- **CSV 2 -- User Journeys**: journey name, description (optional), primary business user (optional), parent business process (optional)
- **CSV 3 -- Activity Steps**: user journey name, process activity name, business user name, application name, sequence order, description (optional)

#### Intermediate Structured Representation (prompt-internal, not persisted)
Fields limited to what matches the existing entity schema:

**user_journeys:**
- name (required)
- description (optional)
- primary_business_user (optional, maps to `primary_business_user_id`)
- parent_business_process (optional, maps to `parent_business_process_id`)

**activity_steps:**
- user_journey_name (required, maps to `user_journey_id`)
- process_activity_name (required, maps to `process_activity_id`)
- business_user_name (required, maps to `business_user_id`)
- application_name (required, maps to `application_id`)
- sequence_order (optional)
- description (optional)

Note: `activity_related_issues` and `ui_related_issues` are explicitly excluded from this increment's structured representation.

#### Conversation Flow
1. LLM greets and requests the three CSV files (or pasted data), explaining expected structure
2. User provides CSV file(s) or pastes data
3. LLM parses and interprets the data into journeys and activity steps
4. LLM cross-references against architecture context, flags issues
5. LLM asks targeted clarifying questions (max ~5) for missing required references, ambiguous mappings, obvious inconsistencies
6. User answers clarifying questions
7. LLM presents final structured summary as human-readable markdown in a regular message bubble

#### Conversation Rules (enforced by prompt)
- Always start with request for spreadsheet/CSV input
- Do NOT attempt to recreate spreadsheet data via exploratory Q&A
- Do NOT ask broad exploratory UX questions
- Only ask targeted, gap-filling questions (max ~5)
- Prefer grouped questions (ask multiple at once rather than one-at-a-time loops)
- Do NOT call MCP save tools or emit diagram JSON

#### Output Format
- Summary of detected User Journeys
- Activity Steps per journey (ordered by sequence_order)
- Highlighted structural issues and unknown references
- Human-readable markdown format, NOT raw JSON
- Rendered as a regular markdown message bubble (no special preview component)

### Validation Rules (LLM-side, enforced by prompt)

**Hard validation (flag as errors):**
- Activity steps referencing unknown/unmatched journey names
- Missing required fields (journey name, step's journey reference, process activity reference, business user reference, application reference)

**Soft validation (flag as warnings):**
- Missing sequence_order on activity steps
- Duplicate sequence_order within the same journey
- Role/application/process names not found in the injected architecture context
- Missing optional descriptions
- Orphaned roles or applications that appear in steps but not in any journey

### Reusability Opportunities
- The `ux-designer--ui-domain.json` task definition serves as an exact template for the target configuration shape (`responseFormat: null`, `artifacts: []`, free-text conversation)
- The existing `buildContentPartsV2()` function in chatV2.ts already handles CSV file decoding and inlining -- no changes needed
- The existing architecture context injection in the `fullArchContextTasks` set already includes `ux-designer--users-interactions` -- no code changes needed
- The prompt composition pipeline (`promptComposer.ts`) works unchanged
- The `ux-designer.identity.md` persona identity prompt is reused as-is

### Scope Boundaries

**In Scope:**
- Modify `gateway/src/config/tasks/ux-designer--users-interactions.json`: update menuLabel, description, set responseFormat to null, set artifacts to []
- Rewrite `gateway/src/config/prompts/ux-designer.users-interactions.task.md`: replace the entire structured Q&A prompt with the new spreadsheet-first conversation prompt
- Ensure the new prompt covers: CSV input request, structure explanation, parsing instructions, architecture context cross-referencing, validation rules, clarifying question behavior, and final markdown summary output

**Out of Scope:**
- Persistence of USER_JOURNEY / ACTIVITY_STEP entities (Increment 4)
- MCP/tool invocation for saving (artifacts removed)
- Diagram generation or rendering
- Adding .xlsx file upload support
- Changes to the `ux-designer--ui-domain` task
- Changes to `ux-designer.identity.md` (persona identity prompt)
- Changes to gateway chatV2.ts routing logic (no new code paths, first-turn short-circuits, or endpoint changes)
- New preview bubble components for the journey summary
- Changes to `UsersInteractionsPreviewBubble.tsx` (it simply won't be triggered since artifacts are removed)
- Changes to `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE` in promptBuilder.ts (generation path won't fire since artifacts are removed)
- Changes to the save-artifact handler for users-interactions in chatV2.ts (won't fire since artifacts are removed)
- `activity_related_issues` and `ui_related_issues` fields
- Changes to other UX Designer tasks
- Changes to Architecture & Design tables
- Spreadsheet upload UI mechanics beyond existing file attachment

### Technical Considerations
- **Task ID preservation**: The task ID `ux-designer--users-interactions` is preserved to maintain thread continuity and avoid breaking any existing references in chatV2.ts (e.g., the `fullArchContextTasks` set on line ~2983)
- **No chatV2.ts code changes expected**: The existing architecture context injection already covers this task ID; responseFormat: null means no JSON validation; artifacts: [] means no Generate/Save flow. The task-specific code paths in chatV2.ts for `users-interactions` artifact generation (line ~1688) and save (line ~2183) simply become unreachable dead code for this increment.
- **File attachment flow**: Users attach CSV files via the existing Paperclip button in ChatInputBar. Files are read as base64 by `readFilesAsBase64()`, sent to the gateway as `{ filename, mimeType, base64 }` objects in the `files` array of ChatV2Request, and decoded by `buildContentPartsV2()` into inline text content parts with `--- File: filename ---` delimiters. The LLM then sees the CSV content as plain text within the conversation.
- **Accepted file types**: CSV (`.csv`, `text/csv`) is already in `ACCEPTED_EXTENSIONS` and `ACCEPTED_MIME_TYPES` in `frontend/src/utils/fileUploadUtils.ts`. No changes needed.
- **Architecture context availability**: The `buildArchitectureContextSection()` call for this task is already wired in the `fullArchContextTasks` set. The LLM will receive existing business users, applications, process activities, and business processes as context to validate against.

### Files to Modify

| File | Change |
|------|--------|
| `gateway/src/config/tasks/ux-designer--users-interactions.json` | Update menuLabel, description, set responseFormat to null, set artifacts to [] |
| `gateway/src/config/prompts/ux-designer.users-interactions.task.md` | Full rewrite: replace structured Q&A prompt with spreadsheet-first conversation prompt |

### Files Unchanged (but relevant for reference)

| File | Relevance |
|------|-----------|
| `gateway/src/config/personas/ux-designer.json` | Persona definition, tasks array references `ux-designer--users-interactions` -- no change needed |
| `gateway/src/config/prompts/ux-designer.identity.md` | Persona identity prompt, reused as-is in prompt composition |
| `gateway/src/config/tasks/ux-designer--ui-domain.json` | Reference pattern for responseFormat: null, artifacts: [] |
| `gateway/src/routes/chatV2.ts` | No changes needed; existing wiring handles null responseFormat, empty artifacts, and architecture context injection |
| `gateway/src/services/promptComposer.ts` | No changes needed; pipeline works unchanged |
| `frontend/src/utils/fileUploadUtils.ts` | No changes needed; CSV already accepted |
| `frontend/src/components/UnifiedChat/TaskMenu.tsx` | No changes needed; reads menuLabel/description from task registry dynamically |
| `architecture-model-service/.../UserJourneyEntity.java` | Reference for field schema alignment |
| `architecture-model-service/.../ActivityStepEntity.java` | Reference for field schema alignment |

### Acceptance Criteria

1. UX Designer task card label reads "Define User Journeys" (not "Define Users & Interactions")
2. UX Designer task card description matches the new description text
3. Selecting the task starts a conversation where the LLM requests CSV files or pasted spreadsheet data
4. LLM describes the expected CSV structure (3 files: Process Activities, User Journeys, Activity Steps) if the user asks or does not provide them
5. LLM parses provided CSV data into user journeys and activity steps
6. LLM correctly splits CSV/PSV multi-value fields (roles, applications)
7. LLM cross-references parsed names against architecture context and reports unknown references
8. LLM reports structural issues (missing required fields, duplicate sequence orders, orphaned references)
9. LLM asks only targeted clarifying questions (max ~5, grouped), not broad exploratory questions
10. LLM presents a final structured summary in human-readable markdown after clarification
11. No backend persistence is triggered (no MCP tool calls, no save operations)
12. No diagram generation is attempted
13. No Generate/Save artifact flow is triggered (artifacts array is empty)
14. Existing UX Designer tasks (UI Domain Design) remain unchanged
15. The `ux-designer.identity.md` persona prompt is unchanged
16. No new code paths added to chatV2.ts

### Testing Requirements

**Manual Testing:**
- Start the UX Designer "Define User Journeys" task and verify the task card label and description
- Verify the LLM requests CSV input on first turn
- Attach CSV files via the Paperclip button and verify the LLM parses them
- Paste tab-separated or comma-separated text and verify the LLM parses it
- Verify the LLM flags unknown references when architecture context contains known entities
- Verify the LLM asks concise, targeted clarifying questions (not broad exploratory loops)
- Verify the final summary is rendered as a regular markdown message bubble
- Verify no Generate/Confirm/Save flow appears (no preview bubble, no completion chip)

**Automated Testing (if applicable):**
- Gateway registry loader test: verify the updated task JSON loads without validation errors (responseFormat: null is valid, empty artifacts array is valid, taskPromptRef points to existing file)
- No new chatV2.ts code paths means no new backend unit tests are required for this increment
- Frontend: no new components means no new component tests; the TaskMenu component dynamically reads from the registry so the label change is covered by the registry
