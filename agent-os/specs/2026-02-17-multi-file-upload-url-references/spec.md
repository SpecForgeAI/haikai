# Specification: Multi-File Upload + URL References for SA and PM Chat

## Goal

Replace the modal-based text-path UploadDocumentsModal mechanism in the Solution Architect and Product Manager chat panels with a native file picker that reads files as base64, sends them in the JSON body alongside the user message, and builds an OpenAI content parts array (text + image_url + file) for a single GPT-5 API call.

## User Stories

- As a Solution Architect user, I want to attach local files (PDFs, images, text files) directly in the chat input area so that the LLM can analyze their contents alongside my message in a single interaction.
- As a Product Manager user, I want to paste URLs in my message text and have the gateway automatically fetch and include their content so that I do not need to manually copy-paste web content.
- As a user of either SA or PM chat, I want attached file content stripped from conversation persistence (storing only filenames) so that stored conversations remain small and readable.

## Specific Requirements

**Inline file attachment UI in chat input row**
- Replace the "Upload Documents" button and UploadDocumentsModal usage in SolutionArchitectChatPanel and ProductManagerChatPanel with an inline "[Paperclip icon] Attach Files" button using the `Paperclip` icon from the already-installed `lucide-react` package
- The button triggers a hidden `<input type="file" multiple>` element with an `accept` attribute that restricts to supported MIME types
- Selected files are displayed as removable chips (filename + X button) in a row between the input field and the message list (above the input row area)
- The user can still type a message in the text input alongside attached files; Send submits both together
- The Send button should be enabled when either the input draft has text OR files are attached (or both)
- Remove the `isUploadModalOpen` state, the `UploadDocumentsModal` import, the `handleUploadDocuments` callback, and the `handleSendWithSources` callback from both panels; replace with the new file attachment state and flow

**Frontend file validation (fail-fast before base64 encoding)**
- Accepted file extensions and MIME types: `.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.yml`, `.xml` (text types), `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg` (image types), `.pdf`
- Per-file size limit: 5 MB (checked via `file.size` on the native `File` object before reading)
- Maximum 10 files per message; reject additional files with a user-visible error
- Total raw file size limit: 20 MB across all attached files (checked before encoding)
- Display inline validation errors (e.g., "File exceeds 5 MB limit", "Maximum 10 files allowed", "Unsupported file type") in the existing error banner pattern; do not send the request

**Base64 file reading and ChatRequest shape**
- On Send, read each attached file using `FileReader.readAsDataURL` (or equivalent) to produce base64 strings
- Add a new `files` field to the frontend `ChatRequest` interface: `files?: Array<{ filename: string; mimeType: string; base64: string }>`
- The `base64` value should be the raw base64 data without the `data:...;base64,` prefix (strip the prefix after reading)
- Remove `sources` field usage from both SA and PM panel `postChatMessage` calls; the `sources` field itself remains on the `ChatRequest` interface for backward compatibility with other consumers but SA/PM panels no longer send it

**Gateway ChatRequest and body size limit update**
- Add the `files` field to the gateway-side `ChatRequest` interface in `gateway/src/types/chat.ts`: `files?: Array<{ filename: string; mimeType: string; base64: string }>`
- Increase the Express JSON body parser limit in `gateway/src/server.ts` from `'3mb'` to `'30mb'` to accommodate the base64 overhead of 20 MB of raw files (base64 expands by ~33%)
- Add server-side validation in the chat route: reject requests where `files` array length exceeds 10 or any individual base64 payload exceeds ~6.67 MB (5 MB raw * 1.34)

**Gateway content parts array construction for OpenAI**
- After `buildAugmentedMessage` (which continues to handle URL fetching from message text), build an OpenAI content parts array when the request has files
- For image MIME types (`image/png`, `image/jpeg`, `image/gif`, `image/svg+xml`): create `image_url` content parts with `url: "data:<mimeType>;base64,<base64data>"` and `detail: "auto"`
- For non-image MIME types (PDF, text, etc.): create `file` content parts with `file_data: "data:<mimeType>;base64,<base64data>"` and `filename` set from the request
- The text part of the message (the augmented message text, which may include URL-fetched content) becomes a `{ type: 'text', text: augmentedMessage }` content part
- The final content parts array is ordered: text part first, then file/image parts in the order they were attached
- This content parts array is set as the `content` field of the user message in the messages array sent to OpenAI

**OpenAIMessage interface update**
- Change the `content` field of the `OpenAIMessage` interface in `gateway/src/services/openaiClient.ts` from `content: string` to `content: string | ContentPart[]` where `ContentPart` is a union type covering `{ type: 'text'; text: string }`, `{ type: 'image_url'; image_url: { url: string; detail?: string } }`, and `{ type: 'file'; file: { file_data: string; filename: string } }`
- Update the `sendChatRequest` function: the messages are already cast to `ChatCompletionMessageParam[]` via `as unknown as`, so the OpenAI SDK will accept content parts arrays for user messages without further changes
- Update `calculateConversationBytes` in `conversation.ts` to handle `content` being either a string or an array (serialize to JSON string for byte counting when it is an array)

