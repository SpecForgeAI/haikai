# Increment 2 of 16 — Phase 0 persistence contract

## Delivery context

This is increment **2 of 16** for the new **legacy / current-state discovery** capability.

Increment 1 established the capability skeleton:
- a new discovery micro-service,
- Phase 0 / Phase 1 pipeline shape,
- phase scaffolding,
- analyzer-pack extension architecture with empty default configuration,
- minimal gateway awareness.

This increment defines the **persistence contract for Phase 0 outputs** so the platform has a canonical, durable handoff from discovery framing into later repo discovery.

Phase 0 is the **discovery framing** phase, not solution architecture design. Its purpose is to capture:
- optional seed anchors the user already knows,
- structured discovery configuration,
- a durable discovery brief artifact.

## Goal

Create the canonical persistence contract for **Phase 0 framing outputs** using the platform's existing architectural principles:
- canonical model/state in the architecture backend,
- controlled writes through MCP,
- durable artifacts rather than transient chat-only state.

At the end of this increment, the platform must have a stable way to persist the outputs of Phase 0, even though the Phase 0 conversation itself is not implemented until the next increment.

## Existing platform alignment

This increment should align with the current codebase architecture:

- **architecture-model-service** is the canonical system of record and should own durable Phase 0 discovery state and artifact persistence shape where appropriate.
- **mcp-server** should remain the controlled write boundary for assistant-driven / orchestrated saves.
- **gateway** is not the canonical store and should not become the owner of Phase 0 durable state.
- **frontend** is not in scope for this increment.

This increment should avoid inventing a parallel persistence mechanism outside the existing platform pattern.

## What Phase 0 must persist

Phase 0 persistence must support **three output categories**.

### 1. Canonical anchor meta-model entities
Phase 0 may persist optional user-known anchors such as:
- `applications`
- `app_components`

Do not expand Phase 0 anchor persistence beyond this in this increment.

`business_users` may become part of Phase 0 later, but should not be included in this increment unless it is essentially free and clean within the existing model. Default assumption: not included yet.

### 2. Structured discovery configuration
Phase 0 must persist structured, machine-readable discovery framing/configuration data such as:
- repos in scope
- repo-to-application mapping
- repo-to-app_component classification hints
- technology/language hints
- exclusions / ignore hints
- optional discovery notes or ambiguity markers

This structured config is **not** the same thing as canonical architecture meta-model state. It is discovery-run framing/configuration.

### 3. Phase 0 discovery brief artifact
Phase 0 must persist a durable markdown artifact, conceptually:
- `LEGACY_DISCOVERY_PHASE_0.MD`

This artifact should summarize:
- scope
- confirmed anchors
- discovery configuration
- assumptions
- ambiguities
- references to saved architecture entities where applicable

This artifact is a durable handoff artifact for later phases.

## In scope

### 1. Canonical persistence shape for Phase 0 outputs
Define how the system persistently stores:
- optional Phase 0 anchor entities in the canonical architecture model
- structured discovery configuration
- Phase 0 discovery brief artifact

### 2. Controlled save contract through MCP
Introduce the MCP-layer contract(s) required so later increments can save Phase 0 outputs through the controlled write boundary.

The save path should be explicit, constrained, and aligned with the existing MCP pattern used elsewhere in the platform.

### 3. Architecture-model-service support for Phase 0 durable state
Add the minimal backend support required so Phase 0 outputs have a canonical home.

This includes a clear durable model for:
- structured Phase 0 discovery config
- Phase 0 discovery brief artifact association
- linkage to project context
- linkage to canonical anchor entities where relevant

### 4. Stable references for later Phase 1 handoff
The persisted Phase 0 outputs must be referenceable by later increments so the new discovery micro-service can consume them during Phase 1.

This does not require implementing Phase 1 consumption yet, only the stable persistence/reference contract.

## Strong design intent

Phase 0 persistence should clearly separate:

### A. Canonical architecture model state
Examples:
- `applications`
- `app_components`

### B. Discovery framing/configuration state
Examples:
- repo mappings
- technology hints
- exclusions
- ambiguity notes

### C. Human-readable artifact state
Example:
- `LEGACY_DISCOVERY_PHASE_0.MD`

Do not collapse all three into a single blob.

## Deliverables

### 1. Phase 0 structured persistence contract exists
There is an explicit contract for storing structured Phase 0 discovery framing/configuration for a project.

### 2. Phase 0 artifact persistence contract exists
There is an explicit contract for storing a Phase 0 markdown discovery brief artifact associated to the project and later retrieval/use.

### 3. MCP controlled write contract exists
There is an MCP-level save contract so later increments can save Phase 0 outputs through a controlled boundary rather than direct ad hoc writes.

### 4. Canonical anchor save path is clear
It is clear how optional `applications` and `app_components` are persisted as normal canonical architecture model entities, rather than as special-case Phase 0 duplicates.

### 5. Reference model for later handoff exists
Later increments can reference the saved:
- anchor entities
- structured Phase 0 discovery config
- Phase 0 discovery brief artifact

without redesigning the persistence model.

## Out of scope

Do **not** implement any of the following in this increment:
- Phase 0 conversation flow
- frontend UX for Phase 0
- discovery run model
- repo scanning
- ctags extraction
- evidence schema
- DecisionTask engine
- Phase 1 processing
- candidate generation
- Phase 1 save-back
- log ingestion
- business/hypothesis Q&A
- any AST functionality
- any specific analyzer pack logic

Also out of scope:
- broad expansion of Phase 0 anchor entity coverage beyond the minimal agreed set
- introducing a new generic persistence mechanism outside existing architecture-model-service + MCP patterns

## Required design constraints

### Controlled writes only
Assistant/orchestrated Phase 0 writes must go through MCP-style controlled save contracts.

### No duplicate architecture concepts
`applications` and `app_components` must remain canonical architecture meta-model entities, not duplicated as Phase 0-only objects.

### Separate config from canonical architecture
Structured discovery framing/config must not be forced into the canonical architecture meta-model if it does not belong there semantically.

### Durable artifact first-class support
The Phase 0 markdown brief must be treated as a real durable artifact, not an incidental debug output.

### Project-scoped persistence
All Phase 0 persisted outputs must be properly scoped to the relevant project.

## Acceptance criteria

1. The platform has an explicit, durable persistence contract for structured Phase 0 discovery framing/configuration.
2. The platform has an explicit, durable persistence contract for a Phase 0 markdown discovery brief artifact associated with a project.
3. Optional Phase 0 anchors `applications` and `app_components` are persisted through existing canonical architecture model paths rather than a duplicate Phase 0-only model.
4. An MCP-controlled save contract exists for Phase 0 outputs so later increments can persist them without direct backend bypass.
5. The persisted outputs are referenceable for later use by the discovery micro-service in Phase 1.
6. The design clearly separates:
   - canonical architecture entities,
   - structured discovery configuration,
   - human-readable discovery artifact.
7. No conversation flow, scanning logic, or Phase 1 behavior is implemented yet.

## Notes for later increments

This increment intentionally prepares for:
- Increment 3: Phase 0 architecture persona conversation
- Increment 4: Phase 0 completion and handoff
- later Phase 1 repo-discovery consumption of:
  - saved anchors,
  - structured discovery config,
  - Phase 0 discovery brief artifact

The implementation should optimize for:
- canonical ownership,
- controlled writes,
- clean referenceability,
- and no semantic mixing between architecture truth and discovery framing.
