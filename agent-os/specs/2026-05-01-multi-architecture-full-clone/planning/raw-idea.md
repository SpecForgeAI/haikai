# Raw Idea: Multi-Architecture Full Clone (Spec #6)

This is spec #6 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing.

**Predecessors (shipped):**
- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — plumbing.
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — URL routing + selector.
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` — CRUD + tags. Provides `EditArchitectureModal`, `ManageArchitecturesModal`, `ArchiveArchitectureConfirmModal`.
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/` — Discovery integration.
- Spec #5: `agent-os/specs/2026-05-01-multi-architecture-save-target-resolution/` — LLM persona save-target resolution.

This spec implements **full clone** — duplicate architecture A into new architecture B. Core legacy-migration use case: user runs Discovery to capture current-state, then clones it as the basis for designing target-state. From the design note: "Selective copy of subsets" is deferred to spec #7; this is "atomic full duplicate" only.

## Scope of this spec

1. **Backend — new clone endpoint in `architecture-model-service`**:
   - `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` — body `{name, description?, tags?}`. Creates new architecture row + duplicates all architecture-scoped meta-model rows from source to target.
   - Atomic: all-or-nothing transaction. Failure rolls back the new architecture.
   - Element ids: fresh UUIDs for every duplicated row (per spec #1's design-note rule that all element ids are globally unique — easy because we're inserting new rows).
   - Reference rewiring: every FK in the duplicated rows that points at another in-scope row (e.g. relationships pointing at entity ids) must be remapped to the new ids. Use a UUID-old-to-new map built during the duplication pass.
   - **Threads NOT cloned** (project-scoped per spec #1's locked decision; spec #4's Discovery threads are bound to their source architecture for life).
   - **Discovery runs NOT cloned** (a Discovery run is a permanent record of "what was discovered for THIS architecture at THIS time"; cloning would create misleading provenance).

2. **Gateway proxy** for the new clone endpoint.

3. **Frontend `architecturesApi.ts`** extension: `cloneArchitecture(projectId, sourceArchitectureId, payload)`.

4. **Frontend UI — Clone entry point(s)** to be decided during shaping. Likely candidates:
   - `ManageArchitecturesModal` per-row "Clone" button alongside Edit + Archive.
   - The selector dropdown footer alongside "Create" / "Manage" — but this conflates "create new" with "clone from existing" so probably belongs in Manage.

5. **Frontend `CloneArchitectureModal` (or extension to `EditArchitectureModal`)** — modal with fields for the new architecture's name, description, tags. Decisions during shaping: pre-populate name as "Copy of <source-name>" or require user-provided? Default tags from source?

6. **Post-clone behaviour** to be decided: auto-navigate to new architecture? Stay on source? Show a toast?

7. **Refuse cloning archived architectures?** Or allow with a warning?

## Out of scope (deferred)
- Selective cross-architecture copy → spec #7.
- Cross-architecture element migration / merging → spec #7.
- Comparison and unarchive UI → deferred indefinitely.
- Cloning into a different project → not in V1.
- Cloning Discovery runs / threads (locked out — see scope #1 above).

## Key constraints
- Atomic (transaction-bound) — must not leave a partially-cloned architecture if any insert fails.
- Element id stability across the clone — all internal references (entity IDs, relationship ids, diagram node ids) consistently remapped.
- Element ids fresh (never reused across architectures) — per spec #1 design note.
- Must not regress any prior spec's behaviour.
- Liquibase: no schema changes needed (architecture-scoped tables already exist; clone is data-level only).
