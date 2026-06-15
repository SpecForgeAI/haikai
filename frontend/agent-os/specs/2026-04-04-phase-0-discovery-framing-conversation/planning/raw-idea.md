# Increment 3 of 16 — Phase 0 architecture persona discovery framing

## Delivery context

This is increment **3 of 16** for the new **legacy / current-state discovery** capability.

Previous increments:
- Increment 1 created the discovery capability skeleton and extension-point architecture.
- Increment 2 defined the persistence contract for Phase 0 outputs.

This increment introduces the **Phase 0 architecture persona conversation**, which gathers discovery framing inputs before any code scanning occurs.

## Goal

Enable a new **architecture persona conversation flow** dedicated to **discovery framing**, allowing users to:
- confirm or define basic anchors (applications, app_components),
- describe repos and scope,
- provide technology hints and exclusions,
- refine discovery setup before Phase 1.

This is not solution architecture design — it is **setup for discovery**.

## In scope

### 1. New discovery-specific persona/task
Introduce a new persona/task in the gateway aligned to:
- "architecture persona for discovery framing"

It should:
- reuse existing chatV2 conversation patterns,
- be clearly distinct from solution architecture persona flows,
- operate within project context.

### 2. Structured conversation intent
The conversation should guide the user to provide:
- optional applications and app_components (if not already defined),
- repo inputs (URLs, identifiers, or descriptions),
- repo → application mapping,
- technology/language hints,
- exclusions/ignore rules,
- ambiguity notes where relevant.

Do not enforce rigid input upfront — allow iterative refinement via conversation.

### 3. Use of existing platform artifacts
The conversation should be able to:
- reference existing canonical architecture entities where present,
- confirm or refine previously defined anchors,
- avoid duplicating entities unnecessarily.

### 4. Output alignment with Phase 0 persistence
The conversation should be designed so its outputs map cleanly to:
- canonical anchor entities (applications, app_components),
- structured discovery configuration,
- Phase 0 discovery brief artifact (to be saved in next increment).

No persistence is required yet in this increment — only alignment of structure.

### 5. Gateway orchestration
Integrate the new persona/task into the gateway so:
- it can be invoked within the existing chatV2 framework,
- it operates within project context,
- it is clearly scoped to discovery framing.

## Out of scope

Do **not** implement:
- persistence of Phase 0 outputs (handled in next increment),
- Phase 0 markdown artifact generation,
- Phase 1 discovery execution,
- repo scanning or analysis,
- frontend-specific UX beyond existing chat interface,
- DecisionTask engine,
- evidence schema,
- any save-back to canonical model,
- analyzer packs or AST logic.

## Required design constraints

### Distinct from solution architecture flows
This persona must clearly focus on **discovery framing**, not designing target architecture.

### Conversational, not rigid forms
The interaction should remain conversational and iterative, not a fixed form submission.

### Structured output intent
Even though persistence is not implemented yet, the conversation must be shaped so outputs can map cleanly to:
- anchors,
- structured config,
- discovery brief artifact.

### Project-scoped
All interactions must operate within a project context.

## Acceptance criteria

1. A new discovery-specific architecture persona/task exists in the gateway.
2. The persona can conduct a conversation to gather:
   - applications/app_components (optional),
   - repo scope and mapping,
   - technology hints,
   - exclusions and notes.
3. The conversation is clearly positioned as **discovery framing**, not solution design.
4. The output of the conversation is structurally aligned with Phase 0 persistence needs, even though it is not yet saved.
5. The flow integrates cleanly with existing chatV2 patterns and project context.
6. No Phase 1 behavior or persistence is implemented yet.

## Notes for later increments

This increment prepares for:
- Increment 4: Phase 0 completion and handoff (persistence + artifact)
- Phase 1 consumption of:
  - confirmed anchors,
  - structured discovery configuration,
  - discovery brief artifact

The implementation should prioritize:
- clarity of intent,
- clean mapping to persistence structures,
- and separation from solution architecture conversations.
