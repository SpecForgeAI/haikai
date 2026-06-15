# Spec #6 Requirements — Multi-Architecture Full Clone

**Spec folder:** `agent-os/specs/2026-05-01-multi-architecture-full-clone/`
**Design note:** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessors (shipped):**
- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/` — data model, all architecture-scoped tables.
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/` — URL routing + selector.
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/` — CRUD + tag management. Provides `EditArchitectureModal`, `ManageArchitecturesModal`, `ArchiveArchitectureConfirmModal`.
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/` — Discovery integration.
- Spec #5: `agent-os/specs/2026-05-01-multi-architecture-save-target-resolution/` — LLM persona save-target resolution.
**Raw idea:** `planning/raw-idea.md`

---

## Context

Full clone — duplicate architecture A into new architecture B. Core legacy-migration use case: user runs Discovery to capture current-state, then clones it as the basis for designing target-state. From the design note: "Selective copy of subsets" is deferred to spec #7; this is **atomic full duplicate** only.

**Hard constraints:**
- **Atomic** — single transaction, all-or-nothing. Failure rolls back the new architecture.
- **Fresh UUIDs** for every duplicated row (per spec #1's design-note rule that every meta-model element has a globally-unique UUID).
- **Reference rewiring** — every FK in duplicated rows pointing at another in-scope row must be remapped to the new id via a UUID-old-to-new map built during the duplication pass.
- **Threads NOT cloned** (project-scoped per spec #1's locked decision).
- **Discovery runs NOT cloned** (a Discovery run is a permanent record of "what was discovered for THIS architecture at THIS time"; cloning would create misleading provenance).
- **Cannot clone archived architectures** — refused both in UI (button hidden, since spec #3 already hides archived rows from `ManageArchitecturesModal`) and at backend (422 with `{code: "archived_source"}`).
- Must not regress any prior spec's behaviour.
- No Liquibase schema changes needed.

---

## Resolved Product/UX Decisions

### 1. Clone entry point — **per-row Clone button in `ManageArchitecturesModal` only**

Add a third action button on each row (alongside Edit + Archive): **Clone**. No selector dropdown footer entry — keeps the dropdown clean and avoids two parallel paths to the same workflow. Discoverability: users who want to clone naturally go to "Manage" first.

### 2. Clone modal name field — **pre-populated `Copy of <source-name>`, user can submit unchanged**

Pre-fill the name input with `Copy of <source-name>` (e.g. `Copy of Default`, `Copy of Current State`). User can edit before submit, or accept as-is. Spec #3's case-insensitive name uniqueness constraint guards collisions: a second clone of the same source produces a 409 the user must resolve inline.

### 3. Clone modal — copy description from source, tags start empty

- **Description**: pre-populated from source. User can edit.
- **Tags**: start empty. Tags often imply intent (e.g. cloning the `current-state` architecture to create `target-state` — copying the `current-state` tag would be wrong).

### 4. Post-clone navigation — **auto-navigate to new architecture**

On successful clone: call `setActiveArchitecture(newArchitectureId)` from `useArchitectureContext()` so the URL switches to the new architecture and the user lands in its view. Mirrors spec #3's create-modal behaviour. Show a brief success toast (`"Cloned <source-name> as <new-name>"`).

### 5. Cloning archived architectures — **refused**

Clone button is not rendered for archived rows in `ManageArchitecturesModal`. Since spec #3 already hides archived rows from the Manage modal entirely, this is automatically true today. Backend additionally rejects with 422 `{code: "archived_source"}` as a defence-in-depth check (in case a stale frontend tries).

### 6. Clone scope — **everything architecture-scoped**

Every row in every table that has an `architecture_id` column from spec #1's migration gets cloned. The implementer compiles the concrete table list during write-spec from a sweep of `architecture-model-service/src/main/resources/db/changelog/sql/0XX-*.sql` (the migration that added the column). Per design note: "Fully isolated — no cross-variant references"; partial clone would leave inconsistent state. **"Full" means full** — selective copy is spec #7's job.

**Excluded** from the clone (matching spec #1's exclusion list for the `architecture_id` column rollout):
- Threads (project-scoped, file-based, not in DB).
- `discovery_*` tables (Discovery's own state — locked out by decision per `raw-idea.md`).
- All project-scoped tables: `project`, `delivery_teams`, `organisations`, `work_item*`, `project_artifact`, `product_definitions`.

---

## Decisions Made Inline (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 7 | **Backend endpoint:** `POST /api/projects/{projectId}/architectures/{sourceArchitectureId}/clone` with body `{name, description?, tags?: string[]}`. Returns 201 + new architecture DTO. | Path-segment URL consistent with spec #1's Bucket A pattern. Body shape matches `EditArchitectureModal`'s submit payload from spec #3. |
| 8 | **Atomic transaction:** wrap the entire clone (architecture row insert + per-table data duplication + tag copy) in a single `@Transactional` boundary. Spring rolls back on any exception. | Non-negotiable per "atomic, all or nothing" rule. |
| 9 | **UUID-old-to-new map strategy:** clone in dependency order — architecture row first, then base entities (applications, services, business processes, etc.), then dependent rows (relationships, diagrams, app_business_points, etc.). At each insert, generate a fresh UUID and record `oldId → newId` in an in-memory map. When cloning dependent rows, look up FK columns in the map to remap. | Standard graph-clone pattern. The map is per-clone-call only — no persistence. |
| 10 | **Validation:** name non-empty + ≤100 chars + unique within project (case-insensitive — already enforced by spec #3's Liquibase 092 unique index, which fires 409 on conflict). Description ≤500 chars. Tags ≤50 chars each. | Reuse spec #3's existing validation rules. |
| 11 | **Backend service method:** `ArchitectureService.cloneArchitecture(projectId, sourceArchitectureId, payload)`. Implementation calls `validateAndTrimName/Description/Tags` (already in spec #3), creates the new architecture row, then iterates the in-scope table list duplicating rows with FK rewiring. | Service layer pattern from spec #3. |
| 12 | **Refuse archived source at backend:** if `source.archived === true`, throw new `ArchivedArchitectureSourceException` mapped to 422 `{code: "archived_source"}`. | Defence in depth — UI already filters but server is source of truth. |
| 13 | **Refuse self-clone:** the source `architectureId` must exist in the project. 404 if missing (existing pattern). | Standard. |
| 14 | **No new architecture-side `clone` Liquibase changeset.** Schema unchanged. | Per the locked rules. |
| 15 | **Concrete table list compilation:** during write-spec or implement-tasks, sweep changeset 089 (`add-architecture-id-columns.sql`) for the authoritative list. Document inline in the new clone service's class-level Javadoc so future contributors understand the scope. | Same approach spec #1 used to compile the column-rollout list. |
| 16 | **Gateway proxy route:** new `POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone` proxy in `gateway/src/routes/architectures.ts`. Pass-through. Forwards 201 + DTO; forwards 422 `archived_source`, 409 `duplicate_name`, 400 validation errors verbatim (per spec #3's error-envelope round-trip rule). | Mirror spec #3's CRUD proxy pattern. |
| 17 | **Frontend API client:** add `cloneArchitecture(projectId, sourceArchitectureId, payload): Promise<Architecture>` to `frontend/src/api/architecturesApi.ts`. Throws `ArchitecturesApiError` (existing typed error from spec #3) with `{status, body.code}` for inline handling. | Reuse spec #3's typed error class. |
| 18 | **Frontend modal component:** new `frontend/src/components/TopBar/CloneArchitectureModal.tsx`. **Do NOT extend `EditArchitectureModal` with a `mode='clone'`** — clone has different defaults (description copied, tags empty), different submit label (`Clone` not `Save changes`), different success copy. Cleaner as its own component. Reuses the same modal shell + chip primitive. Props: `{ open, onClose, projectId, source: Architecture }`. | Avoid `mode` prop overload; small file, low duplication. |
| 19 | **Manage Architectures modal extension:** add per-row `Clone` button next to Edit + Archive. Opens `<CloneArchitectureModal>` with the row's architecture as the source. Modal closes on successful clone, refreshes architectures list, navigates to new architecture. | Mirror spec #3's per-row action wiring. |
| 20 | **`ArchitectureContext.refreshArchitectures()`** is called after successful clone (already exists from spec #3) to repopulate the dropdown and Manage modal. | Reuse. |
| 21 | **Error surfacing in modal:** 409 `duplicate_name` → inline error under name field (reuse spec #3's `EditArchitectureModal` pattern). 422 `archived_source` → footer error (rare; UI already filters). 400 validation → footer error. | Mirror spec #3. |
| 22 | **Test strategy:** Backend integration test for `cloneArchitecture` service — verifies (a) new architecture row created, (b) every in-scope meta-model row duplicated with fresh UUIDs, (c) FK references correctly rewired (e.g. relationship's `source_entity_id` points at the cloned entity, not the source's), (d) atomic rollback on a forced exception, (e) 422 on archived source, (f) 409 on duplicate name. Frontend test for `CloneArchitectureModal` — verifies field defaults + submit + post-clone navigation. Gateway proxy test for round-trip + error envelope. | Standard. |

---

## Out of Scope (deferred)

- **Selective cross-architecture element copy** → spec #7.
- **Cross-architecture element migration / merging** → spec #7.
- **Comparison and unarchive UI** → deferred indefinitely.
- **Cloning into a different project** — not in V1.
- **Cloning from selector dropdown footer** — explicit decision in #1; only the Manage modal exposes Clone.
- **Cloning Discovery runs / threads** — locked out per scope.
- **Async / background clone with progress UI** — V1 is synchronous (transaction blocks the request). If clones become slow on large meta-models, a future spec adds async + progress indication.

---

## Critical Files (anticipated)

**Backend (`architecture-model-service`):**
- `src/main/java/com/example/architecturemodel/exception/ArchivedArchitectureSourceException.java` (new) — mapped to 422 in `GlobalExceptionHandler`.
- `src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java` (modify) — add the 422 mapping.
- `src/main/java/com/example/architecturemodel/service/ArchitectureService.java` (modify) — add `cloneArchitecture(projectId, sourceArchitectureId, payload)`. Class-level Javadoc lists the in-scope table set authoritatively.
- Per-table service / repository touchpoints — depending on architecture, the clone may delegate to a dedicated `ArchitectureCloneService` that orchestrates the per-table inserts + FK rewiring. Implementer's call.
- `src/main/java/com/example/architecturemodel/controller/ArchitectureController.java` (modify) — add `POST /clone`.
- `src/test/java/com/example/architecturemodel/controller/ArchitectureCloneControllerTest.java` (new).
- `src/test/java/com/example/architecturemodel/service/ArchitectureCloneServiceTest.java` (new) — graph-clone correctness tests.

**Gateway:**
- `gateway/src/routes/architectures.ts` (modify) — add clone proxy route.
- `gateway/src/services/architectureModelClient.ts` (modify) — `cloneArchitecture(projectId, sourceArchitectureId, payload)` helper.

**Frontend:**
- `frontend/src/api/architecturesApi.ts` (modify) — add `cloneArchitecture` function.
- `frontend/src/components/TopBar/CloneArchitectureModal.tsx` (new) — clone form modal.
- `frontend/src/components/TopBar/CloneArchitectureModal.module.css` (new).
- `frontend/src/components/TopBar/CloneArchitectureModal.test.tsx` (new).
- `frontend/src/components/TopBar/ManageArchitecturesModal.tsx` (modify) — add per-row Clone button + modal wiring.
- `frontend/src/components/TopBar/ManageArchitecturesModal.test.tsx` (modify) — add Clone-button visibility + click test.

---

## Visual Assets

None provided. Modal mirrors `EditArchitectureModal.tsx` shell + tag-chip primitive; per-row Clone button in Manage modal mirrors Edit / Archive button styling.
