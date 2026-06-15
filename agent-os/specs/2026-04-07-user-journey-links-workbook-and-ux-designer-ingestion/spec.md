# Specification: User Journey Links Workbook and UX Designer Ingestion

## Goal
Extend the existing User Journey workbook ingestion and UX Designer conversation flow to parse, validate, summarize, and persist a 4th worksheet ("User Journey Links") into the USER_JOURNEY_LINK relationship model introduced in Increment 11, completing the ingestion path for journey-to-journey relationships.

## User Stories
- As a UX Designer persona user, I want to upload a workbook that includes a "User Journey Links" sheet so that journey-to-journey relationships are captured alongside journeys and activity steps in a single ingestion flow.
- As a UX Designer persona user, I want validation feedback on my journey link data (unknown journeys, self-links, invalid types) so that I can correct issues before saving.

## Specific Requirements

**Optional 4th Worksheet Parsing**
- Add `User Journey Links` as an OPTIONAL worksheet in `xlsxUserJourneyParser.ts`; do NOT add it to the `REQUIRED_WORKSHEETS` array
- If the sheet is present, validate required column headers: `Source User Journey`, `Target User Journey`, `Relationship Type`; optional headers: `Relationship Label`, `Relationship Description`
- If the sheet is present but has invalid headers, return a validation error (same `ParseResult` failure pattern as required sheets)
- If the sheet is absent, succeed with zero links and omit the 4th CSV-text block (backward compatible)
- When present, convert to the same delimited format: `--- Worksheet: User Journey Links ---` / `--- End Worksheet: User Journey Links ---`
- Append the 4th block after the existing 3 blocks in the output `csvText`
- Preserve row order, ignore fully blank rows, trim all string values (same behavior as existing sheets)
- Do NOT validate relationship type values at the parser level; the parser produces CSV-text for downstream LLM/save-side validation

**UX Designer Task Prompt Extension**
- Update `ux-designer.users-interactions.task.md` to reference 4 worksheets/CSV inputs instead of 3 throughout
- Add "User Journey Links" to the FIRST TURN request, RECOGNISING PRE-PARSED XLSX DATA section (with example block), EXPECTED CSV COLUMN STRUCTURES section, and INTERMEDIATE STRUCTURED REPRESENTATION section
- CSV 4 columns: `source_user_journey_name`, `target_user_journey_name`, `relationship_type`, `relationship_label` (optional), `relationship_description` (optional)
- Add XLSX header-to-internal-field mapping: "Source User Journey" -> `source_user_journey_name`, "Target User Journey" -> `target_user_journey_name`, "Relationship Type" -> `relationship_type`, "Relationship Label" -> `relationship_label`, "Relationship Description" -> `relationship_description`
- Add validation rules for links: Hard errors for unknown source/target journey name, self-links (source == target), invalid relationship type (must be one of RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS), and exact duplicates; Soft warnings for missing optional label/description
- "Known User Journeys" for validation = journeys parsed from the current workbook first, plus already-persisted journeys from architecture context; surface ambiguity for clarification rather than guessing
- Update summary counts to include User Journey Links alongside Process Activities, User Journeys, and Activity Steps
- Update final summary before save confirmation to show User Journey Links in human-readable form; if zero links, state cleanly without error appearance
- Update save confirmation question to mention journey links

**Save Types Extension**
- Add `UserJourneyLinkInput` interface to `mcp-server/src/types/saveUserJourneys.ts` with fields: `source_user_journey_name` (string, required), `target_user_journey_name` (string, required), `relationship_type` (string, required), `relationship_label` (string, optional), `relationship_description` (string, optional)
- Extend `UserJourneysInput` to include `user_journey_links?: UserJourneyLinkInput[]`
- Add `UserJourneyLinkEntityResult` type with fields matching the existing `EntityResult` pattern (id, status)
- Extend `SaveUserJourneysResponse.summary` to include `userJourneyLinks: { created: number; updated: number }`
- Extend `SaveUserJourneysResponse.entities` to include `userJourneyLinks: UserJourneyLinkEntityResult[]`

**parseAndValidate Extension**
- Parse the optional `user_journey_links` array from the JSON input; default to `[]` if absent
- Validate each link: `source_user_journey_name` and `target_user_journey_name` must be non-empty strings
- Validate source and target must not be the same (case-insensitive comparison after trim)
- Validate `relationship_type` must be one of the 5 canonical enum values: `RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS`; accept trim + uppercase normalization
- Validate source and target journey names reference a journey in the payload's `user_journeys` array (note: existing-model resolution happens at save time, not parse time)
- Flag exact duplicate links (same source, target, and relationship_type after normalization)

