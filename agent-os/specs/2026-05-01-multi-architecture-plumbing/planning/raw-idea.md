# Raw Idea: Multi-Architecture Plumbing (Spec #1)

> Saved verbatim from spec initialization. Do not edit — this is the unmodified source description.

This is spec #1 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing — it contains the complete context, all resolved design decisions, and the full spec sequence.

This spec is the **end-to-end vertical-slice plumbing** for multi-architecture support. It introduces the concept of multiple architecture variants per project at the data model, backend, gateway, and frontend layers, but ships with **zero user-visible change** — every project gets a single `Default` architecture and the frontend silently routes through it.

**Scope of this spec:**

1. **architecture-model-service (Java/Spring Boot)**
   - New `architecture` entity: `id` (UUID), `projectId`, `name` (free-form string), `description`, `tags` (multi-valued free-form strings), `archived` (boolean, default false), timestamps.
   - New tag storage (separate table or array column — implementation choice during shaping).
   - Liquibase migration: create the new tables; create one `Default` architecture per existing project; backfill `architectureId` foreign key on every existing meta-model row (entities, relationships, diagrams, valid_from/valid_to history rows, anything currently project-scoped in the meta-model) to point at that project's `Default`. **Zero data loss is non-negotiable.**
   - Refactor all architecture-scoped endpoints to path-segment URLs: `/projects/:projectId/architectures/:architectureId/...`.
   - Project-scoped endpoints (architecture list/CRUD, threads, project metadata) stay at the project level: `/projects/:projectId/...`.
   - Minimal new endpoint needed in this spec: `GET /projects/:projectId/architectures` so the frontend can resolve "the project's default architecture" at load time. Full CRUD (create/rename/archive/tags) is deferred to spec #3.

2. **Gateway (Express/TypeScript)**
   - Proxy routes updated to forward the new path-segment URLs.
   - `architectureModelClient.ts` functions take `architectureId` where they hit architecture-scoped endpoints. Functions hitting project-scoped endpoints unchanged.
   - Threads stay project-scoped — no changes to thread storage paths or thread client functions.

3. **Frontend (React/TypeScript)**
   - Routes updated to embed `architectureId` as a path segment where the existing routes are architecture-scoped.
   - On project load, frontend fetches the project's architectures, picks the `Default` (the one created by migration, identifiable by name or by being the only non-archived one at this stage), and silently uses its id in all subsequent URLs.
   - No selector UI, no CRUD UI, no user-visible change in this spec.
   - URL is the source of truth for active architecture; a React context mirrors it for component consumption.

**Out of scope for this spec (deferred to later specs in the sequence):**
- Architecture selector UI (spec #2)
- Architecture CRUD UI: create / rename / archive / tag modal (spec #3)
- Discovery Service `architectureId` integration (spec #4)
- LLM persona/task save-target resolution (spec #5)
- Full clone (spec #6)
- Selective cross-architecture copy (spec #7)
- Comparison and unarchive UI (deferred)

**Key constraints:**
- Zero data loss in migration.
- Zero user-visible behaviour change after this spec ships.
- Path-segment URLs (not query params, not headers) — forgetting `architectureId` must produce a 404, not silently default.
- Element ids (entities, relationships, diagrams) are already UUID-style and globally unique — no schema change needed for that.
- Threads remain project-scoped — do not move them under `architectureId`.
