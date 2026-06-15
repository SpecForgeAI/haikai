# Task Breakdown: User Journey Links Workbook and UX Designer Ingestion

## Overview
Total Tasks: 29 sub-tasks across 5 task groups

This increment extends the existing User Journey workbook ingestion and UX Designer conversation flow to parse, validate, summarize, and persist a 4th optional worksheet ("User Journey Links") into the USER_JOURNEY_LINK relationship model introduced in Increment 11. No UI changes, no new backend persistence, no new MCP tools or task IDs.

## Task List

### XLSX Parser Extension (Gateway)

#### Task Group 1: Optional 4th Worksheet Parsing
**Dependencies:** None
**Files:** `gateway/src/services/xlsxUserJourneyParser.ts`, `gateway/src/__tests__/xlsxUserJourneyParser.test.ts`

- [x] 1.0 Complete XLSX parser extension for optional "User Journey Links" worksheet
  - [x] 1.1 Write 6 focused tests for the 4th worksheet parsing behavior
    - Test 1: Workbook with valid 4th sheet ("User Journey Links") parses successfully; output csvText contains `--- Worksheet: User Journey Links ---` block with header and data rows appended after the 3 required blocks
    - Test 2: Workbook with only 3 sheets (no "User Journey Links") parses successfully with no User Journey Links block in output (backward compatibility)
    - Test 3: 4th sheet present with invalid/missing required headers returns `{ success: false, error: ... }` mentioning the missing header name
    - Test 4: 4th sheet with blank rows has blank rows excluded from CSV-text output (same behavior as required sheets -- SheetJS handles this, but verify)
    - Test 5: 4th sheet with only required headers (no optional Relationship Label / Relationship Description columns) still parses successfully
    - Test 6: 4th sheet with unsupported relationship type values in data rows is included in CSV-text without parser-level rejection (validation is downstream)
    - Use existing `createValidWorkbookBase64({ extraSheets: { 'User Journey Links': [...] } })` helper pattern
  - [x] 1.2 Add optional worksheet constants
    - Add `OPTIONAL_WORKSHEETS` constant: `['User Journey Links']`
    - Add `OPTIONAL_HEADERS` record: `{ 'User Journey Links': ['Source User Journey', 'Target User Journey', 'Relationship Type'] }`
    - Do NOT modify the existing `REQUIRED_WORKSHEETS` or `REQUIRED_HEADERS` constants
  - [x] 1.3 Implement optional sheet validation in `parseUserJourneyWorkbook()`
    - After required worksheet validation passes, check if each optional worksheet exists in `workbook.SheetNames`
    - If present, validate required column headers using the same `getSheetHeaders()` + case-insensitive comparison pattern
    - If present but headers invalid, return `{ success: false, error: 'Worksheet "User Journey Links" is missing required column header: ...' }`
    - If absent, skip silently (no error, no output block)
  - [x] 1.4 Implement optional sheet CSV-text block generation
    - After converting the 3 required worksheets to delimited blocks, iterate over `OPTIONAL_WORKSHEETS`
    - For each present optional sheet, convert using `XLSX.utils.sheet_to_csv(sheet)` and wrap in `--- Worksheet: User Journey Links ---` / `--- End Worksheet: User Journey Links ---` delimiters
    - Append optional blocks after the 3 required blocks in the output `csvText`
    - Use `blocks.join('\n')` to concatenate (same existing pattern)
  - [x] 1.5 Verify all parser tests pass
    - Run the 6 new tests from 1.1
    - Run the existing 6 tests to confirm regression-free behavior
    - Total: 12 tests in `xlsxUserJourneyParser.test.ts`

**Acceptance Criteria:**
- 4-sheet workbook parses successfully with 4th CSV-text block appended
- 3-sheet workbook continues to parse successfully with no 4th block (backward compatible)
- Invalid headers on present 4th sheet return a descriptive validation error
- All 12 parser tests (6 existing + 6 new) pass

---

### Save Types and Validation (MCP Server)

#### Task Group 2: Type Definitions and parseAndValidate Extension
**Dependencies:** None (can run in parallel with Task Group 1)
**Files:** `mcp-server/src/types/saveUserJourneys.ts`, `mcp-server/src/services/userJourneysService.ts`

