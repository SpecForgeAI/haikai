# Task Breakdown: Questions System v1

## Overview

**Spec ID:** 2026-01-23-questions-system-v1
**Total Tasks:** 32
**Estimated Effort:** Medium (Gateway + Frontend, TypeScript/React)

This implementation enables structured question-and-answer workflow between the Planner LLM and the user by rendering open questions in a table, allowing inline answers, and submitting answered questions back to the chat conversation.

---

## Task List

### Gateway Type Definitions Layer

#### Task Group 1: Gateway OpenQuestion Type and PlannerResponse Update
**Dependencies:** None

- [x] 1.0 Complete gateway type definitions
  - [x] 1.1 Write 3-4 focused tests for OpenQuestion type
    - **File:** `gateway/src/__tests__/open-question-types.test.ts`
    - Test OpenQuestion interface has `id: string` and `question: string` fields
    - Test PlannerResponse.openQuestions is `OpenQuestion[]` not `string[]`
    - Test OpenQuestion type validation accepts valid objects
    - Test OpenQuestion type validation rejects invalid shapes
  - [x] 1.2 Add OpenQuestion interface to chat.ts
    - **File:** `gateway/src/types/chat.ts`
    - Add `OpenQuestion` interface:
      - `id: string` (UUID)
      - `question: string`
    - Export the interface
  - [x] 1.3 Update PlannerResponse interface
    - **File:** `gateway/src/types/chat.ts`
    - Change `openQuestions: string[]` to `openQuestions: OpenQuestion[]`
  - [x] 1.4 Export OpenQuestion from types index
    - **File:** `gateway/src/types/index.ts`
    - Add export for `OpenQuestion`
  - [x] 1.5 Ensure gateway type definition tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 1.1 pass
- OpenQuestion interface is properly defined
- PlannerResponse.openQuestions type updated
- TypeScript compilation succeeds with new types

---

### Gateway UUID Assignment Layer

#### Task Group 2: UUID Generation in plannerResponseValidator
**Dependencies:** Task Group 1

- [x] 2.0 Complete UUID assignment for questions
  - [x] 2.1 Write 4-5 focused tests for UUID generation
    - **File:** `gateway/src/__tests__/planner-response-validator-uuid.test.ts`
    - Test `transformOpenQuestions` converts string array to OpenQuestion array
    - Test each transformed question has a valid UUID (v4 format)
    - Test each transformed question preserves original question text
    - Test empty array input returns empty array output
    - Test transformation happens post-validation (raw strings validated first)
  - [x] 2.2 Add uuid import to plannerResponseValidator.ts
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Add import: `import { v4 as uuidv4 } from 'uuid'`
  - [x] 2.3 Implement transformOpenQuestions helper function
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Function signature: `transformOpenQuestions(questions: string[]): OpenQuestion[]`
    - Map each string question to `{ id: uuidv4(), question: questionString }`
    - Return transformed array
  - [x] 2.4 Integrate transformation into validatePlannerResponse
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - After validating `openQuestions` is string array, call `transformOpenQuestions`
    - Assign transformed result to `plannerResponse.openQuestions`
    - Transformation happens post-validation, preserving existing validation logic
  - [x] 2.5 Update createFallbackPlannerResponse
    - **File:** `gateway/src/services/plannerResponseValidator.ts`
    - Ensure fallback response has `openQuestions: []` as `OpenQuestion[]` type
  - [x] 2.6 Ensure UUID generation tests pass
    - Run ONLY the 4-5 tests written in 2.1
    - Verify UUID generation works correctly
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-5 tests written in 2.1 pass
- String questions transformed to OpenQuestion objects with UUIDs
- Original question text preserved
- Validation logic unchanged (transformation is post-validation)
- Fallback response has correct OpenQuestion[] type

---

### Frontend Type Definitions Layer

#### Task Group 3: Frontend Question Type Definitions
**Dependencies:** Task Group 1 (type alignment)

