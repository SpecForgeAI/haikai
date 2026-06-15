# Spec Requirements: Implement Assistant Stage 1 - Fix Implement Context Resolution Plumbing

## Initial Description

The Implement Assistant chat (mode=implement_feature) supports selecting architecture entities and diagrams as "context" for a feature/work item. Currently, the LLM is not receiving meaningful context because the frontend sends only raw IDs and the Gateway cannot resolve them into human-readable summaries (e.g. because required identifiers like projectId/filename are missing in the chat request context). The architecture-model-service already exposes implement-context resolution endpoints; the missing work is wiring and ensuring the resolved context is injected into the LLM prompt.

**Goal:** When a user has selected architecture entities and/or diagrams for a work item and sends a message to the Implement Assistant, the Gateway must resolve those selections into readable summaries via the architecture-model-service and include the resolved results in the system prompt (or equivalent structured context) sent to the Planner LLM.

## Requirements Discussion

### First Round Questions

**Q1:** Project Identifier Source - I assume the `projectId` is already available in the frontend's React context or routing state when the user is working on a work item. Is that correct, or does the projectId need to be fetched/derived from somewhere else?

**Answer:** Yes, the projectId should be available from the frontend's React context. Look for ArchitectureContext or a similar context that tracks the active project. The projectId may need to be derived from the current filename/model being viewed.

**Q2:** Gateway Tech Stack - I see the main product uses Java/Spring Boot for architecture-model-service. I assume the Gateway is a separate Python/FastAPI service. Is that correct?

**Answer:** Yes, the Gateway is a separate service that orchestrates LLM calls. The architecture-model-service is Java/Spring Boot. (Note: Upon investigation, Gateway is actually Node.js/TypeScript/Express, not Python/FastAPI.)

**Q3:** Current Chat Payload Structure - I assume the frontend currently sends a chat request with `mode=implement_feature` that includes `architectureContext` with `entityIds` and `diagramIds` arrays, but is missing `projectId`. Should I verify this assumption by examining the actual frontend code?

**Answer:** Please verify by examining the actual frontend code. Look for ImplementationAssistantPanel.tsx or similar, API calls with mode=implement_feature, and the architectureContext structure being sent.

**Q4:** Resolution Endpoint Preference - The raw idea mentions the architecture-model-service may currently require a `filename` rather than `projectId`. I assume we should prefer adding a projectId-based resolution endpoint rather than requiring the frontend to track/pass filenames?

**Answer:** Yes, prefer projectId-based resolution. The Gateway should use projectId consistently. If the architecture-model-service currently requires filename, add support for projectId (or accept both).

**Q5:** Resolved Context Format for LLM - For the "HIGHLIGHTED ARCHITECTURE CONTEXT" section in the LLM prompt, I assume a structured markdown format would be appropriate. What format should be used?

**Answer:** Use structured markdown for the LLM prompt. Example format provided:
```
## HIGHLIGHTED ARCHITECTURE CONTEXT

### Selected Entities:
- **User Service** (Service): Handles user authentication and profile management
- **Order Entity** (Logical Data Entity): Fields: orderId, customerId, status, total

### Selected Diagrams:
- **User Flow Diagram** (Sequence): References: User Service, Auth Gateway
```

**Q6:** Error Logging Scope - When resolution fails, should errors be logged at WARN level without exposing internal details to users?

**Answer:** Yes, log at WARN level in the Gateway with specific diagnostic info. Do NOT expose internal errors to the user. The chat should continue gracefully with fallback (raw IDs only).

**Q7:** Is there anything that should explicitly be excluded from this work?

**Answer:** Out of scope:
- Changes to how architecture entities/diagrams are selected in the UI
- Modifications to the work item data model
- Changes to LLM model/parameters
- Conversation persistence
- Staged lifecycle/phase changes

### Existing Code to Reference

**Similar Features Identified:**

Based on codebase analysis, the following key files contain relevant patterns:

**Frontend:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - Main chat panel component
- `frontend/src/components/ProductView/ProductImplementPage.tsx` - Parent page that passes projectId as `loadedFileName`
- `frontend/src/api/chatApi.ts` - Chat API client with `ImplementChatContext` interface
- `frontend/src/contexts/ArchitectureContext.tsx` - Contains `loadedFileName` which serves as projectId

**Gateway (Node.js/TypeScript/Express):**
- `gateway/src/routes/chat.ts` - Chat route handler with `tryResolveImplementContext` function
- `gateway/src/services/promptBuilder.ts` - System prompt builder with `buildImplementPlannerPrompt`
- `gateway/src/services/architectureModelClient.ts` - Client for calling architecture-model-service
- `gateway/src/types/chat.ts` - TypeScript types for `ChatContext`, `ResolvedImplementContextDto`

