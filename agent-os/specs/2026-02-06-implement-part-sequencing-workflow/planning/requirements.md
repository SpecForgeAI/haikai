# Spec Requirements: Implement-Part Sequencing Workflow

## Initial Description

**Title:** Implement-part sequencing workflow (Planner split -> per-part shape-spec Q&A -> async orchestration jobs)

**Intent:** Add an explicit "split into parts" handoff workflow where the Planner LLM signals it has no more questions and provides X implementation parts. The UI then processes parts sequentially: for each part, send details to shape-spec/stream, collect Q&A, call orchestration job, poll until complete, then advance to next part.

## Codebase Findings

### Existing Architecture Analysis

#### 1. Current Planner LLM Integration (Gateway)

**Location:** `gateway/src/routes/chat.ts`, `gateway/src/services/plannerResponseValidator.ts`

The current system has:
- `PlannerResponse` interface with `implementationPlan` field containing `Increment[]`
- `Increment` interface with: `id`, `title`, `shortDescription`, `status`, `proposedFinalSubFeatureDefinition`
- Validation via `validatePlannerResponse()` during `refine` and `implementation_planning` phases
- `ChatResponse` returns `plannerResponse` field with structured shaping output

**Key observation:** The existing `ImplementationPlan.increments` is similar to the proposed "parts" but currently has `status: 'NOT_STARTED'` as the only status value. The new spec requires extending this to support per-part lifecycle states.

#### 2. Current Shape-Spec Streaming (POST /api/v1/shape-spec/stream)

**Location:** `gateway/src/routes/shapeSpec.ts`, `frontend/src/hooks/useShapeSpecStream.ts`, `frontend/src/api/shapeSpecApi.ts`

Current pattern:
- Frontend calls `useShapeSpecStream` hook which sends POST to `/api/v1/shape-spec/stream`
- Request body: `{ company, project, message, session_mode?: 'new' }`
- SSE events: `skill_invoked`, `content`, `questions`, `folder`, `done`
- Gateway proxies via `implementationLlmProxyClient` with server-side Bearer token injection
- Continuation calls omit `session_mode` to use existing session context

**Key observation:** Current flow starts ONE shape-spec session and allows Q&A continuation. New spec requires starting a NEW session per part (`session_mode="new"`) with structured message payload containing PART delimiters.

#### 3. Current Orchestration Job API

**Location:** `gateway/src/routes/orchestrations.ts`, `frontend/src/api/orchestrationApi.ts`

Current endpoints:
- `POST /api/orchestrations/execute` - Executes orchestration with `handoff_intents`
- `POST /api/v1/orchestrations` - Proxy route to upstream Orchestrations Service

Request format:
```typescript
interface StartOrchestrationRequest {
  company: string;
  project: string;
  spec_intents: string[];
  options?: OrchestrationOptions;
}
```

**Key observation:** Current pattern is fire-and-forget (or immediate response). The user's spec describes a job-based pattern with:
- `POST /api/v1/jobs/orchestrations` - Create job
- `GET /api/v1/jobs/{job_id}` - Poll for status

This represents a NEW API pattern not currently implemented in the gateway.

#### 4. Current Implement Context Storage (DB-Backed)

**Location:** `gateway/src/services/transcriptStore.ts`, `gateway/src/services/transcriptWriter.ts`

Current storage:
- In-memory `transcriptStore` with `ConversationTranscript` containing `TranscriptEntry[]`
- Each entry has: `timestamp`, `phase`, `role`, `content`
- Roles: `SYSTEM`, `USER`, `ASSISTANT`, `PLANNER_HANDOFF`, `ORCHESTRATION`
- Phases: `bootstrap`, `refine`, `handoff`, `implementation_planning`, `implementation_clarification`
- Transcripts written to disk via `writeTranscriptToFile()`