- [x] 3.0 Complete frontend question type definitions
  - [x] 3.1 Write 3-4 focused tests for frontend Question type
    - **File:** `frontend/src/__tests__/question-types.test.ts`
    - Test Question interface has all required fields (id, question, status, answer, source)
    - Test status field accepts 'Open' | 'Answered' values
    - Test source field accepts 'Product Owner' | 'Software Architect' values
    - Test Question type aligns with gateway OpenQuestion (id, question fields)
  - [x] 3.2 Add Question interface to chatApi.ts
    - **File:** `frontend/src/api/chatApi.ts`
    - Add `Question` interface:
      - `id: string` (mirrors gateway OpenQuestion.id)
      - `question: string` (mirrors gateway OpenQuestion.question)
      - `status: 'Open' | 'Answered'` (frontend-only, derived)
      - `answer: string` (user-provided answer)
      - `source: 'Product Owner' | 'Software Architect'` (v1: always 'Product Owner')
  - [x] 3.3 Add OpenQuestion interface to chatApi.ts
    - **File:** `frontend/src/api/chatApi.ts`
    - Add `OpenQuestion` interface mirroring gateway:
      - `id: string`
      - `question: string`
    - This is the raw type from API responses
  - [x] 3.4 Update PlannerResponse interface in frontend
    - **File:** `frontend/src/api/chatApi.ts`
    - Change `openQuestions: string[]` to `openQuestions: OpenQuestion[]`
  - [x] 3.5 Ensure frontend type definition tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Question interface has all frontend-specific fields
- OpenQuestion interface mirrors gateway type
- PlannerResponse.openQuestions uses OpenQuestion[]
- TypeScript compilation succeeds

---

### QuestionsTableRow Component Layer

#### Task Group 4: QuestionsTableRow Component
**Dependencies:** Task Group 3

- [x] 4.0 Complete QuestionsTableRow component
  - [x] 4.1 Write 4-5 focused tests for QuestionsTableRow
    - **File:** `frontend/src/__tests__/QuestionsTableRow.test.tsx`
    - Test component renders source label, question text, answer input, and status badge
    - Test answer input calls onChange handler with question ID and new value
    - Test "Open" status displayed when answer is empty
    - Test "Answered" status displayed when answer is non-empty
    - Test answered questions rendered read-only with grayed-out styling (opacity: 0.6)
  - [x] 4.2 Create QuestionsTableRow component
    - **File:** `frontend/src/components/ProductView/QuestionsTableRow.tsx` (NEW)
    - Props interface:
      - `question: Question`
      - `onAnswerChange: (id: string, answer: string) => void`
    - Render row with four columns:
      - Source label (question.source)
      - Question text (question.question)
      - Answer input field (single line text input)
      - Status badge (derived from answer presence)
    - Answer input placeholder: "Enter your answer..."
    - Answer input disabled when status is "Answered"
  - [x] 4.3 Create QuestionsTableRow styles
    - **File:** `frontend/src/components/ProductView/QuestionsTableRow.module.css` (NEW)
    - Row styling:
      - Display: flex or grid for column layout
      - Padding: 12px 0
      - Border-bottom: 1px solid #E0E0E0
    - Answered row styling:
      - Opacity: 0.6
      - Input disabled styling
    - Status badge styling:
      - "Open": Orange/yellow background
      - "Answered": Green background
    - Answer input styling:
      - Border: 1px solid #CCC
      - Padding: 8px
      - Border-radius: 4px
  - [x] 4.4 Ensure QuestionsTableRow tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify component renders correctly in all states

**Acceptance Criteria:**
- The 4-5 tests written in 4.1 pass
- Component renders all four columns correctly
- Answer input triggers onChange with correct parameters
- Status derived correctly from answer presence
- Answered questions have read-only styling

---

### QuestionsTable Component Layer

#### Task Group 5: QuestionsTable Component with Button
**Dependencies:** Task Group 4