**architecture-model-service (Java/Spring Boot):**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ImplementContextResolutionController.java` - POST endpoint at `/api/projects/{projectId}/implement-context/resolve`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java` - GET/PUT for work item context

**Tests:**
- `gateway/src/__tests__/context-resolution.test.ts` - Tests for context resolution flow

### Follow-up Questions

No follow-up questions required - codebase analysis provided comprehensive information.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - this is backend plumbing work with no UI changes.

## Requirements Summary

### Functional Requirements

Based on codebase analysis, the following findings are relevant:

**Current State Analysis:**

1. **Frontend (`ImplementationAssistantPanel.tsx`):**
   - Already receives `projectId` prop (passed as `loadedFileName` from ProductImplementPage)
   - `buildContext()` function constructs `ImplementChatContext` with:
     - `mode: 'implement_feature'`
     - `intent: 'normal_chat' | 'generate_specs'`
     - `workItem: { id, title, type, description }`
     - `architectureContext: { entityIds, diagramIds }`
   - **MISSING:** The context does NOT include `projectId` or `filename` in the payload sent to Gateway

2. **Frontend (`chatApi.ts`):**
   - `ImplementChatContext` interface includes `architectureContext` but NOT `filename` or `projectId`
   - `ChatRequest` sends `context?: ImplementChatContext` but no project identifier

3. **Gateway (`chat.ts`):**
   - `tryResolveImplementContext()` checks for `context.filename` before calling resolution
   - Currently logs: `Cannot resolve implement context: no filename provided`
   - Resolution call uses: `resolveImplementContext(context.filename, entityIds, diagramIds)`

4. **Gateway (`architectureModelClient.ts`):**
   - `resolveImplementContext(projectId, entityIds, diagramIds)` calls:
     - `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/implement-context/resolve`
   - Already uses `projectId` parameter (named `projectId` in function, but expects filename format)

5. **architecture-model-service (`ImplementContextResolutionController.java`):**
   - Endpoint: `POST /api/projects/{projectId}/implement-context/resolve`
   - Already accepts `projectId` as path variable (which is the filename)
   - Returns `ResolvedImplementContextDto` with `resolvedEntities` and `resolvedDiagrams`

**Gap Identified:**
The frontend has `projectId` available but does NOT include it in the chat request payload. The Gateway expects `context.filename` but it's never provided.

### Core Functionality to Implement

1. **Frontend Changes:**
   - Add `filename` (or `projectId`) field to `ImplementChatContext` interface in `chatApi.ts`
   - Update `buildContext()` in `ImplementationAssistantPanel.tsx` to include `projectId` prop value

2. **Gateway Changes:**
   - Verify `tryResolveImplementContext()` receives and uses the filename
   - Ensure graceful fallback (already implemented) logs appropriate warnings

3. **architecture-model-service Changes:**
   - None required - endpoint already exists and works

### Reusability Opportunities

- Existing `resolveImplementContext` function in gateway is complete
- Existing `ImplementContextResolutionController` in backend is complete
- Existing `formatResolvedContext` in promptBuilder produces markdown-like JSON output
- The system prompt templates already include `{resolvedContext}` placeholder

### Scope Boundaries

**In Scope:**
- Add `filename`/`projectId` to frontend chat API request payload
- Update `ImplementChatContext` TypeScript interface
- Update `buildContext()` function to include project identifier
- Verify end-to-end flow works with existing Gateway and backend code
- Add/update tests for the new payload field

**Out of Scope:**
- Changes to entity/diagram selection UI
- Modifications to work item data model
- Changes to LLM model or parameters
- Conversation persistence to disk
- Staged lifecycle/phase changes
- UI changes beyond passing required identifiers

### Technical Considerations

**Key Files to Modify:**

1. `frontend/src/api/chatApi.ts`:
   - Add `filename?: string` to `ImplementChatContext` interface

2. `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`:
   - Update `buildContext()` to include `filename: projectId` in returned context object

3. Testing:
   - Update existing tests to include filename in mock contexts
   - Add integration test verifying filename flows to Gateway

**Existing Patterns:**
- Gateway already uses `context.filename` for OAS assistant mode
- The `loadedFileName` pattern is used throughout the frontend for project identification
- The backend endpoint uses `{projectId}` which is actually the filename

**Error Handling:**
- Gateway already logs WARN when filename is missing
- Gateway already falls back gracefully (no resolved context, proceeds with raw IDs)
- No user-facing error messages needed (silent degradation)
