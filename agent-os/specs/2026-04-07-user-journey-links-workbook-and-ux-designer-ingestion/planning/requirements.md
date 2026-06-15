# Spec Requirements: User Journey Links Workbook and UX Designer Ingestion

## Initial Description
Extend the existing User Journey workbook ingestion and UX Designer flow so a new worksheet, "User Journey Links", can be parsed, validated, summarized, and persisted into the new first-class USER_JOURNEY_LINK relationship model. Increment 11 introduced USER_JOURNEY_LINK as a first-class Business Architecture relationship; this increment (12) extends the deterministic workbook ingestion and UX Designer save pattern to capture journey-to-journey relationships. No parent overview diagram generation or diagram linking in this increment.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the existing XLSX parser lives in the gateway or mcp-server TypeScript layer (not the Java backend), and uses a library like xlsx/exceljs to read workbook sheets. Is that correct, or does the parsing happen elsewhere?
**Answer:** Yes, parsing should continue to live in the existing TypeScript ingestion layer (gateway if that is where the current UX Designer workbook parsing now lives); do not move parsing into the Java backend in Increment 12.

**Q2:** I assume the USER_JOURNEY_LINK relationship type was already added to the architecture-model-service domain model (entity, repository, service, controller, and DB migration) as part of Increment 11, meaning this spec only needs to wire up the ingestion/save path -- not create the backend persistence layer from scratch. Is that correct?
**Answer:** Correct: assume Increment 11 already completed the USER_JOURNEY_LINK persistence/model foundation, so Increment 12 only extends ingestion, interpretation, generation payloads, and save wiring.

**Q3:** For the CSV/paste fallback behavior mentioned in scope: I assume the user can paste or upload CSV data as an alternative to XLSX for each logical "sheet." Should the 4th sheet (User Journey Links) follow the exact same paste/CSV pattern as the existing 3 sheets, or is there a different mechanism?
**Answer:** Yes, the 4th logical sheet should follow the same existing input pattern as the first 3: XLSX worksheet when a workbook is uploaded, and equivalent CSV/pasted tabular fallback when users do not upload a workbook.

**Q4:** For the UX Designer conversation flow: I assume this is driven by a task configuration file (e.g., a JSON task definition under gateway/src/config/tasks/) and a system prompt (under gateway/src/config/prompts/). The spec says "do not create a new task or task ID" -- I assume we are extending the existing UX Designer task's prompt/config to mention the 4th sheet. Is there a specific task ID or config file name you can point me to?
**Answer:** Yes, extend the existing UX Designer "Define User Journeys" task/config in place; use the same task ID/config file already introduced for that task rather than creating a new one.

**Q5:** For the save flow: I assume the current pattern is that the gateway/mcp-server constructs a structured payload containing user_journeys and activity_steps, then calls an architecture-model-service API endpoint to persist them. For USER_JOURNEY_LINK, should we use the same save endpoint (extending the payload), or does the architecture-model-service already expose a dedicated endpoint for USER_JOURNEY_LINK that we should call separately?
**Answer:** Use the same existing save flow endpoint/payload pattern, extending the payload to include user_journey_links; do not introduce a separate save endpoint for this increment.

**Q6:** For validation of journey names in links: I assume "known User Journeys" means the journeys parsed from the same workbook (sheet 2) plus any journeys already persisted in the architecture model for that project. Is that correct, or should validation only consider the journeys from the current workbook upload?
**Answer:** "Known User Journeys" should mean the journeys from the current workbook interpretation first, plus already-persisted journeys in the current architecture context when that context is available; if there is ambiguity between workbook and existing model, surface it for clarification rather than silently guessing.

**Q7:** For the relationship type enum (RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS): I assume this enum is already defined somewhere in the codebase (either in the Java backend or in a shared TypeScript type). Should the parser validate against this existing enum definition, or should we define it fresh in the parser code?
**Answer:** Validate against the existing canonical relationship-type enum/definition introduced in Increment 11; do not define a second divergent enum in the parser.

**Q8:** Is there anything that should explicitly be excluded from this increment that I haven't already captured in the out_of_scope section? For example, should we avoid any changes to the MetaModel grid view, the dashboard summary cards, or the diagram canvas?
**Answer:** Yes, explicitly avoid changes to the MetaModel grid view, dashboard summary cards, and diagram canvas in Increment 12; this increment is ingestion/conversation/save-path only.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: XLSX User Journey Parser - Path: `gateway/src/services/xlsxUserJourneyParser.ts`
  - Current deterministic parser handling 3 worksheets (Process Activities, User Journeys, Activity Steps) using SheetJS (`xlsx` library)
  - Returns `ParseResult` discriminated union: `{ success: true; csvText: string } | { success: false; error: string }`
  - Uses `REQUIRED_WORKSHEETS` constant array and `REQUIRED_HEADERS` per-sheet lookup
  - Converts sheets to delimited CSV-text blocks with `--- Worksheet: X ---` / `--- End Worksheet: X ---` markers

