# Spec Requirements: Shape-Spec 3 - Trigger Orchestration

## Initial Description

Once the Software Architect shape-spec streaming conversation has no further questions, automatically trigger the implementation orchestration using the emitted spec folder name, and then post a final "Software Architect" confirmation message in the chat.

**Definition of "Questions Complete":**
- A stream turn finishes ({type:"done"}) AND
- That stream turn produced no usable questions (questions event missing, null, or empty array) AND
- The Open Questions table is empty/cleared.

**Core Behaviors:**
- Behavior A: Trigger orchestration POST when questions complete (if folder is available)
- Behavior B: Display final "Software Architect" confirmation message on success
- Behavior C: Display error message on failure (minimal handling)

## Requirements Discussion

### First Round Questions

**Q1:** Detection location - Should "questions complete" be detected inside the existing onDone callbacks (startShapeSpecStreamCallback, handleAnswerStreamedQuestions) or extracted to a new hook/function?
**Answer:** Yes - detect "questions complete" inside the existing onDone callbacks in ImplementationAssistantPanel.tsx (i.e. startShapeSpecStreamCallback and handleAnswerStreamedQuestions). No need to extract to a new hook/function for this spec.

**Q2:** Guard conditions - In addition to receivedQuestionsInTurn.current === false, should we explicitly ensure the streamed-questions state is empty/cleared before triggering orchestration?
**Answer:** Yes - in addition to receivedQuestionsInTurn.current === false, explicitly ensure the streamed-questions state is empty/cleared (e.g., streamedQuestions.length === 0) before triggering orchestration. Use both checks together.

**Q3:** Guard flag scope - Should hasTriggeredOrchestration be a local Implement-session state variable, or persisted to ImplementChatUiState?
**Answer:** Add hasTriggeredOrchestration as a local Implement-session state variable. Reset it when workItemId changes or the Implement session is reset. Do NOT persist it to ImplementChatUiState; resetting on tab switch is acceptable.

**Q4:** Re-trigger behavior - If the user closes and reopens the Implement panel, should orchestration be allowed to re-trigger, or should a long-lived lock prevent it?
**Answer:** Allow re-triggering if the user closes and reopens the Implement panel. Treat this as a new Implement session; no long-lived orchestration lock is required in this spec.

**Q5:** Company/project derivation - Should we reuse the existing pattern for resolving company (organisation name via getOrganisationById) and project (activeProject.name)?
**Answer:** Yes - reuse the exact existing pattern used today:
- company: resolved organisation NAME via getOrganisationById(activeProject.organisationId)
- project: activeProject.name (fallback to projectId if needed)

**Q6:** Success message rendering - Should the success message be rendered as a "Software Architect" persona chat bubble (purple styling) or use a different visual treatment?
**Answer:** Display the success message as a "Software Architect" persona chat bubble (purple styling), using the same role/phase conventions as other Software Architect messages (no new visual treatment).

**Q7:** Missing-folder error display - If folder is missing when questions complete, should the error use the existing chat-based error pattern or a modal/blocking UI?
**Answer:** Use the existing chat-based error pattern. A simple Software Architect or error-styled chat bubble such as: "Error: Cannot start implementation - spec folder is missing." No modal or blocking UI.

**Q8:** Orchestration failure messaging - Should orchestration failure messages surface HTTP codes/technical details, or use user-friendly messaging?
**Answer:** Use a user-friendly message. Do NOT surface raw HTTP codes or technical details. Example: "Error: Unable to start implementation. Please try again later."

**Q9:** Explicit exclusions - Anything else to explicitly exclude from this spec's scope?
**Answer:** Exclude/defer:
- Retry buttons or automatic retries for orchestration
- Progress indicators or "running" states beyond a disabled button
- Orchestration status polling or executor output
- Any persistence of orchestration state beyond the current UI session

**Q10:** Existing Code Reuse - Are there existing features in your codebase with similar patterns we should reference?
**Answer:** Yes - reuse the existing startOrchestration function in orchestrationApi.ts for the POST /api/v1/orchestrations call, rather than re-implementing the API logic.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Orchestration API - Path: `orchestrationApi.ts`
  - Contains existing startOrchestration function for POST /api/v1/orchestrations
  - Reuse this function rather than re-implementing API logic
- Feature: Organisation resolution - Pattern used in existing code
  - getOrganisationById(activeProject.organisationId) for company name
  - activeProject.name for project name
- Feature: ImplementationAssistantPanel.tsx
  - Contains startShapeSpecStreamCallback and handleAnswerStreamedQuestions callbacks
  - Detection logic will be added inside these existing callbacks

### Follow-up Questions

No follow-up questions needed. The user's answers were comprehensive and covered all implementation details.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visuals to analyze.

## Requirements Summary

### Functional Requirements

**Questions Complete Detection:**
- Detect "questions complete" inside existing onDone callbacks in ImplementationAssistantPanel.tsx
- Callbacks: startShapeSpecStreamCallback and handleAnswerStreamedQuestions
- Detection criteria (both must be true):
  - receivedQuestionsInTurn.current === false
  - streamedQuestions.length === 0

**Orchestration Trigger:**
- When questions complete AND folder is available:
  - Call existing startOrchestration function from orchestrationApi.ts
  - Request body:
    - company: organisation NAME via getOrganisationById(activeProject.organisationId)
    - project: activeProject.name (fallback to projectId if needed)
    - spec_intents: [captured folder value]
- Guard with hasTriggeredOrchestration flag to prevent duplicate calls

**Success Handling (HTTP 200/201):**
- Append "Software Architect" chat bubble with purple styling
- Message: "Okay, I'll start implementing the code change now. Speak to you soon!"
- Use same role/phase conventions as other Software Architect messages

**Error Handling:**
- Missing folder: Chat bubble error - "Error: Cannot start implementation - spec folder is missing."
- Orchestration failure: User-friendly chat bubble - "Error: Unable to start implementation. Please try again later."
- No raw HTTP codes or technical details surfaced
- No modal or blocking UI

### State Management

**hasTriggeredOrchestration Flag:**
- Scope: Local Implement-session state variable
- Reset when: workItemId changes OR Implement session is reset
- NOT persisted to ImplementChatUiState
- Resetting on tab switch is acceptable

**Re-trigger Behavior:**
- Allow re-triggering when user closes and reopens Implement panel
- Treat as new Implement session
- No long-lived orchestration lock required

### Reusability Opportunities

- Reuse startOrchestration function from orchestrationApi.ts
- Reuse existing organisation resolution pattern (getOrganisationById)
- Reuse existing "Software Architect" chat bubble styling and role conventions
- Reuse existing chat-based error display pattern

### Scope Boundaries

**In Scope:**
- Questions complete detection in existing callbacks
- One-time orchestration trigger with guard flag
- Success message display as Software Architect chat bubble
- Error display for missing folder and orchestration failure
- Basic duplicate prevention via hasTriggeredOrchestration flag

**Out of Scope:**
- Retry buttons or automatic retries for orchestration
- Progress indicators or "running" states beyond a disabled button
- Orchestration status polling or executor output
- Any persistence of orchestration state beyond the current UI session
- Modifications to shape-spec stream behavior (handled in specs 1-2)
- Polling orchestration status/progress
- Displaying live executor output or logs

### Technical Considerations

- Integration with existing ImplementationAssistantPanel.tsx callbacks
- Reuse orchestrationApi.ts for API calls
- Organisation name resolution via getOrganisationById
- Software Architect persona styling (purple) for messages
- Chat-based error patterns (no modals)
- Session-scoped state (not persisted to ImplementChatUiState)
