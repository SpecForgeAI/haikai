# Task Breakdown: Shape-Spec 3 - Trigger Orchestration

## Overview
Total Tasks: 22

This spec implements automatic orchestration triggering when the Software Architect shape-spec streaming conversation completes all questions. The implementation adds state management for a guard flag, detection logic in existing callbacks, success/error messaging, and proper state reset behavior.

## Task List

### State Management

#### Task Group 1: Add hasTriggeredOrchestration State Variable
**Dependencies:** None

- [x] 1.0 Complete state management for orchestration guard flag
  - [x] 1.1 Add hasTriggeredOrchestration useState to ImplementationAssistantPanel.tsx
    - Add `const [hasTriggeredOrchestration, setHasTriggeredOrchestration] = useState<boolean>(false);`
    - Place near other session-scoped state variables (e.g., near isStreaming, streamedQuestions)
    - Initialize to false
    - Do NOT add to ImplementChatUiState interface (session-scoped only)
  - [x] 1.2 Add reset logic for hasTriggeredOrchestration when workItemId changes
    - Locate existing useEffect that resets session state on workItemId change
    - Add `setHasTriggeredOrchestration(false);` to the reset logic
    - Ensure reset happens alongside other session state resets (e.g., messages, streamedQuestions)

**Acceptance Criteria:**
- hasTriggeredOrchestration state variable exists and initializes to false
- State resets to false when workItemId changes
- State is NOT persisted to ImplementChatUiState
- Closing and reopening Implement panel creates fresh session with flag reset

**Files to Modify:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/services/ui/src/panels/ImplementationAssistantPanel.tsx`

---

### Orchestration Trigger Logic

#### Task Group 2: Create Orchestration Trigger Function
**Dependencies:** Task Group 1

- [x] 2.0 Complete orchestration trigger function implementation
  - [x] 2.1 Create helper function triggerOrchestration in ImplementationAssistantPanel.tsx
    - Create async function that encapsulates orchestration call and message handling
    - Accept parameters: latestFolder (string | null)
    - Function should be defined inside the component to access state setters
  - [x] 2.2 Implement guard check at start of triggerOrchestration
    - Check if hasTriggeredOrchestration is true; if so, return early (skip orchestration)
    - Check if latestFolder is null or empty string; if so, display error message and return
  - [x] 2.3 Implement missing folder error handling
    - If latestFolder is null or empty, append ChatMessage to messages state:
      - role: 'assistant'
      - content: "Error: Cannot start implementation - spec folder is missing."
      - id: generateMessageId()
      - timestamp: new Date()
    - Do NOT call startOrchestration
    - Do NOT set hasTriggeredOrchestration to true
  - [x] 2.4 Implement orchestration API call
    - Set hasTriggeredOrchestration to true BEFORE making the API call
    - Resolve organisation name: `const organisation = await getOrganisationById(activeProject.organisationId);`
    - Call startOrchestration with:
      - company: organisation.name
      - project: activeProject.name (fallback to activeProject.id if name unavailable)
      - spec_intents: [latestFolder]
  - [x] 2.5 Implement success message handling (HTTP 200/201)
    - Check response for success: true
    - Append ChatMessage to messages state:
      - role: 'assistant'
      - content: "Okay, I'll start implementing the code change now. Speak to you soon!"
      - id: generateMessageId()
      - timestamp: new Date()
  - [x] 2.6 Implement orchestration API failure handling
    - Check response for success: false OR catch any thrown errors
    - Append ChatMessage to messages state:
      - role: 'assistant'
      - content: "Error: Unable to start implementation. Please try again later."
      - id: generateMessageId()
      - timestamp: new Date()
    - Do NOT surface HTTP codes or technical details
    - Do NOT append success message

**Acceptance Criteria:**
- Guard flag prevents duplicate orchestration calls
- Missing folder displays chat-based error message
- Successful orchestration displays confirmation message
- Failed orchestration displays user-friendly error message
- Organisation name resolved via getOrganisationById
- spec_intents array contains the captured folder value

**Files to Modify:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/services/ui/src/panels/ImplementationAssistantPanel.tsx`

**Existing Code to Leverage:**
- `startOrchestration` function from orchestrationApi.ts (line 184)
- `getOrganisationById` function from organisationsApi.ts (line 140)
- `generateMessageId` function in ImplementationAssistantPanel.tsx (line 245)

---

### Questions Complete Detection

#### Task Group 3: Add Detection Logic to onDone Callbacks
**Dependencies:** Task Group 2

