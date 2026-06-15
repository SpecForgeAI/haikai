# Spec Requirements: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop

## Initial Description

Extend the Implement screen "Software Architect" interaction so that streamed shape-spec events can populate the Open Questions table, and the user can answer those questions to continue the same shape-spec streaming session until no further questions are returned.

Key aspects from the raw idea:
- Shape-Spec 1 is already in place (handles {type:"content"} and {type:"done"})
- This spec adds handling for {type:"questions"} and {type:"folder"} events
- Introduces the "Answer Open Questions" loop via subsequent stream calls
- The shape-spec streaming endpoint: POST http://localhost:8000/api/v1/shape-spec/stream (SSE)

## Requirements Discussion

### First Round Questions

**Q1:** Should the streamed questions create a NEW state source or merge into the existing planner openQuestions?
**Answer:** Create a NEW state source for streamed questions (separate from latestPlannerResponse.openQuestions). Do NOT merge or mutate planner openQuestions; planner questions and Software Architect questions are distinct phases/sources.

**Q2:** How should missing fields be derived when questions arrive from the stream (since stream only provides id and question text)?
**Answer:** Derive missing fields as:
- status: "Open"
- answer: "" (empty)
- source: "Software Architect"
- incrementId: undefined / omitted

**Q3:** Where should the QuestionsTable component render for streamed questions?
**Answer:** Reuse the EXISTING QuestionsTable component in its current location (LHS panel, 65%). Do not create a separate table in the RHS chat panel.

**Q4:** Should the "Answer Open Questions" button be reused or should there be a new button?
**Answer:** Reuse the EXISTING "Answer Open Questions" button and its current location/UX. Its enable/disable logic should now be driven by the streamed-question state while in the Software Architect phase.

**Q5:** What format should the continuation message use when sending answered questions?
**Answer:** The proposed Q/A format is acceptable. No strict schema required; readability for an LLM is the only requirement. Including question IDs or question text is sufficient.

**Q6:** How should session_mode be handled on continuation calls?
**Answer:** Make session_mode OPTIONAL. For continuation calls, omit the field entirely (do not send null, empty string, or undefined).

**Q7:** Where should the folder value be stored when received from the stream?
**Answer:** Store the folder value in component-level or Implement-session-level UI state that persists across stream turns but does NOT need to survive tab reloads or page refresh. Do not persist it to backend or long-lived context in this spec.

**Q8:** How should stream errors be handled?
**Answer:** Use the existing error display pattern (e.g., error-styled chat message or banner). Reset streaming state so the user can manually retry via existing actions. No auto-retry logic.

**Q9:** Are there any additional items to explicitly exclude from this spec?
**Answer:** Explicitly exclude in this spec:
- Any orchestration triggering
- Any "implementation started" or executor-related chat messages
- Any backend persistence of streamed questions, answers, folder, or transcript
- Any changes to planner LLM flows or planner data models

### Existing Code to Reference

Based on the context of this spec building on Shape-Spec 1 and reusing existing components:

**Similar Features Identified:**
- Feature: QuestionsTable component - Path: existing component in LHS panel (65% width area)
- Feature: "Answer Open Questions" button - Path: existing button with enable/disable logic
- Feature: Shape-Spec 1 streaming implementation - Path: current streaming handler for {type:"content"} and {type:"done"}
- Feature: Existing error display patterns - Path: error-styled chat message or banner components

### Follow-up Questions

No follow-up questions needed. The user's answers are comprehensive and provide clear guidance on all implementation decisions.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visual files were found in the planning/visuals folder.

## Requirements Summary

### Functional Requirements

**Event Handling:**
- Handle {type:"questions"} events: populate Open Questions table with questions from stream
- Handle {type:"folder"} events: store folder value in UI state for later use
- Continue handling {type:"content"} events: render as "Software Architect" chat messages (existing)
- Continue handling {type:"done"} events: mark stream complete (existing)
- Ignore {type:"skill_invoked"} events (existing)

