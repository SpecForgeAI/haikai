# Spec Requirements: Generalize Conversation Persistence to Support Kind

## Initial Description

Reuse the existing gateway conversation persistence mechanism by introducing a conversation "kind" directory level so multiple conversation types can be stored without collisions. Persist paths become: `<projectParentFolder>/conversations/<kind>/<derivedFolderName>/...`. Backward compatible: existing implement conversations continue to work with default `kind="implement"`.

The scope includes extending existing implement-conversations GET/PUT to accept optional `kind`, storing and reading transcripts under `conversations/<kind>/...`, defaulting `kind="implement"` when missing, validating `kind` against an allowlist `["implement","product"]`, ensuring atomic writes remain unchanged (tmp + rename), and updating frontend callers for the implement flow to pass `kind` explicitly.

## Requirements Discussion

### First Round Questions

**Q1:** The raw idea mentions extending GET/PUT implement-conversations to accept an optional kind parameter. The implement-state routes (GET/PUT) use the exact same path derivation utilities (deriveFolderName + buildTranscriptPath). Should implement-state also be updated to accept kind so that conversation JSON and implementation-state JSON continue to be co-located in the same folder?
**Answer:** Yes -- update implement-state to accept kind so state + transcript remain co-located under the same `conversations/<kind>/<folderName>/`.

**Q2:** The buildTranscriptPath function in transcriptWriter.ts currently constructs paths as `<basePath>/conversations/<folderName>/`. Should we update buildTranscriptPath itself to accept an optional kind parameter (defaulting to "implement") so all downstream callers inherit the new structure automatically, or handle kind insertion at the route-handler level only?
**Answer:** Update buildTranscriptPath to accept optional kind (default "implement") so all downstream callers inherit the new structure automatically.

**Q3:** The writeTranscriptToFile function in the chat route (chat.ts line ~233) also persists transcripts during the streaming chat flow, using the same buildTranscriptPath/deriveFolderName utilities. Should the chat route also be updated to thread the kind parameter through (defaulting to "implement"), so that chat-flow transcripts land in the same conversations/<kind>/<folderName>/ location?
**Answer:** Yes -- thread kind through chat.ts persistence calls as well, defaulting to "implement" if not provided.

**Q4:** For the kind parameter precedence rule in PUT requests (body > query > default). For GET requests, kind would be a query parameter only (since GET has no body). Should the response include the resolved kind value so the frontend knows which kind was actually used?
**Answer:** No -- don't echo kind in the response; the caller already knows what it requested and defaults are deterministic.

**Q5:** Should the frontend changes be limited to adding an optional kind parameter to getImplementConversation, putImplementConversation, getImplementState, and putImplementState in chatApi.ts, and passing kind="implement" from ImplementationAssistantPanel at its call sites (~lines 956, 999, 1100)? Are there other frontend callers?
**Answer:** Yes -- add optional kind param to those four chatApi.ts functions and pass kind="implement" from ImplementationAssistantPanel; no other frontend changes in this increment.

**Q6:** Should we keep the top-level folder name "conversations" unchanged, only inserting the <kind> subfolder beneath it?
**Answer:** Correct -- keep top-level folder name "conversations"; only insert the <kind> subfolder.

**Q7:** Should the GET endpoints fall back to reading from the old (non-kind) path if the kind-prefixed path returns ENOENT, for backward compatibility with files written before this change?
**Answer:** No fallback/legacy locations needed, so only go forward directory structure.

**Q8:** Is there anything explicitly out of scope or future considerations to document but not implement?
**Answer:** Yes -- out of scope: new kind values, listing/discovery endpoints, UI for selecting kind, any writes to legacy path, and any migration/relocation jobs.

### Existing Code to Reference

