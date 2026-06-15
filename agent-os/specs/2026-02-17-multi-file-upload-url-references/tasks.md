# Task Breakdown: Multi-File Upload + URL References for SA and PM Chat

## Overview
Total Tasks: 37 (across 5 task groups)

This spec replaces the modal-based text-path UploadDocumentsModal mechanism in both the Solution Architect and Product Manager chat panels with a native file picker that reads files as base64, sends them in the JSON body alongside the user message, and builds an OpenAI content parts array (text + image_url + file) for a single GPT-5 API call. URLs in message text continue to be auto-detected and fetched server-side.

## Task List

### Gateway Types and Interfaces

#### Task Group 1: Gateway Type Definitions, OpenAI Message Update, and Body Limit
**Dependencies:** None

This group establishes all the type-level and configuration changes in the gateway that subsequent groups depend on. It covers the `ChatRequest` file attachment shape, the `OpenAIMessage` content parts union type, the `calculateConversationBytes` update, and the Express body parser limit increase.

- [x] 1.0 Complete gateway type definitions and configuration updates
  - [x] 1.1 Write 5 focused tests for gateway type and configuration changes
    - Test 1: Verify `ChatRequest` interface accepts a `files` array with `{ filename, mimeType, base64 }` objects
    - Test 2: Verify `ContentPart` union type covers `text`, `image_url`, and `file` variants
    - Test 3: Verify `OpenAIMessage.content` accepts both `string` and `ContentPart[]` types
    - Test 4: Verify `calculateConversationBytes` correctly counts bytes when `content` is a `ContentPart[]` (serializes to JSON string)
    - Test 5: Verify `calculateConversationBytes` continues to work correctly when `content` is a plain string (regression)
    - Write tests in `gateway/src/__tests__/multi-file-upload-types.test.ts`
  - [x] 1.2 Add `files` field to gateway-side `ChatRequest` interface
    - File: `gateway/src/types/chat.ts`
    - Add `files?: Array<{ filename: string; mimeType: string; base64: string }>` to the `ChatRequest` interface (after the existing `sources` field)
    - Keep the existing `sources` field unchanged for backward compatibility
  - [x] 1.3 Define `ContentPart` union type and update `OpenAIMessage` interface
    - File: `gateway/src/services/openaiClient.ts`
    - Define and export `ContentPart` as a union of three shapes:
      - `{ type: 'text'; text: string }`
      - `{ type: 'image_url'; image_url: { url: string; detail?: string } }`
      - `{ type: 'file'; file: { file_data: string; filename: string } }`
    - Change `OpenAIMessage.content` from `content: string` to `content: string | ContentPart[]`
    - The existing `sendChatRequest` function already casts messages via `as unknown as ChatCompletionMessageParam[]`, so no further SDK casting changes are needed
  - [x] 1.4 Update `calculateConversationBytes` to handle content parts arrays
    - File: `gateway/src/services/conversation.ts`
    - When `message.content` is an array (i.e., `ContentPart[]`), serialize it to a JSON string via `JSON.stringify` before calling `Buffer.byteLength`
    - When `message.content` is a string (existing behavior), continue using it directly
    - Use `typeof message.content === 'string'` guard for branching
  - [x] 1.5 Increase Express JSON body parser limit from `'3mb'` to `'30mb'`
    - File: `gateway/src/server.ts`, line 23
    - Change `express.json({ limit: '3mb' })` to `express.json({ limit: '30mb' })`
    - Update the comment to explain: 20 MB raw files expand to ~27 MB in base64 plus JSON overhead
  - [x] 1.6 Ensure gateway type and configuration tests pass
    - Run ONLY the 5 tests written in 1.1
    - Verify `ContentPart` type compiles correctly
    - Verify `calculateConversationBytes` handles both content shapes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 5 tests written in 1.1 pass
- `ChatRequest` has the new `files` field alongside existing `sources`
- `OpenAIMessage.content` accepts both `string` and `ContentPart[]`
- `calculateConversationBytes` handles both string and array content
- Express body parser limit is `'30mb'`

---

### Gateway Chat Route Logic

