# Spec Requirements: UX Designer XLSX Ingestion for User Journeys

## Initial Description

Add native .xlsx workbook ingestion to the UX Designer "Define User Journeys" flow so users can upload a single Excel file containing the three agreed worksheets ("Process Activities", "User Journeys", "Activity Steps") instead of providing CSVs or pasted tabular text.

This is Increment 10 in a User Journey feature series. Increments 1-9 establish the full meta-model, save, diagram, and sync pipeline. The remaining gap is input UX: business users naturally work in Excel workbooks. Increment 10 upgrades the ingestion path without changing core architecture.

Key design decisions:
- XLSX parsing is deterministic code, NOT LLM reasoning
- Parsing should happen in the gateway (where task/file preprocessing lives)
- The normalized payload feeds into the existing UX Designer conversation flow
- CSV and paste fallback must be preserved
- No changes to meta-model, save pipeline, or diagram behavior

Out of scope: Macro execution, write-back, template generation, arbitrary formats, XLS legacy format, OCR, general-purpose XLSX for other personas, changes to meta-model, save pipeline, or diagram rendering/sync.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the XLSX parsing library to add to the gateway is `xlsx` (SheetJS), the same library already used in the frontend for meta-model import. This keeps the project consistent. Is that correct, or would you prefer a different library (e.g., `exceljs`)?
**Answer:** Use `xlsx` (SheetJS) in the gateway for consistency with the frontend. This applies to both `.xlsx` and `.xlsm`. `.xlsm` must always be accepted for spreadsheet content parsing, and anything related to macros must be completely ignored (no execution, no inspection, no preservation).

**Q2:** I assume the parsing intercept should happen in the `chatV2.ts` route before the message reaches the LLM -- specifically, when the task is `ux-designer--users-interactions` and the uploaded file has a `.xlsx` extension, the gateway should: (a) parse the workbook into the three worksheet payloads, (b) convert the data into CSV/text representations, and (c) replace the binary file attachment with the normalized text in the user message content. This way the LLM sees structured text rather than garbled binary. Is that the right approach?
**Answer:** Yes. The parsing intercept should happen in `chatV2.ts` before the message reaches the LLM. For the `ux-designer--users-interactions` task, when the uploaded file is `.xlsx` or `.xlsm`, the gateway must parse the workbook, convert the relevant worksheet content into normalized text, and replace the binary attachment. `.xlsm` must be treated exactly like `.xlsx` for content extraction, with macros ignored entirely.

**Q3:** For the normalized payload format injected into the user message, I assume each worksheet's data should be rendered as a clearly delimited text block so the existing prompt's CSV parsing instructions work without modification. Alternatively, should the parsed data be injected as a structured JSON payload instead of CSV text?
**Answer:** Use clearly delimited CSV-text blocks per worksheet, not JSON. This aligns with the existing prompt expectations and avoids prompt changes. This format must be used for both `.xlsx` and `.xlsm`, with `.xlsm` parsed only for worksheet data and all macro-related aspects ignored. Example format:
```
--- Worksheet: Process Activities ---
<CSV rows>
--- End Worksheet: Process Activities ---
```

**Q4:** Regarding validation of the XLSX structure: I assume the gateway parser should validate that (a) the workbook contains all three required worksheet names, (b) each worksheet has the expected column headers, and (c) basic data types are correct. If validation fails, should the gateway return an error response immediately, or should it pass a validation error message to the LLM so it can report the issue conversationally?
**Answer:** If workbook validation fails (missing sheets, missing headers), the gateway must return an immediate validation error and must not call the LLM. Do not pass validation errors to the LLM for conversational handling. This rule applies equally to `.xlsx` and `.xlsm`, with `.xlsm` always accepted for content parsing but still subject to validation rules.

**Q5:** For the `ACCEPTED_EXTENSIONS` and `ACCEPTED_MIME_TYPES` update in `fileUploadUtils.ts`, I assume we should add `.xlsx` and the corresponding MIME type only when the active task is `ux-designer--users-interactions`, rather than globally for all chat tasks. Or is it acceptable to allow `.xlsx` uploads globally and just have the gateway parsing logic be task-specific?
**Answer:** Allow `.xlsx` and `.xlsm` globally in `ACCEPTED_EXTENSIONS`, but make parsing logic task-specific. Only the `ux-designer--users-interactions` task should trigger workbook parsing. `.xlsm` must always be accepted as a valid spreadsheet input type, with macros ignored.

