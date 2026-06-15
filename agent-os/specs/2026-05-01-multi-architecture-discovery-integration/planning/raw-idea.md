This is spec #4 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing. Predecessors:
- Spec #1 (shipped): `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — data model, Bucket A endpoints, frontend silent-default. **Group 5 of spec #1 already updated three entity-fetch calls in `discovery-service/src/services/archModelClient.ts` to take `architectureId`, resolved per-project via a per-run cached helper.** That helper picked the project's Default architecture silently. This spec replaces that silent default with explicit user choice.
- Spec #2 (shipped): `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — react-router-dom, URL routing, selector pill in TopBar.
- Spec #3 (shipped): `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` — architecture CRUD UI + tag management.

This spec adds **explicit architecture targeting for discovery runs**. The user picks the target architecture in the UI at run start; that `architectureId` is bound to the discovery run for its entire lifetime and propagates through every Discovery endpoint and every save-back to architecture-model-service. Per the design note, the rule is **strictly one run → one architecture**.

**Scope of this spec:**

1. **Discovery Service backend — `architectureId` on every endpoint**
   - Discovery's own endpoints (currently project-scoped only) need `architectureId` added. Endpoints (per the spec #1 implementer's audit): `POST/GET /api/projects/{projectId}/discovery/runs`, `PUT/GET /api/projects/{projectId}/discovery/runs/{runId}`, `GET /api/projects/{projectId}/discovery/config`, `POST/GET /api/projects/{projectId}/discovery/runs/{runId}/{evidence|relationships|clusters|candidates|decision-tasks}` (plus their per-id PUT/DELETE).
   - These live in `discovery-service` AND have corresponding endpoints in `architecture-model-service` (the discovery_* tables in architecture-model-service hold the persisted state). Spec #1 explicitly excluded discovery_* tables from getting `architecture_id` columns — this spec adds them and runs the backfill migration.
   - URL shape decision: probably mirror the existing pattern — path-segment between projectId and discovery: `/api/projects/{projectId}/architectures/{architectureId}/discovery/...`. To be confirmed during shaping.
   - The discovery `runs` table specifically gains an `architecture_id` foreign key — that's the binding point. Every child entity (evidence, relationships, clusters, candidates, decision-tasks) inherits its architecture via the run.

2. **architecture-model-service — `architecture_id` on `discovery_*` tables**
   - New Liquibase changeset(s) adding `architecture_id` column to `discovery_runs` (NOT NULL after backfill). Other discovery_* tables may not need it directly if they all FK through the run — to be decided during shaping based on query patterns.
   - Backfill: existing discovery runs (if any) get assigned to the project's Default architecture (spec #1's resolution rule).
   - **Hard constraint from project memory:** Never edit applied Liquibase changesets — always add new ones.

3. **Gateway proxies**
   - All `discovery/*` proxy routes updated to embed `:architectureId` path segment.

4. **Frontend — UI selector at run start**
   - When the user starts a discovery run, the UI must let them pick which architecture the run targets. This could be:
     - A dropdown/picker in the existing "start run" modal/dialog, OR
     - A confirmation step after they click "start", OR
     - Just default to the currently-active architecture (from the URL) with no extra picker.
   - To be decided during shaping (this is a real product question).
   - The chosen architecture is locked for the run's entire lifetime — spec #1's per-run cached helper (now a real value, not a silent resolution) keeps it stable.

5. **LLM persona system prompts**
   - Per the design note's "bound-by-system-prompt" mode (resolved decision), Discovery-triggered conversations get the run's `architectureId` pre-declared in the system prompt so the LLM doesn't need to ask. This spec wires that.
   - The persona definitions need updating to include the architecture context.

**Out of scope (deferred):**
- LLM persona save-target resolution for non-Discovery contexts → spec #5.
- Full clone (duplicate architecture A into new B) → spec #6.
- Selective cross-architecture copy → spec #7.
- Discovery run resumption across architectures (a run is bound to its architecture for life) → not a feature.

**Key constraints:**
- **Strictly one run → one architecture.** No multi-architecture writes from a single run (per design note decision #4).
- **Project memory caveat:** `tsx watch` auto-reloads kill in-flight discovery runs — the implementer must check no run is active before editing `discovery-service/src/**`. This applies to spec #4 implementation work.
- Must not regress spec #1's three entity-fetch calls (they already take `architectureId` — this spec extends the pattern, doesn't replace it).
- Must not regress spec #2 or #3 user-facing behaviour.
- Discovery runs created BEFORE this spec ships have no explicit `architectureId` — backfilled to the project's Default during migration.
