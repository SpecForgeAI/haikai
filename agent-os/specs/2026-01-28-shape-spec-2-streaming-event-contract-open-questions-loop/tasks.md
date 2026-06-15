# Task Breakdown: Shape-Spec 2 - Streaming Event Contract + Open Questions Loop

## Overview
Total Tasks: 32 tasks across 5 task groups

This spec extends the Shape-Spec streaming integration to handle `{type:"questions"}` and `{type:"folder"}` SSE events, populate the Open Questions table with streamed questions, and enable the Q&A continuation loop until no further questions are returned.

## Task List

### Event Handling Layer

#### Task Group 1: Extend useShapeSpecStream Hook for New Event Types
**Dependencies:** None

- [x] 1.0 Complete event handling layer extensions
  - [x] 1.1 Write 4-6 focused tests for new SSE event type handling
    - Test parsing of `{type:"questions", questions:[{id, question},...]}` event
    - Test parsing of `{type:"folder", folder:"<name>"}` event
    - Test that `onQuestions` callback is invoked with parsed questions
    - Test that `onFolder` callback is invoked with folder value
    - Test that unknown event types are ignored (existing behavior)
    - Test that continuation calls work without sessionMode
  - [x] 1.2 Add `QuestionsEvent` interface to `useShapeSpecStream.ts`
    - Add interface: `{ type: 'questions'; questions: Array<{ id: string; question: string }> }`
    - Location: After existing `DoneEvent` interface (line ~40)
  - [x] 1.3 Add `FolderEvent` interface to `useShapeSpecStream.ts`
    - Add interface: `{ type: 'folder'; folder: string }`
    - Location: After new `QuestionsEvent` interface
  - [x] 1.4 Extend `ShapeSpecStreamEvent` union type
    - Update union type to include: `QuestionsEvent | FolderEvent`
    - Location: Line ~45 in `useShapeSpecStream.ts`
  - [x] 1.5 Add optional `onQuestions` and `onFolder` callbacks to `ShapeSpecStreamParams`
    - Add: `onQuestions?: (questions: Array<{ id: string; question: string }>) => void`
    - Add: `onFolder?: (folder: string) => void`
    - Location: After `onError` in `ShapeSpecStreamParams` interface (line ~68)
  - [x] 1.6 Make `sessionMode` optional in `ShapeSpecStreamParams`
    - Change: `sessionMode: 'new'` to `sessionMode?: 'new'`
    - This allows continuation calls to omit the field entirely
  - [x] 1.7 Update `processEvent()` to route new event types
    - Add `case 'questions':` that invokes `onQuestions` callback if provided
    - Add `case 'folder':` that invokes `onFolder` callback if provided
    - Modify function signature to accept `onQuestions` and `onFolder` in callbacks parameter
  - [x] 1.8 Update `startStream()` to conditionally include `session_mode`
    - Only include `session_mode` in request body when `sessionMode` is provided
    - Use object spread/conditional to exclude field when undefined
  - [x] 1.9 Ensure event handling tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all new event types are parsed and routed correctly

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `QuestionsEvent` and `FolderEvent` interfaces are exported
- `processEvent()` correctly routes questions and folder events to callbacks
- `sessionMode` can be omitted for continuation calls
- Request body omits `session_mode` field when `sessionMode` is undefined

**Files to Modify:**
- `frontend/src/hooks/useShapeSpecStream.ts`
- `frontend/src/hooks/useShapeSpecStream.test.ts`

---

### API Layer

#### Task Group 2: Update shapeSpecApi.ts Request Interface
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 2.0 Complete API layer updates
  - [x] 2.1 Write 2 focused tests for API request handling
    - Test that request with `session_mode` includes the field
    - Test that request without `session_mode` omits the field entirely (not null/undefined)
  - [x] 2.2 Make `session_mode` optional in `ShapeSpecStreamRequest` interface
    - Change: `session_mode: 'new'` to `session_mode?: 'new'`
    - Location: `frontend/src/api/shapeSpecApi.ts` line ~50
  - [x] 2.3 Ensure API tests pass
    - Run ONLY the 2 tests written in 2.1
    - Verify request serialization is correct for both cases

**Acceptance Criteria:**
- The 2 tests written in 2.1 pass
- `ShapeSpecStreamRequest` allows optional `session_mode`
- Continuation requests serialize correctly without `session_mode` field

**Files to Modify:**
- `frontend/src/api/shapeSpecApi.ts`
- `frontend/src/api/shapeSpecApi.test.ts`

---

### State Management Layer

