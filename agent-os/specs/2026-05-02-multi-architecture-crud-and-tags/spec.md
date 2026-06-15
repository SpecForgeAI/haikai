# Specification: Multi-Architecture CRUD UI + Tag Management (Spec #3)

## Goal
Make multi-architecture useful end-to-end by adding the backend CRUD endpoints, gateway proxies, and frontend modals that let a user create, edit (name + description + tags), and archive architectures from the existing TopBar selector. With this spec, parallel architectures (e.g. current-state vs target-state) become first-class user concepts rather than a silent single-default no-op.

## User Stories
- As a user, I want to create a new architecture for my project (with an optional description and initial tags like `current-state` / `target-state`) so that I can hold a parallel variant alongside the existing one without affecting the original.
- As a user, I want to rename, re-describe, and re-tag an existing architecture from one place so that the metadata for an architecture stays consistent and editable in a single atomic save.
- As a user, I want to archive an architecture I no longer want to see (with a safety net preventing me from archiving the last one) so that the selector and management modal stay focused on architectures I'm actively working with.

## Specific Requirements

**Backend CRUD endpoints (`architecture-model-service`)**
- `POST /api/projects/{projectId}/architectures` — create; body `{name, description?, tags?: string[]}`; returns the created architecture row (id, name, description, tags, archived, timestamps).
- `PATCH /api/projects/{projectId}/architectures/{architectureId}` — combined edit; body `{name, description, tags: string[]}`; replaces the full tag set atomically alongside name and description (no separate add/remove tag endpoints).
- `POST /api/projects/{projectId}/architectures/{architectureId}/archive` — soft-delete; sets `archived = true`; rejects with 422 if it would leave the project with zero non-archived architectures.
- No `DELETE` endpoint and no separate tag endpoints — archive is the only deletion, PATCH owns all tag mutation.
- Service layer enforces last-architecture protection (`countByProjectIdAndArchivedFalse > 1`) and case-insensitive name uniqueness within the project.

**Liquibase changeset for case-insensitive name uniqueness**
- Add a new SQL changeset `092-architecture-name-unique-constraint.sql` (next sequential after the existing `091-architecture-id-not-null-fk.sql`) creating a unique index on `architecture (project_id, LOWER(name))`.
- Register in `db.changelog-master.yaml`.
- Never edit applied changesets 087-091 — add a new file only.
- The constraint is the server's source of truth for the rename collision rule; the controller maps DB-level violations to HTTP 409.

**HTTP error contract**
- 409 Conflict — duplicate name within project (case-insensitive); response body includes a localised message the frontend renders inline next to the name field.
- 422 Unprocessable Entity — attempt to archive the last non-archived architecture; message: "A project must have at least one architecture."
- 404 Not Found — architecture id missing or belongs to a different project.
- 400 Bad Request — malformed payload (missing name, name >100 chars, description >500 chars, any tag empty after trim or >50 chars).
- Map the dedicated exceptions in `GlobalExceptionHandler` so all four codes return consistent envelope shapes.

