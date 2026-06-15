# Specification: Multi-Architecture Full Clone (Spec #6)

## Goal
Add an atomic, transactional "full clone" workflow that duplicates an existing architecture (and every architecture-scoped meta-model row) into a brand-new architecture within the same project, so that the core legacy-migration use case — capture current-state via Discovery, then clone it as the seed for designing target-state — is supported end-to-end.

## User Stories
- As an architect, I want to clone an existing architecture from a per-row button in the Manage Architectures modal so that I can seed a new variant (e.g. target-state) from a known-good baseline (e.g. current-state) without manually re-creating every entity, relationship, and diagram.
- As a user, I want the clone modal to pre-fill `Copy of <source-name>` and the source's description (with empty tags) so that submitting in two clicks is realistic but I retain full control over the new architecture's identity.
- As a user, I want to land in the cloned architecture immediately on success so that I can start working in the new variant without an extra navigation step.

## Specific Requirements

**Backend clone endpoint (`architecture-model-service`)**
- `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` — body `{name, description?, tags?: string[]}`; returns `201 Created` plus the new architecture DTO (same shape as spec #3's create response).
- Path-segment URL is consistent with spec #1's Bucket A pattern; gateway proxy forwards verbatim.
- Validates `name` non-empty / ≤100 chars / unique within project (case-insensitive — reuses spec #3's Liquibase 092 unique index, fires 409 on conflict), `description` ≤500 chars, each `tag` ≤50 chars after trim. Reuse `validateAndTrimName/Description/Tags` helpers from spec #3.
- Refuses cloning of an archived source: if `source.archived === true`, throw `ArchivedArchitectureSourceException` mapped to HTTP 422 with body `{code: "archived_source"}` — defence-in-depth (UI already hides archived rows from the Manage modal).
- Returns 404 if `sourceArchitectureId` does not exist within the project.
- No Liquibase changeset added — the schema is unchanged.

**Atomic transaction with FK rewiring**
- New `ArchitectureService.cloneArchitecture(projectId, sourceArchitectureId, payload)` (or a delegated `ArchitectureCloneService` orchestrator — implementer's choice) wraps the entire clone in a single Spring `@Transactional` boundary. Any thrown exception triggers a full rollback so partially cloned state never leaks.
- Insert order: (1) the new `architecture` row + tag rows, (2) base meta-model entities (applications, services, business processes, data entities, etc.), (3) dependent rows that reference the base entities (relationships, diagrams + diagram children, app_business_points, *_relationships join tables, etc.).
- Maintain an in-memory `Map<UUID, UUID>` (`oldId → newId`) populated as each row is inserted with a freshly generated UUID; when cloning dependent rows, look up every architecture-scoped FK column in the map and substitute the new id. Map is per-call only — never persisted.
- Class-level Javadoc on the clone service authoritatively documents the in-scope table list (compiled by sweeping changeset `089-add-architecture-id-columns.sql` from spec #1) so future contributors understand what is and isn't cloned.

**Clone scope — every table with an `architecture_id` column**
- The clone duplicates rows from every table that received an `architecture_id` column in spec #1's changeset 089 (the same authoritative list spec #1 used for the column rollout).
- Excluded from the clone (matching spec #1's exclusion list):
  - **Threads** — project-scoped, file-based, never written to DB; remain untouched.
  - **All `discovery_*` tables** — Discovery runs are permanent, time-stamped records of "what was discovered for THIS architecture at THIS time"; cloning them would create misleading provenance.
  - **All project-scoped tables** — `project`, `delivery_teams`, `organisations`, `work_item*`, `project_artifact`, `product_definitions`.

**Gateway proxy**
- Add `POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone` in `gateway/src/routes/architectures.ts` — pass-through proxy mirroring spec #3's CRUD route shape.
- Add `cloneArchitecture(projectId, sourceArchitectureId, payload)` helper to `gateway/src/services/architectureModelClient.ts`.
- Forwards 201 + DTO, 422 `archived_source`, 409 `duplicate_name`, 400 validation envelopes verbatim per spec #3's error round-trip rule.

**Frontend API client**
- Add `cloneArchitecture(projectId, sourceArchitectureId, payload): Promise<Architecture>` to `frontend/src/api/architecturesApi.ts`.
- Throws `ArchitecturesApiError` (typed error class introduced in spec #3) carrying `{status, body.code}` so the modal can switch on `409 duplicate_name`, `422 archived_source`, and `400` envelopes.

**`CloneArchitectureModal` (new component — do NOT extend `EditArchitectureModal`)**
- New file at `frontend/src/components/TopBar/CloneArchitectureModal.tsx` plus matching `.module.css` and `.test.tsx`.
- Props: `{ open, onClose, projectId, source: Architecture }`.
- Defaults: Name pre-populated with `Copy of <source.name>` (e.g. `Copy of Default`); Description pre-populated from `source.description`; Tags start empty (no chips pre-loaded).
- Submit button label: `Clone` (not `Save changes` / not `Create`); disabled while invalid or in flight.
- Reuses the shared modal shell + tag chip primitive from `EditArchitectureModal` but stays as its own component — keeps default-population logic, copy, and submit label distinct without overloading a `mode` prop.
- On successful clone: call `refreshArchitectures()` from `ArchitectureContext`, call `setActiveArchitecture(newArchitectureId)` so the URL and active-architecture context switch to the new variant, show a brief success toast (`Cloned <source.name> as <new-name>`), then close the modal.

**`ManageArchitecturesModal` extension**
- Add a third per-row action button — **Clone** — alongside the existing Edit + Archive buttons from spec #3 (same button styling pattern).
- Clicking Clone opens `<CloneArchitectureModal>` with the row's architecture as `source`.
- No selector dropdown footer entry for Clone — Clone lives only in the Manage modal; this avoids two parallel paths into the same workflow and keeps the dropdown a clean name-only chooser (decision locked in requirements #1).
- Archived architectures continue to be filtered out of the Manage modal (per spec #3) — the Clone button is therefore inherently unreachable for archived rows from the UI.

**Error surfacing in the Clone modal**
- 409 `duplicate_name` → inline error rendered under the Name field; modal stays open. Mirrors spec #3's `EditArchitectureModal` 409 handling.
- 422 `archived_source` → footer error banner (rare path — UI already filters archived rows but a stale frontend or race condition could still hit it).
- 400 validation → footer error banner with the server message.
- All other errors → generic footer error message; modal stays open so the user can retry.

**Test strategy**
- Backend integration test for `cloneArchitecture` verifying: (a) new `architecture` row created with the requested name/description/tags, (b) every in-scope meta-model row duplicated with a fresh UUID, (c) FK references correctly rewired (e.g. a cloned relationship's `source_entity_id` points at the cloned entity, not the source's), (d) atomic rollback on a forced exception leaves zero new rows in any table, (e) 422 on archived source, (f) 409 on duplicate name, (g) excluded tables (threads file storage, `discovery_*`) are untouched.
- Gateway test verifying the proxy round-trips the success DTO and the three error envelopes (409, 422, 400) verbatim.
- Frontend Vitest tests for `CloneArchitectureModal`: (a) Name pre-populated as `Copy of <source-name>`, (b) Description pre-populated from source, (c) Tags start empty, (d) submit calls `cloneArchitecture` with the trimmed payload, (e) success path calls `refreshArchitectures` + `setActiveArchitecture(newId)` + closes the modal, (f) 409 surfaces inline under Name, (g) 422 `archived_source` surfaces in footer.
- Updates to `ManageArchitecturesModal.test.tsx` asserting the per-row Clone button is rendered and opens `CloneArchitectureModal` wired with the correct source row.

## Existing Code to Leverage

**`EditArchitectureModal.tsx` + tag chip primitive (spec #3)**
- Modal shell pattern (portal overlay + header + scrollable content + footer with Cancel / primary buttons; click-outside; Esc to dismiss; primary disabled until valid) is the direct template for `CloneArchitectureModal`.
- The local tag chip primitive (chips with `×` to remove + Enter/comma-to-add input + trim/dedupe/empty-rejection/50-char enforcement) is reused as-is — copy or extract a shared minimal helper, but do not extend `EditArchitectureModal` itself with a `mode='clone'`.

**`ManageArchitecturesModal.tsx` (spec #3)**
- Per-row Edit + Archive button wiring (right-aligned action group with click handlers opening modals against the row's architecture) is the pattern the new Clone button follows.
- Archived-row filtering and last-architecture protection logic stay untouched — Clone simply slots in as a third action.

**`ArchitectureContext` — `refreshArchitectures()` + `setActiveArchitecture()` (specs #2 + #3)**
- `refreshArchitectures()` is called after a successful clone to repopulate the dropdown and Manage modal — same pattern Edit / Archive / Create modals already use.
- `setActiveArchitecture(newArchitectureId)` drives the post-clone navigation, mirroring spec #3's create-modal behaviour.

**`ArchitecturesApiError` typed error (spec #3)**
- Existing error class with `{status, body}` shape — `cloneArchitecture` throws it on non-2xx responses so `CloneArchitectureModal` can branch on `body.code` for inline vs footer rendering.

**`ArchitectureService` + `GlobalExceptionHandler` (specs #1 + #3)**
- Existing service-layer pattern (validation helpers, repository wiring, Spring `@Transactional` usage) extends naturally with `cloneArchitecture`.
- `GlobalExceptionHandler` already maps `DuplicateArchitectureNameException` → 409 and the last-architecture exception → 422; add a parallel mapping for the new `ArchivedArchitectureSourceException` → 422 with `{code: "archived_source"}`.

## Out of Scope
- Selective cross-architecture element copy with conflict resolution → spec #7.
- Cross-architecture element migration / merging → spec #7.
- Cloning into a different project (V1 is same-project only).
- Cloning Discovery runs or threads (locked out per scope — Discovery runs are permanent provenance, threads are project-scoped).
- Comparison / diffing UI and unarchive UI (deferred indefinitely).
- A Clone entry in the selector dropdown footer (explicit decision — Manage modal owns the workflow).
- Async / background clone with progress UI; V1 is synchronous and the request blocks for the duration of the transaction.
- Any Liquibase schema changes (clone is purely a data-level operation).
- Optimistic / partial clone responses — the clone is all-or-nothing and the modal awaits completion before closing.
