# Specification: Software Architect Handoff Per Increment

## Goal
Enable per-increment handoff to a Software Architect (SA) persona that clarifies technical implementation details before spec generation, auto-triggering when a plan is generated and tracking clarification status per increment.

## User Stories
- As a developer, I want the Software Architect to ask clarifying questions about each increment so that implementation specs are technically precise.
- As a developer, I want to see which increments are "In Clarification" vs "Ready" so that I know which need my attention.

## Specific Requirements

**Add 'implementation_clarification' phase to gateway**
- Extend `ImplementChatPhase` type in `gateway/src/types/chat.ts` to include `'implementation_clarification'`
- This phase is entered after plan generation, one increment at a time
- Chat requests in this phase route to Software Architect system prompt instead of Product Owner

**Create ImplementerResponse type**
- New type in `gateway/src/types/chat.ts` with fields: `schemaVersion: "1.0"`, `message: string`, `openQuestions: OpenQuestion[]`
- Simpler than PlannerResponse; no featureUnderstanding, scope, assumptions, acceptanceCriteria, or implementationPlan
- Uses existing `OpenQuestion` interface (id, question) for questions array

**Create implementerResponseValidator.ts**
- New file at `gateway/src/services/implementerResponseValidator.ts`
- Follow exact pattern from `plannerResponseValidator.ts`: extractJson, validateImplementerResponse, createFallbackImplementerResponse
- Validate schemaVersion is "1.0", message is non-empty string, openQuestions is array
- Transform string[] questions to OpenQuestion[] with UUID assignment (same as planner validator)

**Create Software Architect system prompt template**
- New file at `gateway/src/services/implementationClarificationPrompt.ts`
- Receives the active increment's `proposedFinalSubFeatureDefinition` as primary context
- Also receives work item context (title, type, description) and architecture context
- Instructs LLM to ask technical clarifying questions about the increment's implementation
- Output format: JSON with schemaVersion, message, openQuestions[] only

**Add incrementId to Question type (frontend)**
- Extend `Question` interface in `frontend/src/api/chatApi.ts` with optional `incrementId?: string`
- When source is 'Software Architect', incrementId stores which increment the question belongs to
- Product Owner questions have incrementId as undefined/null

**Filter Questions table by active increment for SA questions**
- In `QuestionsTable` or its parent, filter displayed questions: show PO questions always, show SA questions only if `incrementId === activeIncrementId`
- Derive questions in `FeatureDefinitionPanel` must pass incrementId when transforming SA questions

**Route chat to SA persona based on phase**
- In `gateway/src/routes/chat.ts`, detect `phase === 'implementation_clarification'`
- Build system prompt using new `buildImplementationClarificationPrompt` function
- Validate response using `validateImplementerResponse` instead of `validatePlannerResponse`
- Return `implementerResponse` field in `ChatResponse` (new field, parallel to `plannerResponse`)

**Show Software Architect persona in ChatBubble**
- When phase is 'implementation_clarification', assistant messages use persona="Software Architect" and personaColor="purple"
- ChatBubble component already supports purple variant; just need to pass correct props from chat rendering logic

**IncrementCard status badge**
- Modify `IncrementCard` component to accept new prop: `clarificationStatus?: 'In Clarification' | 'Ready' | null`
- When 'In Clarification': show orange/amber badge text
- When 'Ready': show green badge text
- When null/undefined: show existing "Not Started" badge
- Badge replaces current hardcoded "Not Started" text

**Wire "Answer Open Questions" button to send answers to SA**
- In `FeatureDefinitionPanel`, when `onSubmitAnswers` is called during implementation_clarification phase, compose user message from answered questions
- Send message via chat API with phase='implementation_clarification' and include incrementId context
- SA may respond with follow-up questions (new Question rows) or empty openQuestions (increment ready)

## Existing Code to Leverage

**plannerResponseValidator.ts**
- Located at `gateway/src/services/plannerResponseValidator.ts`
- Use `extractJson` function directly (export and reuse)
- Use `transformOpenQuestions` function to convert string[] to OpenQuestion[] with UUIDs
- Follow same validation pattern: extract JSON, parse, validate fields, return typed result or error

**ChatBubble.tsx**
- Located at `frontend/src/components/chat/ChatBubble.tsx`
- Already supports `persona` prop (string label) and `personaColor` prop ('green' | 'blue' | 'purple')
- Purple styling already implemented in `ChatBubble.module.css` as `personaPurple` class

**IncrementCard.tsx**
- Located at `frontend/src/components/ProductView/IncrementCard.tsx`
- Has existing `statusBadge` span element showing "Not Started"
- Has existing styles for card active/inactive states
- Add new CSS classes for clarification status colors

**Question interface and QuestionsTable**
- Question interface at `frontend/src/api/chatApi.ts` line 279
- QuestionsTable at `frontend/src/components/ProductView/QuestionsTable.tsx`
- `deriveQuestions` function in FeatureDefinitionPanel transforms OpenQuestion[] to Question[]

**handoffPlanningPrompt.ts**
- Located at `gateway/src/services/handoffPlanningPrompt.ts`
- Use as template for new SA prompt: same context injection pattern (workItem, architectureContext)
- Adapt `formatResolvedContext` helper for SA prompt if needed

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
