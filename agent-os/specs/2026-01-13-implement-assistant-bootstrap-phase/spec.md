# Specification: Implement Assistant Stage 3 - Bootstrap Phase with Rich Background Context

## Goal

Introduce a new bootstrap phase for implement_feature conversations that automatically provides the Planner LLM with rich background context (Product Book of Work summary, current feature, and architecture meta-model) on conversation load, so the assistant starts informed before any user-authored messages.

## User Stories

- As a developer entering the Implement screen, I want the assistant to already know about my product backlog and architecture so that I do not have to manually establish context every time.
- As a developer, I want the assistant to acknowledge the feature I am implementing and invite me to highlight relevant architecture/diagrams so that I can quickly focus the conversation.

## Specific Requirements

**Add 'bootstrap' phase to type definitions**
- Add `'bootstrap'` to `ImplementChatPhase` type in `frontend/src/api/chatApi.ts` (line 56)
- Add `'bootstrap'` to `ChatPhase` type in `gateway/src/types/chat.ts` (line 30)
- Maintain backward compatibility with existing `'refine' | 'handoff'` phases

**Auto-trigger bootstrap request on Implement screen mount**
- Add `isBootstrapping` and `hasBootstrapped` state variables in `ImplementationAssistantPanel.tsx`
- Add useEffect hook to trigger bootstrap when messages are empty and hasBootstrapped is false
- Trigger condition: mount or workItemId change when no stored state exists
- Bootstrap request uses `phase: 'bootstrap'`, `intent: 'normal_chat'`, empty diagramIds
- Include workItem details (id, title, type, description) and filename (projectId)

**Display loading state during bootstrap**
- Show "Initializing assistant..." loading indicator during bootstrap request
- Replace the empty state icon/message while isBootstrapping is true
- After bootstrap completes, display response as first assistant message
- Set `hasBootstrapped = true` after successful or failed bootstrap

**Handle bootstrap errors gracefully**
- On bootstrap error: display error message in chat, allow user to proceed with `phase: 'refine'`
- Log errors for debugging but do not block the Implement screen
- User can still send messages using refine phase after bootstrap failure

**Gateway handles bootstrap phase requests**
- Modify `tryResolveImplementContext()` in `gateway/src/routes/chat.ts` to allow empty user message for bootstrap
- For `phase: 'bootstrap'`: fetch Product Book of Work summary from backend
- For `phase: 'bootstrap'`: fetch meta-model summary (full project entities without specific selection)
- Inject context into system prompt under labeled sections: PRODUCT BACKLOG SUMMARY, CURRENT FEATURE, ARCHITECTURE META-MODEL SUMMARY

**Create bootstrap-specific system prompt template**
- Add `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts`
- Update `buildSystemPrompt()` to route `phase: 'bootstrap'` to new template
- Bootstrap prompt instructs LLM to: acknowledge feature, acknowledge context, respond with short welcome, ask user to highlight relevant architecture/diagrams
- Bootstrap prompt forbids: detailed questions, proposing solutions, refining requirements

**Create Product Book of Work summary endpoint**
- New endpoint: `GET /api/projects/{projectId}/product-summary` in `architecture-model-service`
- Returns condensed hierarchical structure: Initiatives > Epics > Features (names and brief descriptions)
- Omit Stories and detailed spec content to keep response concise for LLM context windows
- Use existing `WorkItemService.getWorkItems()` and build hierarchical structure

**Create meta-model summary endpoint or extend existing**
- Option A: New endpoint `GET /api/projects/{projectId}/meta-model-summary`
- Option B: Extend `ImplementContextResolutionService` to support "all entities" resolution
- Return LLM-friendly summary: services, data entities, interfaces, relationships
- Resolve to human-readable names, avoid raw IDs, scope to active project

**Gateway client methods for new backend endpoints**
- Add `fetchProductSummary(projectId)` function in `gateway/src/services/architectureModelClient.ts`
- Add `fetchMetaModelSummary(projectId)` function in `gateway/src/services/architectureModelClient.ts`
- Follow existing pattern from `resolveImplementContext()` with proper error handling and logging

## Existing Code to Leverage

**ImplementationAssistantPanel.tsx state management patterns**
- Existing `isLoading` state and "Assistant is thinking..." loading indicator (lines 117, 452-456)
- useEffect pattern for hydration from context (lines 159-194)
- `buildContext()` function for constructing `ImplementChatContext` (lines 231-254)
- Empty state rendering pattern (lines 424-448) to adapt for bootstrap loading

**promptBuilder.ts phase routing and template patterns**
- `buildSystemPrompt()` function with phase-based routing (lines 163-193)
- Existing `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` structure (lines 44-91)
- `formatResolvedContext()` helper for injecting context into prompts (lines 301-336)
- Placeholder replacement pattern for template variable injection

**architectureModelClient.ts API client pattern**
- `resolveImplementContext()` function structure (lines 23-76)
- Error handling with logger.warn and null return on failure
- URL construction with `encodeURIComponent(projectId)`

**ImplementContextResolutionService.java entity resolution patterns**
- Entity type resolution switch (lines 157-175)
- `ResolvedEntitySummary` construction with relevant fields (lines 224-512)
- Model file lookup by projectId/filename (lines 80-81)

**WorkItemController.java and WorkItemService**
- `GET /api/model/projects/{projectId}/work-items` endpoint pattern
- Optional type filtering for work items
- Response as `List<WorkItemDto>` with full hierarchy support

## Out of Scope

- Diagram injection during bootstrap phase (user selects diagrams after bootstrap)
- Conversation history persistence to disk
- Caching of bootstrap context
- Retry mechanisms for failed bootstrap requests
- Manual "refresh context" mechanism to re-trigger bootstrap
- Feature refinement or assumption validation in bootstrap response
- Changes to Implement button or execution flow
- Streaming endpoint support for bootstrap (POST only)
- Detailed spec content in Product Book of Work summary (names/descriptions only)
- Changes to existing refine or handoff phase behavior
