# Specification: Implement-Part Sequencing Workflow

## Goal
Add an explicit "split into parts" handoff workflow where the Planner LLM signals it has no more questions and provides X implementation parts. The UI then processes parts sequentially: for each part, send details to shape-spec/stream, collect Q&A, call orchestration job, poll until complete, then advance to next part.

## User Stories
- As a developer, I want the Planner to split a feature into discrete implementation parts so that I can execute them sequentially with isolated Q&A sessions per part
- As a developer, I want to see a parts list with status indicators so that I can track progress through the multi-part implementation workflow

## Specific Requirements

**Extend PlannerResponse.implementationPlan with Split Metadata**
- Add `isSplit: boolean` field to `ImplementationPlan` interface
- Add `parts: Part[]` array to replace/extend existing `increments` for split workflows
- `Part` interface includes: `partIndex: number`, `title: string`, `intent: string`, `dependencies?: string[]`
- Prompt Planner LLM to return BOTH human-readable message AND machine-readable `implementationPlan` with split metadata
- Do NOT parse parts list from text - rely on structured JSON output

**Gateway Proxy Routes for Job-Based Orchestration**
- Add `POST /api/v1/jobs/orchestrations` proxy route to upstream job creation endpoint
- Add `GET /api/v1/jobs/{job_id}` proxy route to upstream job status polling endpoint
- Follow existing proxy patterns in `orchestrations.ts` using `implementationLlmProxyClient`
- Inject server-side Bearer token, return opaque errors for auth failures (401/403 -> 502)
- No gateway-owned job queue - pure upstream proxy

**Frontend Part State Machine**
- Add `PartStatus` type: `'PENDING' | 'QA_IN_PROGRESS' | 'READY_TO_RUN' | 'ORCHESTRATING' | 'COMPLETED' | 'FAILED'`
- Add `partStatuses: Map<number, PartStatus>` state to `ImplementationAssistantPanel`
- Add `activePartIndex: number` state for tracking currently active part
- State transitions: PENDING -> QA_IN_PROGRESS (on start) -> READY_TO_RUN (on no questions) -> ORCHESTRATING (on job create) -> COMPLETED/FAILED (on job poll result)
- Auto-advance: on COMPLETED, automatically start next part (transition to QA_IN_PROGRESS)
- Stop on failure: on FAILED, stop workflow and require manual intervention

**Per-Part Shape-Spec Payload Composition**
- Create `composePartPayload(part: Part, featureContext: FeatureContext): string` utility function
- Payload format with delimiters: `PART n/X\n\nPART_INTENT:\n[intent]\n\nFEATURE_CONTEXT_JSON:\n[JSON]`
- Include this part's full intent + any dependencies in PART_INTENT section
- Include core feature context JSON (feature understanding, scope, acceptance criteria) - NOT all parts' intents
- Always use `session_mode="new"` for each part's first shape-spec request (independent sessions)

**Job Polling Integration**
- Add `startOrchestrationJob(company: string, project: string, specIntent: string): Promise<{ jobId: string }>` API function
- Add `pollJobStatus(jobId: string): Promise<JobStatus>` API function with `JobStatus` type: `{ status: 'pending' | 'running' | 'completed' | 'failed', error?: string }`
- Implement polling loop with 2-second interval in `ImplementationAssistantPanel`
- On `completed`: transition part to COMPLETED, check for next part
- On `failed`: transition part to FAILED, stop workflow, show error message

**Manual Intervention Controls**
- Add "Retry orchestration" button for FAILED parts - re-creates job from same part intent
- Add "Resume Q&A" button for FAILED parts - transitions back to QA_IN_PROGRESS state
- No skip-part or reorder functionality in v1
- Buttons render conditionally based on part status