#### Task Group 2: Server-Side Validation, Content Parts Construction, URL Extraction, and Persistence Stripping
**Dependencies:** Task Group 1

This group implements the core gateway logic: server-side validation of the files array, construction of the OpenAI content parts array from attached files, URL auto-detection in message text, and generalized artefact/file-content stripping for conversation persistence.

- [x] 2.0 Complete gateway chat route logic for file uploads
  - [x] 2.1 Write 8 focused tests for gateway chat route file handling
    - Test 1: Reject request when `files` array length exceeds 10 (return 400)
    - Test 2: Reject request when any individual `base64` payload exceeds ~6.67 MB (return 400)
    - Test 3: Build content parts array correctly for a mix of image and non-image files (verify ordering: text first, then files in attachment order)
    - Test 4: Image MIME types produce `image_url` content parts with correct `data:` URI and `detail: "auto"`
    - Test 5: Non-image MIME types (PDF, text) produce `file` content parts with correct `file_data` and `filename`
    - Test 6: When `files` are present and message text contains URLs, URLs are still extracted and fetched (augmented into the text content part)
    - Test 7: Persistence stripping replaces content parts array with plain string `"<original text>\n\n[Attached: file1.pdf, file2.png]"` for SA mode
    - Test 8: Persistence stripping also works for `product_manager` mode with files
    - Write tests in `gateway/src/__tests__/multi-file-upload-chat-route.test.ts`
  - [x] 2.2 Add server-side validation for `files` array in the chat route
    - File: `gateway/src/routes/chat.ts`
    - After extracting `files` from `req.body`, validate:
      - If `files` is present and `files.length > 10`, return 400 with `{ error: 'Maximum 10 files allowed' }`
      - If any file's `base64` string length exceeds `6_670_000` characters (~5 MB raw * 1.34 base64 overhead), return 400 with `{ error: 'File exceeds 5 MB limit: <filename>' }`
    - Place validation early in the route handler, before any LLM or persistence logic
  - [x] 2.3 Implement content parts array construction helper function
    - File: `gateway/src/routes/chat.ts`
    - Create a new function `buildContentParts(augmentedMessage: string, files: Array<{ filename: string; mimeType: string; base64: string }>): ContentPart[]`
    - Import `ContentPart` from `../services/openaiClient`
    - Logic:
      - Start with `{ type: 'text', text: augmentedMessage }` as the first element
      - For each file, check if `mimeType` starts with `image/`:
        - If image: push `{ type: 'image_url', image_url: { url: 'data:<mimeType>;base64,<base64>', detail: 'auto' } }`
        - If non-image: push `{ type: 'file', file: { file_data: 'data:<mimeType>;base64,<base64>', filename: file.filename } }`
    - Return the assembled array
  - [x] 2.4 Refactor URL auto-detection from message text when files are present
    - File: `gateway/src/routes/chat.ts`
    - When the request has `files` (and no `sources`), extract `http://` and `https://` URLs from the message text
    - Create a helper function `extractUrlsFromText(text: string): string[]` that uses a regex to find URLs in the message text
    - Pass these extracted URLs through the existing `buildAugmentedMessage` function (as synthetic `sources`) so URL content is fetched and appended to the text part
    - When `files` are present, the file content itself does NOT go through `buildAugmentedMessage`; it goes through `buildContentParts` (task 2.3)
    - When neither `files` nor `sources` are present, skip augmentation entirely (existing behavior)
    - Existing `sources` processing for non-SA/PM modes remains completely unchanged
  - [x] 2.5 Integrate content parts into the user message sent to OpenAI
    - File: `gateway/src/routes/chat.ts`
    - After calling `buildAugmentedMessage` (which now handles URL-only augmentation when files are present), check if `files` exists and has items
    - If yes: call `buildContentParts(augmentedMessage, files)` and set the user message's `content` to the resulting `ContentPart[]` array
    - If no: set the user message's `content` to the `augmentedMessage` string (existing behavior, unchanged)
    - This integration point is in the main chat route handler, just before assembling the `messages` array for `sendChatRequest`
  - [x] 2.6 Generalize artefact/file-content stripping for conversation persistence
    - File: `gateway/src/routes/chat.ts`, around lines 1998-2015
    - Expand the existing condition from:
      `context?.mode === 'solution_architect' && sources && sources.length > 0`
      to also match:
      `(context?.mode === 'solution_architect' || context?.mode === 'product_manager') && ((sources && sources.length > 0) || (files && files.length > 0))`
    - When `files` are present: the `messagesForPersistence` mapping replaces the user message content (which may be a `ContentPart[]`) with the plain string: `"<original message text>\n\n[Attached: <comma-separated filenames>]"`
    - When only `sources` are present (no `files`): existing behavior (replace augmented message with original message text)
    - When both `sources` and `files` are present: combine both behaviors (original text + `[Attached: ...]` notation)
    - The `messagesForPersistence` array is a new array; the original `messages` array must not be mutated
  - [x] 2.7 Ensure gateway chat route tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify server-side validation rejects oversized/overcounted files
    - Verify content parts construction produces correct shapes
    - Verify persistence stripping works for both SA and PM modes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 8 tests written in 2.1 pass
