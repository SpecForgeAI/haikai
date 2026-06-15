# Increment 5 of 16 — Discovery run model and orchestration

## Delivery context

This is increment **5 of 16** for the new **legacy / current-state discovery** capability.

Previous increments:
- Increment 1 created the discovery capability skeleton.
- Increment 2 defined Phase 0 persistence.
- Increment 3 introduced the Phase 0 conversation.
- Increment 4 completed Phase 0 persistence and handoff.

This increment introduces the concept of a **discovery run** so Phase 1 execution is **explicit, trackable, and stateful**, rather than implicit in chat.

## Goal

Introduce a first-class **discovery run model** that:
- represents a single execution of discovery,
- tracks progress across Phase 1 (1a–1d),
- is linked to Phase 0 outputs,
- provides a stable orchestration boundary for the discovery micro-service.

## In scope

### 1. Discovery run entity/model
Define a discovery run as a project-scoped entity that includes:
- reference to project
- reference to Phase 0 outputs (anchors, config, artifact)
- lifecycle state (e.g. created, running, completed, failed)
- current phase (1a, 1b, 1c, 1d)
- timestamps and basic metadata

### 2. Run lifecycle and states
Define the lifecycle of a discovery run, including:
- creation
- start of execution
- progression across phases
- completion
- failure handling (basic)

No need for complex retry or scheduling logic in this increment.

### 3. Gateway orchestration
Extend the gateway so it can:
- initiate a discovery run using Phase 0 outputs,
- call into the discovery micro-service to start execution,
- query run status.

This should follow existing orchestration patterns in the gateway.

### 4. Discovery micro-service run handling
Extend the discovery micro-service so it:
- accepts a "start run" request,
- initializes internal state for the run,
- tracks phase progression (even if phases are still placeholders),
- exposes basic status endpoints.

No real analysis is required yet — only orchestration and state tracking.

### 5. Persistence of run state
Persist the discovery run so it can be:
- queried,
- resumed (at a basic level),
- referenced by later increments.

Use the existing backend patterns (architecture-model-service or appropriate service) and controlled write approach where applicable.

## Out of scope

Do **not** implement:
- actual Phase 1 analysis (1a–1d logic),
- evidence schema,
- DecisionTask engine,
- clustering or candidate generation,
- frontend UX beyond minimal status visibility,
- advanced scheduling/queueing,
- retries, concurrency control, or scaling logic,
- log-based discovery,
- analyzer packs or AST functionality.

## Required design constraints

### Explicit execution model
Discovery must be modeled as an explicit run, not inferred from chat or transient state.

### Phase-aware orchestration
The run must explicitly track progression across:
- 1a
- 1b
- 1c
- 1d

even if those phases are placeholders in this increment.

### Decoupled from chat
Execution must not depend on chat history; it must rely on persisted Phase 0 outputs.

### Project-scoped
All runs must be tied to a project.

### Extensible lifecycle
The run model must be flexible enough to support:
- richer status,
- additional phases,
- future retries or partial re-runs.

## Acceptance criteria

1. A discovery run entity/model exists and is project-scoped.
2. A run can be created using persisted Phase 0 outputs.
3. The gateway can initiate a discovery run.
4. The discovery micro-service accepts and initializes a run.
5. The run tracks:
   - lifecycle state,
   - current phase (1a–1d),
   - basic metadata.
6. Run state is persisted and queryable.
7. No actual Phase 1 analysis logic is implemented yet.

## Notes for later increments

This increment enables:
- Increment 6: Phase 1a universal evidence extraction
- later orchestration of 1b–1d
- visibility of discovery progress
- eventual frontend integration for run monitoring

The implementation should prioritize:
- clear run lifecycle,
- clean orchestration boundaries,
- and readiness for real Phase 1 execution.