- Feature: XLSX intercept in chatV2 route - Path: `gateway/src/routes/chatV2.ts` (lines ~2769-2803)
  - Intercepts `.xlsx`/`.xlsm` file uploads when `taskId === 'ux-designer--users-interactions'`
  - Calls `parseUserJourneyWorkbook(file.base64)` and replaces binary attachment with text/plain CSV-text
  - Returns 400 on parse failure

- Feature: UX Designer task config - Path: `gateway/src/config/tasks/ux-designer--users-interactions.json`
  - Task ID: `ux-designer--users-interactions`
  - Menu label: "Define User Journeys"
  - Artifact: `{ "artifactId": "user-journeys", "tool": "save_user_journeys" }`
  - Available from hub and panel

- Feature: UX Designer task prompt - Path: `gateway/src/config/prompts/ux-designer.users-interactions.task.md`
  - Defines conversation flow: request CSV -> parse/validate -> clarifying questions -> final summary -> save confirmation
  - Documents expected column structures for all 3 sheets
  - Defines intermediate structured representation (user_journeys, activity_steps)
  - Contains validation rules (hard/soft) and architecture context cross-referencing logic
  - Currently references "three worksheets" / "three CSV files" throughout

- Feature: UX Designer identity prompt - Path: `gateway/src/config/prompts/ux-designer.identity.md`
  - Persona-level identity (unlikely to need changes)

- Feature: MCP save route - Path: `mcp-server/src/routes/saveUserJourneysRoute.ts`
  - POST route accepting `{ sessionId, projectId, userJourneysJson }`
  - Delegates to `userJourneysService.saveUserJourneys()`

- Feature: User Journeys save service - Path: `mcp-server/src/services/userJourneysService.ts`
  - Core business logic: `parseAndValidate()` + `saveUserJourneys()`
  - GET-merge-PUT strategy against architecture-model-service
  - Name-to-ID resolution for FKs, upsert with CREATED/UPDATED tracking
  - `createEmptyModelShell()` defines model structure (NOTE: relationships section does NOT yet include `user_journey_links`)
  - Currently handles `user_journeys` and `activity_steps` only

- Feature: Save types definition - Path: `mcp-server/src/types/saveUserJourneys.ts`
  - Defines `UserJourneysInput`, `UserJourneyInput`, `ActivityStepInput`, response types
  - Will need extending with `UserJourneyLinkInput` type

- Feature: Gateway tool executor - Path: `gateway/src/services/toolExecutor.ts`
  - Maps `save_user_journeys` to `/mcp/tools/save_user_journeys` with params `['projectId', 'userJourneysJson']`

