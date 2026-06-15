# Task Breakdown: Software Architect Handoff Per Increment

## Overview

**Spec ID:** 2026-01-23-sa-handoff-per-increment
**Total Tasks:** 58
**Estimated Effort:** Medium-Large (Gateway TypeScript + Frontend React)

This implementation enables per-increment handoff to a Software Architect (SA) persona that clarifies technical implementation details before spec generation. The SA phase auto-triggers when a plan is generated, tracks clarification status per increment, and allows users to answer SA questions and send them back for follow-up or completion.

---

## Task List

### Gateway Type Definitions

#### Task Group 1: Extend ImplementChatPhase and Add ImplementerResponse Type
**Dependencies:** None

- [x] 1.0 Complete gateway type definitions
  - [x] 1.1 Write 3-4 focused tests for new gateway types
    - **File:** `gateway/src/__tests__/chatTypes.implementerResponse.test.ts`
    - Test ImplementChatPhase includes 'implementation_clarification' as valid value
    - Test ImplementerResponse type has schemaVersion "1.0", message string, openQuestions array
    - Test ImplementerResponse openQuestions uses existing OpenQuestion interface (id, question)
    - Test TypeScript compilation succeeds with new types
  - [x] 1.2 Add 'implementation_clarification' to ImplementChatPhase type
    - **File:** `gateway/src/types/chat.ts`
    - Update ImplementChatPhase type union to include `'implementation_clarification'`
    - This phase is entered after plan generation, one increment at a time
  - [x] 1.3 Create ImplementerResponse type
    - **File:** `gateway/src/types/chat.ts`
    - Add new interface:
      ```typescript
      export interface ImplementerResponse {
        schemaVersion: "1.0";
        message: string;
        openQuestions: OpenQuestion[];
      }
      ```
    - Reuse existing OpenQuestion interface (id, question fields)
  - [x] 1.4 Add implementerResponse field to ChatResponse
    - **File:** `gateway/src/types/chat.ts`
    - Add optional `implementerResponse?: ImplementerResponse` field to ChatResponse interface
    - Parallel to existing `plannerResponse` field
  - [x] 1.5 Ensure gateway type tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- ImplementChatPhase type includes 'implementation_clarification'
- ImplementerResponse type exists with schemaVersion, message, openQuestions
- ChatResponse includes optional implementerResponse field
- TypeScript compilation succeeds

---

### Gateway Validator

#### Task Group 2: Create implementerResponseValidator.ts
**Dependencies:** Task Group 1

- [x] 2.0 Complete implementer response validator
  - [x] 2.1 Write 5-6 focused tests for implementerResponseValidator
    - **File:** `gateway/src/__tests__/implementerResponseValidator.test.ts`
    - Test extractJson extracts valid JSON from LLM response (reused from plannerResponseValidator)
    - Test validateImplementerResponse accepts valid response with schemaVersion "1.0"
    - Test validateImplementerResponse rejects invalid schemaVersion
    - Test validateImplementerResponse transforms string[] questions to OpenQuestion[] with UUIDs
    - Test createFallbackImplementerResponse creates valid fallback with error message
    - Test validateImplementerResponse handles empty openQuestions array (indicates increment ready)
  - [x] 2.2 Export extractJson from plannerResponseValidator
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Export the existing `extractJson` function for reuse
    - Export the existing `transformOpenQuestions` function if not already exported
  - [x] 2.3 Create implementerResponseValidator.ts file
    - **File:** `gateway/src/services/implementerResponseValidator.ts` (NEW)
    - Import extractJson, transformOpenQuestions from plannerResponseValidator
    - Import ImplementerResponse, OpenQuestion from types/chat
  - [x] 2.4 Implement validateImplementerResponse function
    - **File:** `gateway/src/services/implementerResponseValidator.ts`
    - Extract JSON from LLM response using extractJson
    - Validate schemaVersion is "1.0"
    - Validate message is non-empty string
    - Validate openQuestions is array
    - Transform string[] questions to OpenQuestion[] with UUID assignment
    - Return typed ImplementerResponse or validation error
  - [x] 2.5 Implement createFallbackImplementerResponse function
    - **File:** `gateway/src/services/implementerResponseValidator.ts`
    - Create fallback response with error message explaining parse failure
    - Set schemaVersion: "1.0"
    - Set empty openQuestions array
    - Return valid ImplementerResponse structure
  - [x] 2.6 Ensure validator tests pass
    - Run ONLY the 5-6 tests written in 2.1
    - Verify validation logic handles edge cases

