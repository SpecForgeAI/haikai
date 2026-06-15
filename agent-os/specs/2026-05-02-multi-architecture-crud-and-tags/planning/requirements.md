# Spec #3 Requirements — Multi-Architecture CRUD UI + Tag Management

**Spec folder:** `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/`
**Design note:** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessors (shipped):**
- `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — data model, Bucket A endpoints, gateway, frontend wiring.
- `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — react-router-dom, URL-as-source-of-truth, selector pill in TopBar.
**Raw idea:** `planning/raw-idea.md`

This document captures the resolved decisions from the shape-spec phase, ready for `/agent-os:write-spec`.

---

## Context

Spec #1 created the `architecture` and `architecture_tag` tables, exposed `GET /api/projects/{projectId}/architectures`, and ran a Liquibase migration that gave every existing project one `Default` architecture. Spec #2 made the URL the source of truth and added a selector pill in the TopBar (currently functionally a no-op for users with only one architecture).

This spec is where multi-architecture **becomes useful end-to-end**. It adds:
- Backend CRUD endpoints (create, edit, archive, tag add/remove).
- Gateway proxies for those endpoints.
- Frontend API client functions.
- Two new modals — **Edit/Create Architecture** and **Manage Architectures** — plus an Archive confirmation.
- Extended dropdown footer with two new entry points.

**Hard constraints:**
- Cannot archive the **last** non-archived architecture in a project — every project must always have at least one live architecture.
- Archive is **soft-delete** — data retained; row hidden from the selector and from the Manage Architectures modal. Unarchive UI is out of scope (deferred indefinitely per the design note).
- Tags are **free-form, multi-valued strings**. No namespacing, no key-value, no value normalisation beyond trimming.
- Architecture names must be **unique within a project** (case-insensitive). Reason: prevents two `Target State` rows in the same project's dropdown — pure UX guard. Server-enforced; client validates inline.
- Must not regress spec #1 (zero-data-loss) or spec #2 (URL-driven behaviour).

---

## Resolved Product/UX Decisions

### 1. Global actions in the dropdown — **footer + dedicated management panel**

The selector dropdown stays a minimal list of architecture names (as today). Below the list, a separator, then **two footer entries**:
- `+ Create architecture…` — opens the **Create modal**.
- `Manage architectures…` — opens the **Manage Architectures modal**.

**No per-row inline actions** in the dropdown — keeps the selector clean and the actions discoverable in a single dedicated place.

### 2. Per-row CRUD discoverability — **inside the Manage Architectures modal**

The Manage Architectures modal lists every non-archived architecture for the current project (one row per architecture, oldest first — same ordering rule as the dropdown). Each row shows:
- Name.
- Description (truncated if long).
- Tag chips (read-only display; full management happens via row actions).
- Action buttons / icons on the right: **Edit**, **Archive**.

Selecting **Edit** opens the Edit modal pre-populated with that architecture's name, description, and tags. Selecting **Archive** opens the Archive confirmation modal.

Archived architectures are **not shown** in this modal (since unarchive UI doesn't exist yet, surfacing them would confuse the user with rows they can't act on).

### 3. Rename mechanic — **combined "Edit architecture" modal**

A single **Edit Architecture** modal handles **name + description + tags** in one place. Triggered from:
- The Manage Architectures modal's per-row Edit button.
- (No inline-rename in the dropdown.)

Fields:
- **Name** — required, non-empty, unique within project (case-insensitive), 100-char max. Validated client-side; server enforces.
- **Description** — optional, 500-char max.
- **Tags** — chip UI: existing tags render as removable chips; a text input below accepts new tags (Enter or comma to add; trim whitespace; reject duplicates within the chip set; reject empty; 50-char max per tag).