**Validation rules (server + client mirror)**
- Name: required, non-empty after trim, ≤100 chars, unique within project case-insensitive.
- Description: optional, ≤500 chars.
- Tags: array of strings, each non-empty after trim, ≤50 chars, unique within architecture (existing `architecture_tag` unique constraint from spec #1 covers this).
- Client validates inline (shows error before submit); server is the source of truth and returns 400/409 if client validation is bypassed.

**Gateway proxies**
- Extend `gateway/src/services/architectureModelClient.ts` with `createArchitecture`, `updateArchitecture`, `archiveArchitecture` functions that forward to the new backend endpoints.
- Add proxy routes in `gateway/src/routes/architectures.ts` for `POST /api/projects/:projectId/architectures`, `PATCH /api/projects/:projectId/architectures/:architectureId`, `POST /api/projects/:projectId/architectures/:architectureId/archive`.
- Pass through status codes and error bodies untouched so the frontend can render inline error messages.

**Frontend API client extensions**
- Add `createArchitecture(projectId, payload)`, `updateArchitecture(projectId, architectureId, payload)`, `archiveArchitecture(projectId, architectureId)` to `frontend/src/api/architecturesApi.ts`.
- Each function awaits the response and returns the parsed body or throws a typed error carrying the HTTP status (so callers can branch on 409 vs 422 vs other).

**`ArchitectureContext` extension — `refreshArchitectures()`**
- Extend the context (added in spec #2) with a `refreshArchitectures()` callable that re-invokes `listArchitectures(projectId)` and updates the in-memory `architectures` list.
- Every CRUD modal calls this on success so the dropdown and Manage modal re-render against fresh data.
- Do not introduce optimistic updates — every mutation is server-confirm; the modal awaits the response and the refresh before closing.

**Selector dropdown footer (extend spec #2's `ArchitectureSelector`)**
- Below the existing architecture-name list, render a separator and two footer entries:
  - `+ Create architecture…` — opens `EditArchitectureModal` in `mode='create'`.
  - `Manage architectures…` — opens `ManageArchitecturesModal`.
- No per-row inline actions in the dropdown — the selector list stays a clean name-only chooser; all CRUD lives in the modals.
- Both footer entries are always visible (even when only one `Default` architecture exists).

**`EditArchitectureModal` (combined create + edit)**
- Single component at `frontend/src/components/TopBar/EditArchitectureModal.tsx` driven by a `mode: 'create' | 'edit'` prop.
- Fields: Name (required, inline-validated), Description (optional, multi-line), Tags (chip UI — existing tags as removable chips, text input below with Enter/comma to add, trim-and-dedupe within the chip set, ≤50-char enforcement, reject empty).
- Submit button label: `Create` (create mode) or `Save changes` (edit mode); disabled while invalid or in flight.
- On successful POST/PATCH: call `refreshArchitectures()`, close the modal, and (create mode only) navigate to the new architecture's URL using `setActiveArchitecture(newId)`.
- On 409: render the duplicate-name error inline next to the Name field; do not close the modal.

**`ManageArchitecturesModal`**
- New component at `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`; lists every non-archived architecture for the active project, oldest-first (matches spec #2's selector ordering).
- Each row shows: Name, Description (truncated if long), read-only tag chips, and right-aligned Edit + Archive action buttons.
- Edit opens `EditArchitectureModal` in `mode='edit'` pre-populated with that row's `{name, description, tags}`.
- Archive opens `ArchiveArchitectureConfirmModal` for that row.
- Archived architectures are hidden from this modal (no unarchive UI in this spec; surfacing them would confuse).
- The Archive button on the only-remaining row is disabled with tooltip: "Cannot archive — every project must have at least one architecture." (defence in depth — server also rejects with 422).

**`ArchiveArchitectureConfirmModal`**
- New component at `frontend/src/components/TopBar/ArchiveArchitectureConfirmModal.tsx`; modelled on `DeleteDiagramConfirmModal.tsx`.
- Body warns the user: "Archive `<name>`? This hides it from the selector. (Unarchive is not yet supported.)"
- If the architecture being archived is the currently-active one (matches `activeArchitectureId`): add an extra warning line: "You're archiving the architecture you're currently viewing. You'll be moved to **`<next>`**." — `<next>` is resolved client-side as the project's new oldest non-archived after excluding this row.
- On confirm: call `archiveArchitecture`, await success, call `refreshArchitectures()`. If active was archived, explicitly call `setActiveArchitecture(nextId)` so the URL updates immediately (the spec #2 `<ProjectLayout>` redirect would also catch a stale id, but explicit navigation is faster).
- On 422 (server rejection — race condition): render the error inline and keep the modal open.

**Tag chip primitive (local, scoped to `EditArchitectureModal`)**
- If no shared chip component exists in the codebase, build a minimal one inline within `EditArchitectureModal`: chips with `×` to remove + a text input that accepts Enter or comma to commit a new tag.
- Apply trim, ≤50-char check, dedupe (case-sensitive — tags are free-form strings), and reject empty values before adding to the chip set.
- Keep the primitive local to this file — no premature extraction. Spec #18-style autocomplete is explicitly deferred.

**Test strategy**
- Backend: integration tests for the three new endpoints covering happy paths, name uniqueness (409), last-architecture protection (422), 404 on wrong project, and 400 on payload limits.
- Frontend Vitest tests covering: (a) create flow with name + description + tags submitted in one PATCH-equivalent POST; (b) edit flow updating all three fields and refreshing the list; (c) archive flow including active-architecture warning text and post-archive navigation; (d) Archive button disabled on the last architecture (no server call made); (e) 409 duplicate-name surfaces inline next to Name; (f) tag chip add (Enter and comma), remove (× click), trim, dedupe, empty-rejection, 50-char max.
- Mechanical update: spec #2's `ArchitectureSelector.test.tsx` to assert the two new footer entries are rendered and route to the correct modals.

## Existing Code to Leverage

**`DeliveryTeamEntity` / `OrganisationEntity` + `Architecture*` skeleton from spec #1**
- `ArchitectureService`, `ArchitectureRepository`, `ArchitectureController`, `ArchitectureMapper`, and DTOs already exist (created in spec #1 for the list endpoint) — extend them in place rather than introducing parallel classes.
- `OrganisationEntity` has the same name-uniqueness pattern and demonstrates the matching `existsByNameIgnoreCase` repository method shape.

**`frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx`**
- Modal shell pattern: portal overlay + header + scrollable content + footer with secondary (Cancel) / primary (Save) buttons; click-outside-to-close; Esc to dismiss; primary disabled until valid.
- `EditArchitectureModal` follows the same shell, swapping the inner form for name + description + tags.

**`frontend/src/components/DiagramsView/modals/DeleteDiagramConfirmModal.tsx`**
- Confirmation modal pattern: warning copy + secondary (Cancel) + destructive primary (Archive) button styled appropriately.
- `ArchiveArchitectureConfirmModal` mirrors it, with the extra active-architecture-warning paragraph injected when applicable.

**`ArchitectureContext` (from specs #1 + #2) and `ArchitectureSelector` (from spec #2)**
- `architectures: Architecture[]`, `activeArchitectureId`, and `setActiveArchitecture(id)` are already exposed; this spec adds `refreshArchitectures()` alongside.
- `ArchitectureSelector`'s dropdown render is the extension point for the two new footer entries — keep the existing list rendering and append the separator + footer below it.

**Spec #1's `architecture_tag` table + unique constraint**
- Already enforces `(architecture_id, tag_value)` uniqueness — the PATCH endpoint replaces the full tag set by deleting all rows for the architecture and re-inserting from the payload (atomic within the transaction). No schema change for tags in this spec.

**Liquibase changeset numbering (087-091 already applied)**
- Continue the per-concern, per-file pattern from spec #1's migration sequence; new changeset is `092-architecture-name-unique-constraint.sql`. Project-memory rule: never modify applied changesets — Liquibase checksum validation refuses startup.

## Out of Scope
- Unarchive UI and any rendering of archived rows (deferred indefinitely — surfacing archived rows without an unarchive action would confuse users).
- Discovery Service `architectureId` integration (spec #4).
- LLM persona/task save-target resolution (`clarify-at-save` vs `bound-by-system-prompt`) (spec #5).
- Full clone — duplicate architecture A into new B (spec #6).
- Selective cross-architecture copy with conflict resolution (spec #7).
- Comparison / diffing UI (deferred indefinitely).
- Per-architecture access control (not in V1 — access stays per-project).
- Tag autocomplete, tag suggestions, and any project-wide tag list view (future spec).
- Bulk operations (archive multiple, retag multiple) and per-row inline actions inside the selector dropdown.
- Rendering tags inside the selector pill or dropdown rows (Manage modal owns tag display in this spec).
