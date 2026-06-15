# Spec Requirements: Implement Assistant Stage 3 - Bootstrap Phase with Rich Background Context

## Initial Description

Introduce a new bootstrap phase for implement_feature conversations that automatically provides the Planner LLM with rich background context on conversation load, so the assistant starts informed about the product, the current feature, and the existing architecture meta-model before any user-authored messages.

The bootstrap context includes:
- A high-level summary of the Product Book of Work (initiatives, epics, features)
- The current feature (id, name, description)
- The full architecture meta-model resolved into an LLM-friendly structure

## Requirements Discussion

### First Round Questions

**Q1:** I assume the `ChatPhase` type already exists in both frontend and gateway with values like `refine` and `handoff`. Is that correct, or does this type need to be created from scratch?
**Answer:** Yes, `ChatPhase` type already exists in both frontend (`ImplementChatPhase`) and gateway (`ChatPhase`) with values `'refine' | 'handoff'`. We just need to add `'bootstrap'` to these existing types.

**Q2:** I assume the bootstrap request should be triggered exactly once when the Implement screen mounts (using a `useEffect` hook), and we should track whether bootstrap has completed to prevent re-triggering. Is that correct, or should there be a "refresh context" mechanism to re-trigger bootstrap manually?
**Answer:** Yes, bootstrap should be triggered exactly once when the Implement screen mounts (useEffect with empty deps or feature/workItem change). Track whether bootstrap has completed to prevent re-triggering. No manual refresh mechanism needed at this stage.

**Q3:** I assume the frontend should show a loading indicator (spinner or "Initializing assistant..." message) while the bootstrap request is in flight, before displaying the welcome response. Is that correct, or should the chat area remain empty until the response arrives?
**Answer:** Yes, show a loading indicator ("Initializing assistant..." or similar) while bootstrap is in flight. The chat area should show the loading state, then display the welcome response when complete.

**Q4:** I assume the gateway should fetch the Product Book of Work summary and meta-model from architecture-model-service via REST endpoints (e.g., `/api/projects/{projectId}/product-summary` and `/api/projects/{projectId}/meta-model-summary`). Should these be new dedicated endpoints, or should we reuse existing endpoints if they exist?
**Answer:** Check if endpoints already exist in architecture-model-service. If not, create new dedicated endpoints:
- Product Book of Work summary: `/api/projects/{projectId}/product-summary`
- Meta-model summary: Check if the existing implement-context resolution endpoint can be reused or if a new `/api/projects/{projectId}/meta-model-summary` is needed

**Q5:** I assume the "current feature" (id, name, description) is already available in the frontend context when entering the Implement screen, and should be passed in the bootstrap request body. Is that correct, or does the gateway need to look up feature details from a backend service?
**Answer:** Yes, the "current feature" (id, name, description) should be passed from the frontend in the bootstrap request body. The frontend has this info from the work item selection.

**Q6:** For the Product Book of Work summary, I assume this should include a condensed hierarchical structure (Initiatives > Epics > Features with names and brief descriptions, excluding detailed specs). Is that the right level of detail, or should it be even more condensed (e.g., just feature names)?
**Answer:** Yes, Product Book of Work summary should be condensed hierarchical structure (Initiatives > Epics > Features with names and brief descriptions). Keep it concise for LLM context windows.

**Q7:** I assume that if the bootstrap request fails (network error, service unavailable), the UI should display an error message but still allow the user to proceed with manual chat using `phase: refine`. Is that correct, or should bootstrap failure block the entire Implement screen?
**Answer:** Yes, if bootstrap fails, display an error message but allow user to proceed with manual chat using `phase: refine`. Bootstrap failure should NOT block the screen. Log errors for debugging.

**Q8:** Is there anything specific you want to explicitly exclude from this spec (e.g., caching the bootstrap context, conversation history persistence, retry mechanisms)?
**Answer:** Explicit exclusions:
- No caching of bootstrap context
- No conversation history persistence
- No retry mechanisms
- No diagram injection during bootstrap
- No feature refinement in bootstrap response

### Existing Code to Reference

**Similar Features Identified:**