The same modal component is used for both **Create** and **Edit** with a `mode` prop (see #5). Submit button label is `Create` or `Save changes` accordingly.

### 4. Tag-management surface — **inside the Edit modal**

No separate "Manage tags" modal. Tags live on the Edit Architecture modal alongside name + description. This avoids modal proliferation and matches the user's mental model of "everything about an architecture lives in one place".

### 5. Create modal scope — **name + description + initial tags**

The Create modal has the same fields as Edit, just a different submit-button label. Capturing tags upfront supports the design note's primary use case ("tag as `current-state` / `target-state` at birth"). All fields except name are optional.

---

## Decisions Made Inline (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 6 | **Backend endpoint shapes:** `POST /api/projects/{projectId}/architectures` (create), `PATCH /api/projects/{projectId}/architectures/{architectureId}` (edit name/description and replace full tag set), `POST /api/projects/{projectId}/architectures/{architectureId}/archive` (soft-delete). PATCH handles tags as part of the same payload (`{name, description, tags: string[]}`) — no separate tag endpoints. | Combined-edit Edit modal (decision #3) needs one atomic save; multi-call save would risk partial failure. PATCH-with-full-tag-replace is simpler than diffing add/remove. |
| 7 | **No `DELETE` endpoint** in this spec. Archive is the only "deletion" operation. | Matches the design note's archive-only V1 stance. |
| 8 | **Validation rules:** Name non-empty, ≤100 chars, unique within project case-insensitive (DB constraint added via Liquibase). Description ≤500 chars. Tag value non-empty after trim, ≤50 chars, unique within architecture (DB constraint already exists from spec #1). | Reasonable defaults; matches existing codebase conventions (`OrganisationEntity` has 100-char name uniqueness too). |
| 9 | **HTTP error responses:** 409 Conflict for duplicate name; 422 Unprocessable Entity for "cannot archive last architecture"; 404 Not Found for missing architecture; 400 Bad Request for malformed payload. Messages localised in the response body for the frontend to surface. | Standard REST. |
| 10 | **Liquibase changeset:** add a unique constraint on `(project_id, LOWER(name))` for `architecture` table. Done via a new changeset (092 or next sequential — never edit applied changesets per project memory). | Server-enforced uniqueness; case-insensitive. |
| 11 | **Modal infrastructure:** reuse existing pattern from `frontend/src/components/DiagramsView/modals/RenameDiagramModal.tsx` (overlay + header + content + footer with secondary/primary buttons). Archive confirmation modelled on `DeleteDiagramConfirmModal.tsx`. | Project-wide consistency. |
| 12 | **Tag chip primitive:** if a chip component already exists in the codebase, reuse it. If not, build a minimal one inside the Edit modal (chips with × to remove + text input). Keep it local until another consumer needs it. | Avoid premature abstraction. |
| 13 | **Manage Architectures modal location:** new file at `frontend/src/components/TopBar/ManageArchitecturesModal.tsx`. Edit/Create modal at `frontend/src/components/TopBar/EditArchitectureModal.tsx`. Archive confirmation at `frontend/src/components/TopBar/ArchiveArchitectureConfirmModal.tsx`. | Co-located with the selector that opens them. |
| 14 | **Archive of currently-active architecture:** the Archive confirmation modal explicitly warns: *"You're archiving the architecture you're currently viewing. You'll be moved to **<next>**."* — `<next>` resolved client-side as the project's new oldest non-archived after the to-be-archived row is excluded. After successful archive, the frontend explicitly navigates to the new architecture's URL. (Spec #2's `<ProjectLayout>` redirect would also catch a stale `:architectureId`, but explicit navigation is faster and cleaner.) | Belt and braces; matches the user's mental model of "OK → I'm now somewhere else". |
| 15 | **Archive of last architecture:** the Archive button on the only-remaining architecture is disabled with a tooltip: *"Cannot archive — every project must have at least one architecture."* The server also rejects with 422 as a safety net. | Defence in depth. |
| 16 | **Optimistic vs server-confirm:** all mutations are **server-confirm** (await the response before updating the local list). Tag chips and name fields don't get optimistic updates. | Simpler error handling; the list view has clear loading/error states. |
| 17 | **List refresh after mutation:** after any successful create/edit/archive, refetch `listArchitectures(projectId)` so the dropdown and the Manage modal update. The existing `ArchitectureContext` exposes `architectures` from spec #2 — extend it with a `refreshArchitectures()` callable. | Single source of truth in context. |
| 18 | **No tag autocomplete in this spec.** Tags are free-form text. Future spec could add per-project tag suggestions, but not here. | Scope. |
| 19 | **Empty state in Manage modal:** if a project somehow has only one architecture (the common case after spec #1), the modal still renders the row with Edit + (disabled) Archive. No special "you have no architectures" message — that state is impossible. | Reality of the data model. |
| 20 | **Test strategy:** Vitest tests covering (a) create flow with all fields populated; (b) edit flow updating name + description + tags; (c) archive flow including the "active architecture" warning and post-archive navigation; (d) archive button disabled on the last architecture; (e) duplicate-name validation surfaces the 409 inline; (f) tag chip add/remove. Plus backend integration tests for the new endpoints (status codes, validation, last-architecture protection). | Standard. |

---

## Out of Scope (deferred to later specs)

- **Discovery Service `architectureId` integration** → spec #4.
- **LLM persona/task save-target resolution** → spec #5.
- **Full clone** (duplicate architecture A into new B) → spec #6.
- **Selective cross-architecture copy** → spec #7.
- **Comparison** and **unarchive UI** → deferred indefinitely.
- **Per-architecture access control** — not in V1.
- **Tag autocomplete / suggestions / project-wide tag list view** — future spec.
- **Archived-architectures view** — would require unarchive UI to be useful.
- **Bulk operations** (archive multiple, retag multiple) — not in V1.

---

## Critical Files (anticipated)

**Backend (`architecture-model-service`):**
- `src/main/resources/db/changelog/sql/0XX-architecture-name-unique-constraint.sql` (new) — `UNIQUE (project_id, LOWER(name))` on `architecture`.
- `src/main/resources/db/changelog/db.changelog-master.yaml` (modify — register new changeset).
- `src/main/java/com/example/architecturemodel/controller/ArchitectureController.java` (modify) — add `POST`, `PATCH`, `POST /archive`.
- `src/main/java/com/example/architecturemodel/service/ArchitectureService.java` (modify) — `create`, `update`, `archive`, last-architecture protection, name-uniqueness checks.
- `src/main/java/com/example/architecturemodel/repository/ArchitectureRepository.java` (modify) — `existsByProjectIdAndNameIgnoreCase`, `countByProjectIdAndArchivedFalse`.
- `src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java` (modify) — map duplicate-name and last-architecture exceptions to 409 / 422.
- New tests in `src/test/java/com/example/architecturemodel/controller/` for the three new endpoints.

**Gateway:**
- `gateway/src/routes/architectures.ts` (modify) — proxy routes for `POST`, `PATCH`, `POST /archive` under `/api/projects/:projectId/architectures` and `/api/projects/:projectId/architectures/:architectureId`.
- `gateway/src/services/architectureModelClient.ts` (modify) — `createArchitecture`, `updateArchitecture`, `archiveArchitecture` functions.

**Frontend:**
- `frontend/src/api/architecturesApi.ts` (modify) — add `createArchitecture`, `updateArchitecture`, `archiveArchitecture`.
- `frontend/src/contexts/ArchitectureContext.tsx` (modify) — expose `refreshArchitectures()` for list refresh after mutations.
- `frontend/src/components/TopBar/ArchitectureSelector.tsx` (modify) — add separator + two footer entries (`+ Create architecture…`, `Manage architectures…`).
- `frontend/src/components/TopBar/EditArchitectureModal.tsx` (new) — `mode: 'create' | 'edit'`; name + description + tag chips.
- `frontend/src/components/TopBar/ManageArchitecturesModal.tsx` (new) — list with per-row Edit + Archive buttons.
- `frontend/src/components/TopBar/ArchiveArchitectureConfirmModal.tsx` (new) — confirmation modal with active-architecture warning.
- `frontend/src/components/TopBar/EditArchitectureModal.module.css` (new).
- `frontend/src/components/TopBar/ManageArchitecturesModal.module.css` (new).
- New Vitest test file(s) under `frontend/src/__tests__/` for the CRUD flows.

---

## Visual Assets

None provided. Modal layouts follow the established `RenameDiagramModal` / `DeleteDiagramConfirmModal` patterns; chip UI is a minimal local primitive.