**Key observation:** Current storage is session-scoped and chat-turn-based. The new spec requires:
- Storing `current_split_plan` with parts array
- Per-part status tracking and timestamps
- Per-part transcript separation
- Per-part job_id association

#### 5. Current ImplementationAssistantPanel Frontend

**Location:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

Key state variables:
- `latestPlannerResponse: PlannerResponse | null` - Tracks planner output
- `streamedQuestions: Question[]` - SA questions from shape-spec stream
- `latestFolder: string | null` - Implementation folder from stream
- `hasTriggeredOrchestration: boolean` - Guard flag for orchestration
- `incrementStatuses: Map` - Status per increment
- `activeIncrementId: string` - Currently selected increment

Key patterns:
- `triggerOrchestration()` - Calls `startOrchestration()` API
- `startShapeSpecStreamCallback` - Initiates shape-spec stream
- Detection logic in `onDone` to auto-trigger orchestration when questions complete
- Software Architect persona for implementation messages

**Key observation:** The component already has some increment/status infrastructure. The new spec extends this significantly with a state machine and sequential part processing.

#### 6. Gateway Chat Types

**Location:** `gateway/src/types/chat.ts`

Key types that may need extension:
- `ImplementChatPhase` - Currently: `bootstrap`, `refine`, `implementation_planning`, `generate_specs`, `implementation_clarification`
- `Increment` - Has `status: 'NOT_STARTED'` as literal type
- `ChatContext` - Contains `phase`, `workItem`, `architectureContext`

---

## Requirements Discussion

### First Round Questions

**Q1:** The user describes the Planner emitting "I have no more questions. Implement in X parts..." as an explicit message. I'm assuming the Planner LLM will be prompt-engineered to produce this message AND a machine-readable `handoff_plan` object in the same response. Is that correct, or should the message parsing also extract the parts list from the text itself?

**Answer:** Correct - prompt the Planner to return BOTH the explicit human message AND a machine-readable handoff_plan. Do NOT parse the parts list from text.

---

**Q2:** For the `handoff_plan` structure in the gateway response:
```json
{ "handoff_plan": { "is_split": true, "parts": [ { "part_index": 1, "title": "...", "intent": "..." }, ... ] } }
```
I'm assuming this replaces/extends the current `implementationPlan.increments` structure. Should we:
- (A) Add a new `handoffPlan` field to `ChatResponse` (separate from `plannerResponse`)
- (B) Extend the existing `PlannerResponse.implementationPlan` to include the split metadata
- (C) Create a new response type for the "handoff" phase specifically

**Answer:** (B) Extend the existing `PlannerResponse.implementationPlan` (e.g., add split metadata + parts/increments details) rather than adding a separate top-level field.

---

**Q3:** The spec mentions starting a new shape-spec session per part with `session_mode="new"`. Currently, the shape-spec backend maintains session context. I'm assuming each part should have an independent session with no memory of previous parts. Is that correct, or should parts share context within the same feature implementation?

**Answer:** Independent sessions per part (`session_mode="new"`) - no carry-over memory in the shape-spec backend; shared context comes from the JSON payload we send each time.

---

**Q4:** For the per-part message format:
```
PART n/X

PART_INTENT:
[intent text]

FEATURE_CONTEXT_JSON:
[JSON context]
```
Should `FEATURE_CONTEXT_JSON` include:
- (A) The full feature context from the Planner (all parts' intents + feature understanding)
- (B) Only this part's intent and dependencies
- (C) A minimal subset with just the part index and feature title

**Answer:** (B) Include this part's full intent + any dependencies, plus the core feature context JSON needed for determinism (not all parts' intents).

---

**Q5:** The spec mentions the orchestration pattern `POST /api/v1/jobs/orchestrations` creating a job and `GET /api/v1/jobs/{job_id}` for polling. The current gateway only has synchronous orchestration endpoints. I'm assuming we need to implement new job-based endpoints. Should the gateway:
- (A) Create and manage jobs internally (gateway-owned job queue)
- (B) Proxy to an upstream job service (like the current orchestration proxy)
- (C) Some hybrid where the gateway tracks job state but delegates execution

