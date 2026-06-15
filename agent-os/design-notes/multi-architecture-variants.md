# Design Note: Multi-Architecture Variants per Project

**Status:** Rough sketch — pre-spec. Expected to produce many specs.
**Author:** Design discussion, 2026-04-24.

## Problem

Today, a project has exactly one architecture meta-model. This does not fit real workflows:

- **Legacy migration:** Discovery Service captures *current-state*. The architect then wants a separate conversation to design *target-state*. These are two distinct architectures, both live at the same time.
- **Scenario modelling:** Users may want to hold multiple candidate architectures (e.g. "Option A: monolith", "Option B: microservices") side by side.
- **Experimental variants:** Throwaway exploration without polluting the canonical model.

`valid_from` / `valid_to` does **not** solve this — that is temporal evolution of a single line. These are **parallel lines**.

## Core Concept

Introduce an **architecture variant** as a first-class entity that sits between a project and its meta-model content:

```
Project
 └── Architecture (architectureId, name, description, kind?, createdAt, ...)
      ├── Meta-model entities, relationships, diagrams
      ├── (and whatever else is currently project-scoped in the meta-model)
      └── valid_from/valid_to history still lives inside a single architecture
```

Think of architectures as **branches**, and `valid_from`/`valid_to` as the **commit history on that branch**.

## Scope Boundaries (V1)

- **Fully isolated** — no cross-variant references, no shared baseline, no overlays.
- **Comparison across variants is a future feature**, not in scope for the initial rollout. The data model should not actively prevent it, but we will not build diffing UI now.
- Every existing project gets migrated onto a **default architecture** (e.g. named "Primary" or "Main"), preserving backwards compatibility.
- New projects start with exactly one default architecture, so the UX for single-architecture users stays unchanged.

## Key Areas of Change

This is fundamental because the meta-model is fundamental. Expect changes across every tier.

### 1. Data model & storage
- New `architecture` entity (id, projectId, **free-form `name`**, description, **tags** (multi-valued, user-managed), timestamps). A single-value `kind` field is **deferred** — the taxonomy could explode (current-state, next-year-interim, two-year-interim, target-state, etc.) and is premature to lock in. Tags cover the same need more flexibly without forcing a fixed enum.
- Tags are managed via a dedicated modal (add / edit / delete), separate from the create/migration flow.
- All currently project-scoped architecture data moves under `architectureId`.
- Storage path conventions need updating. Current pattern per memory: `{projectParentFolder}/threads/{type}/thread.json`. Decide where `architectureId` slots in — likely `{projectParentFolder}/architectures/{architectureId}/...` for architecture-scoped data.
- Migration: existing projects → one default architecture, with a stable id so external references don't break.

### 2. `architecture-model-service` (Java/Spring Boot)
- All architecture-scoped endpoints carry `architectureId` as a **path segment**: `/projects/:projectId/architectures/:architectureId/...`.
- Project-scoped endpoints (architecture CRUD, threads, project metadata) stay at the project level.
- New endpoints: `list architectures`, `create`, `rename`, `archive`, `manage tags`, `clone`, `selective copy`.
- Liquibase migration to add the architecture table (and tag table) and backfill existing data onto a `"Default"` architecture per project.

### 3. Gateway (Express/TypeScript)
- `architectureModelClient.ts` functions (`fetchProjectFolder`, `fetchProductName`, `fetchProductSummary`, `fetchMetaModelSummary`, plus save/write paths) take `architectureId`.
- Proxy endpoints forward `architectureId`.
- Decide: do threads belong to an architecture, or stay project-scoped? (See Open Questions.)

### 4. Frontend (React/TypeScript)
- **Architecture selector** somewhere persistent in the UI (top bar / project header).
- React context for "current active architecture" alongside the existing project context.
- Architecture CRUD UI: create, rename, archive. Separate modal for tag add/edit/delete.
- Every read/write in the meta-model views must use the active `architectureId`.
- Guard: switching architectures mid-edit needs a confirmation/save flow.

### 5. Discovery Service
- User picks target architecture in the UI at run start.
- All Discovery Service endpoints take `architectureId`.
- Discovery results are written into the chosen architecture's meta-model.
- Per existing memory feedback: don't modify `discovery-service/src/**` during an in-flight run.

### 6. LLM personas & tasks
- Two modes for resolving the save-target architecture, per task:
  - **Clarify-at-save:** persona asks the user which architecture to save into, e.g. "This will be saved to architecture `<name>`. Correct?"
  - **Bound-by-system-prompt:** the conversation is opened with the target `architectureId` pre-declared in its system prompt (e.g. Discovery runs), and the persona does not ask.
- Persona/task definitions need to declare which mode they use and, for bound mode, how the target id flows into the system prompt.
- Persona `contextNeeds` may gain an `architecture` scope for read-side operations too (e.g. "what does the current-state look like?").