- Feature: ImplementationAssistantPanel - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\ProductView\ImplementationAssistantPanel.tsx`
  - Contains existing chat component with useEffect patterns for session management
  - Has `buildContext()` function that constructs `ImplementChatContext` with phase parameter
  - Shows loading indicator pattern: `isLoading` state with "Assistant is thinking..." message
  - Has empty state handling pattern that can be adapted for bootstrap loading state

- Feature: chatApi.ts - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\api\chatApi.ts`
  - Contains `ImplementChatPhase` type (currently `'refine' | 'handoff'`) - needs `'bootstrap'` added
  - Contains `ImplementChatContext` interface with `phase?: ImplementChatPhase`
  - Contains `postChatMessage()` function for sending chat requests

- Feature: promptBuilder.ts - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\gateway\src\services\promptBuilder.ts`
  - Contains `buildSystemPrompt()` function that routes to different prompts based on `context.phase`
  - Already has `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` and `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE`
  - Needs new `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` added
  - Shows pattern for injecting resolved context into prompts

- Feature: chat.ts (routes) - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\gateway\src\routes\chat.ts`
  - Shows how implement_feature mode is handled (bypasses tool execution)
  - Contains `tryResolveImplementContext()` for fetching resolved context from backend
  - Will need modification to handle `phase: 'bootstrap'` specially

- Feature: chat.ts (types) - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\gateway\src\types\chat.ts`
  - Contains `ChatPhase` type (currently `'refine' | 'handoff'`) - needs `'bootstrap'` added
  - Contains `ChatContext` interface with phase field

- Feature: architectureModelClient.ts - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\gateway\src\services\architectureModelClient.ts`
  - Shows pattern for calling architecture-model-service from gateway
  - Contains `resolveImplementContext()` function as reference for new API calls

- Feature: ImplementContextResolutionController - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\controller\ImplementContextResolutionController.java`
  - Existing endpoint: `POST /api/projects/{projectId}/implement-context/resolve`
  - Resolves entity and diagram IDs into LLM-friendly summaries
  - **Can potentially be reused/extended for meta-model summary**

- Feature: WorkItemController - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\controller\WorkItemController.java`
  - Existing endpoint: `GET /api/model/projects/{projectId}/work-items`
  - Returns list of work items with type filtering
  - **Can be used to fetch all work items for Product Book of Work summary**

- Feature: BookOfWorkController - Path: `C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\controller\BookOfWorkController.java`
  - Currently only has upload endpoint (`POST /api/projects/{projectId}/book-of-work/upload`)
  - **Needs new GET endpoint for Product Book of Work summary**

### Follow-up Questions

No follow-up questions were needed - all requirements were sufficiently clear from the initial answers.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Follow existing chat panel patterns from ImplementationAssistantPanel.tsx for loading states and message display.

## Requirements Summary

### Functional Requirements

**Frontend (ImplementationAssistantPanel.tsx):**
- Add `'bootstrap'` to `ImplementChatPhase` type in `chatApi.ts`
- Add new state: `isBootstrapping` (boolean) and `hasBootstrapped` (boolean)
- Add useEffect hook to trigger bootstrap request on mount (when messages are empty and not bootstrapped)
- Bootstrap request should:
  - Use `phase: 'bootstrap'`
  - Use `intent: 'normal_chat'` (not generate_specs)
  - NOT include diagram selections (architectureContext can have empty diagramIds)
  - Include workItem details (id, title, type, description)
  - Include filename (projectId)
- Show loading state: "Initializing assistant..." during bootstrap
- Display bootstrap response as first assistant message
- After bootstrap completes, set `hasBootstrapped = true`
- Subsequent user messages use `phase: 'refine'`
- On bootstrap error: show error message, allow user to proceed with refine phase

**Gateway (chat.ts, promptBuilder.ts, types):**
- Add `'bootstrap'` to `ChatPhase` type in `types/chat.ts`
- Add new `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE` in `promptBuilder.ts`
- Modify `buildSystemPrompt()` to handle `phase: 'bootstrap'`
- For bootstrap requests:
  - Do not require user message content (can be empty or placeholder)
  - Fetch Product Book of Work summary from architecture-model-service
  - Fetch meta-model summary (or use resolved context without specific entity selection)
  - Inject context into prompt under labelled sections:
    - PRODUCT BACKLOG SUMMARY
    - CURRENT FEATURE
    - ARCHITECTURE META-MODEL SUMMARY
- Bootstrap prompt should instruct LLM to:
  - Acknowledge the feature being implemented
  - Acknowledge receipt of product and architecture context
  - Respond with a short welcome message
  - Ask if user wants to highlight specific architecture or diagrams