**Answer:** (B) Proxy to the upstream job endpoints (`/api/v1/jobs/orchestrations` and `/api/v1/jobs/{job_id}`); no gateway-owned job queue.

---

**Q6:** For the per-part state machine (PENDING -> QA_IN_PROGRESS -> READY_TO_RUN -> ORCHESTRATING -> COMPLETED/FAILED), I'm assuming the status transitions are:
- PENDING: Initial state for all parts
- QA_IN_PROGRESS: When shape-spec Q&A starts for this part
- READY_TO_RUN: When Implementation LLM indicates ready (questions resolved)
- ORCHESTRATING: When job is created and running
- COMPLETED: Job finished successfully
- FAILED: Job failed or error occurred

Is this state machine accurate? Are there any transitions I'm missing (e.g., can a part go back to QA_IN_PROGRESS if the orchestration fails)?

**Answer:** Failure requires manual intervention; allow the user to re-enter Q&A or retry orchestration after failure (no automatic rollback).

---

**Q7:** The spec says "Only one part active at a time" and "auto-advance to next part on completion". I'm assuming:
- When part N completes (COMPLETED), part N+1 automatically starts (transitions to QA_IN_PROGRESS)
- When part N fails (FAILED), the workflow stops and user intervention is required
- There's no manual "skip part" or "retry part" functionality in v1

Is this correct, or should we support manual intervention controls?

**Answer:** Auto-advance on completion, stop on failure; BUT include basic manual controls in v1: "Retry orchestration" and "Resume Q&A" (no skip/reorder).

---

**Q8:** For persistence, the spec mentions extending DB-backed implement context with:
- `current_split_plan`
- Per-part status/timestamps
- Per-part transcript
- Per-part job_id

Currently, the gateway uses an in-memory transcript store with file persistence. Should we:
- (A) Extend the existing in-memory + file pattern
- (B) Move to a proper database (PostgreSQL as per tech stack)
- (C) Use a hybrid where the workflow state is in-memory with periodic file sync

**Answer:** (A) Extend the existing gateway persistence pattern (in-memory + file) for v1; don't introduce PostgreSQL here yet.

---

**Q9:** For the UI, the spec mentions a "parts list with status" and "active transcript" display. I'm assuming the left panel (FeatureDefinitionPanel) will show the parts list with status indicators, and the right panel (Team Chat) will show the active part's transcript. Is that correct, or do you envision a different layout?

**Answer:** Yes - parts list + statuses on the left (FeatureDefinitionPanel area), active part transcript/chat on the right.

---

**Q10:** Is there anything that should be explicitly OUT of scope for this spec? For example:
- Parallel part execution
- Part reordering/dependencies
- Part editing after plan generation
- Integration with external job schedulers

**Answer:** Parallel execution, reordering, editing parts after plan generation, skip-part, advanced scheduling/backoff, external job schedulers.

---

### Existing Code to Reference

**Similar Features Identified:**
- `useShapeSpecStream` hook (`frontend/src/hooks/useShapeSpecStream.ts`) - can be extended for per-part invocation
- `ImplementationAssistantPanel` (`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`) - state management patterns can be extended
- `PlannerResponse` and `Increment` types (`gateway/src/types/chat.ts`) - can be extended for split metadata
- Existing transcript storage patterns (`gateway/src/services/transcriptStore.ts`, `gateway/src/services/transcriptWriter.ts`) - inform persistence design
- Orchestration proxy patterns (`gateway/src/routes/orchestrations.ts`) - similar proxy pattern for job endpoints

---

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - No visual files found in the visuals folder.

---

## Requirements Summary

### Functional Requirements