- [x] 3.0 Complete questions complete detection in existing callbacks
  - [x] 3.1 Add orchestration trigger to startShapeSpecStreamCallback onDone
    - Locate onDone callback in startShapeSpecStreamCallback (approximately line 1355)
    - Add detection logic AFTER existing state updates (setIsStreaming, clearing streamedQuestions)
    - Detection conditions (all must be true):
      - Stream turn finished ({type:"done"} - already handled by onDone)
      - receivedQuestionsInTurn.current === false
      - streamedQuestions.length === 0
    - If all conditions met, call triggerOrchestration(latestFolder)
  - [x] 3.2 Add orchestration trigger to handleAnswerStreamedQuestions onDone
    - Locate onDone callback in handleAnswerStreamedQuestions (approximately line 1225)
    - Add identical detection logic AFTER existing state updates
    - Same detection conditions as 3.1
    - If all conditions met, call triggerOrchestration(latestFolder)
  - [x] 3.3 Ensure detection runs after state updates complete
    - Verify that detection logic executes after setIsStreaming(false) and any streamedQuestions clearing
    - Consider using functional state update or reading current state to ensure accurate check
    - Detection must check the post-update state, not pre-update state

**Acceptance Criteria:**
- Detection logic added to both startShapeSpecStreamCallback and handleAnswerStreamedQuestions
- All three conditions checked: done event, no questions in turn, empty streamedQuestions
- triggerOrchestration called only when all conditions are met
- Detection runs after existing onDone logic completes

**Files to Modify:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/services/ui/src/panels/ImplementationAssistantPanel.tsx`

---

### Message Rendering

#### Task Group 4: Verify Message Styling
**Dependencies:** Task Group 2, Task Group 3

- [x] 4.0 Verify success and error messages render correctly
  - [x] 4.1 Confirm ChatMessage structure matches existing patterns
    - Review existing ChatMessage creation patterns in ImplementationAssistantPanel.tsx
    - Ensure success/error messages use identical structure:
      - role: 'assistant'
      - id: string (from generateMessageId)
      - content: string
      - timestamp: Date
  - [x] 4.2 Verify Software Architect persona styling applies automatically
    - Confirm phase remains 'implementation_clarification' when messages are added
    - Review ChatMessageList.tsx getPersonaForPhase function behavior
    - No changes needed to ChatMessageList or ChatBubble components
    - Messages with role 'assistant' during implementation_clarification phase render with purple styling
    - **Fix Applied:** Updated currentPhase prop to use `(isStreaming || hasTriggeredOrchestration)` condition
    - This ensures messages added after orchestration trigger still render with Software Architect styling

**Acceptance Criteria:**
- Success message renders as Software Architect persona (purple styling)
- Error messages render as Software Architect persona (purple styling)
- No new styling or component changes required
- Messages appear in chat thread in correct order

**Files to Review (no modifications expected):**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/services/ui/src/components/ChatMessageList.tsx`
- `C:/Workspaces/SSD/architecture-store-and-diagrams/services/ui/src/components/ChatBubble.tsx`

**Files Modified:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
  - Updated line 1799 from `currentPhase={isStreaming ? 'implementation_clarification' : undefined}`
  - To `currentPhase={(isStreaming || hasTriggeredOrchestration) ? 'implementation_clarification' : undefined}`

---

### Testing and Verification

#### Task Group 5: Manual Testing Scenarios
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete testing of all scenarios (converted to unit tests)
  - [x] 5.1 Test happy path: Questions complete with folder available
    - Unit test: `triggers orchestration with success message when questions complete and folder is available`
    - Verifies triggerOrchestration function flow, guard flag, organisation resolution, startOrchestration call, success message
  - [x] 5.2 Test error path: Questions complete with missing folder
    - Unit test: `displays error message when questions complete but folder is missing`
    - Verifies error message: "Error: Cannot start implementation - spec folder is missing."
    - Verifies startOrchestration is NOT called, hasTriggeredOrchestration remains false
  - [x] 5.3 Test error path: Orchestration API failure
    - Unit tests: `displays user-friendly error message when orchestration API fails` and `handles orchestration API exception with user-friendly error message`
    - Verifies error message: "Error: Unable to start implementation. Please try again later."
    - Verifies success message does NOT appear
  - [x] 5.4 Test guard flag: Prevent duplicate orchestration
    - Unit test: `prevents duplicate orchestration calls via hasTriggeredOrchestration guard flag`
    - Verifies guard flag initialized to false, set to true before API call, checked at start of triggerOrchestration
  - [x] 5.5 Test state reset: WorkItemId change
    - Unit test: `resets hasTriggeredOrchestration to false when workItemId changes`
    - Verifies hasTriggeredOrchestration resets on workItemId change via hydration useEffect
  - [x] 5.6 Test re-trigger: Close and reopen Implement panel
    - Unit test: `allows re-triggering orchestration after closing and reopening Implement panel`
    - Verifies useState initializes to false on component mount (fresh session)

