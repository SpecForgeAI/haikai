# Spec Requirements: Persist + Rehydrate Implement Workspace

## Initial Description

Persist the full Implement workspace state for each work item so the shaping, clarification, planning, and execution workflow can survive reloads, tab switches, and restarts. Add robust contract validation, migrations, and automated tests to harden the system against malformed LLM outputs and partial runs.

### Scope Includes
- Persist and rehydrate: planner payload, implementationMode, implementationPlan + statuses, questions table, execution artifacts, Team Chat transcript
- Schema versioning + migrations for persisted state
- Contract tests for Planner + Software Architect JSON parsing/validation
- UI/component tests for core workflows and edge cases

### Out of Scope
- Advanced analytics, reporting dashboards, or multi-user collaboration
- Real-time streaming execution logs beyond basic summaries
- Full rollback/undo of completed increments

## Requirements Discussion

### First Round Questions

**Q1:** What persistence granularity is needed - atomic (full workspace JSON per save) vs incremental (patch individual fields)?
**Answer:** Atomic persistence (full workspace JSON). Store the whole implement workspace snapshot in JSONB per save. No incremental patching needed.

**Q2:** What should trigger persistence - periodic autosave, explicit save action, or automatic on meaningful state changes?
**Answer:** Trigger-based persistence on meaningful state changes (plan generated, new questions received, answers submitted, status transitions, artifacts captured). No periodic autosave needed initially.

**Q3:** Where should persistence happen - backend only, or should the gateway also store implement state?
**Answer:** Everything through the backend - unified backend persistence. Store the full implement workspace in the model service DB (including Team Chat transcript). The gateway should NOT be a long-term store of record for this feature.

**Q4:** How should schema versioning work - version field with migrations, or fail-soft loading with defaults?
**Answer:** Migration chain with fail-soft loading. Persist schemaVersion. On load, apply migrations when possible; if fields are unknown/missing, default them safely rather than failing hard. Only fail hard if the snapshot is structurally unreadable.

**Q5:** What error recovery behavior is expected when persistence fails or LLM returns malformed data?
**Answer:** Fail-safe approach - validate LLM payloads before storing; keep last-known-good on validation failure; mark increments as FAILED on pipeline failure; no auto-retry. Add an explicit "Reset Implement Workspace" action but it can be a later increment.

**Q6:** Should we include backward compatibility tests that load older schema versions?
**Answer:** Yes, include backward compatibility tests. Add tests that load older schema snapshots and confirm migration/defaulting works.

**Q7:** What API structure is preferred - new endpoints vs extending existing work item endpoints?
**Answer:** New endpoints:
- GET /api/work-items/{workItemId}/implement-workspace
- PUT /api/work-items/{workItemId}/implement-workspace
Keep it separate from implement-context (context selection is a different concern).

**Q8:** What test coverage priority - unit tests first, E2E flows, or regression tests for prior bugs?
**Answer:** Persistence round-trip + validation first. Then add a small number of high-value E2E flows (resume after reload) once the core is stable. Regression tests for prior infinite-loop bugs are good but secondary to persistence correctness.

**Q9:** What state should explicitly NOT be persisted (loading flags, transient UI state)?
**Answer:**
**What NOT to persist:**
- Loading flags (isLoading, isBootstrapping, isImplementing, isSubmittingAnswers)
- UI-only state (activeTab, isConfirmModalOpen)
- Transient error messages
- Session IDs
- Scroll positions
- Input focus
- Temporary draft chat input text

**What TO persist:**
- Stable chat transcript/messages with persona attribution
- Questions table rows (role, question, answer, status, incrementId)
- Implementation plan + per-increment statuses + activeIncrementId
- Planner payload (featureUnderstanding, scope, assumptions, acceptanceCriteria, plannerReadyForSpec)
- implementationMode flag
- Execution artifacts per increment (shapeSpec, writeSpec, tasks summary, implementation summary, errors)

### Existing Code to Reference

**Similar Features Identified:**
- Feature: WorkItemImplementContext - Path: `WorkItemImplementContextEntity` / `WorkItemImplementContextService` - persistence pattern for work item state
- Feature: ProductUiState - Path: `ProductUiStateContext.tsx` - React state persistence pattern with equality guards
- Tests to reference: `ImplementationAssistantPanel.test.tsx`, `ImplementationPlanSection.test.tsx`

### Follow-up Questions

No follow-up questions were required.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Persist full implement workspace as atomic JSONB snapshot per work item
- Trigger persistence on meaningful state changes: plan generation, questions received, answers submitted, status transitions, artifacts captured
- Store in backend model service database (PostgreSQL with JSONB)
- Support rehydration on page reload, tab switch, or application restart
- Include schema version field in persisted data
- Apply migration chain on load for older schemas
- Default unknown/missing fields safely rather than failing (fail-soft loading)
- Fail hard only if snapshot is structurally unreadable
- Validate LLM payloads before storing
- Keep last-known-good state on validation failure
- Mark increments as FAILED on pipeline failure
- No auto-retry on failure
- Explicit "Reset Implement Workspace" action (can be later increment)

### Data to Persist
- Chat transcript/messages with persona attribution
- Questions table rows (role, question, answer, status, incrementId)
- Implementation plan with per-increment statuses and activeIncrementId
- Planner payload (featureUnderstanding, scope, assumptions, acceptanceCriteria, plannerReadyForSpec)
- implementationMode flag
- Execution artifacts per increment (shapeSpec, writeSpec, tasks summary, implementation summary, errors)

### Data NOT to Persist
- Loading flags (isLoading, isBootstrapping, isImplementing, isSubmittingAnswers)
- UI-only state (activeTab, isConfirmModalOpen)
- Transient error messages
- Session IDs
- Scroll positions
- Input focus
- Temporary draft chat input text

### API Design
- `GET /api/work-items/{workItemId}/implement-workspace` - Retrieve persisted workspace
- `PUT /api/work-items/{workItemId}/implement-workspace` - Save workspace snapshot
- Keep separate from implement-context endpoints (context selection is different concern)

### Reusability Opportunities
- Follow `WorkItemImplementContextEntity` / `WorkItemImplementContextService` persistence pattern
- Reference `ProductUiStateContext.tsx` for React state persistence with equality guards
- Study existing tests: `ImplementationAssistantPanel.test.tsx`, `ImplementationPlanSection.test.tsx`

### Scope Boundaries

**In Scope:**
- Atomic JSONB persistence of implement workspace per work item
- Trigger-based persistence on meaningful state changes
- Backend-only persistence (model service DB)
- Schema versioning with migration chain
- Fail-soft loading with safe defaults
- LLM payload validation before storage
- Last-known-good state preservation on failure
- Backward compatibility tests for schema migrations
- Persistence round-trip tests
- High-value E2E tests for resume-after-reload flows

**Out of Scope:**
- Incremental patching (use full snapshot instead)
- Periodic autosave
- Gateway as store of record
- Auto-retry on failure
- Advanced analytics or reporting dashboards
- Multi-user collaboration
- Real-time streaming execution logs
- Full rollback/undo of completed increments
- "Reset Implement Workspace" action (can be later increment)

### Technical Considerations
- Use PostgreSQL JSONB column for workspace storage
- Include schemaVersion field in persisted JSON structure
- Implement migration functions for each schema version upgrade
- Backend model service handles all persistence (not gateway)
- Validate JSON structure before persisting to prevent corrupt state
- On load failure, return empty/default workspace rather than error (except for structural issues)
- Follow existing patterns in WorkItemImplementContextService for consistency
- Use equality guards in React context to prevent unnecessary re-renders (per ProductUiStateContext pattern)
