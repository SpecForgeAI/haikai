# Specification: Generalize Conversation Persistence to Support Kind

## Goal
Introduce a conversation "kind" directory level into the existing gateway conversation persistence mechanism so that multiple conversation types (implement, product) can be stored without path collisions, changing the persist path from `<projectParentFolder>/conversations/<derivedFolderName>/` to `<projectParentFolder>/conversations/<kind>/<derivedFolderName>/`.

## User Stories
- As a developer working on the implementation assistant, I want conversation and state files to be stored under a kind-specific subfolder so that future product-level conversations can coexist without colliding with existing implement conversations.
- As a frontend consumer of the persistence API, I want the kind parameter to default to "implement" when omitted so that existing implement flows continue working without any required changes.

## Specific Requirements

**normalizeKind helper function**
- Create a new exported function `normalizeKind(inputKind?: string): string` in `gateway/src/services/transcriptWriter.ts`
- Accept an optional string input; when undefined/null/empty, return `"implement"` as the default
- Normalize the input to lower-case via `.toLowerCase()` before validation
- Validate the normalized value against the allowlist `["implement", "product"]`
- If the normalized value is not in the allowlist, throw an error with a message suitable for HTTP 400 responses (e.g., `"Invalid kind '<value>'. Allowed values: implement, product"`)
- Export this function from `gateway/src/services/index.ts` so route handlers can import it
- Directory traversal protection is inherent: only literal string values "implement" or "product" are ever used in path construction

**buildTranscriptPath update to accept kind**
- Modify the existing `buildTranscriptPath` function signature in `gateway/src/services/transcriptWriter.ts` (line 107) to accept an optional third parameter: `kind?: string`
- Default the parameter to `"implement"` when not provided
- Change the `dirPath` construction from `path.join(basePath, CONVERSATIONS_FOLDER, folderName)` to `path.join(basePath, CONVERSATIONS_FOLDER, kind, folderName)`
- This single change propagates the new path structure to all callers: `writeTranscriptToFile`, `writeConversationJson`, `writeDisplayedConversation`, and both route handlers
- The `CONVERSATIONS_FOLDER` constant (`'conversations'`) remains unchanged

**writeConversationJson update**
- Update the `writeConversationJson` function (line 255) to accept an optional fourth parameter `kind?: string` (default `"implement"`)
- Update the internal `dirPath` construction to use `path.join(basePath, CONVERSATIONS_FOLDER, kind, folderName)` instead of the current hard-coded two-segment path
- Alternatively, delegate to `buildTranscriptPath(basePath, folderName, kind)` for path derivation to stay DRY

**writeDisplayedConversation update**
- Update the `writeDisplayedConversation` function (line 341) to accept an optional fourth parameter `kind?: string` (default `"implement"`)
- Update the internal `dirPath` construction to use `path.join(basePath, CONVERSATIONS_FOLDER, kind, folderName)` or delegate to `buildTranscriptPath`

**writeTranscriptToFile update**
- Add an optional `kind?: string` parameter to `writeTranscriptToFile` (line 418), inserting it after `projectParentFolder` and before `displayedMessages`
- Default to `"implement"` when not provided
- Pass the `kind` value through to `buildTranscriptPath(basePath, folderName, kind)` at line 435
- Pass the `kind` value through to `writeConversationJson(messages, basePath, folderName, kind)` at line 484
- Pass the `kind` value through to `writeDisplayedConversation(displayedMessages, basePath, folderName, kind)` at line 488

**implementConversations route handler updates**
- Import `normalizeKind` from `../services/transcriptWriter`
- GET handler (line 128): extract `kind` from `req.query.kind` as optional string; call `normalizeKind(kind)` inside a try/catch; if normalizeKind throws, return `res.status(400).json({ error: <message> })`; pass the resolved kind to `buildTranscriptPath(basePath, folderName, kind)` at line 161
- PUT handler (line 222): resolve kind using precedence rule: `body.kind ?? query.kind ?? undefined`; call `normalizeKind(resolvedKind)` with same 400 error handling; pass the resolved kind to `buildTranscriptPath(projectParentFolder, folderName, kind)` at line 248
- Do NOT add `kind` to the existing `validateGetParams` or `validatePutBody` functions; kind validation is handled separately by `normalizeKind`
- Do NOT echo the resolved kind value in the response body

**implementState route handler updates**
- Import `normalizeKind` from `../services/transcriptWriter`
- GET handler (line 94): extract `kind` from `req.query.kind` as optional string; validate via `normalizeKind`; pass to `buildTranscriptPath(basePath, folderName, kind)` at line 122
- PUT handler (line 180): resolve kind with precedence `body.kind ?? query.kind ?? undefined`; validate via `normalizeKind`; pass to `buildTranscriptPath(projectParentFolder, folderName, kind)` at line 204
- Same 400 error pattern as implementConversations
- Do NOT echo kind in response