- Feature: USER_JOURNEY_LINK backend model (Increment 11) - Paths:
  - Entity: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/UserJourneyLinkEntity.java`
    - Fields: id, modelFileId, sourceUserJourneyId, targetUserJourneyId, relationshipType, label, description, tags
  - DTO: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/UserJourneyLinkDto.java`
    - JSON fields: id, source_user_journey_id, target_user_journey_id, relationship_type, label, description, tags
  - Repository: `architecture-model-service/src/main/java/com/example/architecturemodel/repository/relationship/UserJourneyLinkRepository.java`
  - MetaModelRelationshipsDto: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java`
    - Already includes `user_journey_links` field of type `List<UserJourneyLinkDto>`
  - ModelService validation: `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java` (lines ~1272-1286)
    - Defines canonical enum: `Set.of("RELATES_TO", "PRECEDES", "DEPENDS_ON", "OPTIONALLY_LEADS_TO", "TRIGGERS")`
    - Validates relationship_type before save; throws `IllegalArgumentException` on invalid type

- Feature: Frontend relationship definitions - Path: `frontend/src/config/relationshipDefinitions.ts`
  - `user_journey_links` already registered in `RELATIONSHIP_DEFINITIONS` (endpointEntityTypes: ['user_journeys'])
  - Already mapped in `ENTITY_TYPE_TO_DOMAIN` and `RELATIONSHIP_TAB_ORDER`

- Feature: Frontend grid config - Path: `frontend/src/config/gridConfigs.ts`
  - `user_journey_links` grid config already defined (line 579+)

- Feature: Frontend defaults - Path: `frontend/src/config/defaults.ts`
  - `user_journey_links: []` already in default model relationships (line 1266)

- Feature: Existing parser tests - Path: `gateway/src/__tests__/xlsxUserJourneyParser.test.ts`
  - 6 tests covering valid workbook, missing sheet, missing header, extra sheets ignored, xlsm parity, optional columns
  - Uses programmatic workbook creation with `XLSX.utils.book_new()` -- no binary fixtures
  - Helper `createValidWorkbookBase64()` with configurable sheet data and extraSheets option

- Feature: XLSX integration tests - Path: `gateway/src/__tests__/chatV2-xlsx-integration.test.ts`

### Follow-up Questions

No follow-up questions needed. The user's answers were comprehensive and the codebase research confirms all assumptions.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via directory listing).

### Visual Insights:
Not applicable.

## Requirements Summary

### Functional Requirements

**Parser Extension (gateway/src/services/xlsxUserJourneyParser.ts):**
- Add "User Journey Links" as a 4th worksheet to parse, treated as OPTIONAL (not in `REQUIRED_WORKSHEETS`)
- If present, validate required column headers: Source User Journey, Target User Journey, Relationship Type
- Optional columns: Relationship Label, Relationship Description
- Convert 4th sheet to delimited CSV-text block using same `--- Worksheet: User Journey Links ---` / `--- End Worksheet: User Journey Links ---` pattern
- If absent, omit the 4th block (backward compatible with existing 3-sheet workbooks)
- Invalid headers on present 4th sheet: return validation error
- Preserve row order; ignore fully blank rows; trim all string values

**Conversation Flow Extension (gateway/src/config/prompts/ux-designer.users-interactions.task.md):**
- Update prompt to reference 4 worksheets (not 3) throughout
- Add "User Journey Links" to the expected inputs list
- Document expected column structure for CSV 4 (User Journey Links): source_user_journey_name, target_user_journey_name, relationship_type, relationship_label, relationship_description
- Add mapping from XLSX headers to internal field names
- Update "RECOGNISING PRE-PARSED XLSX DATA" section to show 4th worksheet block example
- After parsing, summary must include count of User Journey Links alongside existing counts (Process Activities, User Journeys, Activity Steps)
- Add validation rules for journey links:
  - Hard: unknown source/target journey name, self-links (source == target), invalid relationship type (must be one of RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS), exact duplicates
  - Soft: missing optional label/description
- "Known User Journeys" for validation = journeys from current workbook + already-persisted journeys in architecture context; surface ambiguity for clarification
- Update intermediate structured representation to include `user_journey_links` collection
- Update final summary to include User Journey Links in human-readable form
- If zero links, state cleanly without error appearance
- Update save confirmation question to mention journey links alongside journeys and steps

**Save Flow Extension (mcp-server/src/services/userJourneysService.ts + mcp-server/src/types/saveUserJourneys.ts):**
- Add `UserJourneyLinkInput` type: source_user_journey_name, target_user_journey_name, relationship_type, relationship_label?, relationship_description?
- Extend `UserJourneysInput` to include optional `user_journey_links?: UserJourneyLinkInput[]`
- Extend `parseAndValidate()` to validate user_journey_links:
  - source/target must be non-empty strings
  - source and target must not be the same
  - relationship_type must be one of the 5 canonical enum values
  - source/target must reference a known journey name (from payload or existing model)
  - Flag exact duplicates
- Extend `saveUserJourneys()` to:
  - Resolve source_user_journey_name and target_user_journey_name to IDs using same name-to-ID resolution pattern as activity steps
  - If either cannot be resolved, reject atomically (do not auto-create placeholder journeys)
  - Build `UserJourneyLinkDto`-compatible objects with generated IDs
  - Merge into model's `metaModel.relationships.user_journey_links` array
  - Include in PUT payload
- Extend `createEmptyModelShell()` to include `user_journey_links: []` in relationships
- Extend response summary to include userJourneyLinks counts (created/updated)

**Generation Payload Extension:**
- The LLM's structured output when phase is "ready" must include `user_journey_links` alongside `user_journeys` and `activity_steps` in the JSON payload passed to the save tool

**No New Endpoints or Tasks:**
- Extend existing `save_user_journeys` MCP tool payload; do not create a new tool or route
- Task ID remains `ux-designer--users-interactions`; no new task config file

### Reusability Opportunities

- XLSX parser pattern: Extend `REQUIRED_WORKSHEETS` vs adding a separate `OPTIONAL_WORKSHEETS` concept for the 4th sheet
- CSV-text block format: Reuse identical `--- Worksheet: X ---` delimited block pattern
- Save service: Follow identical GET-merge-PUT, name-to-ID resolution, and upsert pattern already established for user_journeys and activity_steps
- Relationship type enum: Reference the canonical enum already defined in `ModelService.java` (line 1274); mirror the same values in TypeScript validation
- `createValidWorkbookBase64()` test helper: Already supports `extraSheets` option -- can be used to add 4th sheet in test fixtures
- `UserJourneyLinkDto` fields map directly to the DTO already accepted by the backend

### Scope Boundaries

**In Scope:**
- XLSX parser: add optional 4th worksheet parsing for "User Journey Links"
- Task prompt: update UX Designer prompt to summarize, validate, and clarify journey links
- Save service: extend parseAndValidate, saveUserJourneys, types, and response to handle user_journey_links
- Generation payload: include user_journey_links in the structured output emitted by the LLM
- CSV/paste fallback: 4th sheet data can be pasted as CSV same as other 3 sheets
- Backward compatibility: existing 3-sheet workbooks continue working (user_journey_links = [])
- Tests: parser unit tests, conversation/integration tests, save-flow tests, regression tests

**Out of Scope:**
- Parent "User Journey Overview" diagram type
- Any new native diagram rendering
- Any new diagram link/navigation behavior
- Diagram generation changes for child USER_JOURNEY diagrams
- Changes to the one-way sync model introduced for saved USER_JOURNEY diagrams
- Macro generation or workbook write-back
- General-purpose XLSX ingestion for other personas/tasks
- MetaModel grid view changes (already has user_journey_links grid config from Increment 11)
- Dashboard summary card changes
- Diagram canvas changes
- Creating new backend persistence layer (already done in Increment 11)
- Creating new MCP tools or task IDs

### Technical Considerations

- **Relationship type validation must be consistent**: The canonical enum is `Set.of("RELATES_TO", "PRECEDES", "DEPENDS_ON", "OPTIONALLY_LEADS_TO", "TRIGGERS")` defined in `ModelService.java`. The TypeScript parser/validator must use the exact same values. Safe normalization: trim + uppercase is acceptable.
- **Parser returns CSV-text, not structured objects**: The current parser converts sheets to CSV-text for the LLM to interpret. The 4th sheet follows this same pattern -- the parser produces CSV-text, and the LLM interprets it into the structured intermediate representation.
- **Model shell must be updated**: `createEmptyModelShell()` in `userJourneysService.ts` currently does not include `user_journey_links` in its relationships section. This must be added to prevent null reference errors during merge.
- **Backend already supports user_journey_links in PUT**: The `MetaModelRelationshipsDto` already has the `user_journey_links` field, and `ModelService` already validates and persists them. The save service just needs to populate this field.
- **Name-to-ID resolution for links**: Links reference journeys by name. Resolution must check: (1) journeys being saved in the current payload (by name), (2) journeys already in the existing model (fetched via GET). If unresolvable, reject atomically.
- **Atomic save**: If any link has an unresolvable source or target journey, the entire save must fail -- no partial persistence of valid links while skipping invalid ones.
- **Optional 4th sheet in parser**: Unlike the 3 required worksheets, the 4th is optional. The parser must introduce an "optional worksheet" concept or handle it separately from the required worksheet validation loop.
- **Existing test helper supports extension**: `createValidWorkbookBase64({ extraSheets: { 'User Journey Links': [...] } })` can already add a 4th sheet for testing; however, the parser must be updated to actually process it rather than silently ignoring it.

### Acceptance Criteria (from initialization.md)

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

### Testing Requirements

- **Parser unit tests** (`gateway/src/__tests__/xlsxUserJourneyParser.test.ts` or new file):
  - 4th sheet present with valid data: parse succeeds, CSV-text contains User Journey Links block
  - 4th sheet absent (3-sheet workbook): parse succeeds, no User Journey Links block in output
  - 4th sheet present with invalid headers: parse fails with descriptive error
  - 4th sheet with blank rows: blank rows ignored
  - 4th sheet with unsupported relationship type values: included in CSV-text (validation is LLM/save-side, not parser-side)
  - Existing 6 tests continue to pass unchanged (regression)

- **Conversation/integration tests**:
  - UX Designer summarizes link count correctly after workbook parsing
  - UX Designer identifies and surfaces validation issues (unknown journey, self-link, invalid type, duplicates)
  - UX Designer generates clarifying questions for link validation issues
  - UX Designer includes links in final summary before save confirmation
  - Zero links displayed cleanly in summary

- **Save-flow tests** (`mcp-server` level):
  - `parseAndValidate()` accepts payload with user_journey_links and validates correctly
  - `parseAndValidate()` rejects self-links, invalid relationship types, unknown journey references
  - `saveUserJourneys()` includes user_journey_links in the PUT payload to architecture-model-service
  - `saveUserJourneys()` resolves journey names to IDs for link source/target
  - `saveUserJourneys()` rejects atomically when link references unresolvable journey
  - Response summary includes userJourneyLinks counts

- **Regression tests**:
  - Existing 3-sheet workbooks parse and save correctly with zero links
  - All existing parser tests pass unchanged
  - All existing save-flow tests pass unchanged