- Bootstrap response must NOT:
  - Ask detailed implementation questions
  - Propose solutions
  - Attempt to refine requirements

**Architecture-Model-Service (new endpoints):**
- New endpoint: `GET /api/projects/{projectId}/product-summary`
  - Returns condensed hierarchical structure of work items
  - Format: Initiatives > Epics > Features (with names and brief descriptions)
  - Must be concise for LLM context windows
- Check if existing `/api/projects/{projectId}/implement-context/resolve` can be extended or if new `/api/projects/{projectId}/meta-model-summary` is needed
  - Meta-model summary should include: services, data entities, interfaces, relationships
  - Must resolve to human-readable names (not raw IDs)
  - Scope to active project

### Reusability Opportunities

- Reuse existing `postChatMessage()` API function for bootstrap request
- Reuse existing loading indicator pattern from ImplementationAssistantPanel
- Reuse `tryResolveImplementContext()` pattern in gateway for new context fetches
- Reuse existing phase routing logic in `buildSystemPrompt()` for new bootstrap phase
- Potentially extend `WorkItemController.listWorkItems()` or create thin wrapper for product summary
- May reuse `ImplementContextResolutionService` patterns for meta-model summary

### Scope Boundaries

**In Scope:**
- Add `'bootstrap'` phase to frontend and gateway type definitions
- Auto-trigger bootstrap request on Implement screen mount
- Gateway fetches and assembles background context (Product Book of Work, meta-model)
- New bootstrap-specific system prompt template
- LLM responds with welcome message acknowledging context
- Display bootstrap response as first assistant message
- After bootstrap, user messages use `phase: 'refine'`
- Error handling: allow proceeding if bootstrap fails
- New backend endpoint for Product Book of Work summary
- Backend meta-model summary (new or extended endpoint)

**Out of Scope:**
- Diagram injection during bootstrap
- Conversation persistence to disk
- Caching of bootstrap context
- Retry mechanisms for failed bootstrap
- Manual "refresh context" mechanism
- Feature refinement or assumption validation in bootstrap response
- Changes to Implement button or execution flow
- Streaming endpoint support for bootstrap (POST only)

### Technical Considerations

**Files to Modify:**

| Layer | File | Changes |
|-------|------|---------|
| Frontend | `frontend/src/api/chatApi.ts` | Add `'bootstrap'` to `ImplementChatPhase` type |
| Frontend | `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add bootstrap useEffect, loading state, state tracking |
| Gateway | `gateway/src/types/chat.ts` | Add `'bootstrap'` to `ChatPhase` type |
| Gateway | `gateway/src/services/promptBuilder.ts` | Add `IMPLEMENT_BOOTSTRAP_PROMPT_TEMPLATE`, update `buildSystemPrompt()` |
| Gateway | `gateway/src/routes/chat.ts` | Handle bootstrap phase, fetch context from backend |
| Gateway | `gateway/src/services/architectureModelClient.ts` | Add functions to fetch product summary and meta-model summary |
| Backend | New: `BookOfWorkSummaryController.java` or extend `BookOfWorkController.java` | Add GET endpoint for product summary |
| Backend | New: `ProductSummaryDto.java` | DTO for hierarchical work item summary |
| Backend | New: `ProductSummaryService.java` | Service to build product summary |
| Backend | Possibly extend or add to `ImplementContextResolutionService.java` | Meta-model summary logic |

**Integration Points:**
- Frontend -> Gateway: `POST /api/chat` with `phase: 'bootstrap'`
- Gateway -> Backend: `GET /api/projects/{projectId}/product-summary` (new)
- Gateway -> Backend: `GET /api/projects/{projectId}/meta-model-summary` or extend existing resolve endpoint

**Technology Constraints:**
- Frontend: React 18.x, TypeScript, Vite
- Gateway: Node.js, Express, TypeScript
- Backend: Java 21, Spring Boot 3.x, PostgreSQL

**Existing Patterns to Follow:**
- Phase routing in `buildSystemPrompt()` using switch/if-else on `context.phase`
- Context fetching in `tryResolveImplementContext()` with null-safe error handling
- Loading state pattern in ImplementationAssistantPanel with `isLoading` boolean
- API client pattern in `architectureModelClient.ts` with proper error handling and logging
