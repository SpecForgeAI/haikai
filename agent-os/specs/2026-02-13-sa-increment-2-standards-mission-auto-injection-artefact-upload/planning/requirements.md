# Spec Requirements: SA Increment 2 -- Standards + MISSION Auto-Injection + Artefact Upload/URL Ingestion

## Initial Description

Enhance the Solution Architect mode so that, at conversation start, it automatically receives MISSION.MD (business context) and TECH-STACK.MD (generated standards), and supports user-uploaded artefacts (local files or public URLs) using the same mechanism already implemented for Product Manager. This increment remains tool-less and does NOT persist architecture.

SCOPE INCLUDE:
- auto-load MISSION.MD and TECH-STACK.MD into SA context
- enforce standards-generation check at start of SA session
- reuse existing artefact upload + URL ingestion pipeline
- inject uploaded artefacts into SA context window
- ensure artefacts are not written to transcript files

SCOPE EXCLUDE:
- architecture meta-model writes
- MCP save tool for architecture
- diagram creation
- modification of Product Manager behavior
- structured extraction of artefacts

GATEWAY CHANGES:
- On every SA turn: load MISSION.MD from `<projectParentFolder>/agent-os/product/MISSION.MD`, load TECH-STACK.MD from its existing storage location
- Inject both into system context (NOT as user message) formatted with `=== PRODUCT MISSION ===` and `=== TECHNICAL STANDARDS ===` headers
- If TECH-STACK.MD does not exist: SA must respond "Project standards have not been generated. Please generate standards before proceeding." and halt further questioning (short-circuit, no LLM call)
- System prompt update: instruct SA that architecture decisions must align with MISSION.MD, technology choices must align with TECH-STACK.MD
- Do not output mission or standards content, use only as internal reasoning context

ARTEFACT INGESTION:
- Use same upload/URL ingestion flow already wired for PM (`buildAugmentedMessage` in chat.ts)
- Artefacts appended to user message for OpenAI call via existing `buildAugmentedMessage`
- Prefix each artefact with: `=== USER ARTEFACT: <filename or URL> ===`
- Do NOT persist artefact content into transcript JSON or conversation.json
- Transcript should only record user message indicating upload and assistant acknowledgment
- Full artefact text must not be written to conversation.json
- Persist only the original un-augmented message; send augmented content only to OpenAI
- Reuse existing size limits and sanitization rules

FRONTEND CHANGES:
- SolutionArchitectChatPanel: already has UploadDocumentsModal wired (no new frontend work expected beyond what already exists)
- Allow file upload and URL input (already implemented)
- On upload, call existing artefact ingestion API (already wired)

ACCEPTANCE CRITERIA:
- On every SA message, system automatically injects MISSION.MD and TECH-STACK.MD into system prompt
- If TECH-STACK.MD missing, SA returns deterministic halt message without calling LLM
- User can upload files or provide URLs (already functional from Increment 1)
- Uploaded artefacts are used by SA in reasoning via augmented user message
- Artefact contents are NOT persisted in transcript files or conversation.json
- SA continues structured questioning after artefact review

## Requirements Discussion

### First Round Questions

**Q1:** MISSION.MD file casing ambiguity. The MCP `save_product_artifacts` tool writes `MISSION.MD` (uppercase) to `<projectParentFolder>/agent-os/product/MISSION.MD`. However, this project's existing file is lowercase `mission.md`. I assume the gateway's new file-read logic should try both casings (first `MISSION.MD`, then `mission.md`) to handle either convention. Is that correct, or should we enforce one casing?
**Answer:** Try both casings (first MISSION.MD, then mission.md); treat uppercase as the canonical write target going forward.

**Q2:** TECH-STACK.MD file name and location. The existing standards file on disk is `tech-stack.md` (lowercase, hyphenated) at `<projectParentFolder>/agent-os/product/tech-stack.md`. Your requirements reference `TECH-STACK.MD` (uppercase). I assume we should match the actual file naming convention and try both casings, similar to question 1. Can you confirm the exact filename the external Standards service produces, or should we try `TECH-STACK.MD` then fall back to `tech-stack.md`?
**Answer:** Try both casings (first TECH-STACK.MD, then tech-stack.md at the known path); treat TECH-STACK.MD as canonical name in prompts even if sourced from lowercase.

