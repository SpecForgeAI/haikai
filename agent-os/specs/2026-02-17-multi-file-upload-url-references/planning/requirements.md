# Spec Requirements: Multi-File Upload + URL References for SA and PM Chat

## Initial Description

Replace the current text-path-based UploadDocumentsModal with a proper file upload mechanism:
- Native file picker (multiple files) with chips showing selected files
- User types a message that may reference public URLs
- Single Send action sends everything to the gateway
- Gateway fetches URL content server-side, receives file bytes from frontend
- Gateway builds a single OpenAI message with content parts array (text + file + image_url)
- Single OpenAI API call to GPT-5 with all content

## Requirements Discussion

### First Round Questions

**Q1:** I assume we should enforce a per-file size limit (e.g., 5MB per file) and a total payload size limit (e.g., 20MB, replacing the current 3MB express.json limit). I also assume we should accept common document types -- text files (.txt, .md, .csv, .json, .yaml, .xml), images (.png, .jpg, .gif, .svg), and PDFs (.pdf) -- and reject unsupported types at the frontend before sending. Is that correct, or do you have different limits/types in mind?
**Answer:** Correct -- 5MB per file, 20MB total payload, accept common document types (text, images, PDFs), reject unsupported types at frontend.

**Q2:** I assume we should cap the maximum number of files per message at something reasonable, like 10 files per message, to avoid overly large payloads and token budget issues with the LLM. Is that correct, or should the limit be different?
**Answer:** Correct -- cap at 10 files per message.

**Q3:** The raw idea mentions "Gateway extracts URLs from message text, fetch content server-side." I assume this means automatically detecting http:// and https:// URLs within the user's free-text message (similar to what buildAugmentedMessage already does today), and that the frontend does NOT need to present extracted URLs as chips -- they remain inline in the message text. The chips in the input area are only for selected files. Is that correct?
**Answer:** Correct -- auto-detect URLs in message text, fetch server-side. Chips are only for local files, URLs stay inline in text.

**Q4:** I assume the file picker button and the resulting file chips (removable, showing filename) should appear directly in/above the existing chat input row (replacing the "Upload Documents" button), rather than in a separate modal. When files are selected, the user can still type a message alongside them and hit "Send" to send both the message text and files together. Should the "Upload Documents" button label remain the same, or should it change to something like a paperclip icon or "Attach Files"?
**Answer:** Correct -- inline in the input row, not a modal. Button should be "[lucide icon 'paperclip'] Attach Files" using the lucide Paperclip icon.

**Q5:** The raw idea specifies building a content parts array (text + file + image_url) for GPT-5. I assume image files should be sent as image_url content parts with a data URI (base64), and non-image files (PDF, text, etc.) should be sent as file content parts. Should we also handle the case where the model falls back to GPT-4o (which has different multimodal capabilities), or is GPT-5 the only target?
**Answer:** GPT-5 only -- no need to handle GPT-4o fallback.

**Q6:** The raw idea says "strip file content from conversation persistence (store filenames only)." I assume this extends the existing SA-mode artefact-stripping pattern (lines 1998-2015 in chat.ts) to all modes that use file uploads (both SA and PM). The persisted message would contain the original user text plus a list of filenames like [Attached: report.pdf, diagram.png] instead of the base64 content. Is that correct?
**Answer:** Correct -- strip file content, store original text + filename list like [Attached: report.pdf, diagram.png].

**Q7:** I assume we are fully removing UploadDocumentsModal.tsx, UploadDocumentsModal.module.css, and all references to them in both SolutionArchitectChatPanel.tsx and ProductManagerChatPanel.tsx. Is that correct, or should the old modal be kept as a fallback?
**Answer:** Do NOT remove UploadDocumentsModal -- it is used elsewhere. Instead, implement new code and replace the mechanism ONLY for the "Solution Architect" and "Product Manager" chats in the "Product" screen with the new mechanism. The old UploadDocumentsModal remains for other consumers.

**Q8:** The raw idea lists drag-and-drop, file preview/thumbnails, server-side storage, changes to other chat modes, and conversation rehydration of file content as out of scope. Is there anything else you want to explicitly exclude?
**Answer:** Nothing else to exclude -- the existing out-of-scope list is sufficient.

### Existing Code to Reference

No specific similar features identified for code reuse. The user indicated that a simpler custom chip list should be implemented for file attachments rather than reusing the existing MultiValueChipsInput component from the UploadDocumentsModal.

**Key existing code paths to reference during implementation:**