- Server-side validation returns 400 for files exceeding count or size limits
- Content parts array is correctly constructed with text first, then file/image parts
- Image files produce `image_url` parts; non-image files produce `file` parts
- URLs in message text are still fetched server-side even when files are attached
- Persisted conversations contain plain string content with `[Attached: ...]` notation, not content parts arrays
- Existing `sources`-based flow for non-SA/PM modes is completely unaffected

---

### Frontend Types and API Layer

#### Task Group 3: Frontend ChatRequest Update and File Reading Utilities
**Dependencies:** Task Group 1 (gateway types must be defined first so frontend types align)

This group updates the frontend `ChatRequest` interface to include the `files` array, implements file validation utilities (type, size, count), and implements the base64 file reading function. These are pure utility/type changes with no UI component work.

- [x] 3.0 Complete frontend types and file handling utilities
  - [x] 3.1 Write 6 focused tests for frontend file validation and reading
    - Test 1: `validateFiles` rejects a file exceeding 5 MB with correct error message
    - Test 2: `validateFiles` rejects more than 10 files with correct error message
    - Test 3: `validateFiles` rejects unsupported file types (e.g., `.exe`, `.zip`) with correct error message
    - Test 4: `validateFiles` rejects when total raw size exceeds 20 MB
    - Test 5: `validateFiles` accepts a valid mix of text, image, and PDF files within limits
    - Test 6: `readFilesAsBase64` strips the `data:...;base64,` prefix from the base64 string and returns `{ filename, mimeType, base64 }` for each file
    - Write tests in `frontend/src/__tests__/multi-file-upload-utils.test.ts`
  - [x] 3.2 Add `files` field to the frontend `ChatRequest` interface
    - File: `frontend/src/api/chatApi.ts`
    - Add `files?: Array<{ filename: string; mimeType: string; base64: string }>` to the `ChatRequest` interface (after the existing `sources` field)
    - Keep the existing `sources` field unchanged for backward compatibility with other consumers
  - [x] 3.3 Create file validation utility
    - File: `frontend/src/utils/fileUploadUtils.ts` (new file)
    - Export constants:
      - `MAX_FILES = 10`
      - `MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024` (5 MB)
      - `MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024` (20 MB)
      - `ACCEPTED_EXTENSIONS` -- array of `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.xml`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.pdf`
      - `ACCEPTED_MIME_TYPES` -- corresponding MIME type string for the `accept` attribute
    - Export function `validateFiles(existingFiles: File[], newFiles: File[]): { valid: boolean; error?: string }`
      - Check combined count does not exceed `MAX_FILES`
      - Check each new file's extension is in `ACCEPTED_EXTENSIONS`
      - Check each new file's `size` does not exceed `MAX_FILE_SIZE_BYTES`
      - Check combined total size (existing + new) does not exceed `MAX_TOTAL_SIZE_BYTES`
      - Return `{ valid: true }` or `{ valid: false, error: '<specific message>' }`
  - [x] 3.4 Create base64 file reading utility
    - File: `frontend/src/utils/fileUploadUtils.ts` (same file as 3.3)
    - Export async function `readFilesAsBase64(files: File[]): Promise<Array<{ filename: string; mimeType: string; base64: string }>>`
    - Use `FileReader.readAsDataURL` for each file
    - Strip the `data:<mimeType>;base64,` prefix from the result to produce raw base64
    - Return array of `{ filename: file.name, mimeType: file.type, base64: strippedBase64 }`
    - If any file read fails, throw an Error with a descriptive message including the filename
  - [x] 3.5 Ensure frontend utility tests pass
    - Run ONLY the 6 tests written in 3.1
    - Verify validation catches all constraint violations
    - Verify base64 reading strips prefix correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 3.1 pass
- `ChatRequest` has the new `files` field
- File validation catches size, count, type, and total-size violations with specific error messages
- Base64 reading strips the data URI prefix and returns the correct shape

---

### Frontend Components

#### Task Group 4: UI Components -- Inline File Attachment in SA and PM Chat Panels
**Dependencies:** Task Group 3 (file utilities must exist), Task Group 2 (gateway must accept files)

This group implements the visible UI changes: replacing the UploadDocumentsModal trigger with an inline Attach Files button, rendering file chips, integrating file reading into the send flow, adding CSS styles, and updating both panels identically.

- [x] 4.0 Complete UI components for inline file attachment
  - [x] 4.1 Write 6 focused tests for UI component behaviors
    - Test 1: Attach Files button triggers the hidden file input when clicked
    - Test 2: File chips render for each selected file showing the filename
    - Test 3: Clicking the X button on a file chip removes that file from the selection
    - Test 4: Send button is enabled when files are attached but input text is empty
    - Test 5: Send button is disabled when both input text is empty and no files are attached
    - Test 6: File validation error is displayed in the error banner when an invalid file is selected (e.g., unsupported type)
    - Write tests in `frontend/src/__tests__/multi-file-upload-ui.test.tsx`
  - [x] 4.2 Add CSS styles for file chips and attach button to SolutionArchitectChatPanel.module.css
    - File: `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css`
    - Add `.attachButton` class: reuse `.uploadButton` styling but update for Paperclip icon + "Attach Files" text
    - Add `.fileChipsContainer` class: flexbox row, wrapping, gap of 6px, padding 4px 16px, sits between message list and input row, `display: none` when empty
    - Add `.fileChip` class: compact pill -- `background: #e3f2fd`, `color: #1565c0`, `border-radius: 10px`, `font-size: 11px`, `padding: 3px 8px 3px 10px`, `display: inline-flex`, `align-items: center`, `gap: 4px`
    - Add `.fileChipRemove` class: small X button within the chip -- `background: none`, `border: none`, `cursor: pointer`, `color: #1565c0`, `font-size: 13px`, `line-height: 1`, `padding: 0`
    - Keep existing `.uploadButton` class intact (used by other consumers if imported)
  - [x] 4.3 Add identical CSS styles to ProductManagerChatPanel.module.css
    - File: `frontend/src/components/ProductView/ProductManagerChatPanel.module.css`
    - Add the same `.attachButton`, `.fileChipsContainer`, `.fileChip`, `.fileChipRemove` classes as in 4.2
    - Keep existing `.uploadButton` class intact
  - [x] 4.4 Update SolutionArchitectChatPanel.tsx -- remove modal, add inline file attachment
    - File: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
    - **Remove:** `import { UploadDocumentsModal } from './UploadDocumentsModal';`
    - **Remove:** `isUploadModalOpen` state and `setIsUploadModalOpen`
    - **Remove:** `handleSendWithSources` callback entirely
    - **Remove:** `<UploadDocumentsModal ... />` JSX rendering
    - **Remove:** The "Upload Documents" button from the input row
    - **Add imports:** `import { Paperclip } from 'lucide-react';` and `import { validateFiles, readFilesAsBase64, ACCEPTED_MIME_TYPES } from '../../utils/fileUploadUtils';`
    - **Add state:** `const [attachedFiles, setAttachedFiles] = useState<File[]>([]);` and `const fileInputRef = useRef<HTMLInputElement>(null);`
    - **Add handler:** `handleAttachFiles` -- triggered by the hidden file input's `onChange`; calls `validateFiles(attachedFiles, Array.from(event.target.files))`; if invalid, sets error; if valid, appends new files to `attachedFiles` state
    - **Add handler:** `handleRemoveFile(index: number)` -- removes the file at the given index from `attachedFiles`
    - **Update `handleSend`:** Before calling `postChatMessage`, if `attachedFiles.length > 0`, call `readFilesAsBase64(attachedFiles)` and include the result as `files` in the `ChatRequest`; do NOT include `sources`; clear `attachedFiles` state on successful send
    - **Update `handleSend`:** Enable send when `inputDraft.trim() !== '' || attachedFiles.length > 0`
    - **Update `handleSend`:** If `readFilesAsBase64` throws, catch the error, display in error banner, and do not send
    - **Add JSX:** Hidden `<input type="file" ref={fileInputRef} multiple accept={ACCEPTED_MIME_TYPES} onChange={handleAttachFiles} style={{ display: 'none' }} />`
    - **Add JSX:** `<button className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={loading}><Paperclip size={14} /> Attach Files</button>` in the input row (replacing the Upload Documents button position)
    - **Add JSX:** File chips container (above the input row) rendering each `attachedFiles` entry as a chip with filename and X remove button
    - **Update:** Loading state disables the attach button alongside the input field and send button
  - [x] 4.5 Update ProductManagerChatPanel.tsx -- identical changes as SolutionArchitectChatPanel
    - File: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx`
    - Apply the exact same set of changes as task 4.4:
      - Remove UploadDocumentsModal import, state, callback, JSX
      - Add lucide-react Paperclip import, file upload utils imports
      - Add `attachedFiles` state and `fileInputRef`
      - Add `handleAttachFiles` and `handleRemoveFile` handlers
      - Update `handleSend` to read files as base64 and include in `ChatRequest` (no `sources`)
      - Update send-enabled logic to include file attachment check
      - Add hidden file input, attach button, and file chips container JSX
      - Disable attach button during loading
  - [x] 4.6 Ensure UI component tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify attach button, file chips, removal, send-enabled logic, and error display work
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6 tests written in 4.1 pass
- UploadDocumentsModal is no longer imported or rendered in either SA or PM panels
- Paperclip icon + "Attach Files" button appears in both panels' input rows
- File chips render above the input row with removable X buttons
- Send button is enabled when files are attached (even without text)
- File validation errors appear in the error banner
- Files are read as base64, stripped of the data URI prefix, and sent in the `ChatRequest.files` array
- Loading state disables input field, attach button, and send button
- Both panels implement identical file attachment behavior

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 5 tests written by Task Group 1 (gateway types and configuration)
    - Review the 8 tests written by Task Group 2 (gateway chat route logic)
    - Review the 6 tests written by Task Group 3 (frontend file utilities)
    - Review the 6 tests written by Task Group 4 (UI components)
    - Total existing tests: 25 tests
  - [x] 5.2 Analyze test coverage gaps for THIS feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to multi-file upload and URL reference features
    - Do NOT assess entire application test coverage
    - Prioritize integration points: frontend-to-gateway file payload, content parts construction with URL augmentation, persistence round-trip
  - [x] 5.3 Write up to 10 additional strategic tests maximum
    - Potential gap areas to consider:
      - End-to-end: SA panel sends files -> gateway receives -> content parts constructed -> persistence stripped (integration test)
      - End-to-end: PM panel sends files -> gateway receives -> content parts constructed -> persistence stripped (integration test)
      - Edge case: Message with both inline URLs and attached files produces text part with URL-fetched content AND file content parts
      - Edge case: Empty files array (zero files) is treated as no-files (no content parts, just plain string content)
      - Edge case: File with no extension but valid MIME type handling
      - Regression: Existing `sources`-based flow for non-SA/PM modes still works unchanged
      - Regression: SA mode with `sources` (no `files`) still strips artefact content from persistence correctly
      - Edge case: `readFilesAsBase64` failure mid-batch (e.g., 3rd of 5 files fails) produces correct error and does not send
      - Boundary: Exactly 10 files at exactly 5 MB each (at the limit, should succeed)
      - Boundary: 11th file addition is rejected at frontend validation
    - Add maximum of 10 new tests to fill identified critical gaps
    - Write tests in `frontend/src/__tests__/multi-file-upload-gap-tests.test.ts` and/or `gateway/src/__tests__/multi-file-upload-gap-tests.test.ts`
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature:
      - `gateway/src/__tests__/multi-file-upload-types.test.ts` (Task 1.1)
      - `gateway/src/__tests__/multi-file-upload-chat-route.test.ts` (Task 2.1)
      - `frontend/src/__tests__/multi-file-upload-utils.test.ts` (Task 3.1)
      - `frontend/src/__tests__/multi-file-upload-ui.test.tsx` (Task 4.1)
      - Any gap tests from 5.3
    - Expected total: approximately 25-35 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 25-35 tests total)
- Critical user workflows for multi-file upload + URL references are covered
- No more than 10 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Regression confidence: existing `sources` flow and non-SA/PM modes unaffected

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Types and Interfaces** -- Foundation layer with no dependencies. Defines the `ContentPart` union type, updates `OpenAIMessage`, updates `calculateConversationBytes`, adds `files` to `ChatRequest`, and increases body limit. All subsequent groups depend on these types.

2. **Task Group 2: Gateway Chat Route Logic** -- Core backend logic. Depends on Task Group 1 types. Implements server-side validation, content parts construction, URL auto-detection refactoring, and persistence stripping generalization. Must be complete before frontend can successfully send file requests.

3. **Task Group 3: Frontend Types and API Layer** -- Utility layer for the frontend. Depends on Task Group 1 (types must align). Creates file validation utilities, base64 reading function, and updates the frontend `ChatRequest` interface. No UI changes yet.

4. **Task Group 4: UI Components** -- The user-facing changes. Depends on Task Group 3 (utilities) and Task Group 2 (gateway acceptance). Replaces the modal-based upload in both SA and PM panels with inline file attachment, file chips, and integrated send flow.

5. **Task Group 5: Test Review and Gap Analysis** -- Final validation. Depends on all prior groups. Reviews all tests, identifies gaps, writes up to 10 additional tests, and runs the full feature-specific test suite.

## Key Files Modified

| File | Task Group | Change Summary |
|------|-----------|---------------|
| `gateway/src/types/chat.ts` | 1 | Add `files` field to `ChatRequest` |
| `gateway/src/services/openaiClient.ts` | 1 | Define `ContentPart` union, update `OpenAIMessage.content` type |
| `gateway/src/services/conversation.ts` | 1 | Update `calculateConversationBytes` for array content |
| `gateway/src/server.ts` | 1 | Increase body parser limit to `'30mb'` |
| `gateway/src/routes/chat.ts` | 2 | Server-side validation, `buildContentParts`, URL extraction, persistence stripping |
| `frontend/src/api/chatApi.ts` | 3 | Add `files` field to frontend `ChatRequest` |
| `frontend/src/utils/fileUploadUtils.ts` | 3 | New file: validation constants, `validateFiles`, `readFilesAsBase64` |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` | 4 | Replace modal with inline file attachment |
| `frontend/src/components/ProductView/SolutionArchitectChatPanel.module.css` | 4 | Add `.attachButton`, `.fileChipsContainer`, `.fileChip`, `.fileChipRemove` |
| `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` | 4 | Replace modal with inline file attachment |
| `frontend/src/components/ProductView/ProductManagerChatPanel.module.css` | 4 | Add `.attachButton`, `.fileChipsContainer`, `.fileChip`, `.fileChipRemove` |

## Files NOT Modified (Out of Scope)

| File | Reason |
|------|--------|
| `frontend/src/components/ProductView/UploadDocumentsModal.tsx` | Remains for other consumers |
| `frontend/src/components/ProductView/UploadDocumentsModal.module.css` | Remains for other consumers |
| Any OAS assistant, implement_feature, or roadmap_pm code | Other chat modes are out of scope |