**URL auto-detection and server-side fetching**
- The existing `buildAugmentedMessage` function already handles URL fetching from `sources` (file paths or URLs); refactor it to work with the new flow
- When the request has no `sources` but message text contains `http://` or `https://` URLs, extract those URLs and fetch their content server-side using the same pattern (fetch with 10s timeout, truncate at 50K chars, append as `--- ATTACHED DOCUMENTS ---` sections)
- When the request has `files`, do NOT use `buildAugmentedMessage` for file content (files go through content parts); only use it for URL extraction from the message text
- The `sources` field processing remains unchanged for backward compatibility with non-SA/PM modes that still send it

**Conversation persistence: strip file content, store filenames only**
- Generalize the existing artefact-stripping pattern at lines ~1998-2015 of `chat.ts` to handle the new `files` array for both `solution_architect` and `product_manager` modes
- When persisting, if the request included `files`, replace the user message content (which contains the content parts array) with the original text message plus `\n\n[Attached: filename1.pdf, filename2.png]` notation
- The persisted message content must be a plain string (not a content parts array) so that conversation rehydration continues to work without changes
- The `persistConversation` call should receive a `messagesForPersistence` array with the stripped content, leaving the original `messages` array unmodified (same pattern as the existing SA artefact stripping)

**CSS styles for file chips and attach button**
- Add new CSS classes to both `SolutionArchitectChatPanel.module.css` and `ProductManagerChatPanel.module.css` for the file chip container, individual file chips (with filename text and remove button), and the attach button
- The file chip container sits between the message list and the input row, visible only when files are selected
- File chips use a compact pill style consistent with the existing design system: `background: #e3f2fd`, `color: #1565c0`, `border-radius: 10px`, `font-size: 11px`, matching the `sectionLabel` badge style
- The attach button replaces the `.uploadButton` style; use the same secondary button styling but with the Paperclip icon inline before the "Attach Files" text

**Send flow integration**
- The `handleSend` callback in both panels is updated to: (1) read all attached files as base64, (2) construct the `ChatRequest` with `message`, `context`, `sessionId`, and the new `files` array, (3) call `postChatMessage`, (4) clear attached files state on successful send
- If file reading fails (e.g., permission error), display an error in the error banner and do not send
- The loading state disables both the input field, the attach button, and the send button (same pattern as current loading behavior)

## Visual Design

No visual mockups were provided. The UI follows the existing design system patterns:
- Paperclip icon + "Attach Files" as a secondary button in the input row, matching the existing `.uploadButton` styling
- File chips as small removable pills above the input row, matching the `.sectionLabel` badge color scheme

## Existing Code to Leverage

**SolutionArchitectChatPanel.tsx and ProductManagerChatPanel.tsx (current upload flow)**
- Both panels currently have identical patterns: `isUploadModalOpen` state, `handleUploadDocuments` callback, `handleSendWithSources` callback, `UploadDocumentsModal` rendering, and the "Upload Documents" button in the input row
- These are replaced in-place with the new inline file attachment mechanism; the overall panel structure (messages list, input row, error banner, loading indicator) remains unchanged
- The `handleSend` callback structure is reused and extended to include file reading before calling `postChatMessage`

**buildAugmentedMessage in gateway/src/routes/chat.ts (line ~749)**
- Currently fetches content from `sources` (file paths or URLs) and appends to the message text as `--- ATTACHED DOCUMENTS ---` sections
- The URL-fetching logic (lines 760-763) should be extracted or replicated to work with inline URLs detected in message text when no `sources` are provided but `files` are present
- The function signature and behavior for non-SA/PM modes using `sources` must remain unchanged for backward compatibility

**Artefact-stripping pattern in gateway/src/routes/chat.ts (lines ~1998-2015)**
- Currently strips augmented document content from persistence for SA mode when `sources` are present, replacing augmented user message content with the original `message` string
- Generalize the condition from `context?.mode === 'solution_architect' && sources && sources.length > 0` to also match `product_manager` mode and the new `files` array
- The stripping logic for `files` creates a new `messagesForPersistence` array where the user message content is `"<original text>\n\n[Attached: file1.pdf, file2.png]"` instead of the content parts array

**OpenAIMessage interface in gateway/src/services/openaiClient.ts (line ~38)**
- Currently defines `content: string`; this single-type field must become `content: string | ContentPart[]` to support the OpenAI content parts array format for multimodal messages
- The existing `sendChatRequest` already casts messages through `as unknown as ChatCompletionMessageParam[]`, so the SDK typing will accept the new shape without additional casting changes

**Express body parser limit in gateway/src/server.ts (line 23)**
- Currently `express.json({ limit: '3mb' })`; must be increased to `'30mb'` to accommodate base64-encoded file payloads (20 MB raw files expand to ~27 MB in base64, plus JSON overhead)

## Out of Scope

- Drag-and-drop file upload (future enhancement)
- File preview or thumbnail rendering in the chat panel
- Server-side file storage or caching of uploaded files
- Changes to any chat modes other than `solution_architect` and `product_manager` on the Product screen (no changes to OAS assistant, implement_feature, roadmap_pm)
- Conversation rehydration of file content (only filenames are stored; the actual file data is not recoverable from persisted conversations)
- Removal of UploadDocumentsModal.tsx or UploadDocumentsModal.module.css (they remain for other consumers)
- GPT-4o fallback or multi-model compatibility (GPT-5 is the only target model)
- Removal of the `sources` field from the ChatRequest interface (it remains for backward compatibility with non-SA/PM flows)
- Streaming endpoint support for file uploads (only the non-streaming POST /api/chat endpoint is in scope)
- Multipart form data transport (files are sent as base64 in the JSON body)
