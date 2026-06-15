# Specification: Questions System v1

## Goal
Enable structured question-and-answer workflow between the Planner LLM and the user by rendering open questions from `PlannerResponse.openQuestions` in a table, allowing inline answers, and submitting answered questions back to the chat conversation.

## User Stories
- As a user shaping a feature, I want to see the Planner's open questions in a dedicated table so that I can systematically address each clarification needed.
- As a user, I want to provide inline answers to questions and submit them in a single action so that the Planner can continue refining the feature definition.

## Specific Requirements

**Gateway: Update PlannerResponse.openQuestions Type**
- Change `openQuestions` from `string[]` to `OpenQuestion[]` where `OpenQuestion` is `{ id: string, question: string }`
- Gateway assigns UUID to each question using `uuid.v4()` when processing planner responses
- Update `plannerResponseValidator.ts` to transform raw string array into OpenQuestion array with generated IDs
- Existing validator logic for array validation remains unchanged; transformation happens post-validation
- Update `gateway/src/types/chat.ts` with new `OpenQuestion` interface

**Frontend: Question Type Definition**
- Create `Question` interface in `frontend/src/api/chatApi.ts` mirroring gateway `OpenQuestion`
- Add `status: 'Open' | 'Answered'` field (frontend-only, derived from answer presence)
- Add `answer: string` field for user-provided answers
- Add `source: 'Product Owner' | 'Software Architect'` field for future multi-role support (v1: always 'Product Owner')

**QuestionsTable Component**
- Renders questions in a flex/grid-based table layout (no dedicated table component exists in codebase)
- Columns: Question From?, Question, Answer, Status
- Positioned after the Acceptance Criteria section in FeatureDefinitionPanel
- Wrapped in FeatureSectionCard with title "Open Questions"
- Hidden when no questions exist (matches scopeIn/scopeOut pattern)

**QuestionsTableRow Component**
- Renders single row with: source label, question text, answer input field, status badge
- Answer field: inline text input (single line) with placeholder "Enter your answer..."
- Status derived: "Open" when answer is empty, "Answered" when answer is non-empty
- Answered questions rendered read-only with grayed-out styling (opacity: 0.6)
- Answer input disabled for Answered status questions

**Answer State Management**
- Local state managed within FeatureDefinitionPanel component
- State shape: `Map<string, string>` mapping question ID to answer text
- Initialize from incoming PlannerResponse questions (preserve existing answers across responses)
- Clear answers for question IDs no longer present in new response
- Merge new questions with preserved answers for existing IDs

**Answer Open Questions Button**
- Positioned below QuestionsTable within the FeatureSectionCard
- Button text: "Answer Open Questions"
- Enabled when: at least one Open question has non-empty answer text
- Disabled styling when no answerable questions
- On click: triggers answer submission handler

**Answer Submission Handler**
- Collect all questions with non-empty answers that have status "Open"
- Format as single chat message with role sections (per multi-role decision)
- Message format: "## Answers to Open Questions\n\n**Product Owner Questions:**\n- Q: {question}\n  A: {answer}\n..."
- Call `postChatMessage()` with `phase: 'refine'` and constructed message
- After successful response: answered questions transition to "Answered" status (via new response processing)

**Integration into FeatureDefinitionPanel**
- Add `onAnswerQuestions` callback prop for parent to handle submission
- Add `answers` and `onAnswerChange` props for controlled answer state
- Insert QuestionsTable after Acceptance Criteria section, before Assumptions
- Pass `plannerResponse.openQuestions` to QuestionsTable
- Questions section uses same visibility pattern as other optional sections

## Visual Design

**Questions Table Layout (ASCII)**
```
+----------------+----------------------------------+------------------+----------+
| Question From? | Question                         | Answer           | Status   |
+----------------+----------------------------------+------------------+----------+
| Product Owner  | What authentication method...    | [OAuth 2.0____]  | Answered |
| Product Owner  | Should we support bulk upload?   | [______________] | Open     |
| Product Owner  | What is the max file size?       | [10MB__________] | Answered |
+----------------+----------------------------------+------------------+----------+
                                          [ Answer Open Questions ]
```

**Responsive Behavior**
- Desktop (>1024px): 4-column layout with fixed widths for From/Status, flexible for Question/Answer
- Tablet (768-1024px): Stack Question/Answer vertically within row
- Mobile (<768px): Full vertical stack per question card

## Existing Code to Leverage

**FeatureSectionCard Component**
- Located at `frontend/src/components/ProductView/FeatureSectionCard.tsx`
- Provides card wrapper with title header and empty state support
- Re-use for "Open Questions" section with `isEmpty` and `emptyMessage` props
- Follow existing pattern of hiding section when data array is empty

**FeatureDefinitionPanel Structure**
- Located at `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx`
- Contains section ordering: Description, Understanding, Scope, Out of Scope, Acceptance Criteria, Assumptions
- Insert QuestionsTable between Acceptance Criteria and Assumptions sections
- Follow existing pattern of conditional rendering for optional sections

**PlannerResponse Type and Validation**
- Gateway type at `gateway/src/types/chat.ts` defines current `openQuestions: string[]`
- Validator at `gateway/src/services/plannerResponseValidator.ts` validates array structure
- Frontend type at `frontend/src/api/chatApi.ts` mirrors gateway definition
- UUID generation pattern: `import { v4 as uuidv4 } from 'uuid'` used throughout gateway

**postChatMessage and buildContext Pattern**
- `postChatMessage()` in `frontend/src/api/chatApi.ts` sends chat requests
- ImplementationAssistantPanel constructs context with `phase: 'refine'` for dialog
- Message submission follows existing chat dispatch pattern in ImplementationAssistantPanel

## Out of Scope
- Software Architect questions (future: implementer-originated questions) - v1 only supports Product Owner questions
- Question editing after submission - answered questions are immutable
- Question deletion or removal by user
- Persisting answers to disk (conversation persistence handles this implicitly via chat messages)
- Drag-and-drop question reordering
- Question priority or categorization
- Rich text or markdown in answers
- File attachments to answers
- Question threading or nested follow-ups
- Backend storage of question-answer pairs (stateless; derived from chat history)