**Q3:** Context injection point: system prompt vs. user message. Currently, `buildAugmentedMessage` appends artefact content to the user message string. Your requirements state artefacts should be "appended to system context" and MISSION/TECH-STACK should be "injected into system context (NOT as user message)." I see two approaches: (A) Inject MISSION + TECH-STACK into the system prompt (via `buildSystemPrompt`), and also inject artefacts into the system prompt. (B) Inject MISSION + TECH-STACK into the system prompt, but keep artefacts flowing through `buildAugmentedMessage` (user message) since that pipeline already exists and works. I assume option (A) is preferred for MISSION/TECH-STACK (system prompt), but for user artefacts, the existing `buildAugmentedMessage` mechanism (option B) would be reused as-is since it already handles size limits, error handling, and URL fetching. Is that correct?
**Answer:** Yes -- use (B): inject MISSION/TECH-STACK into the system prompt, keep uploaded user artefacts flowing through the existing buildAugmentedMessage user-message pipeline (but ensure persistence strips them).

**Q4:** "First SA turn" detection for auto-loading. You say "On first SA turn (no prior transcript)..." I assume "first turn" means the session has no conversation history. Should MISSION + TECH-STACK be loaded on every SA turn (to ensure they are always in context) or only on the first turn? Since the system prompt is rebuilt every turn anyway, injecting them every turn seems safer and simpler.
**Answer:** Load on every SA turn (safer + consistent since system prompt is rebuilt each request); cache file reads per request if needed.

**Q5:** Standards-missing halt behavior. When TECH-STACK.MD is missing, you want the SA to respond with the fixed halt message and "halt further questioning." I assume this means the gateway should not send the user's message to OpenAI at all -- instead, it should return a pre-built response with the halt message directly, bypassing the LLM call entirely. Is that correct?
**Answer:** Short-circuit in the gateway without calling the LLM at all; return a deterministic "standards missing -- please generate" response.

**Q6:** Artefact content in conversation.json persistence. You require artefact contents NOT be persisted in transcript files. Currently, `persistConversation` stores the full messages array (including the augmented user message) to the in-memory session, which is then written to conversation.json. To prevent this, should we: (A) Store only the original message (not the augmented one) in the persisted conversation, while still sending the augmented message to OpenAI? (B) Or is it acceptable that artefact content appears in the in-memory session's conversation history but must not appear in on-disk files?
**Answer:** Choose (A): persist only the original, un-augmented messages to disk; send augmented content only to OpenAI.

**Q7:** Scope of "artefact not in transcript" requirement. The augmented message content would appear in both conversation.json and full-conversation.txt. I assume the requirement is that no on-disk file should contain the full artefact text -- so both files should record only the user's short sharing message, not the appended document content. Correct?
**Answer:** Correct -- neither conversation.json nor full-conversation.txt should contain full artefact text; only the user's short sharing message and assistant acknowledgements.

**Q8:** Are there any additional scope exclusions or edge cases? For example: Should the upload button be disabled when standards are missing and the SA has halted? Should there be any visual indicator in the SA panel that MISSION/TECH-STACK have been loaded?
**Answer:** Out of scope: disabling upload when standards missing and visual indicators for loaded files (keep UX minimal in this increment).

### Existing Code to Reference

**Similar Features Identified:**

- Feature: buildAugmentedMessage - Path: `gateway/src/routes/chat.ts` (lines 294-320)
  - Reads local files and URLs, appends to user message with size limit (50KB per source)
  - Handles errors gracefully per-source
  - Already called for SA mode at line 498

- Feature: buildSystemPrompt SA branch - Path: `gateway/src/services/promptBuilder.ts` (lines 1353-1356)
  - Currently returns bare `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` with no dynamic context injection
  - Needs enhancement to accept and inject MISSION.MD and TECH-STACK.MD content

- Feature: SOLUTION_ARCHITECT_PROMPT_TEMPLATE - Path: `gateway/src/services/promptBuilder.ts` (lines 367-442)
  - Full SA system prompt defining the architecture discovery persona
  - Needs instruction additions about aligning with MISSION.MD and TECH-STACK.MD

