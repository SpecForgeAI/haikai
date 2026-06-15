# Increment 4 of 16 — Phase 0 completion and handoff

## Delivery context

This is increment **4 of 16** for the new **legacy / current-state discovery** capability.

Previous increments:
- Increment 1 created the discovery capability skeleton and extension-point architecture.
- Increment 2 defined the persistence contract for Phase 0 outputs.
- Increment 3 introduced the Phase 0 architecture persona discovery framing conversation.

This increment completes Phase 0 by **persisting the outputs and creating a clean handoff into Phase 1**.

## Goal

When the Phase 0 conversation is complete, the system must:
- persist canonical anchor entities,
- persist structured discovery configuration,
- generate and persist a Phase 0 discovery brief artifact,
- provide a clear, structured handoff for Phase 1.

## In scope

### 1. Phase 0 completion trigger
Define how Phase 0 is considered "complete" within the conversation flow.

Completion should occur when:
- sufficient discovery framing information has been gathered,
- or the user explicitly confirms completion.

### 2. Controlled persistence of Phase 0 outputs
Persist the Phase 0 outputs using the contract defined in Increment 2:

- canonical anchor entities:
  - `applications`
  - `app_components`

- structured discovery configuration:
  - repo scope
  - repo → application mapping
  - technology/language hints
  - exclusions/ignore rules
  - ambiguity notes

All writes must go through the **MCP controlled write boundary**.

### 3. Phase 0 discovery brief artifact
Generate and persist a markdown artifact representing the Phase 0 outcome, conceptually:

- `LEGACY_DISCOVERY_PHASE_0.MD`

It should include:
- summary of scope
- confirmed anchors
- discovery configuration
- assumptions and ambiguities
- references to saved architecture entities where applicable

This must be a durable artifact associated with the project.

### 4. Handoff contract for Phase 1
Establish a clear handoff structure so Phase 1 can consume:
- persisted anchors
- structured discovery configuration
- Phase 0 discovery brief artifact

This handoff should be explicit and referenceable, not implicit in chat history.

### 5. Gateway orchestration
Extend the gateway so:
- it can trigger Phase 0 completion,
- it coordinates persistence via MCP,
- it finalizes the conversation state into a structured Phase 0 result.

## Out of scope

Do **not** implement:
- Phase 1 discovery execution,
- repo scanning or analysis,
- evidence schema or DecisionTask engine,
- frontend-specific workflow beyond existing chat interaction,
- refinement/review UX,
- log-based discovery,
- hypothesis-first discovery,
- analyzer packs or AST functionality.

## Required design constraints

### Controlled writes only
All persistence must go through MCP-style controlled save operations.

### Separation of concerns
Maintain clear separation between:
- canonical architecture entities,
- structured discovery configuration,
- discovery brief artifact.

### Idempotent completion
Phase 0 completion should be safe to re-run or confirm without duplicating entities or corrupting state.

### Project-scoped
All persisted data must be correctly scoped to the project.

### Explicit handoff
Phase 1 must not depend on chat history; it must rely on persisted Phase 0 outputs.

## Acceptance criteria

1. Phase 0 can be explicitly or implicitly marked as complete within the conversation.
2. Canonical anchor entities (`applications`, `app_components`) are persisted via MCP.
3. Structured discovery configuration is persisted in the canonical backend.
4. A Phase 0 markdown discovery brief artifact is generated and stored for the project.
5. A clear, structured handoff exists so Phase 1 can consume Phase 0 outputs.
6. Gateway orchestrates completion and persistence without bypassing controlled write mechanisms.
7. No Phase 1 execution or analysis is triggered yet.

## Notes for later increments

This increment enables:
- Increment 5: discovery run model and orchestration
- Phase 1 consumption of:
  - anchors,
  - discovery configuration,
  - Phase 0 discovery brief artifact

The implementation should prioritize:
- clean persistence boundaries,
- clear handoff contracts,
- and readiness for Phase 1 execution.