- `frontend/src/components/ProductView/UploadDocumentsModal.tsx` -- Existing modal that will remain but whose mechanism is being replaced in SA and PM panels
- `frontend/src/components/ProductView/UploadDocumentsModal.module.css` -- Existing modal styles (keep intact)
- `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` -- SA panel where the new inline file attachment replaces the modal trigger
- `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` -- PM panel where the new inline file attachment replaces the modal trigger
- `frontend/src/api/chatApi.ts` -- ChatRequest interface (currently has `sources?: string[]` field); needs new `files` array shape
- `gateway/src/routes/chat.ts` -- `buildAugmentedMessage` function (line ~739) handles URL fetching; artefact stripping pattern (lines ~1998-2015) for persistence
- `gateway/src/types/chat.ts` -- Gateway-side ChatRequest type
- `gateway/src/services/openaiClient.ts` -- OpenAIMessage interface; needs content parts array support
- `gateway/src/services/conversation.ts` -- Conversation persistence logic
- `gateway/src/config.ts` -- Body size limits configuration

### Follow-up Questions

No follow-up questions were needed. All first-round answers were sufficiently clear and specific.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `C:/Workspaces/SSD/architecture-store-and-diagrams/agent-os/specs/2026-02-17-multi-file-upload-url-references/planning/visuals/` confirmed no image files found.

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements
- Native file picker allowing multiple file selection (up to 10 files per message)
- Per-file size limit of 5MB; total payload limit of 20MB
- Accepted file types: text (.txt, .md, .csv, .json, .yaml, .xml), images (.png, .jpg, .gif, .svg), PDFs (.pdf); unsupported types rejected at frontend
- Inline "[Paperclip icon] Attach Files" button in the chat input row using the lucide Paperclip icon
- Selected files displayed as removable chips (showing filename) in/above the input area
- User can type a message alongside attached files and send both together with a single Send action
- URLs in message text are auto-detected and fetched server-side by the gateway (existing buildAugmentedMessage pattern)
- Gateway receives file bytes (base64) from frontend in a new `files` array field on ChatRequest (filename, mimeType, base64)
- Gateway builds OpenAI content parts array: text parts for message, `image_url` parts for images (base64 data URI), `file` parts for non-image files (PDF, text, etc.)
- Single OpenAI API call to GPT-5 with combined content parts
- File content stripped from conversation persistence; persisted message stores original user text plus `[Attached: filename1, filename2]` notation
- The `sources` field on ChatRequest is removed from the SA and PM chat flows (replaced by `files` array)
- Express body size limit increased to accommodate 20MB payloads
- Both Solution Architect and Product Manager chat panels use the identical new mechanism

### Reusability Opportunities
- Implement a simpler custom chip list for file attachments (do not reuse MultiValueChipsInput from UploadDocumentsModal)
- Extend the existing SA-mode artefact-stripping pattern in chat.ts (lines ~1998-2015) to generalize for both SA and PM modes with file uploads
- The existing `buildAugmentedMessage` URL-fetching logic can be refactored to handle URLs only (file content handled separately through content parts)

### Scope Boundaries

**In Scope:**
- Frontend: New inline file picker + chips UI in SolutionArchitectChatPanel and ProductManagerChatPanel
- Frontend: Read selected files as base64 on Send
- Frontend: New ChatRequest shape with files array (filename, mimeType, base64)
- Frontend: Remove sources field usage from SA and PM chat flows
- Gateway: Accept files array from JSON body, increase body size limit
- Gateway: Extract URLs from message text, fetch content server-side
- Gateway: Build OpenAI content parts array (text, file, image_url) based on MIME type
- Gateway: Update OpenAIMessage interface to support content parts array
- Gateway: Strip file content from conversation persistence (store filenames only)
- Gateway: Update buildAugmentedMessage to handle URLs only (files handled separately)
- Both SA and PM chat panels on the "Product" screen (identical mechanism)
- Target GPT-5 model compatibility only

**Out of Scope:**
- Drag-and-drop file upload (future enhancement)
- File preview/thumbnails in chat
- Server-side file storage/caching
- Changes to other chat modes (OAS assistant, implement_feature, roadmap_pm)
- Conversation rehydration of file content (only filenames stored)
- Removal of UploadDocumentsModal (it is used by other consumers outside SA/PM Product screen)
- GPT-4o fallback handling

### Technical Considerations
- Express JSON body parser limit must be increased from current value to at least 20MB to support file payloads
- The OpenAIMessage interface in `gateway/src/services/openaiClient.ts` currently uses `content: string`; it must be updated to support `content: string | ContentPart[]` for the GPT-5 content parts array format
- File validation (type, size, count) should happen at the frontend before encoding to base64, to fail fast and avoid unnecessary encoding work
- The lucide-react library must be available (or added) for the Paperclip icon; verify it is in the frontend dependencies
- The existing `sources` field on ChatRequest is replaced by the new `files` array; this is a breaking change for SA and PM chat flows but should not affect other modes
- The artefact-stripping logic currently only applies when `context?.mode === 'solution_architect' && sources && sources.length > 0`; this must be generalized to also handle `product_manager` mode and the new `files` array
- Base64 encoding increases payload size by ~33%; a 5MB file becomes ~6.67MB base64, so 10 files at 5MB each could approach ~67MB base64 -- the 20MB total payload limit should be enforced on the raw file sizes before encoding, and the Express body limit should account for the base64 overhead (consider setting it to ~30MB to handle 20MB of raw files after base64 expansion)