**chat.ts transcript persistence threading**
- In `flushTranscriptToDisk` (line 190), the `writeTranscriptToFile` call at line 233 currently passes `(transcript, featureTitle, featureId, projectParentFolder, context.displayedMessages)`. The new `kind` parameter should be inserted after `projectParentFolder` with a hard-coded default of `"implement"` for now, since the chat route only handles implement_feature mode conversations
- No new query/body parameter parsing is needed in chat.ts for this increment; the kind is implicitly "implement" for all chat-route transcript writes

**Frontend chatApi.ts function signature updates**
- `getImplementConversation` (line 698): add optional fifth parameter `kind?: string`; when provided, append `&kind=${encodeURIComponent(kind)}` to the URL query string
- `putImplementConversation` (line 726): the `PutConversationRequest` interface (line 636) should gain an optional `kind?: string` field; this is serialized into the PUT body automatically via `JSON.stringify(params)`
- `getImplementState` (line 840): add optional fifth parameter `kind?: string`; append to URL query string when provided
- `putImplementState` (line 868): the `PutImplementStateRequest` interface (line 813) should gain an optional `kind?: string` field
- All four functions default to omitting kind from the request when not provided, which causes the gateway to default to "implement"

**ImplementationAssistantPanel call site updates**
- At the `getImplementState` call (line ~956): pass `"implement"` as the fifth argument
- At the `getImplementConversation` call (line ~999): pass `"implement"` as the fifth argument
- At the `putImplementState` call (line ~1100): add `kind: "implement"` to the request object
- These explicit values make the intent clear and future-proof the call sites for when product-kind conversations are added

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**`gateway/src/services/transcriptWriter.ts` -- buildTranscriptPath and path utilities**
- `buildTranscriptPath` (line 107) is the single centralized function that computes `dirPath` and `filePath` from `basePath` and `folderName`; adding an optional `kind` parameter here propagates the path change to all callers automatically
- `writeConversationJson` (line 255) and `writeDisplayedConversation` (line 341) both independently construct `dirPath` using the same `path.join(basePath, CONVERSATIONS_FOLDER, folderName)` pattern and must also be updated or refactored to use `buildTranscriptPath`
- `deriveFolderName` (line 67) remains completely unchanged; the kind parameter is orthogonal to folder name derivation
- The atomic write pattern (temp file + rename) used throughout this file must be preserved exactly as-is

**`gateway/src/routes/implementConversations.ts` -- validation pattern**
- `validateGetParams` (line 40) and `validatePutBody` (line 62) provide the established validation pattern: check required fields, return error string or null
- The kind parameter should NOT be added to these validators since it is optional with a default; instead, `normalizeKind` handles validation separately and throws on invalid values
- The route already imports `deriveFolderName` and `buildTranscriptPath` from transcriptWriter (line 20), so the updated signatures will flow through naturally

**`gateway/src/routes/implementState.ts` -- co-located state persistence**
- This route uses the exact same `deriveFolderName` + `buildTranscriptPath` utilities (line 18) as implementConversations, writing `implementation-state.json` into the same derived directory
- Both routes must be updated in lockstep to ensure conversation JSON and implementation state JSON remain co-located under the same `conversations/<kind>/<folderName>/` directory
- The validation functions (lines 32, 54) follow the same pattern as implementConversations and should be treated identically (kind handled outside these validators)

**`gateway/src/routes/chat.ts` -- flushTranscriptToDisk**
- The `flushTranscriptToDisk` function (line 190) calls `writeTranscriptToFile` at line 233; this is the only chat.ts call site that needs the kind parameter threaded through
- Since chat.ts only operates in `implement_feature` mode (guarded by the `context?.mode !== 'implement_feature'` check at line 196), the kind value can be hard-coded to `"implement"` for this increment

**`frontend/src/api/chatApi.ts` -- API function signatures**
- The four functions (`getImplementConversation`, `putImplementConversation`, `getImplementState`, `putImplementState`) all follow a consistent pattern: GET functions build URL query strings, PUT functions serialize request body interfaces
- Adding optional `kind` to each follows the established pattern without breaking existing callers that omit the parameter

## Out of Scope
- New kind values beyond "implement" and "product" (e.g., "design", "testing")
- Listing or discovery endpoints for conversations across kinds
- UI for selecting or switching conversation kind
- Any writes to the legacy (non-kind-prefixed) path `conversations/<folderName>/`
- Any migration, relocation, or cleanup of existing on-disk conversation folders
- Fallback reads from the old path structure when the kind-prefixed path returns ENOENT
- Any new product conversation UI or product-mode chat flows
- Any OpenAI/LLM prompt or model changes
- Any MCP server or tool changes
- Any changes to architecture-model-service
- Renaming the top-level `conversations` folder constant
