# Specification: Implement Assistant Stage 1 - Fix Implement Context Resolution Plumbing

## Goal
Fix the missing `filename` field in the implement_feature chat request so the Gateway can resolve architecture entity and diagram IDs into human-readable summaries for LLM context enrichment. This is a minimal, targeted fix - the backend plumbing already exists and works.

## User Stories
- As a developer using the Implementation Assistant, I want my selected architecture entities and diagrams to be resolved into meaningful summaries so the LLM understands what I am referencing.
- As a developer, I want the chat to continue working gracefully even if context resolution fails so my workflow is not interrupted.

## Specific Requirements

**Add filename to ImplementChatContext interface**
- Add `filename?: string` field to `ImplementChatContext` interface in `frontend/src/api/chatApi.ts`
- The field should be optional to maintain backwards compatibility
- Place the field logically near other context identifiers in the interface

**Update buildContext to include filename**
- Modify `buildContext()` function in `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- Include `filename: projectId` in the returned `ImplementChatContext` object
- The `projectId` prop is already available and passed from `ProductImplementPage.tsx`

**Verify Gateway receives and uses filename**
- The Gateway's `tryResolveImplementContext()` in `gateway/src/routes/chat.ts` already checks for `context.filename`
- Currently logs "Cannot resolve implement context: no filename provided" when missing
- Once frontend passes filename, resolution should work automatically

**No backend changes required**
- The `architecture-model-service` endpoint at `POST /api/projects/{projectId}/implement-context/resolve` is fully implemented
- The Gateway's `resolveImplementContext()` function in `architectureModelClient.ts` is complete
- The `ResolvedImplementContextDto` types are already defined in `gateway/src/types/chat.ts`

**Error handling remains unchanged**
- Gateway already logs WARN level when resolution fails
- Gateway already falls back gracefully (proceeds without resolved context)
- No user-facing error messages needed - silent degradation is already implemented

## Visual Design
N/A - This is backend plumbing work with no UI changes.

## Existing Code to Leverage

**Gateway tryResolveImplementContext (gateway/src/routes/chat.ts lines 65-122)**
- Already checks for `context.filename` and `context.architectureContext`
- Already calls `resolveImplementContext()` when both are present
- Already logs diagnostic info and handles errors gracefully
- Only needs the frontend to actually pass the filename

**Gateway resolveImplementContext client (gateway/src/services/architectureModelClient.ts)**
- Fully implemented HTTP client for the backend resolution API
- Makes POST request to `/api/projects/{projectId}/implement-context/resolve`
- Returns `ResolvedImplementContextDto` or null on error
- No modifications needed

**Gateway ChatContext type (gateway/src/types/chat.ts line 51-82)**
- Already has `filename?: string` field defined
- Already has `architectureContext?: ArchitectureContext` field
- Frontend just needs to populate these existing fields

**ImplementationAssistantPanel projectId prop (line 60)**
- Component already receives `projectId` as a prop
- Prop is passed from `ProductImplementPage.tsx` as `loadedFileName`
- Already used for `deriveProjectKey()` - just need to also include in API context

**architecture-model-service ImplementContextResolutionController**
- Endpoint fully implemented and tested
- Accepts `projectId` path variable and request body with entity/diagram IDs
- Returns resolved summaries with names, types, and relevant fields

## Out of Scope
- Changes to how architecture entities or diagrams are selected in the UI
- Modifications to the work item data model
- Changes to LLM model or parameters
- Conversation persistence to disk
- Staged lifecycle or phase changes
- Adding new resolution endpoints to architecture-model-service
- Changes to the Gateway prompt builder or system prompts
- UI changes to ImplementationAssistantPanel beyond passing the filename
- Streaming endpoint support for implement_feature mode
- New test files - only update existing tests to include filename in mock contexts