**Per-Part Persistence (In-Memory + File)**
- Extend `ConversationTranscript` with optional `splitPlan?: SplitPlan` field
- `SplitPlan` includes: `parts: Part[]`, `partStatuses: Record<number, PartStatus>`, `partTimestamps: Record<number, { startedAt?: string, completedAt?: string }>`, `partJobIds: Record<number, string>`, `partTranscripts: Record<number, TranscriptEntry[]>`
- Extend `transcriptStore` to persist split plan alongside existing transcript entries
- Extend `writeTranscriptToFile` to include split plan metadata in conversation JSON

**Parts List UI Component**
- Create `PartsListSection` component for displaying parts with status indicators
- Render in `FeatureDefinitionPanel` after Implementation Plan section (or replace increments display)
- Each part shows: part number, title, status badge (color-coded by status)
- Clicking a part sets it as active and scrolls to its transcript in the RHS panel
- Active part highlighted with distinct styling

## Visual Design

**Parts List + Active Transcript Layout**
- Left panel (`FeatureDefinitionPanel`): Parts list with status indicators below Implementation Plan section
- Right panel (Team Chat): Active part's shape-spec transcript, Q&A flow
- Parts list shows vertical stack of part cards with: index badge, title, status chip
- Status chips: PENDING (gray), QA_IN_PROGRESS (blue), READY_TO_RUN (green), ORCHESTRATING (amber), COMPLETED (green check), FAILED (red)
- Active part card highlighted with left border accent (similar to selected increment pattern)
- Manual intervention buttons ("Retry orchestration", "Resume Q&A") appear in part card when status is FAILED

## Existing Code to Leverage

**`PlannerResponse` and `ImplementationPlan` types (`gateway/src/types/chat.ts`)**
- Existing `ImplementationPlan` interface with `planTitle` and `increments` array
- Existing `Increment` interface with `id`, `title`, `shortDescription`, `status`, `proposedFinalSubFeatureDefinition`
- Extend rather than replace - add `isSplit`, `parts` fields to `ImplementationPlan`
- Reuse `PlannerValidationResult` pattern for validating split metadata

**`useShapeSpecStream` hook (`frontend/src/hooks/useShapeSpecStream.ts`)**
- Existing pattern for SSE streaming with `startStream()`, callbacks for `onContent`, `onDone`, `onQuestions`, `onFolder`
- `session_mode="new"` parameter already supported
- Invoke once per part with composed payload
- Hook already handles abort, error states, and multi-turn Q&A

**`ImplementationAssistantPanel` state patterns (`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`)**
- Existing `incrementStatuses: Map` pattern for status tracking per increment
- Existing `hasTriggeredOrchestration` guard flag pattern for preventing duplicate calls
- Existing `triggerOrchestration` helper function pattern for orchestration API calls
- Existing `handleAnswerStreamedQuestions` pattern for Q&A continuation flow

**`orchestrationsRouter` proxy patterns (`gateway/src/routes/orchestrations.ts`)**
- Existing `/v1/orchestrations` POST proxy pattern using `implementationLlmProxyClient.request`
- Existing validation, error handling, and logging patterns
- Existing `PROXY_TIMEOUT_MS` and abort controller patterns
- Extend with `/v1/jobs/orchestrations` POST and `/v1/jobs/{job_id}` GET routes

**Transcript persistence patterns (`gateway/src/services/transcriptStore.ts`, `transcriptWriter.ts`)**
- Existing `InMemoryTranscriptStore` with `get`, `appendEntry`, `getOrCreate` methods
- Existing `ConversationTranscript` with `sessionId`, `entries`, `createdAt` fields
- Existing `writeTranscriptToFile` with atomic write pattern (temp file + rename)
- Extend to include split plan metadata in both in-memory store and file persistence

## Out of Scope
- Parallel part execution (parts must execute sequentially)
- Part reordering after plan generation
- Editing part content after plan generation
- Skip-part functionality
- Advanced scheduling or backoff strategies for job polling
- External job scheduler integration
- PostgreSQL migration (use existing in-memory + file persistence)
- Context carry-over between parts in shape-spec backend (each part is independent)
- Automatic rollback on failure (manual intervention required)
- Part dependency graph execution (linear execution only)
