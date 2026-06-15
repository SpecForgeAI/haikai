# Task Breakdown: UX Designer XLSX Ingestion for User Journeys

## Overview
Total Tasks: 4 Task Groups, ~28 sub-tasks

This feature enables business users to upload `.xlsx` or `.xlsm` workbooks containing User Journey data directly into the "Define User Journeys" chat. The gateway deterministically parses the workbook into delimited CSV-text blocks before the LLM sees it, preserving full compatibility with the existing prompt and conversation pipeline.

## Task List

### Gateway Backend

#### Task Group 1: XLSX Parser Module
**Dependencies:** None

- [x] 1.0 Complete XLSX parser module
  - [x] 1.1 Write 6 focused tests for the parser module
    - Test: valid `.xlsx` workbook with all three required worksheets produces correct delimited CSV-text output with `--- Worksheet: X ---` / `--- End Worksheet: X ---` wrappers
    - Test: workbook missing a required worksheet (e.g., "Activity Steps") returns a validation error naming the missing sheet
    - Test: worksheet missing a required column header (e.g., `journey_name` absent from "User Journeys") returns a validation error naming the missing header
    - Test: workbook with extra worksheets beyond the three required ones ignores them silently and produces correct output
    - Test: `.xlsm` file content is parsed identically to `.xlsx` (macro content is ignored)
    - Test: workbook with only optional columns missing (e.g., `sequence_order`, `description`) parses successfully without error
    - Use Jest; place tests at `gateway/src/__tests__/xlsxUserJourneyParser.test.ts`
    - Create minimal `.xlsx` test fixtures programmatically using the `xlsx` library in test setup (no committed binary fixture files)
  - [x] 1.2 Add `xlsx` (SheetJS) to gateway dependencies
    - Add `xlsx` to `gateway/package.json` `dependencies` (NOT devDependencies)
    - Run `npm install` to update `package-lock.json`
    - Confirm this is the same library used in `frontend/src/utils/excelOperations.ts`
  - [x] 1.3 Create `gateway/src/services/xlsxUserJourneyParser.ts`
    - Export a single entry-point function (e.g., `parseUserJourneyWorkbook(base64: string): ParseResult`)
    - Define return type as a discriminated union: `{ success: true; csvText: string }` or `{ success: false; error: string }`
    - Decode the base64 string to a Node.js Buffer and call `XLSX.read(buffer, { type: 'buffer' })`
    - For `.xlsm` files: SheetJS does not execute macros, but add an explicit design comment noting macro content is ignored
  - [x] 1.4 Implement workbook structure validation
    - Validate all three required worksheet names exist: "Process Activities", "User Journeys", "Activity Steps"
    - Validate each worksheet contains its required column headers (first row):
      - Process Activities: `process_activity_name`, `business_process`
      - User Journeys: `journey_name`
      - Activity Steps: `user_journey_name`, `process_activity_name`, `business_user_name`, `application_name`
    - Only validate required columns; optional columns (`sequence_order`, `description`, `actor_role_hints`, `primary_business_user`, `parent_business_process`) may be absent
    - Extra worksheets beyond the three required ones must be silently ignored
    - On any validation failure, return `{ success: false, error: '<descriptive message>' }` immediately
  - [x] 1.5 Implement CSV-text conversion and output assembly
    - Use `XLSX.utils.sheet_to_csv()` to convert each required worksheet to CSV text
    - Wrap each worksheet's CSV output in delimiters matching the prompt expectations:
      ```
      --- Worksheet: Process Activities ---
      <CSV rows>
      --- End Worksheet: Process Activities ---
      ```
    - Process worksheets in order: "Process Activities", "User Journeys", "Activity Steps"
    - Concatenate all three delimited blocks into a single string
    - Return `{ success: true, csvText: '<concatenated output>' }`
  - [x] 1.6 Ensure parser module tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify all pass with correct CSV-text output and correct error messages
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 6 parser tests pass
- Valid workbooks produce correctly delimited CSV-text blocks with all three worksheets
- Missing worksheets and missing required headers produce clear, specific error messages
- Extra worksheets are silently ignored
- `.xlsm` is handled identically to `.xlsx`
- Optional columns can be absent without triggering errors

---

#### Task Group 2: ChatV2 XLSX Intercept
**Dependencies:** Task Group 1