- [x] 2.0 Complete type definitions and validation for user journey links
  - [x] 2.1 Write 8 focused tests for parseAndValidate link validation
    - Test 1: Payload with valid `user_journey_links` array parses without errors; links are present in returned `input`
    - Test 2: Payload without `user_journey_links` field parses successfully with `user_journey_links` defaulting to `[]`
    - Test 3: Link with empty `source_user_journey_name` produces a validation error
    - Test 4: Link with empty `target_user_journey_name` produces a validation error
    - Test 5: Self-link (source == target, case-insensitive after trim) produces a validation error
    - Test 6: Link with invalid `relationship_type` (not one of the 5 canonical values) produces a validation error
    - Test 7: Link with valid `relationship_type` after trim + uppercase normalization passes (e.g., " precedes " normalizes to "PRECEDES")
    - Test 8: Exact duplicate links (same source, target, and relationship_type after normalization) produce a validation error
    - Place tests in `mcp-server/src/__tests__/userJourneysService.linkValidation.test.ts` or extend existing test file
  - [x] 2.2 Add `UserJourneyLinkInput` interface to `saveUserJourneys.ts`
    - Fields: `source_user_journey_name` (string, required), `target_user_journey_name` (string, required), `relationship_type` (string, required), `relationship_label` (string, optional), `relationship_description` (string, optional)
  - [x] 2.3 Extend `UserJourneysInput` interface
    - Add `user_journey_links?: UserJourneyLinkInput[]`
  - [x] 2.4 Add response types for link results
    - Add `UserJourneyLinkEntityResult` interface: `{ sourceJourneyName: string; targetJourneyName: string; relationshipType: string; id: string; status: EntityStatus }`
    - Extend `SaveUserJourneysResponse.summary` to include `userJourneyLinks: { created: number; updated: number }`
    - Extend `SaveUserJourneysResponse.entities` to include `userJourneyLinks: UserJourneyLinkEntityResult[]`
  - [x] 2.5 Extend `parseAndValidate()` to handle `user_journey_links`
    - Parse optional `user_journey_links` array from JSON; default to `[]` if absent or not an array
    - Add `user_journey_links` to the returned `input` object
    - Define canonical relationship types constant: `['RELATES_TO', 'PRECEDES', 'DEPENDS_ON', 'OPTIONALLY_LEADS_TO', 'TRIGGERS']` (mirror `ModelService.java` enum)
    - For each link, validate:
      - `source_user_journey_name` is a non-empty string (after trim)
      - `target_user_journey_name` is a non-empty string (after trim)
      - Source and target are not the same (case-insensitive comparison after trim)
      - `relationship_type` after trim + uppercase is one of the 5 canonical values
      - Source and target journey names exist in the payload's `user_journeys` array (case-insensitive name match using the existing `journeyNames` set)
    - Detect exact duplicate links: same (source, target, relationship_type) after normalization
  - [x] 2.6 Verify parseAndValidate tests pass
    - Run the 8 new tests from 2.1
    - Run existing parseAndValidate tests to confirm no regressions

**Acceptance Criteria:**
- New type interfaces compile without errors
- parseAndValidate correctly validates link fields, self-links, invalid types, duplicates
- Absent `user_journey_links` defaults to empty array without errors
- Trim + uppercase normalization works for relationship_type
- All validation tests pass

---

### Save Flow Extension (MCP Server)

#### Task Group 3: saveUserJourneys Link Persistence
**Dependencies:** Task Group 2
**Files:** `mcp-server/src/services/userJourneysService.ts`