- Feature: SolutionArchitectChatPanel - Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`
  - Already has UploadDocumentsModal integrated (lines 541-545)
  - Already has handleSendWithSources (lines 328-375)
  - Already sends `sources` field in postChatMessage call (line 348)
  - Already sends `projectParentFolder` in context (line 79)
  - Bootstrap message at line 189

- Feature: ProductManagerChatPanel upload flow - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` (lines 304-359)
  - Pattern reference for handleSendWithSources and handleUploadDocuments

- Feature: UploadDocumentsModal - Path: `frontend/src/components/ProductView/UploadDocumentsModal.tsx`
  - Shared component already used by both PM and SA panels
  - Uses MultiValueChipsInput for file paths / URLs

- Feature: persistConversation - Path: `gateway/src/services/conversation.ts` (lines 95-119)
  - Currently persists full messages array including augmented content
  - Key modification point for stripping artefact content before persistence

- Feature: shouldAppendToTranscript - Path: `gateway/src/routes/chat.ts` (lines 134-136)
  - Currently only returns true for implement_feature mode
  - SA mode does NOT use transcript entries -- but does use conversation.json via separate path

- Feature: save_product_artifacts MCP tool - Path: `mcp-server/src/routes/saveProductArtifactsRoute.ts`
  - Writes MISSION.MD to `<projectParentFolder>/agent-os/product/MISSION.MD` (uppercase)
  - Confirms the canonical write path and casing

- Feature: Chat request types - Path: `gateway/src/types/chat.ts`
  - ChatContext includes `projectParentFolder` (line 260) which is needed for file path construction
  - ChatRequest includes `sources` field (line 316)

- Feature: SA response validation with corrective retry - Path: `gateway/src/routes/chat.ts` (lines 781-881)
  - The standards-missing short-circuit must happen BEFORE this validation block

### Follow-up Questions

No follow-up questions were needed. All answers were comprehensive and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided. Mandatory bash check of the visuals folder confirmed no image files present.

### Visual Insights:
N/A -- no visuals to analyze.

## Requirements Summary

### Functional Requirements

1. **Auto-load MISSION.MD on every SA turn**: The gateway reads `<projectParentFolder>/agent-os/product/MISSION.MD` (falling back to `mission.md`) on every `solution_architect` mode request. Content is injected into the system prompt under a `=== PRODUCT MISSION ===` header.

2. **Auto-load TECH-STACK.MD on every SA turn**: The gateway reads `<projectParentFolder>/agent-os/product/TECH-STACK.MD` (falling back to `tech-stack.md`) on every `solution_architect` mode request. Content is injected into the system prompt under a `=== TECHNICAL STANDARDS ===` header.

3. **Standards-missing short-circuit**: If TECH-STACK.MD does not exist (neither casing found), the gateway returns a deterministic response `"Project standards have not been generated. Please generate standards before proceeding."` WITHOUT calling the LLM. This is a gateway-level short-circuit that must occur before the OpenAI call and before SA validation logic.

4. **MISSION.MD missing is NOT a hard stop**: If MISSION.MD is missing, the SA conversation proceeds without it (graceful degradation). Only TECH-STACK.MD absence triggers the halt.

5. **System prompt enhancement**: The `SOLUTION_ARCHITECT_PROMPT_TEMPLATE` must be updated with instructions that:
   - Architecture decisions must align with the injected PRODUCT MISSION context
   - Technology choices must align with the injected TECHNICAL STANDARDS context
   - The SA must NOT output the mission or standards content to the user; use them only as internal reasoning context

6. **Artefact upload via existing pipeline**: User-uploaded artefacts (file paths and URLs) continue to flow through the existing `buildAugmentedMessage` function, appending to the user message for the OpenAI call. The prefix format is `=== USER ARTEFACT: <filename or URL> ===`.

7. **Artefact content must not persist to disk**: The original un-augmented user message is what gets stored in:
   - The in-memory session conversation (for rehydration to conversation.json)
   - Any transcript files (full-conversation.txt)
   - The conversation.json written by putImplementConversation
   Only the augmented message is sent to OpenAI. This requires modifying the persistence flow in chat.ts to use the original `message` rather than `augmentedMessage` when building the messages array for `persistConversation`.

8. **Frontend already wired**: The SolutionArchitectChatPanel already integrates UploadDocumentsModal, handleSendWithSources, and sends the `sources` field. No new frontend component work is required. The UploadDocumentsModal body text could optionally be updated to say "Solution Architect" instead of "Product Manager" but this is cosmetic and low priority.