**Q6:** The current `MAX_FILE_SIZE_BYTES` is 5 MB per file. I assume typical user journey workbooks will be well under this limit and no size adjustment is needed. Is that correct?
**Answer:** Keep the existing `MAX_FILE_SIZE_BYTES` of 5 MB. No adjustment is required.

**Q7:** If a user uploads an `.xlsx` file that has the three required worksheets plus additional worksheets (e.g., notes, instructions), I assume the parser should silently ignore extra worksheets and only process the three expected ones. Is that correct?
**Answer:** Silently ignore additional worksheets beyond the required ones. Do not warn the user in this increment.

**Q8:** Is there anything you want explicitly excluded from this increment that I haven't already captured?
**Answer:** Do not implement any of the following in this increment: template download functionality, drag-and-drop upload changes, progress indicators, macro handling of any kind (explicitly ignore all macro-related content in `.xlsm`).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Frontend XLSX Import/Export for Architecture Meta-Model - Path: `frontend/src/utils/excelOperations.ts`
  - Uses the same `xlsx` (SheetJS) library that will be added to the gateway
  - Demonstrates worksheet iteration, column header extraction, row-to-object mapping
  - Shows patterns for handling metadata worksheets, ignored sheets, and import results
- Feature: File Upload Utilities (Accepted Types + Base64 Reading) - Path: `frontend/src/utils/fileUploadUtils.ts`
  - Contains `ACCEPTED_EXTENSIONS` and `ACCEPTED_MIME_TYPES` that need updating to include `.xlsx` and `.xlsm`
  - Contains `validateFiles()` and `readFilesAsBase64()` functions
- Feature: Chat File Attachment UI - Path: `frontend/src/components/UnifiedChat/ChatInputBar.tsx`
  - The paperclip button and hidden `<input type="file" accept={ACCEPTED_MIME_TYPES}>` element
  - The `handleFileChange` and `handleSend` flow that reads files as base64
- Feature: File Attachment Display - Path: `frontend/src/components/UnifiedChat/FileAttachmentBar.tsx`
  - Shows attached file chips below the textarea
- Feature: Gateway Content Parts Builder - Path: `gateway/src/routes/chatV2.ts` (function `buildContentPartsV2` around line 326)
  - Currently handles images, PDFs, and text-based files
  - The XLSX intercept must happen before this function is called so binary files are replaced with text
- Feature: UX Designer Task Configuration - Path: `gateway/src/config/tasks/ux-designer--users-interactions.json`
  - Task definition with `mode: "discovery"`, `responseFormat: null`, `contextNeeds: ["mission"]`, `artifacts: [{ artifactId: "user-journeys", tool: "save_user_journeys" }]`
- Feature: UX Designer Task Prompt - Path: `gateway/src/config/prompts/ux-designer.users-interactions.task.md`
  - Expects CSV/paste input for three worksheets: Process Activities, User Journeys, Activity Steps
  - Defines column structures, validation rules, and conversation flow
  - No changes needed to this prompt -- the XLSX-to-CSV conversion preserves compatibility
- Feature: Architecture Context Injection - Path: `gateway/src/routes/chatV2.ts` (around line 3084)
  - `fullArchContextTasks` Set includes `ux-designer--users-interactions`
  - Calls `buildArchitectureContextSection()` to inject architecture context
- Feature: User Journeys Generation Prompt Template - Path: `gateway/src/services/promptBuilder.ts` (line 766)
  - `USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE` used in the `/generate` endpoint
