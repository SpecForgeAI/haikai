This is spec #3 of a multi-spec initiative described in full at `agent-os/design-notes/multi-architecture-variants.md`. **Read that design note in full** before initializing. Predecessors:
- Spec #1 (shipped): `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — data model, backend Bucket A endpoints, gateway proxies, frontend API client wiring with silent-default behaviour. Created `architecture` and `architecture_tag` tables and a single `GET /api/projects/{projectId}/architectures` endpoint.
- Spec #2 (shipped): `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — react-router-dom integration, URL-as-source-of-truth, selector pill in TopBar, legacy-URL redirect with toast, empty-view-on-switch toast.

This spec adds the **CRUD UI and tag-management modal** for architectures. It's the first spec where users can actually create, rename, archive architectures, and manage tags. With existing data still showing only one `Default` architecture per project, this is also the spec where the multi-architecture concept becomes useful end-to-end.

**Scope of this spec:**

1. **Backend — new CRUD endpoints in `architecture-model-service`** (currently only `GET /api/projects/{projectId}/architectures` exists):
   - `POST /api/projects/{projectId}/architectures` — create new architecture (body: `{name, description?, tags?}`).
   - `PATCH /api/projects/{projectId}/architectures/{architectureId}` — rename / edit description.
   - `POST /api/projects/{projectId}/architectures/{architectureId}/archive` — archive (sets `archived = true`).
   - `POST /api/projects/{projectId}/architectures/{architectureId}/tags` — add a tag.
   - `DELETE /api/projects/{projectId}/architectures/{architectureId}/tags/{tagValue}` — delete a tag.
   - Validation rules to be decided during shaping (name uniqueness within project? non-empty? tag length limits?).

2. **Gateway** — pass-through proxies for the new endpoints. Architecture-scoped CRUD endpoints follow the established Bucket A path-segment shape.

3. **Frontend API client** — `architecturesApi.ts` extended with `createArchitecture`, `renameArchitecture`, `updateArchitectureDescription`, `archiveArchitecture`, `addTag`, `removeTag`.

4. **Frontend UI** — extend the existing `ArchitectureSelector` from spec #2:
   - Footer/menu in the dropdown with "Create architecture…" entry that opens a create modal.
   - Per-row hover/menu actions: Rename, Archive, Manage Tags…
   - Modal components: Create modal, Rename inline-or-modal, Archive confirmation, Tag-management modal (add/remove via simple chips UI).
   - Reuse existing modal patterns from the codebase where possible (e.g. `CreateOrganisationModal` if present).

**Out of scope (deferred to later specs):**
- Discovery Service `architectureId` integration → spec #4.
- LLM persona/task save-target resolution → spec #5.
- Full clone (duplicate architecture A into new B) → spec #6.
- Selective cross-architecture copy → spec #7.
- Comparison and unarchive UI → deferred indefinitely.
- Per-architecture access control → not in V1.

**Key constraints:**
- Cannot delete the last/only architecture in a project (must always have at least one non-archived).
- Archive is soft-delete — data remains, just hidden from the selector dropdown (spec #1 design decision).
- Tags are free-form multi-valued strings; no namespacing, no key-value.
- Must not regress spec #1 zero-data-loss or spec #2 URL-driven behaviour.
- After archiving the currently-active architecture, the user is redirected to the project's new oldest non-archived (the spec #2 redirect logic should handle this naturally if the active id becomes invalid).