#### Task Group 3: Add Streamed Questions and Folder State to ImplementationAssistantPanel
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete state management additions
  - [x] 3.1 Write 4-6 focused tests for state management
    - Test that `streamedQuestions` is populated when `onQuestions` callback fires
    - Test that `latestFolder` is updated when `onFolder` callback fires
    - Test that `streamedQuestions` is cleared when stream completes with no questions
    - Test that `streamedQuestions` replaces (not merges) on each new questions event
    - Test derived Question[] fields (status: 'Open', answer: '', source: 'Software Architect')
  - [x] 3.2 Add `streamedQuestions` state variable
    - Type: `Question[]` (import from `chatApi.ts`)
    - Initial value: `[]`
    - Location: After `streamedContentRef` (line ~335)
  - [x] 3.3 Add `latestFolder` state variable
    - Type: `string | null`
    - Initial value: `null`
    - Location: After `streamedQuestions`
  - [x] 3.4 Add `receivedQuestionsInTurn` ref to track if questions were received
    - Type: `useRef<boolean>(false)`
    - Reset to `false` when stream starts
    - Set to `true` when questions event received
    - Used by `onDone` to determine if questions should be cleared
  - [x] 3.5 Create `handleQuestionsEvent` callback
    - Accepts: `questions: Array<{ id: string; question: string }>`
    - Maps each to `Question` type with derived fields:
      - `id`: from stream
      - `question`: from stream
      - `status`: `'Open'`
      - `answer`: `''`
      - `source`: `'Software Architect'`
      - `incrementId`: `undefined`
    - Replaces `streamedQuestions` state entirely (not merge)
    - Sets `receivedQuestionsInTurn.current = true`
  - [x] 3.6 Create `handleFolderEvent` callback
    - Accepts: `folder: string`
    - Updates `latestFolder` state
    - Overwrites previous value (no merge)
  - [x] 3.7 Update `startShapeSpecStreamCallback` to pass new callbacks
    - Add `onQuestions: handleQuestionsEvent` to `startStream()` call
    - Add `onFolder: handleFolderEvent` to `startStream()` call
  - [x] 3.8 Update `onDone` callback in `startShapeSpecStreamCallback`
    - Check `receivedQuestionsInTurn.current`
    - If `false` (no questions this turn), clear `streamedQuestions` to `[]`
    - Reset `receivedQuestionsInTurn.current = false`
  - [x] 3.9 Reset state on workItemId change
    - Add `streamedQuestions` reset to `[]` in hydration useEffect
    - Add `latestFolder` reset to `null` in hydration useEffect
  - [x] 3.10 Ensure state management tests pass
    - Run ONLY the 4-6 tests written in 3.1
    - Verify state transitions work correctly

**Acceptance Criteria:**
- The 4-6 tests written in 3.1 pass
- `streamedQuestions` state is separate from `latestPlannerResponse.openQuestions`
- Questions are correctly derived with `source: 'Software Architect'`
- `latestFolder` persists across stream turns but resets on workItem change
- Stream completion with no questions clears the questions table

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- `frontend/src/components/ProductView/ImplementationAssistantPanel.test.tsx`

---

### UI Integration Layer

#### Task Group 4: Integrate Streamed Questions with QuestionsTable and Answer Flow
**Dependencies:** Task Group 3