**Acceptance Criteria:**
- The 5-6 tests written in 2.1 pass
- extractJson and transformOpenQuestions are reused from plannerResponseValidator
- validateImplementerResponse validates schemaVersion, message, openQuestions
- String questions are transformed to OpenQuestion[] with UUIDs
- createFallbackImplementerResponse creates valid fallback structure

---

### Gateway SA Prompt

#### Task Group 3: Create Software Architect System Prompt Template
**Dependencies:** None (can run in parallel with Task Groups 1-2)

- [x] 3.0 Complete SA system prompt template
  - [x] 3.1 Write 3-4 focused tests for SA prompt generation
    - **File:** `gateway/src/__tests__/implementationClarificationPrompt.test.ts`
    - Test buildImplementationClarificationPrompt includes increment's proposedFinalSubFeatureDefinition
    - Test prompt includes work item context (title, type, description)
    - Test prompt includes architecture context
    - Test prompt output format instructs JSON with schemaVersion, message, openQuestions only
  - [x] 3.2 Create implementationClarificationPrompt.ts file
    - **File:** `gateway/src/services/implementationClarificationPrompt.ts` (NEW)
    - Import necessary types from types/chat
    - Follow pattern from handoffPlanningPrompt.ts for context injection
  - [x] 3.3 Implement buildImplementationClarificationPrompt function
    - **File:** `gateway/src/services/implementationClarificationPrompt.ts`
    - Parameters: activeIncrement (with proposedFinalSubFeatureDefinition), workItem, architectureContext
    - Primary context: increment's proposedFinalSubFeatureDefinition
    - Secondary context: work item title, type, description
    - Tertiary context: architecture context (system boundaries, components)
  - [x] 3.4 Add SA persona instructions to prompt
    - **File:** `gateway/src/services/implementationClarificationPrompt.ts`
    - Instruct LLM to act as Software Architect
    - Focus on technical clarifying questions about implementation
    - Output format: JSON with schemaVersion: "1.0", message (explanation), openQuestions[] only
    - Questions should clarify technical details, dependencies, integration points
  - [x] 3.5 Add formatResolvedContext helper if needed
    - **File:** `gateway/src/services/implementationClarificationPrompt.ts`
    - Reuse or adapt formatResolvedContext from handoffPlanningPrompt.ts
    - Format architecture context for inclusion in prompt
  - [x] 3.6 Ensure SA prompt tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify prompt includes all required context

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Prompt template includes increment's proposedFinalSubFeatureDefinition as primary context
- Prompt includes work item and architecture context
- Output format instructs JSON with schemaVersion, message, openQuestions only
- SA persona focuses on technical implementation clarifications

---

### Gateway Route Handler

#### Task Group 4: Handle implementation_clarification Phase in Chat Route
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete chat route handler for implementation_clarification
  - [x] 4.1 Write 5-6 focused tests for implementation_clarification phase handling
    - **File:** `gateway/src/__tests__/implementationClarificationPhase.test.ts`
    - Test POST /chat with phase='implementation_clarification' routes to SA prompt
    - Test response includes implementerResponse field (not plannerResponse)
    - Test validateImplementerResponse is used for validation
    - Test incrementId is extracted from request and included in context
    - Test error handling returns valid fallback implementerResponse
    - Test SA system prompt receives activeIncrement data
  - [x] 4.2 Add implementation_clarification case to chat route
    - **File:** `gateway/src/routes/chat.ts`
    - Detect `phase === 'implementation_clarification'` in request handler
    - Extract incrementId from request body or context
  - [x] 4.3 Build SA system prompt for implementation_clarification phase
    - **File:** `gateway/src/routes/chat.ts`
    - Import buildImplementationClarificationPrompt from services
    - Retrieve active increment data based on incrementId
    - Call buildImplementationClarificationPrompt with increment, workItem, architectureContext
  - [x] 4.4 Validate response using implementerResponseValidator
    - **File:** `gateway/src/routes/chat.ts`
    - Import validateImplementerResponse from services
    - Validate LLM response using validateImplementerResponse
    - Handle validation errors with createFallbackImplementerResponse
  - [x] 4.5 Return implementerResponse in ChatResponse
    - **File:** `gateway/src/routes/chat.ts`
    - Set `implementerResponse` field in response (instead of plannerResponse)
    - Ensure response structure matches ChatResponse type
  - [x] 4.6 Ensure chat route tests pass
    - Run ONLY the 5-6 tests written in 4.1
    - Verify routing and response structure