### Reusability Opportunities

- **buildAugmentedMessage** (`gateway/src/routes/chat.ts`): Reuse as-is for artefact ingestion. No modifications needed to the function itself.
- **buildSystemPrompt SA branch** (`gateway/src/services/promptBuilder.ts`): Extend to accept MISSION and TECH-STACK content and inject into the returned prompt.
- **UploadDocumentsModal** (`frontend/src/components/ProductView/UploadDocumentsModal.tsx`): Already shared between PM and SA panels. No changes needed.
- **SolutionArchitectChatPanel** (`frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx`): Already has full upload wiring. No changes needed.
- **fs.readFile pattern in buildAugmentedMessage** (line 310): Same pattern for reading MISSION.MD and TECH-STACK.MD from disk.
- **persistConversation** (`gateway/src/services/conversation.ts`): Modify or wrap to accept original (non-augmented) messages for SA mode.

### Scope Boundaries

**In Scope:**
- Gateway: Read MISSION.MD from disk on every SA turn, inject into system prompt
- Gateway: Read TECH-STACK.MD from disk on every SA turn, inject into system prompt
- Gateway: Short-circuit with deterministic response when TECH-STACK.MD is missing
- Gateway: Update SOLUTION_ARCHITECT_PROMPT_TEMPLATE with alignment instructions
- Gateway: Ensure artefact content from buildAugmentedMessage does not leak into persisted conversations
- Gateway: Use original message (not augmented) for conversation persistence and transcript

**Out of Scope:**
- Architecture meta-model writes
- MCP save tool for architecture
- Diagram creation
- Modification of Product Manager behavior
- Structured extraction of artefacts
- Disabling upload button when standards are missing
- Visual indicators for loaded MISSION/TECH-STACK files
- Any changes to the UploadDocumentsModal component
- Any changes to the SolutionArchitectChatPanel component (frontend is already wired)
- Conversation reset or "start over" functionality

### Technical Considerations

- **File casing strategy**: Try uppercase first (MISSION.MD, TECH-STACK.MD), fall back to lowercase (mission.md, tech-stack.md). Use `fs.access` or try/catch on `fs.readFile` for existence checking.
- **File path construction**: `<projectParentFolder>/agent-os/product/MISSION.MD` and `<projectParentFolder>/agent-os/product/TECH-STACK.MD`. The `projectParentFolder` is available from `context.projectParentFolder` in the ChatContext.
- **Short-circuit placement**: The standards-missing check must occur in `chat.ts` BEFORE the call to `sendChatRequest` and BEFORE the SA validation block (lines 781-881). It should return a ChatResponse with the halt message directly.
- **Persistence separation**: The key change is in the POST /api/chat handler in chat.ts. Currently, line 626 appends the assistant response to `messages` (which already contains the augmented user message). For SA mode with sources, the messages array passed to `persistConversation` must use the original `message` instead of `augmentedMessage` for the user turn. One approach: rebuild the messages array for persistence with the original message, or keep two parallel arrays.
- **System prompt size**: MISSION.MD and TECH-STACK.MD content will be injected into the system prompt. Need to consider token limits. The existing 50KB per-source limit in buildAugmentedMessage provides a reference point. Consider a similar cap for injected files (e.g., truncate at 50KB each).
- **Error handling**: If MISSION.MD or TECH-STACK.MD cannot be read (permissions, encoding issues), log a warning and proceed gracefully (MISSION missing = proceed without; TECH-STACK missing = halt).
- **buildSystemPrompt signature**: Currently `buildSystemPrompt(session, context, resolvedContext, productSummary, metaModelSummary)`. The SA branch returns early at line 1355-1356 before using any of these parameters. The function signature may need extension, or the file-reading logic could be embedded in the SA prompt builder itself since it needs `context.projectParentFolder`. Alternatively, the file reads happen in chat.ts before calling buildSystemPrompt, and the content is passed as new parameters.
- **Async considerations**: `buildSystemPrompt` is currently synchronous. If file reads are done inside it, it would need to become async. Alternatively, read files in chat.ts (which is already async) and pass content to a synchronous buildSystemPrompt.
