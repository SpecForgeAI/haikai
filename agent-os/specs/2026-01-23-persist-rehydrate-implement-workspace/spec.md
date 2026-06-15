# Specification: Persist + Rehydrate Implement Workspace

## Goal
Persist the full Implement workspace state for each work item so the shaping, planning, clarification, and execution workflow can survive reloads, tab switches, and application restarts.

## User Stories
- As a developer, I want to continue working on a feature implementation after refreshing the page so that I don't lose my progress through the planning and clarification workflow.
- As a developer, I want to switch between work items and return to find my previous state intact so that I can work on multiple features without losing context.

## Specific Requirements

**Backend Entity Design (WorkItemImplementWorkspaceEntity)**
- Create new JPA entity with JSONB column for workspace state
- Store workspace as atomic JSON snapshot in `workspace_state` column (jsonb)
- Include `schema_version` field in persisted JSON for migration support
- Use UUID primary key, with `project_id` and `work_item_id` composite unique index
- Include `created_at` and `updated_at` timestamp columns with @PrePersist/@PreUpdate hooks
- Follow pattern from `WorkItemImplementContextEntity` for JSONB handling with Hypersistence JsonType

**API Endpoints**
- GET `/api/projects/{projectId}/work-items/{workItemId}/implement-workspace` returns persisted workspace or empty default
- PUT `/api/projects/{projectId}/work-items/{workItemId}/implement-workspace` saves full workspace snapshot
- Keep separate from existing `/implement-context` endpoint (context selection is different concern)
- Return 200 OK with `ImplementWorkspaceDto` on success for both endpoints
- GET returns empty workspace DTO (not 404) when no workspace exists yet

**Workspace State Schema**
- `schemaVersion: number` - version for migration support (start at 1)
- `implementationMode: boolean` - user-controlled implementation phase flag
- `plannerPayload: PlannerPayload` - nested object with featureUnderstanding, scope, assumptions, acceptanceCriteria, openQuestions, plannerReadyForSpec, implementationPlan
- `activeIncrementId: string | null` - currently selected increment
- `questions: Question[]` - array of Question objects with id, workItemId, incrementId, fromRole, question, answer, status, createdAt, answeredAt
- `executionArtifactsByIncrement: Map<string, IncrementArtifacts>` - serialized as JSON object keyed by incrementId
- `teamChatTranscript: TeamChatMessage[]` - array of transcript entries with id, role, message, createdAt, linkedIncrementId

**Persistence Triggers (Frontend)**
- Save workspace after plan generation completes (plannerPayload updated)
- Save workspace when new questions received from PO or SA
- Save workspace when user submits answers to questions
- Save workspace on increment status transitions (NOT_STARTED -> IN_CLARIFICATION -> READY_TO_EXECUTE -> EXECUTING -> COMPLETED/FAILED)
- Save workspace when execution artifacts are captured
- Save workspace when team chat transcript is updated
- Do NOT save on loading flag changes or transient UI state changes

**Schema Versioning and Migration**
- Persist `schemaVersion` field in JSON root
- On load: check schemaVersion and apply migration chain if needed
- Migration functions transform older schemas to current version
- If fields are unknown/missing, default them safely (fail-soft)
- Only fail hard if JSON is structurally unreadable (parse error)
- Log warnings for unknown fields but continue loading

**Validation and Error Handling**
- Validate LLM payloads (plannerPayload, questions) before storing
- On validation failure: keep last-known-good state, do not overwrite
- Mark increments as FAILED on pipeline failure (do not auto-retry)
- Provide explicit "Reset Implement Workspace" action (can be deferred to later increment)
- Frontend should display validation errors non-blockingly in Team Chat

**Frontend Rehydration Flow**
- On ImplementationAssistantPanel mount: call GET implement-workspace endpoint
- If workspace exists: populate all state fields from persisted data
- If workspace does not exist: initialize with empty defaults, trigger bootstrap
- Use equality guards to prevent unnecessary re-renders (follow ProductUiStateContext pattern)
- Maintain existing in-memory context state for tab-switch optimization (GET only on full page reload)

## Visual Design
No visual assets provided.

## Existing Code to Leverage

**WorkItemImplementContextEntity / WorkItemImplementContextService**
- JSONB persistence pattern using Hypersistence JsonType annotation
- Entity structure with UUID id, projectId, workItemId, timestamps
- Service pattern with getContext/saveContext methods returning DTOs
- Repository interface extending JpaRepository with findByProjectIdAndWorkItemId

**WorkItemImplementContextController**
- REST controller pattern with @RequestMapping at sub-resource path
- GET/PUT endpoints returning ResponseEntity with DTOs
- Input validation with IllegalArgumentException for null/blank checks
- SaveContextRequest record for PUT request body binding

**ProductUiStateContext.tsx**
- React context pattern for UI state persistence
- stateRef pattern for stable getter function identities
- Equality guards in setters to prevent no-op updates
- ImplementChatUiState interface structure for workspace state

**ImplementationAssistantPanel.tsx state fields**
- implementationMode, latestPlannerResponse, activeIncrementId state fields
- saQuestions, incrementStatuses, incrementArtifacts state fields
- currentPhase, answers state fields
- teamChatTranscript (messages) state management

**chatApi.ts types**
- PlannerResponse, ImplementationPlan, Increment, Question, OpenQuestion interfaces
- IncrementStatus type (NOT_STARTED, IN_CLARIFICATION, READY_TO_EXECUTE, EXECUTING, COMPLETED, FAILED)
- IncrementArtifacts interface with shapeSpecArtifact, writeSpecArtifact, tasksSummary, implementationResult, error

## Out of Scope
- Incremental patching of workspace state (use full snapshot instead)
- Periodic autosave (only trigger-based persistence)
- Gateway as store of record for workspace (backend model service DB only)
- Auto-retry on pipeline failure (manual retry required)
- "Reset Implement Workspace" action (can be added in later increment)
- Advanced analytics or reporting dashboards for workspace data
- Multi-user collaboration or conflict resolution
- Real-time streaming execution logs beyond basic summaries
- Full rollback/undo of completed increments
- Workspace export/import functionality
