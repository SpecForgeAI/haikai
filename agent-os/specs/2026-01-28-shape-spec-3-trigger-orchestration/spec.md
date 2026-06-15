# Specification: Shape-Spec 3 - Trigger Orchestration

## Goal

Automatically trigger the implementation orchestration when the Software Architect shape-spec streaming conversation completes all questions, using the captured spec folder name, and display a final confirmation message in the chat.

## User Stories

- As a developer using the Implement workflow, I want the system to automatically start code implementation when I finish answering all the Software Architect's questions so that I do not have to manually trigger the next step.
- As a developer, I want to see a confirmation message when implementation starts so that I know the handoff was successful.

## Specific Requirements

**Definition of "Questions Complete"**
- A stream turn finishes with {type:"done"} event
- That stream turn produced no usable questions (receivedQuestionsInTurn.current === false)
- The streamedQuestions state array is empty (streamedQuestions.length === 0)
- All three conditions must be true simultaneously to consider questions complete

**Behavior A: Trigger Orchestration**
- When "questions complete" is detected, check if latestFolder state has a non-null/non-empty value
- If folder is available, call startOrchestration from orchestrationApi.ts with:
  - company: resolved organisation NAME via getOrganisationById(activeProject.organisationId)
  - project: activeProject.name (fallback to projectId if name unavailable)
  - spec_intents: [latestFolder] (single-element array containing the captured folder)
- Add hasTriggeredOrchestration guard flag to prevent duplicate orchestration calls
- If hasTriggeredOrchestration is true, skip the orchestration trigger entirely

**Guard Flag State Management**
- Add hasTriggeredOrchestration as a useState boolean, initialized to false
- Set to true immediately before calling startOrchestration
- Reset to false when workItemId changes (add to existing useEffect that resets session state)
- Do NOT persist to ImplementChatUiState; session-scoped only
- Closing and reopening the Implement panel allows re-triggering (new session)

**Behavior B: Final Chat Message on Success (HTTP 200/201)**
- Append a new ChatMessage to messages state with:
  - role: 'assistant'
  - content: "Okay, I'll start implementing the code change now. Speak to you soon!"
  - id: generateMessageId()
  - timestamp: new Date()
- Message renders as "Software Architect" persona with purple styling (phase remains 'implementation_clarification')
- The Open Questions controls remain in their current state (no additional disabling needed since streamedQuestions is already empty)

**Behavior C: Error Handling - Missing Folder**
- If latestFolder is null or empty string when questions complete, do NOT call orchestration
- Display a chat-based error message as ChatMessage with:
  - role: 'assistant'
  - content: "Error: Cannot start implementation - spec folder is missing."
- Use same message structure, renders as Software Architect bubble
- Do not block the UI or show a modal

**Behavior C: Error Handling - Orchestration API Failure**
- If startOrchestration returns success: false or throws an error
- Display a user-friendly chat-based error message:
  - content: "Error: Unable to start implementation. Please try again later."
- Do NOT surface HTTP codes or technical details to the user
- Do not append the success confirmation message
- Do not retry automatically; user must restart the flow if needed

**Detection Location in Callbacks**
- Add orchestration trigger logic inside the existing onDone callbacks in both:
  - startShapeSpecStreamCallback (initial stream)
  - handleAnswerStreamedQuestions (continuation stream)
- Detection happens after existing onDone logic (setIsStreaming, clearing streamedQuestions if no questions received)
- Check all "questions complete" conditions after the existing state updates

## Visual Design

No visual mockups provided for this spec. The UI changes are minimal:
- Success and error messages use the existing Software Architect chat bubble styling (purple color, persona label)
- No new UI components or layout changes required

## Existing Code to Leverage

**startOrchestration function in orchestrationApi.ts**
- Existing function at line 184 that POSTs to /api/v1/orchestrations
- Accepts StartOrchestrationRequest with company, project, spec_intents, options
- Returns StartOrchestrationResponse with success boolean and optional error
- Reuse as-is; no modifications needed to the API client

**getOrganisationById function in organisationsApi.ts**
- Existing function at line 140 for resolving organisation name from ID
- Already used in startShapeSpecStreamCallback and handleAnswerStreamedQuestions
- Pattern: await getOrganisationById(activeProject.organisationId), then use organisation.name

**Software Architect chat bubble styling in ChatMessageList.tsx**
- getPersonaForPhase function returns persona: 'Software Architect', personaColor: 'purple' for implementation_clarification phase
- Messages with role: 'assistant' during this phase render with purple styling automatically
- No changes needed to ChatMessageList or ChatBubble components

**Existing onDone callback pattern in ImplementationAssistantPanel.tsx**
- startShapeSpecStreamCallback has onDone at line 1355 that handles setIsStreaming(false), clearing state
- handleAnswerStreamedQuestions has onDone at line 1225 with same pattern
- Add orchestration trigger logic after the existing receivedQuestionsInTurn check

**generateMessageId function in ImplementationAssistantPanel.tsx**
- Existing helper function at line 245 that generates unique message IDs
- Use for creating success/error ChatMessage objects

## Out of Scope

- Polling orchestration status or progress after triggering
- Displaying live executor output or logs during implementation
- Retry buttons or automatic retries for failed orchestration
- Progress indicators or "running" states beyond the confirmation message
- Persisting orchestration state (hasTriggeredOrchestration) beyond the current UI session
- Modifications to shape-spec stream behavior (handled in Shape-Spec 1 and 2)
- Any changes to the orchestration API or backend services
- Blocking UI or modal dialogs for errors
- Disabling the Implement button after orchestration starts
- Handling multiple concurrent orchestrations
