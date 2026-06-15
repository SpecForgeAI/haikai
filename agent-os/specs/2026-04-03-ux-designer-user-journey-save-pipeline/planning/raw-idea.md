---
name: ux-designer-user-journey-save-pipeline
summary: Enable the UX Designer "Define User Journeys" task to persist USER_JOURNEY and ACTIVITY_STEP entities via a deterministic MCP save pipeline, using the structured output from Increment 3.

motivation:
- Increment 3 produces a validated, structured representation of user journeys and activity steps, but nothing is persisted.
- The platform requires a deterministic, enterprise-grade save mechanism (aligned with existing MCP/tool patterns) so that LLM output becomes authoritative architecture data.
- This increment completes the loop: spreadsheet → LLM interpretation → validated structure → persisted meta-model.

scope:
- Add MCP/tool contracts for saving USER_JOURNEY and ACTIVITY_STEP.
- Wire UX Designer conversation to invoke these tools after confirmation.
- Implement idempotent upsert behavior for journeys and steps.
- Ensure strict validation and project scoping.
- Return a structured save result back to the LLM and UI.
- No diagram generation in this increment.
- No diagram UI/editor changes.
- No changes to spreadsheet parsing (already handled in Increment 3).

out_of_scope:
- Diagram JSON generation (Increment 5).
- Temporary diagram selection UI.
- Native diagram rendering/editor.
- Changes to other personas or tasks.
- Bulk import endpoints outside the MCP flow.
- Advanced conflict resolution UI.

architectural_intent:
- The LLM never writes directly to the database.
- All persistence goes through deterministic MCP tools with explicit schemas.
- Save operations must be idempotent, project-scoped, validated against existing meta-model entities.
- USER_JOURNEY and ACTIVITY_STEP are treated as first-class architecture artifacts.

mcp_tooling:
  tool: save_user_journeys_and_activity_steps
  description: Persist user journeys and their ordered activity steps for a given project. Performs upsert semantics based on unique keys.
  input_schema:
    project_id: string (required)
    user_journeys: array of {name, description, primary_business_user_name, parent_business_process_name}
    activity_steps: array of {user_journey_name, process_activity_name, business_user_name, application_name, sequence_order, description, activity_related_issues, ui_related_issues}
  resolution_rules:
    - user_journey.name is unique key within project
    - lookup references by name (primary_business_user_name → BUSINESS_USER, etc.)
    - if referenced entity not found → reject with validation error
    - for USER_JOURNEY: name exists → update, else → create
    - for ACTIVITY_STEP: uniqueness key (user_journey_id, sequence_order), exists → update, else → create
  output_schema:
    user_journeys: array of {name, id, status: CREATED|UPDATED}
    activity_steps: array of {user_journey_name, sequence_order, id, status: CREATED|UPDATED}
    errors: array of {type, message, context}

conversation_flow_changes:
  - After Increment 3 summary, LLM asks explicit confirmation before saving
  - On confirmation, invoke MCP tool with structured payload
  - Receive result, summarize created/updated counts and errors
  - LLM must not call tool before user confirmation, must not fabricate IDs

validation_rules:
  pre_tool (LLM-side): ensure step references journey in payload, sequence_order present/integer, no duplicate sequence_order per journey
  tool-side (authoritative): enforce project scoping, FK existence, sequence_order uniqueness, reject invalid references

error_handling:
  - Partial success allowed (valid persist, invalid returned in errors)
  - Errors with clear context (e.g. "Application 'App Z' not found")
  - LLM surfaces errors and suggests corrective action

idempotency_rules:
  - Re-running same payload must not create duplicates
  - Sequence order updates overwrite previous ordering
  - No duplicate USER_JOURNEY names within project

acceptance_criteria:
1. UX Designer conversation asks for confirmation before saving
2. On confirmation, MCP tool is invoked with structured payload
3. USER_JOURNEY records created or updated correctly
4. ACTIVITY_STEP records created or updated correctly
5. All FK references validated against existing entities
6. Invalid references rejected with clear error messages
7. Partial success supported and reported
8. Re-running same save does not create duplicates
9. LLM presents clear save result summary
10. Saved data visible in User Journeys and Activity Steps tables
11. No diagram generation in this increment
12. Existing MCP tools and flows unaffected

testing_requirements:
- Tool-level: create, update, reject invalid, partial success, idempotent re-run
- Integration: UX Designer → MCP tool → persistence → result to LLM
- Regression: existing MCP tools unaffected, other persona flows unaffected