- [x] 2.0 Complete chatV2 XLSX intercept
  - [x] 2.1 Write 5 focused tests for the chatV2 intercept logic
    - Test: POST with `taskId: 'ux-designer--users-interactions'` and a `.xlsx` file attachment triggers parsing and replaces the binary attachment with text/plain CSV-text content
    - Test: POST with `taskId: 'ux-designer--users-interactions'` and a `.xlsm` file attachment triggers parsing identically to `.xlsx`
    - Test: POST with a different `taskId` (e.g., `'product-manager--define-product'`) and a `.xlsx` file attachment passes the file through unchanged (no parsing)
    - Test: POST with `taskId: 'ux-designer--users-interactions'` and an invalid workbook (missing required worksheet) returns HTTP 400 with descriptive error JSON and does NOT call `sendChatRequest`
    - Test: POST with `taskId: 'ux-designer--users-interactions'` and mixed files (one `.xlsx` plus one `.csv`) parses the `.xlsx` and passes the `.csv` through unchanged
    - Use Jest with `jest.mock()` patterns consistent with existing `gateway/src/__tests__/chatV2-*.test.ts` files
    - Place tests at `gateway/src/__tests__/chatV2-xlsx-intercept.test.ts`
  - [x] 2.2 Add XLSX intercept logic in `gateway/src/routes/chatV2.ts`
    - Insert intercept code in the POST `/` handler after Step 1 (request validation, around line 2490) but before Step 7 (message assembly with `buildContentPartsV2`, around line 3448)
    - Check if `request.taskId === 'ux-designer--users-interactions'` AND `request.files` contains at least one file with extension `.xlsx` or `.xlsm`
    - Import and call the parser module from Task Group 1 for each matched XLSX/XLSM file
  - [x] 2.3 Implement validation error response handling
    - On parser validation failure, immediately return HTTP 400 with JSON body: `{ "error": "<user-facing message>" }`
    - Do NOT call `sendChatRequest` when validation fails
    - Do NOT pass validation errors into the LLM for conversational handling
    - Log the validation error with the request ID for debugging
  - [x] 2.4 Implement successful file replacement
    - On successful parsing, replace each `.xlsx`/`.xlsm` file entry in `request.files` with a synthetic text attachment:
      - Set `filename` to the original filename with `.txt` appended (e.g., `journeys.xlsx.txt`) or keep original name
      - Set `mimeType` to `text/plain`
      - Set `base64` to the base64-encoded CSV-text output from the parser
    - Non-XLSX files in the same request must pass through completely unchanged
    - If no `.xlsx`/`.xlsm` files are present in the request, skip the intercept entirely
    - If the user uploads CSV files or pastes text (no `.xlsx`/`.xlsm`), the existing flow continues unchanged
  - [x] 2.5 Ensure chatV2 intercept tests pass
    - Run ONLY the 5 tests written in 2.1
    - Verify correct file replacement, error responses, and passthrough behavior
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- The 5 intercept tests pass
- XLSX/XLSM files for `ux-designer--users-interactions` are parsed and replaced with CSV-text before the LLM call
- XLSX/XLSM files for other tasks pass through unchanged
- Validation failures return HTTP 400 immediately without calling the LLM
- Non-XLSX files in the same request are unaffected
- Existing CSV/paste flow remains completely unchanged

---

### Frontend

#### Task Group 3: Accepted File Types Update
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete frontend file type updates
  - [x] 3.1 Write 3 focused tests for the file type additions
    - Test: `ACCEPTED_EXTENSIONS` array includes `.xlsx` and `.xlsm`
    - Test: `ACCEPTED_MIME_TYPES` string includes `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/vnd.ms-excel.sheet.macroEnabled.12`
    - Test: `validateFiles()` accepts a file with `.xlsx` extension and rejects a file with `.xls` extension (legacy format remains unsupported)
    - Use Vitest; place tests at `frontend/src/utils/__tests__/fileUploadUtils.xlsx.test.ts` or co-locate with existing tests
  - [x] 3.2 Add `.xlsx` and `.xlsm` to `ACCEPTED_EXTENSIONS` in `frontend/src/utils/fileUploadUtils.ts`
    - Append `.xlsx` and `.xlsm` to the existing `ACCEPTED_EXTENSIONS` array
    - No other structural changes to the file
  - [x] 3.3 Add XLSX/XLSM MIME types to `ACCEPTED_MIME_TYPES` in `frontend/src/utils/fileUploadUtils.ts`
    - Append `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` to the MIME types string
    - Append `application/vnd.ms-excel.sheet.macroEnabled.12` to the MIME types string
    - These are used directly as the HTML `<input accept>` attribute in `ChatInputBar.tsx`
    - No changes needed to `ChatInputBar.tsx` or `FileAttachmentBar.tsx` -- they will pick up the new types automatically
  - [x] 3.4 Ensure file type tests pass
    - Run ONLY the 3 tests written in 3.1
    - Verify `.xlsx` and `.xlsm` are accepted globally
    - Verify `.xls` (legacy) is still rejected
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- The 3 frontend tests pass
- `.xlsx` and `.xlsm` files are accepted by the upload validation for all tasks
- The existing file type list is preserved (no regressions)
- No UI component changes are needed -- `ChatInputBar.tsx` and `FileAttachmentBar.tsx` pick up the new types automatically