1. **Planner Handoff Contract**
   - Planner LLM produces BOTH human-readable message AND machine-readable `handoff_plan`
   - Do NOT parse parts list from text - rely on structured JSON output
   - Extend existing `PlannerResponse.implementationPlan` with split metadata and parts details

2. **Per-Part Shape-Spec Session Management**
   - Each part gets an independent session (`session_mode="new"`)
   - No carry-over memory in shape-spec backend between parts
   - Shared context comes from JSON payload sent with each part request

3. **Per-Part Payload Format**
   - Include this part's full intent + any dependencies
   - Include core feature context JSON needed for determinism
   - Do NOT include all parts' intents (only current part + dependencies)

4. **Job-Based Orchestration**
   - Proxy to upstream job endpoints (`POST /api/v1/jobs/orchestrations`, `GET /api/v1/jobs/{job_id}`)
   - No gateway-owned job queue
   - Poll for job completion status

5. **Part State Machine**
   - States: PENDING -> QA_IN_PROGRESS -> READY_TO_RUN -> ORCHESTRATING -> COMPLETED/FAILED
   - Auto-advance on completion (COMPLETED -> next part starts QA)
   - Stop on failure (FAILED requires manual intervention)

6. **Manual Intervention Controls (v1)**
   - "Retry orchestration" button - retry ORCHESTRATING state for failed part
   - "Resume Q&A" button - re-enter QA_IN_PROGRESS for failed part
   - No skip or reorder functionality

7. **Persistence (v1)**
   - Extend existing in-memory + file pattern
   - Store: `current_split_plan`, per-part status/timestamps, per-part transcript, per-part job_id
   - No PostgreSQL migration in this spec

8. **UI Layout**
   - Left panel (FeatureDefinitionPanel area): Parts list with status indicators
   - Right panel (Team Chat area): Active part transcript/chat

### Reusability Opportunities

Based on codebase analysis:
- `useShapeSpecStream` hook can be extended for per-part invocation
- `ImplementationAssistantPanel` state management patterns can be extended
- `PlannerResponse` and `Increment` types can be extended
- Existing transcript storage patterns inform persistence design
- Orchestration proxy patterns can be replicated for job endpoints

### Scope Boundaries

**In Scope:**
- Planner split detection and handoff plan structure (extending `implementationPlan`)
- Per-part shape-spec session management with `session_mode="new"`
- Per-part Q&A workflow
- Job-based orchestration via upstream proxy (no gateway job queue)
- Sequential part execution with auto-advance on completion
- Part status state machine (PENDING -> QA_IN_PROGRESS -> READY_TO_RUN -> ORCHESTRATING -> COMPLETED/FAILED)
- Basic manual controls: "Retry orchestration" and "Resume Q&A"
- UI for parts list (left panel) and active transcript (right panel)
- Persistence of workflow state (in-memory + file, extending existing patterns)

**Out of Scope:**
- Parallel part execution
- Part reordering after plan generation
- Editing parts after plan generation
- Skip-part functionality
- Advanced scheduling/backoff strategies
- External job scheduler integration
- PostgreSQL migration (use existing in-memory + file persistence)

### Technical Considerations

- **Planner Contract:** Extend `PlannerResponse.implementationPlan` with `isSplit`, `parts[]` containing `partIndex`, `title`, `intent`, `dependencies`
- **Gateway Endpoints:** Add proxy routes for `/api/v1/jobs/orchestrations` (POST) and `/api/v1/jobs/{job_id}` (GET)
- **Frontend State:** Extend `ImplementationAssistantPanel` with per-part state machine, active part tracking, and manual control buttons
- **Message Composition:** Create utility for composing per-part payload with PART header, PART_INTENT, and FEATURE_CONTEXT_JSON sections
- **Persistence Schema:** Extend transcript store to include `splitPlan`, per-part status map, per-part timestamps, per-part transcript arrays, and per-part job_id associations
- **Session Management:** Track session per part, always use `session_mode="new"` for each part's first request
