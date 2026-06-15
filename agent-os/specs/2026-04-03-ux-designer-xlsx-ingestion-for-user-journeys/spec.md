# Specification: UX Designer XLSX Ingestion for User Journeys

## Goal
Enable business users to upload a single `.xlsx` or `.xlsm` workbook containing three worksheets ("Process Activities", "User Journeys", "Activity Steps") through the existing chat file-attachment flow, with the gateway deterministically parsing the workbook into delimited CSV-text blocks before the LLM sees it -- preserving full compatibility with the existing prompt and conversation pipeline.

## User Stories
- As a business user, I want to upload my Excel workbook directly into the "Define User Journeys" chat so that I do not need to manually export and paste CSV text for each worksheet.
- As a business user, I want immediate feedback when my workbook is missing required worksheets or column headers so that I can fix my file before the conversation proceeds.

## Specific Requirements

**Add `xlsx` (SheetJS) library to gateway**
- Add `xlsx` to `gateway/package.json` `dependencies` (not devDependencies)
- This is the same library used in the frontend (`frontend/src/utils/excelOperations.ts`), keeping the project consistent
- No other XLSX libraries should be introduced

**Add `.xlsx` and `.xlsm` to global accepted file types in the frontend**
- Add `.xlsx` and `.xlsm` to the `ACCEPTED_EXTENSIONS` array in `frontend/src/utils/fileUploadUtils.ts`
- Add `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `application/vnd.ms-excel.sheet.macroEnabled.12` to the `ACCEPTED_MIME_TYPES` string
- These additions are global (all tasks can accept the file types), but only the `ux-designer--users-interactions` task triggers parsing

**Create a dedicated XLSX parser module in the gateway**
- Create a new module (e.g., `gateway/src/services/xlsxUserJourneyParser.ts`) that encapsulates all parsing and validation logic
- The module should export a single entry-point function that accepts a base64-encoded file string and returns either parsed CSV-text blocks or a validation error
- Use `XLSX.read(buffer, { type: 'buffer' })` to parse the workbook from a Node.js Buffer decoded from base64
- For `.xlsm` files, ignore all macro-related content entirely (SheetJS does not execute macros, but this should be an explicit design note)

**Validate workbook structure before parsing**
- Validate that all three required worksheet names exist: "Process Activities", "User Journeys", "Activity Steps"
- Validate that each worksheet contains the expected column headers (first row) as defined in the task prompt: `process_activity_name`, `business_process`, etc. for Process Activities; `journey_name`, etc. for User Journeys; `user_journey_name`, `process_activity_name`, `business_user_name`, `application_name`, etc. for Activity Steps
- Only required columns need header validation; optional columns may be absent
- Extra worksheets beyond the three required ones must be silently ignored (no warning, no error)
- If any required worksheet is missing or any required column header is absent, return an immediate error -- do not proceed to LLM

**Convert worksheet data to delimited CSV-text blocks**
- Use `XLSX.utils.sheet_to_csv()` or equivalent to convert each worksheet to CSV text
- Wrap each worksheet's CSV output in clear delimiters that align with the existing prompt's expectations:
  ```
  --- Worksheet: Process Activities ---
  <CSV rows>
  --- End Worksheet: Process Activities ---
  ```
- Repeat for "User Journeys" and "Activity Steps"
- Concatenate all three blocks into a single text string

**Intercept XLSX files in the chatV2 POST handler before LLM call**
- The intercept must occur in `gateway/src/routes/chatV2.ts` in the POST `/` handler, after request validation (Step 1) but before `buildContentPartsV2` is called (Step 7, around line 3448)
- Check if `request.taskId === 'ux-designer--users-interactions'` AND `request.files` contains a file with extension `.xlsx` or `.xlsm`
- If matched, call the parser module; on validation failure, return an HTTP error response (e.g., 400) with a descriptive error message and do NOT call the LLM
- On success, replace the binary file attachment in `request.files` with a synthetic text attachment containing the concatenated CSV-text blocks (set `mimeType` to `text/plain` and `base64` to the base64-encoded CSV-text, or directly inject the text into the message)
- Non-XLSX files in the same request (if any) should pass through unchanged
- If the user uploads CSV files or pastes text (no `.xlsx`/`.xlsm` present), the existing flow continues completely unchanged

**Return validation errors as immediate HTTP error responses**
- When workbook validation fails, respond with HTTP 400 and a JSON body containing a clear, user-facing error message (e.g., `{ "error": "Workbook is missing required worksheet: Activity Steps" }`)
- Do not pass validation errors into the LLM for conversational handling
- Do not call `sendChatRequest` when validation fails

**Gateway unit tests for the parser and intercept**
- Test the parser module in isolation: valid workbook produces correct CSV-text output; missing worksheet returns error; missing required headers returns error; extra worksheets are ignored; `.xlsm` is handled identically to `.xlsx`
- Test the chatV2 intercept: verify that an XLSX file attachment for `ux-designer--users-interactions` triggers parsing and replacement; verify that the same file for a different taskId passes through unchanged; verify validation error returns 400 without LLM call
- Use Jest with `jest.mock()` patterns consistent with existing gateway tests

## Visual Design
No visual mockups provided. The existing chat UI (paperclip button, file chips in `FileAttachmentBar`, hidden file input in `ChatInputBar`) handles `.xlsx`/`.xlsm` display automatically once the accepted types are updated. No UI changes beyond the accepted file types are required.

## Existing Code to Leverage

**`frontend/src/utils/excelOperations.ts` -- SheetJS usage patterns**
- Demonstrates `XLSX.read(arrayBuffer, { type: 'array' })` for parsing workbooks from binary data
- Shows `workbook.SheetNames` iteration for discovering worksheets and `workbook.Sheets[name]` for accessing worksheet data
- Uses `XLSX.utils.sheet_to_json()` for row-to-object mapping and header extraction
- The gateway parser should follow the same library API but use `{ type: 'buffer' }` since Node.js Buffer is available server-side

**`frontend/src/utils/fileUploadUtils.ts` -- File type constants**
- Contains `ACCEPTED_EXTENSIONS` array and `ACCEPTED_MIME_TYPES` string that must be updated
- The `ACCEPTED_MIME_TYPES` string is used directly as the HTML `<input accept>` attribute in `ChatInputBar.tsx`
- No structural changes needed -- just append the two new extensions and two new MIME types

**`gateway/src/routes/chatV2.ts` -- `buildContentPartsV2` function (line 326)**
- Currently decodes non-image/non-PDF files as UTF-8 text via `Buffer.from(file.base64, 'base64').toString('utf-8')`, which would garble binary `.xlsx` content
- The XLSX intercept must transform or replace the binary attachment before this function runs
- The intercept point is in the POST handler between Step 1 (request validation, line 2481) and Step 7 (message assembly, line 3448)

**`gateway/src/config/prompts/ux-designer.users-interactions.task.md` -- Prompt expectations**
- Expects CSV/paste input for three worksheets with specific column structures
- The delimited CSV-text output format (`--- Worksheet: X ---`) aligns with these expectations
- No changes are needed to this prompt file -- the conversion preserves full compatibility

**`gateway/src/types/chatV2.ts` -- `ChatV2Request.files` interface**
- Files are `Array<{ filename: string; mimeType: string; base64: string }>` -- base64-encoded JSON transport, not multipart
- The parser receives the base64 string directly, decodes to Buffer, and passes to `XLSX.read()`

## Out of Scope
- Template download functionality (no Excel template generation or download endpoint)
- Drag-and-drop upload UI changes (existing paperclip-button flow is sufficient)
- Progress indicators for file processing
- Macro execution, inspection, or preservation of any kind (`.xlsm` macros are completely ignored)
- XLS legacy format support (only `.xlsx` and `.xlsm`)
- OCR or arbitrary format support
- General-purpose XLSX parsing for other personas or tasks
- Changes to the meta-model, save pipeline, or diagram rendering/sync
- Changes to the UX Designer task prompt (`ux-designer.users-interactions.task.md`)
- Write-back to Excel files
- File size limit adjustments (5 MB per file remains unchanged)
- Warning users about extra or unrecognized worksheets in the workbook