**Acceptance Criteria:**
- The 5-6 tests written in 4.1 pass
- POST /chat with phase='implementation_clarification' routes to SA prompt
- Response includes implementerResponse field
- validateImplementerResponse is used for validation
- Error handling returns valid fallback structure

---

### Frontend Question Type Update

#### Task Group 5: Add incrementId to Question Type
**Dependencies:** None (can run in parallel with Gateway groups)

- [x] 5.0 Complete Question type update
  - [x] 5.1 Write 2-3 focused tests for Question type with incrementId
    - **File:** `frontend/src/__tests__/question-incrementId.test.ts`
    - Test Question interface accepts optional incrementId field
    - Test Question with source='Software Architect' can have incrementId set
    - Test Question with source='Product Owner' has incrementId as undefined
  - [x] 5.2 Add incrementId field to Question interface
    - **File:** `frontend/src/api/chatApi.ts`
    - Find Question interface (line ~279)
    - Add optional field: `incrementId?: string`
    - Document: "When source is 'Software Architect', stores which increment the question belongs to"
  - [x] 5.3 Ensure Question type tests pass
    - Run ONLY the 2-3 tests written in 5.1
    - Verify TypeScript compilation succeeds

**Acceptance Criteria:**
- The 2-3 tests written in 5.1 pass
- Question interface has optional incrementId field
- SA questions can store incrementId
- PO questions have incrementId as undefined/null

---

### Frontend Questions Filtering

#### Task Group 6: Filter Questions Table by Active Increment for SA Questions
**Dependencies:** Task Group 5

- [x] 6.0 Complete Questions filtering logic
  - [x] 6.1 Write 4-5 focused tests for SA questions filtering
    - **File:** `frontend/src/__tests__/questionsFiltering.sa.test.ts`
    - Test PO questions (no incrementId) are always displayed
    - Test SA questions with matching incrementId are displayed
    - Test SA questions with non-matching incrementId are hidden
    - Test filtering updates when activeIncrementId changes
    - Test deriveQuestions sets incrementId when source is 'Software Architect'
  - [x] 6.2 Update deriveQuestions to set incrementId
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - In deriveQuestions function, when transforming SA questions:
    - Set `incrementId: activeIncrementId` when source is 'Software Architect'
    - PO questions retain undefined incrementId
  - [x] 6.3 Add activeIncrementId prop to QuestionsTable (if not present)
    - **File:** `frontend/src/components/ProductView/QuestionsTable.tsx`
    - Add optional prop: `activeIncrementId?: string | null`
    - Pass from FeatureDefinitionPanel
  - [x] 6.4 Implement filtering logic in QuestionsTable
    - **File:** `frontend/src/components/ProductView/QuestionsTable.tsx`
    - Filter displayed questions:
      - Show all questions where source !== 'Software Architect' (PO questions)
      - Show SA questions only if `incrementId === activeIncrementId`
    - Apply filter before rendering table rows
  - [x] 6.5 Ensure questions filtering tests pass
    - Run ONLY the 4-5 tests written in 6.1
    - Verify filtering works correctly in all scenarios

**Acceptance Criteria:**
- The 4-5 tests written in 6.1 pass
- PO questions always displayed regardless of incrementId
- SA questions filtered by activeIncrementId match
- deriveQuestions sets incrementId for SA questions
- Filtering updates reactively when activeIncrementId changes

---

### Frontend Chat Persona Routing

