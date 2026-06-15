# Specification: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop

## Goal
Extend the Implement screen "Software Architect" interaction to handle `{type:"questions"}` and `{type:"folder"}` SSE events from the shape-spec stream, populate the Open Questions table with streamed questions, and enable users to answer those questions to continue the streaming session until no further questions are returned.

## User Stories
- As a user on the Implement screen, I want to see questions from the Software Architect appear in the Open Questions table so I can provide clarifying answers
- As a user, I want to click "Answer Open Questions" to send my answers back and continue the conversation loop until the Software Architect has no more questions

## Specific Requirements

**Handle {type:"questions"} SSE events**
- Parse `{type:"questions", questions: [{id, question}, ...]}` events from the shape-spec stream
- Each question object contains `id` (string) and `question` (text)
- Replace entire Open Questions table content with streamed questions when event is received
- Do NOT merge with existing planner openQuestions; these are a separate state source

**Derive missing Question fields for streamed questions**
- Set `status: "Open"` for all newly received questions
- Set `answer: ""` (empty string) as initial value
- Set `source: "Software Architect"` to distinguish from planner questions
- Omit `incrementId` (undefined) since streamed questions are not increment-scoped

**Create separate state for streamed questions**
- Add new state variable `streamedQuestions: Question[]` in ImplementationAssistantPanel
- Keep this state distinct from `latestPlannerResponse.openQuestions`
- Clear `streamedQuestions` when a stream turn completes with no questions

**Handle {type:"folder"} SSE events**
- Parse `{type:"folder", folder: "<folder-name>"}` events from the stream
- Store the folder value in component-level UI state (new `latestFolder: string | null`)
- Overwrite with latest value if multiple folder events are received
- Do NOT persist to backend; only needed for next spec (orchestration)

**Button enable/disable logic for "Answer Open Questions"**
- Enable when: at least one `streamedQuestion` exists AND all questions have non-empty answers
- Disable when: no `streamedQuestions` OR any question has an empty answer OR stream is currently active
- Reuse existing button in QuestionsTable component; update data source to use `streamedQuestions` during Software Architect phase

**Answer Open Questions triggers continuation stream**
- On button click, compose a single message string with all Q/A pairs
- Format: Include question text or ID followed by answer (flexible, LLM-readable)
- POST to same endpoint: `http://localhost:8000/api/v1/shape-spec/stream`
- Request body: `{ company, project, message }` - omit `session_mode` entirely for continuation

**Handle continuation stream responses**
- Continue rendering `{type:"content"}` as Software Architect chat messages
- If `{type:"questions"}` received, replace `streamedQuestions` with new question set (loop continues)
- If `{type:"folder"}` received, update `latestFolder` state
- On `{type:"done"}`: if no questions received in this turn, clear `streamedQuestions` and consider Q&A complete

**Looping behavior rules**
- User may click "Answer Open Questions" multiple times
- Each continuation call omits `session_mode` (backend manages session continuity)
- Each stream turn's questions replace the previous set entirely
- Loop ends when a stream turn returns no questions (empty/null/missing)

**UI state guardrails during streaming**
- Disable "Answer Open Questions" button while any stream is active (initial or follow-up)
- Disable "Implement" button while streaming
- Keep Software Architect message history visible and scrollable
- Show streaming indicator during active stream

**Error handling**
- Use existing error display pattern (error-styled chat message or banner)
- Reset streaming state on error so user can manually retry
- No auto-retry logic in this spec

## Existing Code to Leverage

**useShapeSpecStream.ts hook**
- Already handles SSE parsing, `{type:"content"}`, `{type:"done"}`, and `{type:"skill_invoked"}`
- Extend `ShapeSpecStreamEvent` union type to include `QuestionsEvent` and `FolderEvent`
- Modify `processEvent()` to route new event types to callbacks
- Add `onQuestions` and `onFolder` optional callbacks to `ShapeSpecStreamParams`
- Make `sessionMode` optional in `ShapeSpecStreamParams` for continuation calls

**shapeSpecApi.ts**
- Contains `ShapeSpecStreamRequest` interface
- Modify `session_mode` field to be optional (not required for continuation)
- Existing `startShapeSpecStream()` function can be reused

**ImplementationAssistantPanel.tsx**
- Already has `isStreaming`, `streamingMessageId`, `streamedContentRef` state
- Add new state: `streamedQuestions: Question[]` and `latestFolder: string | null`
- Modify `startShapeSpecStreamCallback` to pass `onQuestions` and `onFolder` callbacks
- Add `handleAnswerOpenQuestions` callback for continuation flow
- Update button disable logic to check `isStreaming` and `streamedQuestions` state

**QuestionsTable and QuestionsTableRow components**
- Fully reusable without modification
- Component accepts `questions: Question[]` prop - just pass different data source
- Already has button enable/disable logic based on answer completeness
- Already has `isSubmitting` prop for loading state

**Question interface in chatApi.ts**
- Existing interface has all required fields: `id`, `question`, `status`, `answer`, `source`, `incrementId?`
- Use `source: "Software Architect"` for streamed questions vs `source: "Product Owner"` for planner questions

## Out of Scope
- Triggering POST to `/api/v1/orchestrations` endpoint
- Any "implementation started" confirmation bubble or executor-related chat messages
- Persisting questions/answers/transcript/folder to backend beyond UI state
- Backend persistence of streamed questions or folder value
- Auto-retry logic on stream errors
- Tab reload or page refresh persistence of folder or questions
- Any changes to planner LLM flows or planner data models
- Any transformation of planner content
- Initial session start (handled by Shape-Spec 1)
- Phase awareness for planner vs SA questions in QuestionsTable (use separate data sources instead)
