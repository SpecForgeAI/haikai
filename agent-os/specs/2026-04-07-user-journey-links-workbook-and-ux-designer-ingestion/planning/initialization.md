name: user-journey-links-workbook-and-ux-designer-ingestion
summary: Extend the existing User Journey workbook ingestion and UX Designer flow so a new worksheet, "User Journey Links", can be parsed, validated, summarized, and persisted into the new first-class USER_JOURNEY_LINK relationship model.

motivation:
- Increment 11 introduced USER_JOURNEY_LINK as a first-class Business Architecture relationship.
- The current workbook/XLSX flow only captures:
  - Process Activities
  - User Journeys
  - Activity Steps
- To make the future parent overview diagram fully derivable from architecture truth, the workbook and UX Designer flow must also capture and save journey-to-journey relationships.
- This increment extends the existing deterministic workbook ingestion + UX Designer save pattern; it does not yet generate the parent overview diagram.

scope:
- Add support for a 4th workbook worksheet:
  - User Journey Links
- Extend deterministic workbook parsing to read and normalize journey-to-journey relationship rows.
- Extend the UX Designer "Define User Journeys" conversation flow to:
  - summarize detected User Journey Links
  - validate them against known User Journeys
  - ask targeted clarifying questions if needed
- Extend the existing generate/save flow to persist USER_JOURNEY_LINK relationships.
- Extend the final preview/summary so the user can review journey links before save.
- Preserve existing CSV/paste fallback behavior, now including the logical 4th sheet.
- No parent overview diagram generation in this increment.
- No parent/child diagram linking in this increment.

out_of_scope:
- Parent "User Journey Overview" diagram type
- Any new native diagram rendering
- Any new diagram link/navigation behavior
- Diagram generation changes for child USER_JOURNEY diagrams
- Changes to the one-way sync model introduced for saved USER_JOURNEY diagrams
- Macro generation or workbook write-back
- General-purpose XLSX ingestion for other personas/tasks

architectural_intent:
- The workbook remains a structured source for UX Designer input.
- Workbook parsing remains deterministic code, not LLM reasoning.
- The LLM remains responsible for:
  - contextual interpretation
  - minimal clarifying questions
  - save confirmation
- USER_JOURNEY_LINK becomes part of the same architecture-truth ingestion path as USER_JOURNEY and ACTIVITY_STEP.
- The saved architecture after this increment must contain:
  - User Journeys
  - Activity Steps
  - User Journey Links
  all derived from the workbook + clarifications.

required_workbook_structure:
- Workbook must now contain these four logical worksheets:
  1) Process Activities
  2) User Journeys
  3) Activity Steps
  4) User Journey Links
- Sheet-name matching may remain tolerant to whitespace/case variations but not arbitrary alternate names.
- If the workbook is missing "User Journey Links":
  - treat it as optional for backward compatibility, but if present it must validate correctly.
- If present, "User Journey Links" must be parsed and included in the normalized payload.

recommended_User_Journey_Links_worksheet_columns:
- Source User Journey
- Target User Journey
- Relationship Type
- Relationship Label
- Relationship Description

column_rules:
- Source User Journey: required
- Target User Journey: required
- Relationship Type: required
- Relationship Label: optional
- Relationship Description: optional
- Relationship Type must map to supported enum values:
  RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS

parsing_and_normalization_requirements:
- Extend the existing XLSX parser to extract and normalize a new collection:
  user_journey_links:
    - source_user_journey_name
    - target_user_journey_name
    - relationship_type
    - relationship_label
    - relationship_description
- Trim all string values.
- Preserve original row order from the worksheet.
- Ignore fully blank rows.
- Do not silently normalize arbitrary synonyms for relationship types; accept only the supported enum names unless there is already a safe canonicalization pattern in code.
- If relationship type casing/spacing normalization is low-risk, allow it explicitly and deterministically (e.g. trim + uppercase).

backward_compatibility_rule:
- Existing workbooks with only 3 worksheets must continue to work.
- In that case: user_journey_links = []
- UX Designer flow proceeds as before.

conversation_flow_changes:
- Update the UX Designer "Define User Journeys" prompt/config so the assistant now understands a possible 4th worksheet.
- After successful parsing, the assistant should summarize: number of Process Activities, User Journeys, Activity Steps, and User Journey Links.
- The assistant should validate and mention issues such as: unknown source/target journey, self-links, invalid relationship type, duplicates.
- Only targeted clarifying questions where needed.

validation_rules_before_save:
- Source/Target must reference known User Journey names.
- Source and target must not be the same.
- Relationship Type must be one of the supported enum values.
- Exact duplicates should be flagged.
- Missing optional label/description is allowed.
- Unknown journey names should be treated as validation issues requiring clarification before save.

save_flow_requirements:
- Extend the existing generate/save-artifact pattern.
- Add USER_JOURNEY_LINK extraction to the generation payload alongside user_journeys and activity_steps.
- Save behavior aligned with current architecture save conventions.
- Save remains confirmation-driven.

generate_payload_addition:
- Extend the structured generation prompt/template to output user_journey_links.

name_resolution_rules_for_save:
- Resolve names to existing/interpreted USER_JOURNEY by exact name.
- Relationship type must resolve to enum exactly.
- If either source or target cannot be resolved at save time, reject the save payload atomically.
- Do not auto-create placeholder journeys from link rows.

preview_and_summary_requirements:
- Update final structured summary to include User Journey Links in human-readable form.
- If zero links, say so cleanly without making it look like an error.

frontend_and_gateway_changes:
- Extend workbook upload parsing path to surface user_journey_links.
- Update task prompt/configuration only as needed.
- Do not create a new task or task ID.
- Preserve current UX Designer task entry point and routing.

error_handling_behavior:
- Invalid headers on 4th sheet: surface clear error.
- Absent 4th sheet: continue with zero links.
- Row-level issues: continue parsing, surface for clarification, don't silently discard.
- Save remains atomic.

acceptance_criteria:
1. Workbook with 4 sheets (including "User Journey Links") parses successfully; the normalized payload contains user_journey_links[].
2. Workbook with only 3 sheets (no "User Journey Links") still parses successfully; user_journey_links = [].
3. UX Designer summary message after parsing now lists the count of User Journey Links alongside existing counts.
4. Validation surfaces: unknown source/target journey, self-links, invalid relationship type, duplicates.
5. Clarifying questions are generated for validation issues before save.
6. The generate/save flow includes USER_JOURNEY_LINK data in its payload.
7. Saving persists USER_JOURNEY_LINK relationships into the architecture model.
8. Final preview/summary before save shows User Journey Links in human-readable form.
9. If zero links, the summary states this cleanly without error appearance.
10. CSV/paste fallback continues to work for the existing 3 sheets and optionally for the 4th.
11. All existing parser tests continue to pass (regression).
12. New tests cover: 4th-sheet parsing, missing-sheet backward compatibility, validation rules, save-flow inclusion, and summary rendering.

testing_requirements:
- Parser unit tests for 4th-sheet extraction, normalization, and edge cases (missing sheet, invalid headers, blank rows, unsupported relationship types).
- Conversation/integration tests confirming the UX Designer summarizes and validates links correctly.
- Save-flow tests confirming USER_JOURNEY_LINK is included in the generation payload and persisted.
- Regression tests confirming existing 3-sheet workbooks still parse and save correctly.