- [x] 3.0 Complete save flow extension for user journey links
  - [x] 3.1 Write 6 focused tests for save flow link handling
    - Test 1: `saveUserJourneys()` with valid links resolves journey names to IDs and includes `user_journey_links` in the PUT payload sent to architecture-model-service
    - Test 2: `saveUserJourneys()` with a link referencing an unresolvable journey name (not in payload and not in existing model) throws a 400 error atomically
    - Test 3: `saveUserJourneys()` response summary includes `userJourneyLinks: { created: N, updated: M }` counts
    - Test 4: `saveUserJourneys()` with zero links succeeds; response includes `userJourneyLinks: { created: 0, updated: 0 }` (backward compatibility)
    - Test 5: Upsert behavior -- link matching existing (source_id, target_id, relationship_type) reuses existing ID and reports UPDATED; new link generates fresh `ujl-` prefixed ID and reports CREATED
    - Test 6: Link source resolves via `journeyIdByName` map (current payload) first, then falls back to `findEntityByName` against existing model journeys
    - Place tests in `mcp-server/src/__tests__/userJourneysService.linkSave.test.ts` or extend existing test file
    - Mock `archModelClient.getProjectById`, `archModelClient.getModel`, and `archModelClient.putModel` using existing Jest mock patterns
  - [x] 3.2 Update `createEmptyModelShell()` to include `user_journey_links`
    - Add `user_journey_links: []` to the `relationships` object so merge operations do not encounter null/undefined
  - [x] 3.3 Implement link resolution and upsert in `saveUserJourneys()`
    - After journey upsert (Step 6), resolve each link's source and target journey names to IDs:
      - Check `journeyIdByName` map first (current payload journeys)
      - Fall back to `findEntityByName(existingUserJourneys, name)` for existing model journeys
    - If either source or target cannot be resolved, throw `createHttpError(400, ...)` with descriptive error message (atomic rejection -- no partial link persistence)
    - Build `UserJourneyLinkDto`-compatible objects: `{ id, source_user_journey_id, target_user_journey_id, relationship_type, label, description, tags: null }`
    - Generate IDs with prefix `ujl-` using existing `generateId()` utility
    - Normalize `relationship_type` to uppercase before building DTO
    - Upsert key: `(source_user_journey_id, target_user_journey_id, relationship_type)`
    - If existing link matches the upsert key in `base.metaModel.relationships.user_journey_links`, reuse its ID (UPDATED); otherwise generate new ID (CREATED)
  - [x] 3.4 Implement link merge into model
    - Ensure `base.metaModel.relationships.user_journey_links` is an array (use `ensureArray` pattern or direct check)
    - Merge upserted links using the same replace-or-append pattern used for user_journeys and activity_steps
    - Include `user_journey_links` in the model object sent to `archModelClient.putModel()`
  - [x] 3.5 Extend response to include link results
    - Build `linkResults` array with `UserJourneyLinkEntityResult` entries for each processed link
    - Add `userJourneyLinks` to `summary`: `{ created: ..., updated: ... }`
    - Add `userJourneyLinks` to `entities`: array of `UserJourneyLinkEntityResult`
  - [x] 3.6 Verify save flow tests pass
    - Run the 6 new tests from 3.1
    - Run existing save flow tests to confirm no regressions

**Acceptance Criteria:**
- Links with resolvable journey names are persisted via PUT to architecture-model-service
- Unresolvable journey name in any link causes atomic 400 rejection
- Upsert correctly distinguishes CREATED vs UPDATED based on composite key
- Response includes accurate link counts and entity results
- Zero-link payloads continue to work identically (backward compatible)
- `createEmptyModelShell()` includes `user_journey_links: []` in relationships

---

### UX Designer Prompt Extension (Gateway)

#### Task Group 4: Task Prompt Updates
**Dependencies:** Task Groups 1-3 (prompt references all behaviors implemented above)
**Files:** `gateway/src/config/prompts/ux-designer.users-interactions.task.md`