**Primary touchpoint files identified:**
- Feature: transcriptWriter utilities - Path: `gateway/src/services/transcriptWriter.ts` -- contains `buildTranscriptPath`, `deriveFolderName`, `writeTranscriptToFile`, `writeConversationJson`, `writeDisplayedConversation`
- Feature: implementConversations route - Path: `gateway/src/routes/implementConversations.ts` -- GET and PUT handlers for conversation persistence
- Feature: implementState route - Path: `gateway/src/routes/implementState.ts` -- GET and PUT handlers for implementation state persistence
- Feature: chat route transcript writing - Path: `gateway/src/routes/chat.ts` -- `writeTranscriptToFile` call at line ~233
- Feature: frontend API callers - Path: `frontend/src/api/chatApi.ts` -- `getImplementConversation`, `putImplementConversation`, `getImplementState`, `putImplementState`
- Feature: ImplementationAssistantPanel - Path: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` -- call sites at lines ~956, ~999, ~1100
- Feature: gateway server route mounting - Path: `gateway/src/server.ts` -- routes mounted at `/api/implement-conversations` and `/api/implement-state`

### Follow-up Questions

No follow-up questions were needed. All answers were clear and complete.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add an optional `kind` parameter to all conversation and state persistence endpoints (implement-conversations GET/PUT, implement-state GET/PUT)
- `kind` must be validated against an allowlist: `["implement", "product"]`; invalid values return HTTP 400
- `kind` is normalized to lower-case
- Default `kind` to `"implement"` when not provided, ensuring backward compatibility
- PUT precedence rule: body `kind` > query `kind` > default `"implement"`; GET uses query parameter only
- Folder structure changes from `<basePath>/conversations/<folderName>/` to `<basePath>/conversations/<kind>/<folderName>/`
- Atomic write behavior (temp file + rename) must be preserved unchanged
- Do not echo the resolved `kind` value in the response; callers know what they requested
- No fallback reads from legacy (non-kind-prefixed) paths; forward-only directory structure
- Update `buildTranscriptPath` in `transcriptWriter.ts` to accept optional `kind` parameter (default `"implement"`) so all downstream callers (`writeTranscriptToFile`, `writeConversationJson`, `writeDisplayedConversation`) inherit the new structure automatically
- Thread `kind` through `chat.ts` transcript persistence calls, defaulting to `"implement"`
- Update four frontend API functions in `chatApi.ts` (`getImplementConversation`, `putImplementConversation`, `getImplementState`, `putImplementState`) to accept optional `kind` parameter
- `ImplementationAssistantPanel.tsx` passes `kind="implement"` explicitly at call sites

### Reusability Opportunities
- `buildTranscriptPath` is the single utility that computes the directory path; updating it with optional `kind` propagates the change to all existing callers automatically
- The `normalizeKind` helper (allowlist validation + lower-case normalization) should be a shared utility usable by both implement-conversations and implement-state routes
- Validation patterns in `implementState.ts` (validateGetParams, validatePutBody) provide the template for adding `kind` validation consistently across routes

### Scope Boundaries
**In Scope:**
- Gateway route changes: implement-conversations GET/PUT, implement-state GET/PUT
- Gateway utility changes: buildTranscriptPath in transcriptWriter.ts to accept kind
- Gateway chat route: thread kind through writeTranscriptToFile call
- New helper: normalizeKind(inputKind) -- returns valid kind or throws 400
- Frontend API changes: optional kind parameter on four chatApi.ts functions
- Frontend component changes: ImplementationAssistantPanel passes kind="implement" at call sites

**Out of Scope:**
- New kind values beyond "implement" and "product"
- Listing/discovery endpoints for conversations across kinds
- UI for selecting conversation kind
- Any writes to legacy (non-kind-prefixed) path
- Any migration or relocation of existing on-disk folders
- Any new product UI
- Any OpenAI/LLM changes
- Any MCP changes
- Any changes to architecture-model-service

### Technical Considerations
- The `CONVERSATIONS_FOLDER` constant (`'conversations'`) in transcriptWriter.ts remains unchanged; `kind` is inserted as a subdirectory beneath it
- `deriveFolderName(featureTitle, featureId)` generation logic remains completely unchanged
- `projectParentFolder` continues to be required and used as the base directory
- Directory traversal protection is inherent via the allowlist approach (only "implement" or "product" are accepted, no raw user input used in path construction)
- Existing files at `conversations/<folderName>/` will not be accessible via the new `conversations/<kind>/<folderName>/` path -- this is intentional (no fallback)
- The implement-state route uses the same `deriveFolderName` + `buildTranscriptPath` utilities as implement-conversations, writing `implementation-state.json` into the same derived directory, so both must be updated in lockstep to maintain co-location