### 7. Threads & conversation memory
- **Decision:** Threads remain **project-scoped** and span architectures. No change to current thread storage layout.
- When a save to the meta-model is required, the target architecture is resolved one of two ways depending on the use-case:
  - **LLM-driven clarification:** the persona asks the user to confirm target architecture at save time.
  - **System-prompt-bound:** for tasks where the target is known up front (e.g. a Discovery-triggered conversation), the system prompt for that conversation declares the target `architectureId` and the LLM does not ask.
- Persona/task definitions need a per-task choice between these two modes.

## Resolved Decisions

- **Thread scope:** project-level (threads span architectures). Save target is resolved per-task via either LLM clarification or a system-prompt-bound `architectureId`.
- **`kind` field:** deferred for V1 — free-form `name` plus user-managed `tags` instead. Tags cover the taxonomy need flexibly without locking an enum.
- **Cloning/copying:** both full **clone** (new architecture seeded from another) **and selective cross-architecture copy** (pull chosen entities / relationships / diagrams from one architecture into another) are in scope. The data model must give every element a stable id that survives a cross-architecture copy.
- **Default architecture on migration:** named `"Default"`. Renaming and tag editing are available at any time via a separate modal (no special migration UX).
- **Deletion:** **archive** (soft delete with hidden flag). Architecture vanishes from the standard selector / list views but data is retained. An "unarchive" UI is **deferred** — out of scope for V1, but the data model must support it.
- **Selective-copy conflicts:** **per-element interactive resolution**, with an upfront summary screen showing the **total conflict count** before the user commits. Few conflicts → user resolves inline. Many conflicts → user can cancel and rethink the operation.
- **Discovery Service:** strictly **one run → one architecture**. The target `architectureId` is bound to the run at launch and into its system prompt.
- **API shape:** **path segment** — `/projects/:projectId/architectures/:architectureId/...` for architecture-scoped routes. Project-scoped routes (architecture list, threads, project metadata) stay at the project level. Rationale: forgetting `architectureId` must fail loudly (404), not silently route to a default and corrupt data. Self-documenting URLs and clean OpenAPI/Spring controller mappings are worth the wider refactor — every call site has to be touched anyway.
- **Access control:** **per-project** (everyone with project access sees all its architectures). No per-architecture ACLs in V1.
- **Rollout strategy:** **vertical** — spec #1 lands the plumbing end-to-end (entity, migration, path-segment URLs, gateway, frontend rewire) with the UI defaulting silently to each project's `Default` architecture. User-visible change in spec #1: **zero**. Subsequent specs add the selector UI, CRUD, archive, tags, Discovery, persona changes, clone, selective copy. No half-migrated states between specs.
- **Active-architecture state:** lives in **both** the URL (path segment, source of truth for deep-linking and refresh) **and** a React context (in-memory mirror that components read). Route change updates context; navigation updates URL.
- **Tag schema:** simple free-form **strings, multi-valued**. No key-value, no namespacing.
- **Element id stability:** all entity, relationship, and diagram ids are already globally unique (UUID-style) and survive a cross-architecture copy unchanged. No data-model adjustment needed for clone / selective-copy.
- **Data preservation through migration:** non-negotiable. Liquibase creates one `Default` architecture per existing project and backfills `architectureId` on every existing meta-model row to point at it. Zero data loss; existing users see identical content under a single architecture named `Default`.

## Spec Sequence (vertical rollout)

Each spec leaves the system in a working, shippable state.

1. **End-to-end plumbing (vertical slice)** — `architecture` entity + tag table in `architecture-model-service`; Liquibase migration creating one `Default` architecture per existing project and backfilling `architectureId` on all meta-model rows; path-segment URLs (`/projects/:projectId/architectures/:architectureId/...`); gateway client + proxy updates; frontend rewired to embed `architectureId` in routes and call new URLs, defaulting silently to the project's `Default`. **No user-visible change.** Threads stay project-scoped.
2. **Architecture selector + active-architecture context** — selector UI in the project header; URL ↔ React context wiring for deep-linking; existing views switch when selection changes.
3. **Architecture CRUD UI** — create, rename, archive. Separate modal for tag add/edit/delete (free-form multi-valued strings).
4. **Discovery Service integration** — `architectureId` on all Discovery endpoints; UI selector at run start; target id bound into the run's system prompt. One run → one architecture.
5. **LLM persona/task save-target resolution** — per-task declaration of `clarify-at-save` vs `bound-by-system-prompt` mode; wire `architectureId` into system prompts where bound; persona `contextNeeds` gains `architecture` scope where needed.
6. **Full clone** — "duplicate architecture A into new architecture B" workflow (core legacy-migration use case).
7. **Selective cross-architecture copy** — pick entities / relationships / diagrams from one architecture and copy into another. Pre-flight conflict count screen, then per-element interactive resolution.
8. **Comparison** (future, out of scope here) — diff two architectures.
9. **Unarchive UI** (future, out of scope here) — restore archived architectures.

## Non-Goals (V1)

- Cross-architecture references or shared elements.
- Diffing or comparison UI.
- Merging architectures.
- Access control scoped per-architecture.
- Automatic promotion of one variant to "canonical".

## Next Steps

- All design decisions resolved. Begin shaping spec #1 (end-to-end plumbing vertical slice) via `/agent-os:shape-spec`.