- [x] 4.0 Complete UX Designer task prompt extension for journey links
  - [x] 4.1 Write 4 focused tests for prompt-driven conversation behavior
    - Test 1: When 4-sheet workbook CSV-text is provided (including `--- Worksheet: User Journey Links ---` block), the LLM response summary includes a count of User Journey Links alongside Process Activities, User Journeys, and Activity Steps
    - Test 2: When 3-sheet workbook CSV-text is provided (no User Journey Links block), the summary states zero links cleanly without error appearance
    - Test 3: When the LLM phase is "ready", the structured JSON output includes `user_journey_links` array in the `userJourneysJson` payload alongside `user_journeys` and `activity_steps`
    - Test 4: Save confirmation question mentions journey links alongside journeys and steps
    - Place tests in `gateway/src/__tests__/ux-designer-journey-links-prompt.test.ts`
    - These may be structural/contract tests verifying the prompt content rather than full LLM integration tests
  - [x] 4.2 Update FIRST TURN section to reference 4 inputs
    - Change "three CSV files" / "three worksheets" references to "three required inputs plus an optional fourth"
    - Add 4th input to the list: **User Journey Links** -- defines relationships between user journeys
    - Update the upload request question to mention "User Journey Links (optional)" as a 4th worksheet
  - [x] 4.3 Update RECOGNISING PRE-PARSED XLSX DATA section
    - Add example 4th delimited block:
      ```
      --- Worksheet: User Journey Links ---
      Source User Journey,Target User Journey,Relationship Type,Relationship Label,Relationship Description
      Customer Onboarding,Product Purchase,PRECEDES,Onboarding leads to purchase,After onboarding the user typically purchases
      --- End Worksheet: User Journey Links ---
      ```
    - Add XLSX header-to-internal-field mapping entries:
      - "Source User Journey" -> `source_user_journey_name`
      - "Target User Journey" -> `target_user_journey_name`
      - "Relationship Type" -> `relationship_type`
      - "Relationship Label" -> `relationship_label`
      - "Relationship Description" -> `relationship_description`
    - Note that this 4th block may be absent (optional worksheet)
  - [x] 4.4 Add CSV 4 column structure to EXPECTED CSV COLUMN STRUCTURES section
    - Add new subsection: `### CSV 4 -- User Journey Links (Optional)`
    - Columns: `source_user_journey_name` (required), `target_user_journey_name` (required), `relationship_type` (required, one of RELATES_TO / PRECEDES / DEPENDS_ON / OPTIONALLY_LEADS_TO / TRIGGERS), `relationship_label` (optional), `relationship_description` (optional)
  - [x] 4.5 Update INTERMEDIATE STRUCTURED REPRESENTATION section
    - Add `user_journey_links` collection table:
      - `source_user_journey_name` (string, required) -- maps to UserJourneyLinkDto.sourceUserJourneyId (by name lookup)
      - `target_user_journey_name` (string, required) -- maps to UserJourneyLinkDto.targetUserJourneyId (by name lookup)
      - `relationship_type` (string, required) -- maps to UserJourneyLinkDto.relationshipType
      - `relationship_label` (string, optional) -- maps to UserJourneyLinkDto.label
      - `relationship_description` (string, optional) -- maps to UserJourneyLinkDto.description
  - [x] 4.6 Add link validation rules to VALIDATION RULES section
    - Hard errors: unknown source/target journey name (not in current workbook and not in architecture context), self-links (source == target), invalid relationship type (must be one of the 5 canonical values), exact duplicates (same source, target, and type)
    - Soft warnings: missing optional `relationship_label`, missing optional `relationship_description`
    - "Known User Journeys" for validation = journeys parsed from current workbook first, plus already-persisted journeys from architecture context; surface ambiguity for clarification rather than guessing
  - [x] 4.7 Update CONVERSATION FLOW section
    - Turn 1: update request to mention 4 worksheets (3 required + 1 optional)
    - Summary counts: include User Journey Links count alongside Process Activities, User Journeys, and Activity Steps
    - Final summary: include User Journey Links in human-readable form; if zero links, state cleanly (e.g., "No User Journey Links provided.")
    - Save confirmation question: update to "Would you like me to save these user journeys, activity steps, and journey links to the architecture model?"
    - "ready" phase: ensure the structured JSON output schema documents `user_journey_links` alongside `user_journeys` and `activity_steps`
  - [x] 4.8 Verify prompt tests pass
    - Run the 4 tests from 4.1
    - Verify prompt file is well-formed markdown

**Acceptance Criteria:**
- Prompt references 4 worksheets/inputs throughout (3 required + 1 optional)
- CSV 4 column structure is documented with correct field names
- Link validation rules are clearly specified (hard errors + soft warnings)
- Summary, save confirmation, and "ready" phase all include journey links
- Zero links handled cleanly in summary without error appearance
- All 4 prompt tests pass

---

### Test Review and Gap Analysis

