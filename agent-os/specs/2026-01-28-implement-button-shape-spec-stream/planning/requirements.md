# Spec Requirements: Implement Button Starts Shape-Spec Stream (Spec 1)

## Initial Description

Enable the Implement button in the Feature Implement screen to initiate a new Shape-Spec streaming conversation with the Software Architect (Claude Code proxy), using the Planner LLM's final spec intent as input.

This is Spec 1 of a multi-phase feature. It covers only:
- Starting the streaming conversation
- Rendering streamed content

Question handling, looping, and orchestration are explicitly out of scope.

## Requirements Discussion

### First Round Questions

**Q1:** Should this Shape-Spec-1 flow REPLACE the current Implement button behavior (startOrchestration/generateImplementationPlan), or ADD to it?
**Answer:** Yes - this Shape-Spec-1 flow should REPLACE the current Implement button behavior (i.e., don't call startOrchestration / generateImplementationPlan on Implement). Implement now starts the shape-spec streaming session.

**Q2:** What is the source of truth for the "spec intent" sent in the message field - latestPlannerResponse or the current PROPOSED marker extraction path?
**Answer:** Use latestPlannerResponse (the structured PlannerResponse) as the source of truth for the "spec intent" (compose a concise LLM-friendly spec intent from its fields). Do NOT use the current PROPOSED marker extraction path.

**Q3:** Endpoint ownership and expected payloads for POST /api/v1/shape-spec/stream?
**Answer:** Correct - POST http://localhost:8000/api/v1/shape-spec/stream is an EXTERNAL service (Claude Code proxy) and is not implemented in this repo. We just consume it via SSE. Expected event payloads are exactly:
- `{type:"skill_invoked", skill:"..."}` (ignore)
- `{type:"content", delta:"..."}` (render)
- `{type:"done"}` (stop)
(Questions/folder exist but are out-of-scope for spec 1.)

**Q4:** UI rendering approach for streamed content?
**Answer:** Reuse existing Software Architect chat bubble styling/pattern. Incremental update is acceptable (append deltas to a single in-progress Software Architect message during the stream; finalize it on done). No need for a new component in spec 1.

**Q5:** How should company/project fields be derived?
**Answer:** Yes - derive from active project context the same way current orchestration uses company/project strings. Use organisation NAME (not ID) and project NAME (the same values currently sent to orchestration endpoints).

**Q6:** Error handling approach?
**Answer:** Correct - minimal only. If stream connect/parse fails or ends unexpectedly, show a simple visible error (chat bubble or existing error banner pattern). No retries, no categorization, no recovery logic.

**Q7:** Explicit deferrals for Spec 1?
**Answer:** Exclude/defer in spec 1:
- handling `{type:"questions"}` and populating Open Questions table
- Answer Open Questions loop / subsequent stream calls (session continuation)
- handling `{type:"folder"}` storage
- orchestration triggering (`/api/v1/orchestrations`) and the "I'll start implementing" bubble
- persistence/rehydration of this new stream transcript

### Existing Code to Reference

**Similar Features Identified:**
- Component: `ImplementationAssistantPanel` - Path: `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
  - Contains the Implement button click handler (`handleImplementClick`, `generateImplementationPlan`)
  - Shows how organisation/project names are derived (`getOrganisationById`, `activeProject?.name`)
  - Contains streaming-like patterns with incremental message updates
- Component: `ChatMessageList` - Path: `frontend/src/components/chat/ChatMessageList.tsx`
  - Shows how to pass `currentPhase` to determine persona ("Software Architect" with purple color)
  - Auto-scroll behavior for new messages
- Component: `ChatBubble` - Path: `frontend/src/components/chat/ChatBubble.tsx`
  - Supports persona labels and color variants (purple for "Software Architect")
- API: `chatApi.ts` - Path: `frontend/src/api/chatApi.ts`
  - Contains `PlannerResponse` interface with all fields for composing spec intent
  - Shows `ChatMessage` interface for message structure
- API: `orchestrationApi.ts` - Path: `frontend/src/api/orchestrationApi.ts`
  - Shows current `startOrchestration` pattern being replaced
- Context: `ProjectContext.tsx` - Path: `frontend/src/contexts/ProjectContext.tsx`
  - Shows how to access `activeProject?.name` and `activeProject?.organisationId`
- API: `organisationsApi.ts` - Path: `frontend/src/api/organisationsApi.ts`
  - Contains `getOrganisationById` for resolving organisation name from ID

### Follow-up Questions

No follow-up questions needed. The user's answers are comprehensive and unambiguous.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

1. **Replace Implement Button Behavior**
   - Remove current `startOrchestration` / `generateImplementationPlan` flow from Implement button
   - New click handler initiates Shape-Spec streaming session

2. **Compose Spec Intent from latestPlannerResponse**
   - Extract relevant fields from `PlannerResponse` interface:
     - `featureUnderstanding` - primary feature definition
     - `scope.in` / `scope.out` - scope boundaries
     - `assumptions` - working assumptions
     - `acceptanceCriteria` - completion criteria
   - Compose into a concise LLM-friendly string
   - Prefix with `/shape-spec ` as required by the endpoint

3. **Build Request Payload**
   - `company`: Organisation NAME (resolve via `getOrganisationById(activeProject.organisationId)`)
   - `project`: Project NAME (`activeProject.name`)
   - `message`: Composed spec intent prefixed with `/shape-spec `
   - `session_mode`: "new"

4. **SSE Stream Consumption**
   - POST to `http://localhost:8000/api/v1/shape-spec/stream` (external Claude Code proxy)
   - Handle SSE events:
     - `{type:"skill_invoked", skill:"..."}` - IGNORE (no UI impact)
     - `{type:"content", delta:"..."}` - Append delta to in-progress message
     - `{type:"done"}` - Finalize message, stop listening

5. **UI Rendering**
   - Create single "Software Architect" chat message at stream start
   - Incrementally append `delta` content to message during stream
   - Use existing ChatBubble with persona="Software Architect" and personaColor="purple"
   - Auto-scroll to bottom as content streams in
   - Finalize message on `{type:"done"}` event

6. **UI State Management**
   - While stream is active: disable Implement button to prevent duplicate submissions
   - Track streaming state (e.g., `isStreaming` boolean)
   - Preserve streamed messages in chat after completion

7. **Error Handling (Minimal)**
   - Connection failure: Show error in chat bubble or error banner
   - Parse failure: Show error in chat bubble or error banner
   - Unexpected stream end: Show error in chat bubble or error banner
   - No retries, no categorization, no recovery logic

### Reusability Opportunities

- **ChatBubble/ChatMessageList**: Existing components support "Software Architect" persona with purple color
- **Organisation/Project Resolution**: Existing patterns in `handleImplement` for deriving company/project names
- **Message State Management**: Existing `messages` state array and `setMessages` pattern
- **Loading State**: Existing `isImplementing` state pattern can be adapted to `isStreaming`

### Scope Boundaries

**In Scope:**
- Replace Implement button click handler
- Compose spec intent from `latestPlannerResponse` fields
- POST to shape-spec/stream endpoint with SSE consumption
- Handle `skill_invoked` (ignore), `content` (render), `done` (stop) events
- Render streamed content as Software Architect chat bubbles
- Minimal error display for stream failures
- Prevent duplicate submissions during active stream

**Out of Scope:**
- Handling `{type:"questions"}` events
- Populating Open Questions table from stream
- Answer submission / session continuation loop
- Handling `{type:"folder"}` storage events
- Triggering orchestration (`/api/v1/orchestrations`)
- "I'll start implementing" confirmation bubble
- Persistence/rehydration of shape-spec stream transcripts
- Retry logic or sophisticated error handling
- New UI components (reuse existing)

### Technical Considerations

1. **SSE Handling**
   - Use `EventSource` API or `fetch` with `ReadableStream` for SSE consumption
   - Parse JSON from each SSE `data:` line
   - Handle connection errors gracefully

2. **Endpoint Configuration**
   - Base URL: `http://localhost:8000` (or configurable via environment variable)
   - Path: `/api/v1/shape-spec/stream`
   - Method: POST with JSON body
   - Response: Server-Sent Events stream

3. **Message Accumulation Pattern**
   - Create placeholder message at stream start
   - Accumulate `delta` strings into a single message
   - Update React state incrementally (append to existing message content)
   - Consider debouncing state updates if performance is a concern

4. **Button State**
   - `canImplementBase` existing logic should still apply (check `latestPlannerResponse`, `plannerReadyForSpec`, etc.)
   - Add `isStreaming` check to disable button during active stream

5. **Integration Points**
   - Uses `useProject()` hook for `activeProject`
   - Uses `getOrganisationById()` for organisation name resolution
   - Uses existing `ChatMessageList` with `currentPhase` for persona routing
