# Specification: UX Designer User Journey Conversation Refactor

## Goal
Refactor the UX Designer "Define Users & Interactions" task into a "Define User Journeys" task that uses a spreadsheet-first ingestion approach -- the LLM requests CSV files (or pasted tabular data), parses them into structured user journey and activity step representations, validates against the architecture context, asks only targeted clarifying questions, and presents a final markdown summary. This increment changes only the conversation contract and prompt behavior; no persistence, diagrams, or save flows are triggered.

## User Stories
- As a UX Designer user, I want to provide structured CSV data representing user journeys and activity steps so that the system can quickly interpret and validate my input instead of walking me through a slow multi-section Q&A loop.
- As a UX Designer user, I want the LLM to cross-reference my spreadsheet data against existing architecture entities so that unknown references and structural issues are flagged before I proceed to persistence.

## Specific Requirements

**Modify the task card configuration in place**
- Edit `gateway/src/config/tasks/ux-designer--users-interactions.json` while preserving the task ID `ux-designer--users-interactions` to maintain thread continuity and avoid breaking references in `chatV2.ts` (e.g., the `fullArchContextTasks` set on line 2983)
- Change `menuLabel` from `"Define Users & Interactions"` to `"Define User Journeys"`
- Change `description` to: `"Ingests structured spreadsheet input to define user journeys, activity steps, and pain points. Validates structure, identifies gaps, and prepares data for persistence into the Business Architecture meta-model."`
- Set `responseFormat` to `null` (remove the entire existing JSON schema object with phase/section/questions/summary)
- Set `artifacts` to `[]` (remove the `save_users_interactions` linkage so the Generate/Save artifact flow is never triggered)
- Retain unchanged: `mode: "discovery"`, `contextNeeds: ["mission"]`, `persistence: "hub"`, `phases: null`, `availableFrom: ["hub", "panel"]`

**Rewrite the task prompt file for spreadsheet-first conversation**
- Replace the entire content of `gateway/src/config/prompts/ux-designer.users-interactions.task.md` with a new prompt that drives the spreadsheet-first ingestion flow
- The prompt must produce free-text markdown responses (not JSON), since `responseFormat` is now `null`
- The prompt must NOT include any of the old structured-questions format instructions, section progression logic, or JSON response rules

**First-turn behavior: request CSV input**
- The prompt must instruct the LLM to begin by requesting three CSV files (one per worksheet-equivalent) or pasted tab/comma-separated text
- The three expected inputs are: (1) Process Activities, (2) User Journeys, (3) Activity Steps
- If the user asks for help or does not provide files, the LLM should describe the expected columns for each CSV
- First-turn behavior is driven entirely by the prompt -- no special first-turn short-circuit code in `chatV2.ts`

**Define the expected CSV column structures in the prompt**
- CSV 1 -- Process Activities: process activity name, associated business process, actor/role hints, sequence ordering
- CSV 2 -- User Journeys: journey name, description (optional), primary business user (optional), parent business process (optional)
- CSV 3 -- Activity Steps: user journey name, process activity name, business user name, application name, sequence order, description (optional)
- The prompt should instruct the LLM to accept both CSV (comma-separated) and PSV (pipe-separated) multi-value fields for roles and applications

**Intermediate structured representation aligned to entity schema**
- The prompt instructs the LLM to internally parse data into `user_journeys` (name, description, primary_business_user, parent_business_process) and `activity_steps` (user_journey_name, process_activity_name, business_user_name, application_name, sequence_order, description)
- Fields are limited strictly to what matches `UserJourneyEntity` and `ActivityStepEntity` column schemas
- Explicitly exclude `activity_related_issues` and `ui_related_issues` from the structured representation in this increment

**Architecture context cross-referencing**
- The prompt must instruct the LLM to cross-reference parsed entity names (business users, applications, process activities, business processes) against the injected `ARCHITECTURE CONTEXT` section
- Unknown references should be flagged as warnings so the user is aware of mismatches
- The existing `fullArchContextTasks` set in `chatV2.ts` already includes `ux-designer--users-interactions`, so no code changes are needed for context injection