#### Task Group 5: Test Review and Critical Gap Fill
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review all tests and fill critical gaps
  - [x] 5.1 Review tests written by Task Groups 1-4
    - Review the 6 parser tests from Task Group 1 (1.1)
    - Review the 8 parseAndValidate tests from Task Group 2 (2.1)
    - Review the 6 save flow tests from Task Group 3 (3.1)
    - Review the 4 prompt/conversation tests from Task Group 4 (4.1)
    - Total existing new tests: 24 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Verify backward compatibility path is tested (3-sheet workbook through full save flow producing zero links)
    - Verify the XLSX intercept in `chatV2.ts` still works correctly (no code changes needed, but confirm the 4th block flows through the intercept path unchanged)
    - Verify `createEmptyModelShell()` change does not break existing save flows
    - Check that response type extensions are backward compatible (existing consumers receiving new `userJourneyLinks` field)
    - Check that relationship_type normalization edge cases are covered (mixed case, whitespace, etc.)
  - [x] 5.3 Write up to 6 additional tests to fill critical gaps
    - Gap test 1 (end-to-end regression): 3-sheet workbook parsed, passed to `saveUserJourneys()` with no `user_journey_links` field; response includes `userJourneyLinks: { created: 0, updated: 0 }` and PUT payload has `user_journey_links: []`
    - Gap test 2 (integration): 4-sheet workbook parsed by XLSX parser, CSV-text output fed to save flow; links are correctly persisted end-to-end
    - Gap test 3 (edge case): Link where source journey is in the current payload but target journey is only in the existing model (cross-resolution); both resolve successfully
    - Gap test 4 (edge case): Link with all 5 valid relationship types tested (RELATES_TO, PRECEDES, DEPENDS_ON, OPTIONALLY_LEADS_TO, TRIGGERS); all pass validation
    - Gap test 5 (atomic rejection): Payload with 3 valid links and 1 link referencing unknown journey; entire save fails with 400 (no partial persistence)
    - Gap test 6 (idempotency): Same link payload saved twice; second save reports all links as UPDATED with same IDs
  - [x] 5.4 Run all feature-specific tests
    - Run all tests from Task Groups 1-4 plus gap-fill tests from 5.3
    - Expected total: approximately 30 tests
    - Verify the existing 6 parser tests still pass (regression)
    - Do NOT run the entire application test suite

**Acceptance Criteria:**
- All approximately 30 feature-specific tests pass
- Backward compatibility verified: 3-sheet workbooks work end-to-end with zero links
- Cross-resolution (payload + existing model) for link journey names is tested
- Atomic rejection of invalid links is tested
- No more than 6 additional tests added in gap fill
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1 (XLSX Parser)** and **Task Group 2 (Types and Validation)** -- these are independent and can run in parallel
2. **Task Group 3 (Save Flow)** -- depends on Task Group 2 (type definitions and validation must exist)
3. **Task Group 4 (UX Designer Prompt)** -- depends on Task Groups 1-3 (prompt references all implemented behaviors)
4. **Task Group 5 (Test Review and Gap Fill)** -- depends on all preceding groups

```
Task Group 1 (Parser) ──────────────────────┐
                                             ├──> Task Group 3 (Save Flow) ──> Task Group 4 (Prompt) ──> Task Group 5 (Test Review)
Task Group 2 (Types & Validation) ──────────┘
```

## Key Implementation Notes

- **No backend changes**: The `architecture-model-service` already has `UserJourneyLinkEntity`, `UserJourneyLinkDto`, `UserJourneyLinkRepository`, and `ModelService` validation from Increment 11. This increment only wires up the ingestion/save path.
- **No new routes or tools**: The existing `save_user_journeys` MCP tool endpoint and `ux-designer--users-interactions` task ID are reused as-is.
- **No UI changes**: This is ingestion/conversation/save-path only. The MetaModel grid already has `user_journey_links` config from Increment 11.
- **Canonical relationship types**: `RELATES_TO`, `PRECEDES`, `DEPENDS_ON`, `OPTIONALLY_LEADS_TO`, `TRIGGERS` -- must match `ModelService.java` exactly.
- **Backward compatibility is critical**: Existing 3-sheet workbooks must continue to parse and save correctly with `user_journey_links = []` at every stage.