**saveUserJourneys Extension**
- After resolving user_journeys and activity_steps, resolve each link's `source_user_journey_name` and `target_user_journey_name` to IDs using the same name-to-ID resolution pattern: check `journeyIdByName` map (current payload) first, then `findEntityByName` against existing model journeys
- If either source or target cannot be resolved, reject atomically with a 400 error (do NOT auto-create placeholder journeys and do NOT partially persist valid links)
- Build `UserJourneyLinkDto`-compatible objects: `{ id, source_user_journey_id, target_user_journey_id, relationship_type, label, description, tags: null }`
- Generate IDs with prefix `ujl-` using the existing `generateId()` utility
- Upsert key: `(source_user_journey_id, target_user_journey_id, relationship_type)`; if an existing link matches, reuse its ID (UPDATED); otherwise generate a new ID (CREATED)
- Merge into `base.metaModel.relationships.user_journey_links` array using the same replace-or-append pattern used for user_journeys and activity_steps
- Include `user_journey_links` in the PUT payload sent to architecture-model-service

**createEmptyModelShell Extension**
- Add `user_journey_links: []` to the `relationships` object in `createEmptyModelShell()` so that merge operations do not encounter null/undefined

**LLM Generation Payload**
- When the UX Designer prompt phase transitions to "ready", the LLM's structured JSON output must include `user_journey_links` alongside `user_journeys` and `activity_steps` in the `userJourneysJson` payload passed to the `save_user_journeys` tool
- This is prompt-driven behavior; no code changes beyond the prompt update are needed for this requirement

**Backward Compatibility**
- Existing 3-sheet workbooks must continue to parse and save correctly with `user_journey_links = []`
- The `save_user_journeys` tool endpoint, route, and parameter names remain unchanged
- The task ID remains `ux-designer--users-interactions`; no new task config file, no new MCP tool

## Visual Design
No visual assets provided. This increment is ingestion/conversation/save-path only with no UI changes.

## Existing Code to Leverage

**XLSX Parser (`gateway/src/services/xlsxUserJourneyParser.ts`)**
- Uses `REQUIRED_WORKSHEETS` array and `REQUIRED_HEADERS` record for validation; the 4th sheet should use a separate `OPTIONAL_WORKSHEETS` / `OPTIONAL_HEADERS` concept rather than modifying the required constants
- `getSheetHeaders()` helper extracts and normalizes headers from a sheet; reuse for 4th sheet validation
- `XLSX.utils.sheet_to_csv()` conversion and `--- Worksheet: X ---` delimiter pattern should be reused identically for the 4th block
- Existing test helper `createValidWorkbookBase64()` already accepts `extraSheets` parameter for adding arbitrary sheets; use this to add "User Journey Links" test data

**Save Service (`mcp-server/src/services/userJourneysService.ts`)**
- GET-merge-PUT strategy with `archModelClient.getModel()`/`putModel()` is the established save pattern; extend it, do not create a new flow
- `findEntityByName()` helper provides case-insensitive name-to-ID resolution; reuse for resolving link source/target journey names
- `journeyIdByName` map (built during journey upsert) provides current-payload resolution; check it first before falling back to existing model
- The merge pattern (find existing by key, replace if found, append if new) should be replicated for `user_journey_links` using the upsert key `(source_user_journey_id, target_user_journey_id, relationship_type)`

**Backend Model (`architecture-model-service`)**
- `MetaModelRelationshipsDto` already includes `user_journey_links` field of type `List<UserJourneyLinkDto>`
- `ModelService.java` (line 1272-1286) already validates `relationship_type` against the canonical enum and persists links via `userJourneyLinkRepository.saveAll()`
- `UserJourneyLinkDto` record defines the exact JSON field names the backend expects: `id`, `source_user_journey_id`, `target_user_journey_id`, `relationship_type`, `label`, `description`, `tags`

**Frontend Type Definitions (Increment 11)**
- `UserJourneyLinkRelationshipType` union type and `userJourneyLinkTypeOptions` array define the canonical 5 enum values; the TypeScript validation in the save service must mirror these exact values
- `UserJourneyLink` interface in `frontend/src/types/model.ts` confirms the field shape; no frontend changes needed in this increment

**chatV2 XLSX Intercept (`gateway/src/routes/chatV2.ts` lines 2769-2803)**
- The intercept calls `parseUserJourneyWorkbook(file.base64)` and replaces binary with text/plain CSV-text; no changes needed to the intercept logic since the parser itself will produce the 4th block when the sheet is present

## Out of Scope
- Parent "User Journey Overview" diagram type or any new diagram rendering
- Any new diagram link/navigation behavior or diagram generation changes
- Changes to the one-way sync model for saved USER_JOURNEY diagrams
- Macro generation or workbook write-back
- General-purpose XLSX ingestion for other personas/tasks
- MetaModel grid view changes (already has user_journey_links grid config from Increment 11)
- Dashboard summary card changes
- Diagram canvas changes
- Creating new backend persistence layer or DB migrations (already done in Increment 11)
- Creating new MCP tools, routes, or task IDs