- [x] 5.0 Complete QuestionsTable component
  - [x] 5.1 Write 4-5 focused tests for QuestionsTable
    - **File:** `frontend/src/__tests__/QuestionsTable.test.tsx`
    - Test component renders header row with column labels
    - Test component renders QuestionsTableRow for each question
    - Test "Answer Open Questions" button enabled when at least one Open question has non-empty answer
    - Test "Answer Open Questions" button disabled when no answerable questions
    - Test button click triggers onSubmitAnswers callback
  - [x] 5.2 Create QuestionsTable component
    - **File:** `frontend/src/components/ProductView/QuestionsTable.tsx` (NEW)
    - Props interface:
      - `questions: Question[]`
      - `onAnswerChange: (id: string, answer: string) => void`
      - `onSubmitAnswers: () => void`
    - Render header row with columns: "Question From?", "Question", "Answer", "Status"
    - Map questions to QuestionsTableRow components
    - Render "Answer Open Questions" button below table
    - Button enabled logic: `questions.some(q => q.status === 'Open' && q.answer.trim() !== '')`
  - [x] 5.3 Create QuestionsTable styles
    - **File:** `frontend/src/components/ProductView/QuestionsTable.module.css` (NEW)
    - Table container styling:
      - Width: 100%
      - Border-collapse: separate
    - Header row styling:
      - Font-weight: semi-bold
      - Background: #F5F5F5
      - Border-bottom: 2px solid #DDD
    - Column width distribution:
      - Question From?: 120px (fixed)
      - Question: flexible (expand)
      - Answer: flexible (expand)
      - Status: 100px (fixed)
    - Button styling:
      - Margin-top: 16px
      - Align: right
      - Primary button style (blue background)
      - Disabled: muted styling
  - [x] 5.4 Ensure QuestionsTable tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify table renders correctly with all rows

**Acceptance Criteria:**
- The 4-5 tests written in 5.1 pass
- Header row displays column labels
- Rows render for each question
- Button enabled/disabled logic works correctly
- Button click triggers callback

---

### FeatureDefinitionPanel Integration Layer

#### Task Group 6: FeatureDefinitionPanel Integration and State Management
**Dependencies:** Task Groups 3, 5