- [x] 4.0 Complete UI integration
  - [x] 4.1 Write 5-7 focused tests for UI integration
    - Test that QuestionsTable receives `streamedQuestions` as data source during SA phase
    - Test "Answer Open Questions" button enables when all streamedQuestions have answers
    - Test "Answer Open Questions" button disables during active stream
    - Test answer submission composes correct continuation message
    - Test continuation call omits `sessionMode`
    - Test continuation response replaces questions table content
    - Test loop terminates when no questions returned
  - [x] 4.2 Add `streamedAnswers` state for tracking answers to streamed questions
    - Type: `Record<string, string>` (questionId -> answer)
    - Initial value: `{}`
    - Reset when `streamedQuestions` changes (new questions replace old answers)
  - [x] 4.3 Create `handleStreamedAnswerChange` callback
    - Accepts: `(id: string, answer: string) => void`
    - Updates `streamedAnswers[id]` with new answer value
  - [x] 4.4 Create `handleAnswerStreamedQuestions` callback for continuation flow
    - Compose message string with all Q/A pairs in LLM-readable format:
      ```
      Answers to your questions:

      Q: [question text]
      A: [answer text]

      Q: [question text]
      A: [answer text]
      ```
    - Reset `receivedQuestionsInTurn.current = false`
    - Call `startStream()` with:
      - `company`: from `activeProject.organisationId` lookup (same as initial)
      - `project`: from `activeProject.name`
      - `message`: composed Q/A message
      - `sessionMode`: **omitted** (undefined) for continuation
      - `onContent`, `onDone`, `onError`, `onQuestions`, `onFolder`: same callbacks
  - [x] 4.5 Compute button enable/disable state for "Answer Open Questions"
    - Enable when:
      - `streamedQuestions.length > 0` AND
      - All questions have non-empty answers AND
      - `!isStreaming`
    - Create computed variable: `canAnswerStreamedQuestions`
  - [x] 4.6 Update FeatureDefinitionPanel to pass streamed questions to QuestionsTable
    - Add prop: `streamedQuestions: Question[]`
    - Add prop: `streamedAnswers: Record<string, string>`
    - Add prop: `onStreamedAnswerChange: (id: string, answer: string) => void`
    - Add prop: `onSubmitStreamedAnswers: () => void`
    - Add prop: `isStreamedQuestionsSubmitting: boolean` (same as `isStreaming`)
    - Add prop: `canAnswerStreamedQuestions: boolean`
  - [x] 4.7 Update FeatureDefinitionPanel to render QuestionsTable for streamed questions
    - When `streamedQuestions.length > 0`, render QuestionsTable with:
      - `questions`: `streamedQuestions` with answers merged from `streamedAnswers`
      - `onAnswerChange`: `onStreamedAnswerChange`
      - `onSubmitAnswers`: `onSubmitStreamedAnswers`
      - `isSubmitting`: `isStreamedQuestionsSubmitting`
    - May need conditional rendering or separate section for SA questions
  - [x] 4.8 Update `onDone` to clear `streamedAnswers` when no questions returned
    - If `receivedQuestionsInTurn.current === false`, also reset `streamedAnswers` to `{}`
  - [x] 4.9 Ensure UI integration tests pass
    - Run ONLY the 5-7 tests written in 4.1
    - Verify full Q&A loop works end-to-end

**Acceptance Criteria:**
- The 5-7 tests written in 4.1 pass
- Streamed questions appear in QuestionsTable during SA phase
- "Answer Open Questions" button correctly enables/disables
- Continuation calls work without session_mode
- Q&A loop terminates correctly when no questions returned

**Files to Modify:**
- `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`
- `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` (if needed for QuestionsTable rendering)

---

### Error Handling & Testing

#### Task Group 5: Error Handling and Test Coverage Review
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete error handling and test review
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4-6 tests from Task Group 1 (event handling)
    - Review the 2 tests from Task Group 2 (API layer)
    - Review the 4-6 tests from Task Group 3 (state management)
    - Review the 5-7 tests from Task Group 4 (UI integration)
    - Total existing tests: approximately 15-21 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical user workflows lacking coverage
    - Focus on edge cases in the Q&A loop flow
    - Check error recovery paths
  - [x] 5.3 Verify error handling in `startShapeSpecStreamCallback`
    - Ensure `onError` callback resets streaming state
    - Verify error message appears in chat (existing pattern)
    - Confirm user can manually retry after error
  - [x] 5.4 Verify error handling in `handleAnswerStreamedQuestions`
    - Same error handling pattern as initial stream
    - Reset streaming state on error
    - Show error in chat
  - [x] 5.5 Add up to 5 additional tests if gaps identified
    - Focus on error recovery scenarios
    - Focus on edge cases (empty questions array, malformed events)
    - Focus on state consistency across stream turns
  - [x] 5.6 Run all feature-specific tests
    - Run all tests from groups 1-4 plus any new tests from 5.5
    - Expected total: approximately 20-26 tests
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 20-26 tests)
- Error handling follows existing patterns
- Streaming state resets correctly on error
- User can retry after error

**Files to Modify:**
- Test files for the components modified in Task Groups 1-4

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Extend useShapeSpecStream Hook** - Event parsing foundation
2. **Task Group 2: Update shapeSpecApi.ts** - API contract update (can run parallel with 1)
3. **Task Group 3: Add State Management** - State variables and callbacks
4. **Task Group 4: UI Integration** - Wire up QuestionsTable and button logic
5. **Task Group 5: Error Handling & Testing** - Review and fill gaps

### Parallel Execution Opportunities
- Task Group 1 and Task Group 2 can run in parallel (no dependencies on each other)

### Key File References

| File | Task Groups |
|------|-------------|
| `frontend/src/hooks/useShapeSpecStream.ts` | 1 |
| `frontend/src/api/shapeSpecApi.ts` | 2 |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | 3, 4 |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | 4 |
| `frontend/src/api/chatApi.ts` | Reference only (Question interface) |
| `frontend/src/components/ProductView/QuestionsTable.tsx` | Reference only (no changes needed) |

### Out of Scope Reminders
- No orchestration triggering
- No backend persistence of questions/answers/folder
- No auto-retry on errors
- No changes to planner flows
- No tab reload persistence of folder/questions