#### Task Group 7: Route Chat to SA Persona Based on Phase
**Dependencies:** Task Group 1 (gateway phase support)

- [x] 7.0 Complete chat persona routing for SA
  - [x] 7.1 Write 3-4 focused tests for SA chat persona
    - **File:** `frontend/src/__tests__/chatPersona.sa.test.ts`
    - Test ChatBubble receives persona="Software Architect" when phase='implementation_clarification'
    - Test ChatBubble receives personaColor="purple" when phase='implementation_clarification'
    - Test PO phase messages retain persona="Product Owner" and personaColor="green"
    - Test persona switches correctly when phase changes
  - [x] 7.2 Update chat rendering logic for phase detection
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` or chat component
    - Detect current phase from context or state
    - Determine persona based on phase:
      - `'implementation_clarification'` -> persona="Software Architect", personaColor="purple"
      - Other phases -> existing persona logic
  - [x] 7.3 Pass correct persona props to ChatBubble
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` or chat component
    - For assistant messages, set persona and personaColor based on phase
    - ChatBubble already supports purple variant (personaPurple class in CSS)
  - [x] 7.4 Ensure chat persona tests pass
    - Run ONLY the 3-4 tests written in 7.1
    - Verify persona displays correctly in UI

**Acceptance Criteria:**
- The 3-4 tests written in 7.1 pass
- SA phase messages show persona="Software Architect"
- SA phase messages show purple persona color
- Persona switches correctly when phase changes
- ChatBubble purple styling already exists and is used

---

### IncrementCard Status Badge

#### Task Group 8: Add Clarification Status Badge to IncrementCard
**Dependencies:** None (can run in parallel)