**Acceptance Criteria:**
- All six test scenarios have unit tests (57 total tests pass)
- No duplicate orchestration calls in single session
- Appropriate messages displayed for all scenarios
- State resets correctly on workItemId change and panel reopen

**Unit Tests Location:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/ProductView/ImplementationAssistantPanel.test.tsx`

---

### Code Review and Cleanup

#### Task Group 6: Final Review
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete code review and cleanup
  - [x] 6.1 Review code for consistency with existing patterns
    - Verified async/await usage matches existing code style
    - Verified error handling follows existing patterns (try-catch with user-friendly messages)
    - Verified state update patterns are consistent (functional updates with prev state)
  - [x] 6.2 Remove any debug logging or console statements
    - No new console.log statements added by orchestration implementation
    - Existing console.error/console.warn statements are appropriate for production error handling
    - Pre-existing console.log in TODO section (line 1650) is unrelated to this feature
  - [x] 6.3 Verify no TypeScript errors or warnings in the implementation
    - No TypeScript errors in ImplementationAssistantPanel.tsx related to orchestration code
    - Test file TypeScript errors fixed (ContextState version field, removed unused imports)
  - [x] 6.4 Verify imports are correct
    - `startOrchestration` imported from orchestrationApi.ts (line 210)
    - `getOrganisationById` imported from organisationsApi.ts (line 211)
    - No unused imports related to orchestration feature

**Acceptance Criteria:**
- Code follows existing project conventions
- No TypeScript errors or warnings in implementation
- No debug code left in production
- All imports correctly specified

**Files Reviewed:**
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- `C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/ProductView/ImplementationAssistantPanel.test.tsx`

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: State Management** - Add hasTriggeredOrchestration state variable and reset logic
2. **Task Group 2: Orchestration Trigger Logic** - Create the triggerOrchestration function with all handling
3. **Task Group 3: Questions Complete Detection** - Add detection to both onDone callbacks
4. **Task Group 4: Message Rendering** - Verify styling works correctly (may be minimal work)
5. **Task Group 5: Manual Testing** - Test all scenarios (converted to unit tests)
6. **Task Group 6: Final Review** - Code cleanup and verification

## Summary of Changes

| File | Changes |
|------|---------|
| ImplementationAssistantPanel.tsx | Add hasTriggeredOrchestration state, reset in useEffect, create triggerOrchestration function, add detection to both onDone callbacks |
| ImplementationAssistantPanel.test.tsx | Added 22 new unit tests for orchestration trigger scenarios (Task Group 5) |
| ChatMessageList.tsx | No changes (verification only) |
| ChatBubble.tsx | No changes (verification only) |
| orchestrationApi.ts | No changes (reuse existing startOrchestration) |
| organisationsApi.ts | No changes (reuse existing getOrganisationById) |

## Key Implementation Notes

1. **Order of Operations in onDone:** The orchestration trigger must run AFTER the existing state updates (setIsStreaming, clearing streamedQuestions) to ensure accurate condition checking.

2. **Guard Flag Timing:** Set hasTriggeredOrchestration to true BEFORE making the API call, not after. This prevents race conditions if multiple stream completions occur rapidly.

3. **No Retry Logic:** Per spec, do NOT implement retry buttons or automatic retries. User must restart the flow if orchestration fails.

4. **Session Scope:** hasTriggeredOrchestration is intentionally session-scoped. It resets on workItemId change and when the panel is closed/reopened.

5. **Message Structure:** Use the exact same ChatMessage structure as existing messages to ensure proper rendering with Software Architect persona styling.

6. **Task Group 4 Fix:** Updated the currentPhase prop to persist 'implementation_clarification' when hasTriggeredOrchestration is true, ensuring success/error messages render with purple Software Architect styling.

7. **Task Group 5 Conversion:** Manual testing scenarios were converted to unit tests in ImplementationAssistantPanel.test.tsx. All 57 tests pass, covering:
   - Happy path with folder available
   - Error path with missing folder
   - Error path with API failure (success: false)
   - Error path with API exception
   - Guard flag duplicate prevention
   - State reset on workItemId change
   - Re-trigger after panel close/reopen