**Validation rules enforced by the prompt**
- Hard validation (flag as errors): activity steps referencing unknown/unmatched journey names; missing required fields (journey name, step journey reference, process activity reference, business user reference, application reference)
- Soft validation (flag as warnings): missing `sequence_order`; duplicate `sequence_order` within the same journey; role/application/process names not found in architecture context; missing optional descriptions; orphaned roles or applications appearing in steps but not in any journey

**Clarifying question behavior**
- The LLM must ask only targeted, gap-filling clarifying questions -- maximum approximately 5, grouped together in a single turn rather than spread across multiple rounds
- The LLM must NOT attempt to recreate spreadsheet data via exploratory Q&A and must NOT ask broad exploratory UX questions
- Questions should focus on: missing required references, ambiguous name mappings, and obvious structural inconsistencies

**Final structured summary as markdown**
- After clarification, the LLM presents a final summary listing: detected User Journeys, Activity Steps per journey (ordered by sequence_order), and highlighted structural issues/unknown references
- The summary must be human-readable markdown, not raw JSON
- The summary renders as a regular markdown message bubble -- no special preview component, no reuse of `UsersInteractionsPreviewBubble`

**No save, diagram, or tool invocations**
- The prompt must explicitly instruct the LLM to NOT call any MCP save tools, NOT emit diagram JSON, and NOT attempt to render diagrams
- With `artifacts: []` in the task config, the Generate/Save artifact flow in `chatV2.ts` (lines ~1688, ~2183) becomes unreachable dead code for this task

## Visual Design
No visual assets were provided for this specification.

## Existing Code to Leverage

**`gateway/src/config/tasks/ux-designer--ui-domain.json` -- target configuration pattern**
- This task already uses `responseFormat: null` and `artifacts: []`, which is the exact configuration shape the refactored `ux-designer--users-interactions.json` must adopt
- Serves as a validated template proving the registry loader accepts this configuration without errors

**`buildContentPartsV2()` in `gateway/src/routes/chatV2.ts` (line 325) -- CSV file handling**
- Decodes base64-encoded text files and inlines them as plain text with `--- File: filename ---` delimiters
- CSV files (`.csv`, `text/csv`) are already supported in `ACCEPTED_EXTENSIONS` and `ACCEPTED_MIME_TYPES` in `frontend/src/utils/fileUploadUtils.ts`
- No changes needed; user-attached CSV files will flow through this path automatically

**`fullArchContextTasks` set in `gateway/src/routes/chatV2.ts` (line 2983) -- architecture context injection**
- Already includes `ux-designer--users-interactions` in the set, so `buildArchitectureContextSection()` will inject the full architecture context into the system prompt for this task
- No code changes needed; the prompt can reference `ARCHITECTURE CONTEXT` section content for cross-referencing

**`composeSystemPrompt()` in `gateway/src/services/promptComposer.ts` -- prompt composition pipeline**
- Composes system prompts from identity markdown + task prompt markdown + resolved context sections + response format contract
- When `responseFormat` is `null`, the pipeline skips Layer 4 (response format contract), which is the desired behavior for free-text responses
- No changes needed to the composition pipeline

**`UserJourneyEntity.java` and `ActivityStepEntity.java` -- entity schema reference**
- `UserJourneyEntity`: id, modelFileId, name, description, tags, primaryBusinessUserId, parentBusinessProcessId
- `ActivityStepEntity`: id, modelFileId, userJourneyId, name, description, tags, sequenceOrder, processActivityId, businessUserId, applicationId
- These schemas define the field boundaries for the intermediate structured representation in the prompt

## Out of Scope
- Persistence of USER_JOURNEY and ACTIVITY_STEP entities to the database (deferred to Increment 4)
- MCP/tool invocation for saving artifacts (artifacts array is empty)
- Diagram generation, diagram JSON emission, or diagram rendering
- Adding `.xlsx` file upload support to the accepted file types
- Changes to the `ux-designer--ui-domain` task definition or prompt
- Changes to `ux-designer.identity.md` (persona identity prompt remains as-is)
- Changes to `gateway/src/routes/chatV2.ts` routing logic (no new code paths, first-turn short-circuits, or endpoint changes)
- New preview bubble components for the user journey summary (no replacement for `UsersInteractionsPreviewBubble`)
- Changes to `USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE` in promptBuilder.ts (generation path becomes dead code)
- Inclusion of `activity_related_issues` and `ui_related_issues` fields in the structured representation
- Changes to other personas, tasks, or Architecture & Design tables