- Feature: ChatV2 API Client (Frontend) - Path: `frontend/src/api/chatV2Api.ts`
  - `FileAttachment` interface: `{ filename: string; mimeType: string; base64: string }`
  - Files sent as JSON (not multipart) via `POST /api/chat/v2`

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Add `xlsx` (SheetJS) library to the gateway's `package.json`
- When the active task is `ux-designer--users-interactions` and an uploaded file has a `.xlsx` or `.xlsm` extension, the gateway must intercept and parse the workbook before the message reaches the LLM
- Parse the three required worksheets ("Process Activities", "User Journeys", "Activity Steps") and convert each into CSV-text with clear delimiters
- Replace the binary file attachment in the user message with the normalized CSV-text content
- Validate the workbook structure: (a) all three required worksheets must be present, (b) each worksheet must have the expected column headers
- If validation fails, return an immediate error response -- do not call the LLM
- Silently ignore extra worksheets beyond the three required ones
- `.xlsm` files must be treated identically to `.xlsx` for content extraction; all macro-related content must be completely ignored (no execution, no inspection, no preservation)
- Preserve the existing CSV/paste fallback -- if the user pastes text or uploads CSV files, the existing flow continues unchanged
- Add `.xlsx` and `.xlsm` (and their MIME types) to the global `ACCEPTED_EXTENSIONS` and `ACCEPTED_MIME_TYPES` in `fileUploadUtils.ts`
- XLSX/XLSM parsing logic is task-specific (only triggered for `ux-designer--users-interactions`), even though the file types are globally accepted

### Reusability Opportunities
- `frontend/src/utils/excelOperations.ts` demonstrates SheetJS worksheet parsing patterns (column mapping, row iteration, ignored sheets) that can inform the gateway parser implementation
- `buildContentPartsV2()` in `chatV2.ts` is the existing file-to-content bridge -- the XLSX preprocessing intercept should occur before this function runs
- The delimited CSV-text output format aligns with the existing task prompt's CSV expectations, requiring no prompt changes
- The `FileAttachment` interface and base64 transport mechanism are already in place and require no modification

### Scope Boundaries

**In Scope:**
- Adding `xlsx` (SheetJS) to gateway dependencies
- Gateway-side XLSX/XLSM parsing for the `ux-designer--users-interactions` task
- Workbook validation (required worksheets and column headers) with immediate error on failure
- Conversion of worksheet data to delimited CSV-text blocks
- Replacing binary file attachment with normalized text before LLM call
- Adding `.xlsx` and `.xlsm` to global accepted file types in frontend
- Handling `.xlsm` identically to `.xlsx` with complete macro ignorance
- Silently ignoring extra worksheets

**Out of Scope:**
- Template download functionality
- Drag-and-drop upload UI changes
- Progress indicators for file processing
- Macro execution, inspection, or preservation of any kind
- XLS legacy format support
- OCR or arbitrary format support
- General-purpose XLSX parsing for other personas/tasks
- Changes to the meta-model, save pipeline, or diagram rendering/sync
- Changes to the UX Designer task prompt (`ux-designer.users-interactions.task.md`)
- Write-back to Excel files
- File size limit adjustments (5 MB per file remains)
- Warning users about extra/unrecognized worksheets

### Technical Considerations
- The gateway currently has no XLSX library -- `xlsx` (SheetJS) must be added to `gateway/package.json`
- Files are transported as base64-encoded JSON in the `files` array of the `POST /api/chat/v2` request body (not multipart)
- The gateway's `buildContentPartsV2()` function currently decodes non-image/non-PDF files as UTF-8 text, which would produce garbled output for binary `.xlsx` files -- the intercept must happen before this function
- The XLSX parsing intercept should be placed in `chatV2.ts` in the POST `/` handler, after request validation but before the message is assembled for the LLM
- The MIME type for `.xlsx` is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; for `.xlsm` it is `application/vnd.ms-excel.sheet.macroEnabled.12`
- The `ACCEPTED_MIME_TYPES` string in `fileUploadUtils.ts` is used directly as the `accept` attribute on the HTML file input element
- The existing task prompt at `gateway/src/config/prompts/ux-designer.users-interactions.task.md` expects CSV column structures matching the three worksheet schemas -- the normalized CSV-text output must align with these column names
- Existing tests at `gateway/src/__tests__/ux-designer-user-journey-task-config.test.ts` and `ux-designer-user-journey-prompt.test.ts` verify task config integrity and prompt content
- Gateway tests use Jest with `jest.mock()` at top of file
