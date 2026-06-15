---
name: ux-designer-user-journey-conversation-refactor
summary: Refactor the UX Designer persona task from "Define Users & Interactions" to "Define User Journeys", shifting the conversation to spreadsheet-first ingestion, structured interpretation, and minimal clarifying questions (no persistence yet).

motivation:
- The current UX Designer flow attempts to elicit users, processes, activities, and interactions via conversational Q&A, which is inefficient and does not align with the new structured spreadsheet-driven approach.
- We now have a defined input model (3 worksheets) and backend entities (USER_JOURNEY, ACTIVITY_STEP).
- The UX Designer should:
  1) request the spreadsheet
  2) interpret it into structured journey/step data
  3) ask only targeted clarifying questions
- This increment changes only the conversation contract and prompt behavior, not persistence or diagrams.

scope:
- Rename UX Designer task card.
- Replace existing MD prompt/instructions for that task.
- Add structured parsing logic expectations to the LLM prompt.
- Define expected intermediate structured output (NOT saved yet).
- Introduce clarifying-question behavior (gap-driven).
- No saving to backend in this increment.
- No diagram JSON generation in this increment.
- No UI changes outside the chat drawer/task card.

out_of_scope:
- Persistence of USER_JOURNEY / ACTIVITY_STEP (Increment 4).
- MCP/tool invocation for saving.
- Diagram generation or rendering.
- Spreadsheet upload UI mechanics (assume file is provided via existing chat/file mechanism).
- Changes to other UX Designer tasks (e.g. UI Domain Design).
- Changes to Architecture & Design tables.

ui_intent:
- User triggers via @UX Designer → selects task
- Task card label: "Define User Journeys"
- Conversation flow: LLM asks for spreadsheet → user provides → LLM interprets/summarizes → minimal clarifying questions → structured summary (preview only)

task_card_changes:
- Rename: "Define Users & Interactions" → "Define User Journeys"
- Update description to: "Ingests structured spreadsheet input to define user journeys, activity steps, and pain points. Validates structure, identifies gaps, and prepares data for persistence into the Business Architecture meta-model."

prompt_contract:
- Request spreadsheet if not provided
- Confirm expected structure (3 worksheets: Process Activities, User Journeys, Activity Steps)
- Parse activities, roles (CSV/PSV split), applications (CSV/PSV split), journey definitions, activity steps and ordering
- Construct internal structured representation (user_journeys[], activity_steps[])
- Validate: missing journey references, missing step ordering, orphaned roles/apps, duplicate/conflicting steps
- Ask only targeted clarifying questions for missing required references, ambiguous mappings, obvious inconsistencies
- Produce final structured summary ready for save (but DO NOT call save tools)

expected_intermediate_structure:
  user_journeys: name, description (optional), primary_business_user (optional), parent_business_process (optional)
  activity_steps: user_journey_name, process_activity_name, business_user_name, application_name, sequence_order, description (optional), activity_related_issues (optional), ui_related_issues (optional)

conversation_rules:
- Always start with request for spreadsheet
- Do NOT attempt to recreate spreadsheet via Q&A
- Do NOT ask broad exploratory UX questions
- Only ask targeted, gap-filling questions (max ~5)
- Prefer grouped questions

validation_rules:
- Identify: steps referencing unknown journeys, missing sequence_order, duplicate sequence_order, roles/apps not in meta-model
- Flag but do not block: missing descriptions, empty issue fields

output_behavior:
- Summary of detected User Journeys, Activity Steps per journey (ordered), highlighted issues
- Human-readable format, not raw JSON
- DO NOT call MCP save tools, emit diagram JSON, or attempt to render diagrams

acceptance_criteria:
1. UX Designer task card label is "Define User Journeys"
2. Selecting task starts conversation requesting spreadsheet
3. LLM describes expected spreadsheet structure if not provided
4. LLM parses spreadsheet into journeys and activity steps
5. LLM splits CSV/PSV values correctly
6. LLM reports structural issues
7. LLM asks targeted clarifying questions only
8. LLM presents structured summary after clarification
9. No backend persistence triggered
10. No diagram generation attempted
11. Existing UX Designer tasks unchanged