---

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 6 parser tests from Task Group 1 (sub-task 1.1)
    - Review the 5 intercept tests from Task Group 2 (sub-task 2.1)
    - Review the 3 file type tests from Task Group 3 (sub-task 3.1)
    - Total existing tests: 14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack coverage
    - Focus ONLY on gaps related to the XLSX ingestion feature requirements
    - Do NOT assess entire application test coverage
    - Candidate gaps to evaluate:
      - End-to-end flow: XLSX upload through chatV2 POST to correct CSV-text in the LLM message content
      - Edge case: empty worksheet (headers only, no data rows) -- should produce CSV with header row only
      - Edge case: worksheet with special characters in cell values (commas, quotes, newlines) -- CSV escaping
      - Integration: parser called from chatV2 handler with realistic request body shape
      - Boundary: file with only the three required worksheets and no extra ones
  - [x] 4.3 Write up to 8 additional strategic tests to fill critical gaps
    - Focus on integration points between the parser module and chatV2 intercept
    - Add an end-to-end integration test verifying the full POST flow: XLSX attachment in request body results in text/plain content reaching `buildContentPartsV2`
    - Add a test for empty worksheets (headers only) producing valid but minimal CSV-text output
    - Add a test for CSV escaping of special characters in cell values
    - Add a test verifying that the concatenated output contains all three worksheet sections in the correct order
    - Add a test verifying case sensitivity of worksheet name matching (e.g., "process activities" lowercase should fail validation)
    - Do NOT write comprehensive coverage for all scenarios
    - Skip performance tests, accessibility tests, and drag-and-drop scenarios (out of scope)
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - `gateway/src/__tests__/xlsxUserJourneyParser.test.ts` (6 tests from 1.1)
      - `gateway/src/__tests__/chatV2-xlsx-intercept.test.ts` (5 tests from 2.1)
      - `frontend/src/utils/__tests__/fileUploadUtils.xlsx.test.ts` (3 tests from 3.1)
      - New gap-fill tests from 4.3 (up to 8 tests)
    - Expected total: approximately 22 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 22 tests total)
- Critical user workflows for XLSX ingestion are covered end-to-end
- No more than 8 additional tests added in the gap analysis phase
- Testing focused exclusively on XLSX ingestion feature requirements
- No regressions in existing CSV/paste upload flow (verified by passthrough tests)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: XLSX Parser Module** -- No dependencies; creates the core parsing logic that all other groups depend on
2. **Task Group 3: Accepted File Types Update** -- No dependencies on Task Group 1; can be developed in parallel. Simple frontend constants change.
3. **Task Group 2: ChatV2 XLSX Intercept** -- Depends on Task Group 1 (imports the parser module). Wires the parser into the request pipeline.
4. **Task Group 4: Test Review and Gap Analysis** -- Depends on all prior groups. Reviews coverage and fills critical gaps.

**Parallelization opportunity:** Task Groups 1 and 3 can be developed simultaneously by different engineers since they have no shared dependencies. Task Group 2 must wait for Task Group 1 to complete.

## Key Files

| File | Action | Task Group |
|------|--------|------------|
| `gateway/package.json` | Add `xlsx` dependency | 1 |
| `gateway/src/services/xlsxUserJourneyParser.ts` | Create new | 1 |
| `gateway/src/__tests__/xlsxUserJourneyParser.test.ts` | Create new | 1 |
| `gateway/src/routes/chatV2.ts` | Modify (add intercept) | 2 |
| `gateway/src/__tests__/chatV2-xlsx-intercept.test.ts` | Create new | 2 |
| `frontend/src/utils/fileUploadUtils.ts` | Modify (add extensions + MIME types) | 3 |
| `frontend/src/utils/__tests__/fileUploadUtils.xlsx.test.ts` | Create new | 3 |
| `gateway/src/__tests__/xlsxUserJourneyParser.gaps.test.ts` | Create new | 4 |
| `gateway/src/__tests__/chatV2-xlsx-integration.test.ts` | Create new | 4 |

## Reference Files (Read-Only)

| File | Why |
|------|-----|
| `frontend/src/utils/excelOperations.ts` | SheetJS usage patterns to follow |
| `gateway/src/config/prompts/ux-designer.users-interactions.task.md` | Expected column structures and CSV format |
| `gateway/src/types/chatV2.ts` | `ChatV2Request.files` interface shape |
| `frontend/src/components/UnifiedChat/ChatInputBar.tsx` | Consumes `ACCEPTED_MIME_TYPES` (no changes needed) |
| `frontend/src/components/UnifiedChat/FileAttachmentBar.tsx` | Displays file chips (no changes needed) |
| `gateway/src/config/tasks/ux-designer--users-interactions.json` | Task definition (no changes needed) |
