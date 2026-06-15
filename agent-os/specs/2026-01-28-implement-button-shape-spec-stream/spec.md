# Specification: Implement Button Starts Shape-Spec Stream (New Session)

## Goal

Replace the existing Implement button behavior in the Feature Implement screen to initiate a new Shape-Spec streaming conversation with the Software Architect (Claude Code proxy), using the Planner LLM's final spec intent as input, and render streamed content live in the chat UI.

## User Stories

- As a Product Owner, I want to click the Implement button after shaping a feature so that a Software Architect begins working on implementing my spec intent.
- As a User, I want to see the Software Architect's response stream in real-time so that I can follow along as the implementation thinking unfolds.

## Specific Requirements

**Replace Implement Button Click Handler**
- Remove calls to `startOrchestration` and `generateImplementationPlan` from the Implement button's click handler
- New handler initiates Shape-Spec streaming session via POST to external endpoint
- Button click triggers `startShapeSpecStream()` function instead of current flow
- The existing `canImplementBase` logic for button enablement should continue to apply
- Add `isStreaming` check to disable button during active stream

**Compose Spec Intent from latestPlannerResponse**
- Extract relevant fields from `PlannerResponse` interface to compose spec intent
- Fields to include: `featureUnderstanding`, `scope.in`, `scope.out`, `assumptions`, `acceptanceCriteria`
- Compose into a concise LLM-friendly string format
- Prefix the composed message with `/shape-spec ` as required by the endpoint
- Do NOT use PROPOSED marker extraction (the old path) - use structured `latestPlannerResponse` only

**Derive Company and Project Names**
- `company`: Organisation NAME (not ID) - resolve via `getOrganisationById(activeProject.organisationId)`
- `project`: Project NAME - use `activeProject.name`
- These follow the same pattern currently used in `handleImplement()` for orchestration calls
- Handle case where organisation lookup fails gracefully (use fallback string)

**Build Shape-Spec Stream Request**
- POST to `http://localhost:8000/api/v1/shape-spec/stream` (external Claude Code proxy service)
- Request body JSON structure: `{ company: string, project: string, message: string, session_mode: "new" }`
- The endpoint URL should be configurable via environment variable `VITE_SHAPE_SPEC_BASE_URL` with fallback to `http://localhost:8000`
- Response is Server-Sent Events (SSE) stream, not standard JSON

**SSE Stream Consumption**
- Use `fetch` API with `ReadableStream` for SSE consumption (POST with body requires this approach, not EventSource)
- Parse each SSE line: lines starting with `data:` contain JSON payloads
- Handle three event types by parsing `type` field from JSON:
  - `{type:"skill_invoked", skill:"..."}` - IGNORE (no UI impact)
  - `{type:"content", delta:"..."}` - Append `delta` text to in-progress message
  - `{type:"done"}` - Finalize message, stop listening, mark stream complete
- Handle stream parsing errors gracefully (malformed JSON, connection drops)

**UI Rendering for Streamed Content**
- Create single "Software Architect" chat message at stream start
- Incrementally append `delta` content to message during stream (accumulate into single message)
- Use existing `ChatBubble` with persona="Software Architect" and personaColor="purple"
- Pass `currentPhase="implementation_clarification"` to `ChatMessageList` for correct persona routing
- Auto-scroll to bottom as content streams in (existing ChatMessageList behavior)
- Finalize message on `{type:"done"}` event

**UI State Management**
- Add `isStreaming` boolean state to track active stream
- While stream is active: disable Implement button to prevent duplicate submissions
- Preserve streamed messages in chat after completion (add to existing `messages` array)
- Reset `isStreaming` to false when stream completes or errors

**Error Handling (Minimal)**
- Connection failure: Show error message in chat bubble using existing error pattern
- Parse failure: Show error message in chat bubble
- Unexpected stream end: Show error message in chat bubble
- No retries, no error categorization, no sophisticated recovery logic
- Error messages should use the existing assistant message pattern with error content

## Visual Design

No visual mockups provided. Reuse existing chat UI patterns.

## Existing Code to Leverage

**ImplementationAssistantPanel.tsx**
- Contains `handleImplementClick()` and `generateImplementationPlan()` - replace this flow
- Shows pattern for deriving company/project: `getOrganisationById(activeProject.organisationId)`, `activeProject?.name`
- Has existing `isImplementing` state - adapt to `isStreaming` for stream tracking
- Contains `latestPlannerResponse` state with PlannerResponse type
- Shows `messages` state array and `setMessages` pattern for adding chat messages
- Uses `generateMessageId()` helper for unique message IDs

**PlannerResponse Interface (chatApi.ts)**
- `featureUnderstanding`: string - primary feature definition
- `scope.in`: string[] - items explicitly in scope
- `scope.out`: string[] - items explicitly out of scope
- `assumptions`: string[] - working assumptions
- `acceptanceCriteria`: string[] - completion criteria
- `plannerReadyForSpec`: boolean - used for button enablement

**ChatBubble and ChatMessageList Components**
- `ChatBubble` supports persona="Software Architect" with personaColor="purple"
- `ChatMessageList` accepts `currentPhase` prop to determine persona routing
- Phase `'implementation_clarification'` maps to "Software Architect" persona with purple color
- Auto-scroll behavior already implemented in ChatMessageList

**getOrganisationById (organisationsApi.ts)**
- Fetches all organisations and filters by ID
- Returns `OrganisationDto | null`
- Use `organisation.name` for the `company` field

**useProject Hook (ProjectContext.tsx)**
- Returns `activeProject: ProjectDto | null`
- Provides `activeProject.name` for project name
- Provides `activeProject.organisationId` for organisation lookup

## Out of Scope

- Handling `{type:"questions"}` SSE events and populating Open Questions table
- Answer Open Questions flow / session continuation loop (subsequent stream calls)
- Handling `{type:"folder"}` SSE events for folder storage
- Triggering orchestration (`/api/v1/orchestrations`) after stream completes
- "I'll start implementing" confirmation bubble
- Persistence/rehydration of shape-spec stream transcripts
- Retry logic or sophisticated error handling/categorization
- New UI components (must reuse existing ChatBubble/ChatMessageList)
- Modifying the external Shape-Spec streaming endpoint (it's a consumed service)