- [x] 8.0 Complete IncrementCard status badge
  - [x] 8.1 Write 4-5 focused tests for clarification status badge
    - **File:** `frontend/src/__tests__/IncrementCard.clarificationStatus.test.ts`
    - Test clarificationStatus='In Clarification' shows orange/amber badge
    - Test clarificationStatus='Ready' shows green badge
    - Test clarificationStatus=null shows existing "Not Started" badge
    - Test badge text matches status value
    - Test badge styling applies correct color class
  - [x] 8.2 Add clarificationStatus prop to IncrementCard
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Add prop: `clarificationStatus?: 'In Clarification' | 'Ready' | null`
    - Prop is optional, defaults to null behavior
  - [x] 8.3 Update status badge rendering logic
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Replace hardcoded "Not Started" with dynamic status:
      - `'In Clarification'` -> display "In Clarification"
      - `'Ready'` -> display "Ready"
      - `null/undefined` -> display "Not Started" (existing behavior)
  - [x] 8.4 Add status badge color classes to CSS
    - **File:** `frontend/src/components/ProductView/IncrementCard.module.css`
    - Add `.statusBadgeInClarification` - orange/amber background (#FFA726 or similar)
    - Add `.statusBadgeReady` - green background (#66BB6A or similar)
    - Keep existing `.statusBadge` for "Not Started" (gray)
  - [x] 8.5 Apply correct badge class based on status
    - **File:** `frontend/src/components/ProductView/IncrementCard.tsx`
    - Conditionally apply badge class based on clarificationStatus value
    - Use template literals or classnames library for class composition
  - [x] 8.6 Ensure status badge tests pass
    - Run ONLY the 4-5 tests written in 8.1
    - Verify badge displays correctly for all status values

**Acceptance Criteria:**
- The 4-5 tests written in 8.1 pass
- 'In Clarification' shows orange/amber badge
- 'Ready' shows green badge
- null/undefined shows "Not Started" gray badge
- Badge text matches clarificationStatus prop value

---

### Answer Submission Wiring

#### Task Group 9: Wire "Answer Open Questions" to Send Answers to SA
**Dependencies:** Task Groups 4, 5, 6

- [x] 9.0 Complete answer submission wiring
  - [x] 9.1 Write 4-5 focused tests for answer submission to SA
    - **File:** `frontend/src/__tests__/answerSubmission.sa.test.ts`
    - Test onSubmitAnswers during implementation_clarification sends answers to chat API
    - Test message composed from answered questions (question + answer format)
    - Test request includes phase='implementation_clarification' and incrementId
    - Test SA response with openQuestions adds new Question rows
    - Test SA response with empty openQuestions marks increment as ready
  - [x] 9.2 Detect implementation_clarification phase in answer submission
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - In onSubmitAnswers handler, check current phase
    - If phase is 'implementation_clarification', route to SA handling
  - [x] 9.3 Compose user message from answered questions
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Format answered questions as user message:
      - "Q: [question text]\nA: [answer text]\n\n" for each answered question
    - Create properly formatted message for SA context
  - [x] 9.4 Send answers via chat API with incrementId context
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Build context with: `buildContext('normal_chat', 'implementation_clarification')`
    - Include incrementId in request context
    - Call postChatMessage with composed message and context
  - [x] 9.5 Handle SA response with new or empty questions
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - If response.implementerResponse.openQuestions has items: add as new Question rows
    - If response.implementerResponse.openQuestions is empty: update increment status to 'Ready'
  - [x] 9.6 Ensure answer submission tests pass
    - Run ONLY the 4-5 tests written in 9.1
    - Verify end-to-end answer flow works

**Acceptance Criteria:**
- The 4-5 tests written in 9.1 pass
- Answers sent via chat API with phase='implementation_clarification'
- incrementId included in request context
- SA response with questions adds new Question rows
- SA response with empty questions marks increment ready

---

### Auto-Trigger Integration

#### Task Group 10: Auto-Trigger SA Clarification After Plan Generation
**Dependencies:** Task Groups 4, 7, 8, 9

- [x] 10.0 Complete auto-trigger integration
  - [x] 10.1 Write 4-5 focused tests for auto-trigger
    - **File:** `frontend/src/__tests__/autoTrigger.saClarification.test.ts`
    - Test SA clarification auto-triggered after successful plan generation
    - Test first increment selected and phase set to 'implementation_clarification'
    - Test SA prompt receives first increment's proposedFinalSubFeatureDefinition
    - Test increment status set to 'In Clarification' on auto-trigger
    - Test SA questions added to Questions table for first increment
  - [x] 10.2 Add auto-trigger logic after plan generation
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - After successful generateImplementationPlan:
      1. Plan received and stored
      2. First increment selected (activeIncrementId set)
      3. Trigger SA clarification for first increment
  - [x] 10.3 Implement triggerSAClarification function
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Parameters: incrementId
    - Set phase to 'implementation_clarification'
    - Build context with increment data
    - Call postChatMessage with phase and increment context
    - Handle response: store implementerResponse, add questions
  - [x] 10.4 Set increment status to 'In Clarification' on trigger
    - **File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
    - Maintain incrementStatuses state: `Map<string, 'In Clarification' | 'Ready' | null>`
    - On triggerSAClarification: set status to 'In Clarification'
    - Pass status to IncrementCard via clarificationStatus prop
  - [x] 10.5 Ensure auto-trigger tests pass
    - Run ONLY the 4-5 tests written in 10.1
    - Verify end-to-end auto-trigger flow works

**Acceptance Criteria:**
- The 4-5 tests written in 10.1 pass
- SA clarification auto-triggered after plan generation
- First increment selected and phase set correctly
- Increment status set to 'In Clarification'
- SA questions added to Questions table

---

### Integration Testing

#### Task Group 11: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-10

- [x] 11.0 Review existing tests and fill critical gaps
  - [x] 11.1 Review tests from Task Groups 1-10
    - Review the 3-4 gateway type tests (Task 1.1) - 8 tests
    - Review the 5-6 validator tests (Task 2.1) - 11 tests
    - Review the 3-4 SA prompt tests (Task 3.1) - 7 tests
    - Review the 5-6 chat route tests (Task 4.1) - 12 tests
    - Review the 2-3 Question type tests (Task 5.1) - 4 tests
    - Review the 4-5 questions filtering tests (Task 6.1) - 7 tests
    - Review the 3-4 chat persona tests (Task 7.1) - 11 tests
    - Review the 4-5 status badge tests (Task 8.1) - 6 tests
    - Review the 4-5 answer submission tests (Task 9.1) - 20 tests
    - Review the 4-5 auto-trigger tests (Task 10.1) - 15 tests
    - Total existing tests: Gateway 38 + Frontend 63 = 101 tests
  - [x] 11.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/saHandoffIntegration.test.tsx` (NEW)
    - Identified critical end-to-end workflows lacking coverage
    - Focused ONLY on SA Handoff Per Increment feature
    - Prioritized user interaction flows across frontend
  - [x] 11.3 Write up to 10 additional strategic integration tests
    - Test end-to-end: plan generation -> auto-trigger SA -> questions displayed
    - Test end-to-end: answer questions -> submit to SA -> follow-up questions
    - Test end-to-end: answer questions -> submit to SA -> empty questions -> increment ready
    - Test switching active increment shows correct SA questions for that increment
    - Test PO questions remain visible regardless of active increment
    - Test purple persona displays for SA messages, blue for PO messages
    - Test status badge transitions: null -> "In Clarification" -> "Ready"
    - Test incrementId flows correctly through the system
    - Test error handling: null plan, empty increments, missing incrementId
    - **Added 10 integration test suites with 64 total tests**
  - [x] 11.4 Run feature-specific tests only
    - Run tests from: `chatTypes.implementerResponse.test.ts` - 8 tests passed
    - Run tests from: `implementerResponseValidator.test.ts` - 11 tests passed
    - Run tests from: `implementationClarificationPrompt.test.ts` - 7 tests passed
    - Run tests from: `implementationClarificationPhase.test.ts` - 12 tests passed
    - Run tests from: `question-incrementId.test.ts` - 4 tests passed
    - Run tests from: `questionsFiltering.sa.test.ts` - 7 tests passed
    - Run tests from: `chatPersona.sa.test.tsx` - 11 tests passed
    - Run tests from: `IncrementCard.clarificationStatus.test.tsx` - 6 tests passed
    - Run tests from: `answerSubmission.sa.test.ts` - 20 tests passed
    - Run tests from: `autoTrigger.saClarification.test.ts` - 15 tests passed
    - Run tests from: `saHandoffIntegration.test.tsx` - 64 tests passed
    - **Total: Gateway 38 tests + Frontend 127 tests = 165 tests, ALL PASSING**

**Acceptance Criteria:**
- All feature-specific tests pass (165 tests total)
- End-to-end user workflows validated across gateway and frontend
- Error handling verified (non-blocking)
- 10 integration test suites added (within limit)
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Type Definitions** - Foundation types for entire feature
2. **Task Group 3: Gateway SA Prompt** - Can run in parallel with Task Group 1 (independent)
3. **Task Group 2: Gateway Validator** - Depends on Task Group 1 (uses types)
4. **Task Group 4: Gateway Route Handler** - Depends on Task Groups 1, 2, 3 (integrates all gateway pieces)
5. **Task Group 5: Frontend Question Type Update** - Can run in parallel with Gateway groups
6. **Task Group 8: IncrementCard Status Badge** - Can run in parallel (independent UI component)
7. **Task Group 6: Frontend Questions Filtering** - Depends on Task Group 5
8. **Task Group 7: Frontend Chat Persona Routing** - Depends on Task Group 1 (gateway phase)
9. **Task Group 9: Answer Submission Wiring** - Depends on Task Groups 4, 5, 6
10. **Task Group 10: Auto-Trigger Integration** - Depends on Task Groups 4, 7, 8, 9
11. **Task Group 11: Integration Testing** - Final validation of all components

**Parallelization opportunities:**
- Task Groups 1, 3, 5, 8 can run in parallel (no dependencies between them)
- Task Group 2 waits for Task Group 1
- Task Group 4 waits for Task Groups 1, 2, 3
- Task Groups 6, 7 can run in parallel after their dependencies
- Task Group 9 waits for Task Groups 4, 5, 6
- Task Group 10 waits for Task Groups 4, 7, 8, 9
- Task Group 11 waits for all other groups

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `gateway/src/__tests__/chatTypes.implementerResponse.test.ts` | ImplementerResponse type tests |
| `gateway/src/__tests__/implementerResponseValidator.test.ts` | Validator tests |
| `gateway/src/__tests__/implementationClarificationPrompt.test.ts` | SA prompt tests |
| `gateway/src/__tests__/implementationClarificationPhase.test.ts` | Chat route handler tests |
| `gateway/src/services/implementerResponseValidator.ts` | ImplementerResponse validation |
| `gateway/src/services/implementationClarificationPrompt.ts` | SA system prompt template |
| `frontend/src/__tests__/question-incrementId.test.ts` | Question incrementId tests |
| `frontend/src/__tests__/questionsFiltering.sa.test.ts` | SA questions filtering tests |
| `frontend/src/__tests__/chatPersona.sa.test.tsx` | SA chat persona tests |
| `frontend/src/__tests__/IncrementCard.clarificationStatus.test.tsx` | Status badge tests |
| `frontend/src/__tests__/answerSubmission.sa.test.ts` | Answer submission tests |
| `frontend/src/__tests__/autoTrigger.saClarification.test.ts` | Auto-trigger tests |
| `frontend/src/__tests__/saHandoffIntegration.test.tsx` | Frontend integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Add 'implementation_clarification' to ImplementChatPhase; add ImplementerResponse type; add implementerResponse to ChatResponse |
| `gateway/src/services/plannerResponseValidator.ts` | Export extractJson and transformOpenQuestions for reuse |
| `gateway/src/routes/chat.ts` | Handle implementation_clarification phase; use SA prompt and validator |
| `frontend/src/api/chatApi.ts` | Add incrementId field to Question interface |
| `frontend/src/components/ProductView/QuestionsTable.tsx` | Add activeIncrementId prop; filter SA questions by incrementId |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Update deriveQuestions to set incrementId; handle answer submission for SA phase |
| `frontend/src/components/ProductView/IncrementCard.tsx` | Add clarificationStatus prop; update badge rendering |
| `frontend/src/components/ProductView/IncrementCard.module.css` | Add status badge color classes for In Clarification and Ready |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Add SA persona routing; add auto-trigger logic; manage increment statuses |
| `frontend/src/components/chat/ChatMessageList.tsx` | Add currentPhase prop; route persona based on phase |

---

## Key Implementation Notes

1. **Reuse plannerResponseValidator patterns** - extractJson and transformOpenQuestions should be exported and reused in implementerResponseValidator to maintain consistency
2. **ImplementerResponse is simpler** - Only schemaVersion, message, openQuestions; no featureUnderstanding, scope, assumptions, acceptanceCriteria, or implementationPlan
3. **ChatBubble already supports purple** - personaPurple class exists in ChatBubble.module.css; just pass correct props
4. **incrementId flows through entire stack** - From frontend context to gateway route to SA prompt and back in response
5. **Empty openQuestions signals "Ready"** - When SA returns empty questions array, increment status changes to 'Ready'
6. **One increment at a time** - SA clarification happens for active increment only; user manually selects next
7. **Status is in-memory only** - Increment clarification status not persisted to database in v1; session/memory only
8. **Filter logic** - PO questions always shown; SA questions filtered by incrementId === activeIncrementId

---

## Visual Design Reference

**IncrementCard Status Badge Colors:**
- "Not Started": Gray background (existing)
- "In Clarification": Orange/amber background (#FFA726 or similar)
- "Ready": Green background (#66BB6A or similar)

**Chat Persona Colors:**
- Product Owner: Blue (personaColor="blue")
- Software Architect: Purple (personaColor="purple")

**Questions Table Filtering:**
- Always show: questions with source !== 'Software Architect'
- Conditionally show: SA questions where incrementId === activeIncrementId

---

## Out of Scope

- Persisting increment clarification status to database (in-memory/session only for v1)
- SA asking questions across multiple increments simultaneously (one increment at a time)
- Editing or reordering increments after plan generation
- SA suggesting changes to the implementation plan itself
- Automatic progression to next increment (user must manually select)
- SA follow-up questions changing the increment's proposedFinalSubFeatureDefinition
- Integration with spec generation phase (separate future spec)
- SA persona in bootstrap or refine phases
- Timeout or auto-escalation if SA clarification takes too long
- Analytics or metrics on SA question counts or clarification duration