- [x] 6.0 Complete FeatureDefinitionPanel questions integration
  - [x] 6.1 Write 5-6 focused tests for panel integration
    - **File:** `frontend/src/__tests__/FeatureDefinitionPanel.questions.test.tsx`
    - Test QuestionsTable rendered after Acceptance Criteria section
    - Test Questions section hidden when no questions exist
    - Test answer state updates when user types in answer field
    - Test answers preserved for existing question IDs when new response received
    - Test answers cleared for question IDs no longer present in new response
    - Test onAnswerQuestions callback triggered with correct message format
  - [x] 6.2 Add answer state management to FeatureDefinitionPanel
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add state: `const [answers, setAnswers] = useState<Map<string, string>>(new Map())`
    - Add `handleAnswerChange` function: `(id: string, answer: string) => void`
    - Update map immutably: `setAnswers(prev => new Map(prev).set(id, answer))`
  - [x] 6.3 Add props for questions callback
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add to props interface:
      - `onAnswerQuestions?: (message: string) => void`
    - Wire callback to QuestionsTable onSubmitAnswers
  - [x] 6.4 Implement answer synchronization with plannerResponse
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Add useEffect to sync answers with incoming plannerResponse.openQuestions:
      - Preserve existing answers for question IDs still present
      - Clear answers for question IDs no longer present
      - Initialize new questions with empty answers
    - Use question.id as key for Map
  - [x] 6.5 Implement handleSubmitAnswers function
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Collect all questions with non-empty answers and status "Open"
    - Format message: `"## Answers to Open Questions\n\n**Product Owner Questions:**\n- Q: {question}\n  A: {answer}\n..."`
    - Call `onAnswerQuestions(formattedMessage)` if provided
  - [x] 6.6 Derive Question objects from OpenQuestion and answers
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Transform `plannerResponse.openQuestions` (OpenQuestion[]) to `Question[]`:
      - `id`: from OpenQuestion.id
      - `question`: from OpenQuestion.question
      - `answer`: from answers Map (or empty string)
      - `status`: 'Answered' if answer non-empty, else 'Open'
      - `source`: 'Product Owner' (v1 default)
  - [x] 6.7 Insert QuestionsTable into panel layout
    - **File:** `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
    - Import QuestionsTable component
    - Add Questions section after Acceptance Criteria, before Assumptions
    - Wrap in FeatureSectionCard with title "Open Questions"
    - Use `isEmpty` prop to hide when no questions
    - Pass derived Question[] to QuestionsTable
  - [x] 6.8 Ensure panel integration tests pass
    - Run ONLY the 5-6 tests written in 6.1
    - Verify questions section renders and functions correctly

**Acceptance Criteria:**
- The 5-6 tests written in 6.1 pass
- QuestionsTable appears after Acceptance Criteria
- Questions section hidden when empty
- Answer state managed locally
- Answers preserved across response updates
- Message formatted correctly for submission

---

### Responsive Design Layer

#### Task Group 7: Responsive Design for Questions Table
**Dependencies:** Task Groups 4, 5

- [x] 7.0 Complete responsive design for questions
  - [x] 7.1 Write 3-4 focused tests for responsive behavior
    - **File:** `frontend/src/__tests__/QuestionsTable.responsive.test.tsx`
    - Test desktop layout (>1024px): 4-column layout
    - Test tablet layout (768-1024px): Question/Answer stacked vertically within row
    - Test mobile layout (<768px): Full vertical stack per question card
    - Test all layouts maintain functionality (input, button, status)
  - [x] 7.2 Update QuestionsTableRow responsive styles
    - **File:** `frontend/src/components/ProductView/QuestionsTableRow.module.css`
    - Desktop (>1024px):
      - Grid columns: 120px 1fr 1fr 100px
      - All columns in single row
    - Tablet (768-1024px):
      - Grid columns: 120px 1fr 100px
      - Question in first row
      - Answer below question, spanning column
    - Mobile (<768px):
      - Stack all fields vertically
      - Card-like appearance with background
      - Full-width answer input
  - [x] 7.3 Update QuestionsTable responsive styles
    - **File:** `frontend/src/components/ProductView/QuestionsTable.module.css`
    - Desktop: Show header row with column labels
    - Tablet: Adjust header row for stacked layout
    - Mobile: Hide header row (labels inline in cards instead)
    - Button: Full-width on mobile
  - [x] 7.4 Ensure responsive tests pass
    - Run ONLY the 3-4 tests written in 7.1
    - Test using viewport simulation in tests

**Acceptance Criteria:**
- The 3-4 tests written in 7.1 pass
- Desktop displays 4-column layout
- Tablet stacks Question/Answer vertically
- Mobile shows full card-based layout
- All breakpoints maintain functionality

---

### Integration Testing

#### Task Group 8: Integration Testing and Gap Analysis
**Dependencies:** Task Groups 1-7

- [x] 8.0 Review existing tests and fill critical gaps
  - [x] 8.1 Review tests from Task Groups 1-7
    - Review the 3-4 gateway type tests (Task 1.1)
    - Review the 4-5 UUID generation tests (Task 2.1)
    - Review the 3-4 frontend type tests (Task 3.1)
    - Review the 4-5 QuestionsTableRow tests (Task 4.1)
    - Review the 4-5 QuestionsTable tests (Task 5.1)
    - Review the 5-6 panel integration tests (Task 6.1)
    - Review the 3-4 responsive tests (Task 7.1)
    - Total existing tests: approximately 26-33 tests
  - [x] 8.2 Analyze test coverage gaps for this feature only
    - **File:** `frontend/src/__tests__/questions-system-integration.test.tsx` (NEW)
    - Identify critical end-to-end workflows lacking coverage
    - Focus ONLY on Questions System feature
    - Prioritize user interaction flows
  - [x] 8.3 Write up to 8 additional strategic integration tests
    - Test end-to-end flow: plannerResponse with questions -> render table -> user enters answer -> submit
    - Test gateway UUID generation produces unique IDs for each question
    - Test answer preservation: new response with same question IDs keeps existing answers
    - Test answer clearing: new response without question ID removes that answer
    - Test submit button formats message correctly with all answered questions
    - Test submit triggers chat message post with correct phase
    - Test empty questions array hides entire section
    - Test multiple questions can be answered and submitted together
  - [x] 8.4 Run feature-specific tests only
    - Run tests from: `open-question-types.test.ts` (gateway)
    - Run tests from: `planner-response-validator-uuid.test.ts` (gateway)
    - Run tests from: `question-types.test.ts` (frontend)
    - Run tests from: `QuestionsTableRow.test.tsx`
    - Run tests from: `QuestionsTable.test.tsx`
    - Run tests from: `FeatureDefinitionPanel.questions.test.tsx`
    - Run tests from: `QuestionsTable.responsive.test.tsx`
    - Run tests from: `questions-system-integration.test.tsx`
    - Expected total: approximately 34-41 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 34-41 tests total)
- End-to-end user workflows validated
- Gateway and frontend integration tested
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Gateway Type Definitions** - Foundation types required by gateway validator
2. **Task Group 2: Gateway UUID Assignment** - Depends on Task Group 1
3. **Task Group 3: Frontend Type Definitions** - Can start after Task Group 1 (type alignment)
4. **Task Group 4: QuestionsTableRow Component** - Depends on Task Group 3
5. **Task Group 5: QuestionsTable Component** - Depends on Task Group 4
6. **Task Group 6: FeatureDefinitionPanel Integration** - Depends on Task Groups 3, 5
7. **Task Group 7: Responsive Design** - Depends on Task Groups 4, 5 (can parallel with 6)
8. **Task Group 8: Integration Testing** - Final validation of all components

**Parallelization opportunities:**
- Task Groups 3 and 2 can run in parallel (after Task Group 1)
- Task Group 7 can run in parallel with Task Group 6 (both depend on 4, 5)

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `gateway/src/__tests__/open-question-types.test.ts` | Gateway OpenQuestion type tests |
| `gateway/src/__tests__/planner-response-validator-uuid.test.ts` | UUID generation tests |
| `frontend/src/__tests__/question-types.test.ts` | Frontend Question type tests |
| `frontend/src/components/ProductView/QuestionsTableRow.tsx` | Individual question row component |
| `frontend/src/components/ProductView/QuestionsTableRow.module.css` | QuestionsTableRow styles |
| `frontend/src/components/ProductView/QuestionsTable.tsx` | Questions table container with button |
| `frontend/src/components/ProductView/QuestionsTable.module.css` | QuestionsTable styles |
| `frontend/src/__tests__/QuestionsTableRow.test.tsx` | QuestionsTableRow unit tests |
| `frontend/src/__tests__/QuestionsTable.test.tsx` | QuestionsTable unit tests |
| `frontend/src/__tests__/FeatureDefinitionPanel.questions.test.tsx` | Panel questions integration tests |
| `frontend/src/__tests__/QuestionsTable.responsive.test.tsx` | Responsive design tests |
| `frontend/src/__tests__/questions-system-integration.test.tsx` | End-to-end integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Add OpenQuestion interface, update PlannerResponse.openQuestions type |
| `gateway/src/types/index.ts` | Export OpenQuestion |
| `gateway/src/services/plannerResponseValidator.ts` | Add uuid import, transformOpenQuestions function, integrate transformation |
| `frontend/src/api/chatApi.ts` | Add Question interface, OpenQuestion interface, update PlannerResponse |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Add answer state, QuestionsTable integration, submission handler |

---

## Key Implementation Notes

1. **UUID Generation Location** - UUIDs assigned in gateway, not frontend, ensuring consistency
2. **Type Separation** - OpenQuestion (API) vs Question (frontend with derived fields)
3. **Status Derivation** - Status is derived from answer presence, not stored
4. **State Locality** - Answer state managed in FeatureDefinitionPanel, not global
5. **Answer Preservation** - Use question.id as key to preserve answers across response updates
6. **Message Format** - Follow spec format with role sections for future multi-role support
7. **Section Visibility** - Follow existing pattern of hiding sections when data is empty

---

## Risk Mitigation

1. **Type Alignment** - Ensure frontend OpenQuestion matches gateway exactly
2. **UUID Uniqueness** - Use uuid v4 for cryptographically random IDs
3. **State Synchronization** - Carefully handle answer map updates when questions change
4. **Responsive Testing** - Test actual viewport sizes, not just CSS media queries
5. **Accessibility** - Ensure answer inputs have proper labels and ARIA attributes

---

## Out of Scope

- Software Architect questions (future multi-role support)
- Question editing after submission (answered questions are immutable)
- Question deletion or removal by user
- Persisting answers to disk (handled implicitly via chat messages)
- Drag-and-drop question reordering
- Question priority or categorization
- Rich text or markdown in answers
- File attachments to answers
- Question threading or nested follow-ups
- Backend storage of question-answer pairs (stateless; derived from chat history)