**Question State Management:**
- Create NEW separate state source for streamed questions (distinct from planner openQuestions)
- Derive missing fields for streamed questions:
  - status: "Open"
  - answer: "" (empty string)
  - source: "Software Architect"
  - incrementId: undefined/omitted
- Replace entire question set when new {type:"questions"} event arrives
- Clear questions table if stream completes with no questions returned

**UI Component Reuse:**
- Reuse existing QuestionsTable component in LHS panel (65% width)
- Reuse existing "Answer Open Questions" button with current location/UX
- Update button enable/disable logic to be driven by streamed-question state during Software Architect phase

**Button Enable/Disable Logic:**
- Enable "Answer Open Questions" button when:
  - At least one active streamed question exists AND
  - All active questions have non-empty answers
- Disable when:
  - No active questions OR
  - Any question has an empty answer OR
  - Stream is currently active

**Answer Open Questions Flow:**
- Compose a single message string containing all Q/A pairs (flexible format, LLM-readable)
- POST to same endpoint: http://localhost:8000/api/v1/shape-spec/stream
- Request body includes: company, project, message (composed answers)
- Omit session_mode field entirely for continuation calls (do not send null/empty/undefined)

**Looping Behavior:**
- Allow multiple "Answer Open Questions" iterations
- Each continuation uses same conversation (no session_mode)
- Replace questions table with latest returned questions each turn
- If no questions returned, clear table and disable button

**Folder Storage:**
- Store folder value in component-level or session-level UI state
- Persist across stream turns within same session
- Does NOT need to survive tab reload or page refresh
- Do NOT persist to backend

**Error Handling:**
- Use existing error display pattern (error-styled chat message or banner)
- Reset streaming state on error
- Allow user to manually retry via existing actions
- No auto-retry logic

### Reusability Opportunities

- QuestionsTable component: Reuse entirely, just populate with different data source
- "Answer Open Questions" button: Reuse entirely, update enable/disable logic
- Shape-Spec 1 streaming infrastructure: Extend event handling for new event types
- Error display patterns: Reuse existing error-styled chat message or banner

### Scope Boundaries

**In Scope:**
- Handling {type:"questions"} SSE events
- Handling {type:"folder"} SSE events
- New state source for streamed questions (separate from planner questions)
- Populating existing QuestionsTable with streamed questions
- Answer editing in UI (local state only)
- "Answer Open Questions" button enable/disable logic for Software Architect phase
- Composing and sending continuation stream requests
- Folder storage in UI state (session-level, not persisted)
- Error handling using existing patterns
- Looping until no more questions returned

**Out of Scope:**
- Any orchestration triggering (POST /api/v1/orchestrations)
- Any "implementation started" or executor-related chat messages
- Backend persistence of streamed questions, answers, folder, or transcript
- Any changes to planner LLM flows or planner data models
- Auto-retry logic on errors
- Tab reload/page refresh persistence of folder or questions
- Any transformation of planner content
- Initial session start (handled by Shape-Spec 1)

### Technical Considerations

**Endpoint:**
- POST http://localhost:8000/api/v1/shape-spec/stream (SSE)
- Continuation calls omit session_mode field entirely

**State Architecture:**
- Streamed questions: NEW separate state (not merged with planner openQuestions)
- Folder value: Component/session-level UI state
- Both are distinct from planner data models

**Request Body for Continuation:**
```
{
  company: <active project organisation name>,
  project: <active project name>,
  message: <composed answers text>
}
```
Note: session_mode is omitted entirely (not null, not empty string, not undefined)

**Message Format for Answers:**
- Flexible Q/A format
- Include question IDs or question text with answers
- Must be readable by LLM
- No strict schema required

**Phase Awareness:**
- Button enable/disable logic must be driven by streamed-question state when in Software Architect phase
- Planner questions and Software Architect questions are distinct phases/sources
