# Spec #7 Requirements — Multi-Architecture Selective Cross-Architecture Copy

**Spec folder:** `agent-os/specs/2026-05-01-multi-architecture-selective-copy/`
**Design note:** `agent-os/design-notes/multi-architecture-variants.md`
**Predecessors (all shipped):**
- Spec #1: `agent-os/specs/2026-05-01-multi-architecture-plumbing/`
- Spec #2: `agent-os/specs/2026-05-02-multi-architecture-selector-and-routing/`
- Spec #3: `agent-os/specs/2026-05-02-multi-architecture-crud-and-tags/`
- Spec #4: `agent-os/specs/2026-05-01-multi-architecture-discovery-integration/`
- Spec #5: `agent-os/specs/2026-05-01-multi-architecture-save-target-resolution/`
- Spec #6: `agent-os/specs/2026-05-01-multi-architecture-full-clone/` — `ArchitectureCloneService` (generic JdbcTemplate per-table cloning + UUID-old-to-new map). **Directly reusable for selective copy.**
**Raw idea:** `planning/raw-idea.md`

---

## Context

This is the **final spec** in the multi-architecture-variants initiative. Selective cross-architecture copy: user picks specific entities / relationships / diagrams from a source architecture and copies them into a target architecture (the currently active one). The legacy-migration use case extends to: "I cloned current-state to start target-state, but as I work I realise I want to selectively pull a few more bits from current-state without re-cloning."

**Hard constraints (locked in design note + this conversation):**
- Per-element interactive conflict resolution with upfront summary screen showing total conflict count.
- Element ids are globally-unique UUIDs — same UUID in source and target = clear conflict.
- Conflict resolution actions (V1): **skip / overwrite / duplicate-with-new-id**.
- Atomic — commit is all-or-nothing transaction.
- Refuse archived source architectures (consistent with spec #6).
- Threads + Discovery runs NOT copyable (consistent with spec #6 — file-based + Discovery's locked rules).
- Cross-project copy NOT supported.
- No Liquibase schema changes.

---

## Resolved Product/UX Decisions

### 1. Entry point — **per-row button in `ManageArchitecturesModal`**

Add a fourth per-row action button (alongside Edit, Clone, Archive): **`Copy from…`** (or `Selective copy…`). The row IS the **source**; target is always the currently active architecture. Wizard's first step displays this clearly: *"Copying from `<source>` into `<active-target>`"*.

**Disabled with tooltip** when the row IS the currently active architecture (`source.id === activeArchitectureId`): *"Cannot copy into itself — switch to a different architecture first."*

This mirrors spec #6's Clone exactly — no parallel paths, consistent discoverability.

### 2. Element picker UI — **collapsible tree by domain → entity type → instance, tri-state checkboxes**

- **Tree structure**: top-level groups by domain (Applications, Data, Business, UI, Behavioural, Diagrams). Within each domain: collapsible by entity type (e.g. `Applications > Services`). Within each type: instances listed with checkboxes.
- **Tri-state checkboxes** at every internal node — checking a domain checks all its types; checking a type checks all its instances; partial check shows the indeterminate state.
- **Search box** at top — filters visible nodes by name across all entity types.
- **Diagrams** are their own top-level group at the bottom of the tree (since they reference entities across all domains).
- Tree is read-only metadata view — clicking the entity name doesn't navigate anywhere; only the checkbox is interactive.

### 3. Cascading auto-selection — **smart fallback (UUID match → reuse; missing → auto-include with badge)**

When the user picks an element with FK references (e.g. a relationship referencing two applications, or a diagram referencing nodes):

- **If the referenced element already exists in the target by UUID match** → reuse the existing target element. No copy needed; no conflict; no auto-include.
- **If the referenced element is missing in the target** → auto-include it in the copy set, marked in the picker tree with an `auto-included` visual badge + tooltip (`"Auto-included because referenced by <X>"`).

Auto-included elements appear in the preflight summary as a separate group so nothing is hidden from the user. The user can manually un-tick an auto-included element, but doing so will cause the preflight to flag the parent as having a missing reference (and the commit will refuse with a clear error).

### 4. Per-conflict resolution UI — **bulk actions + inline overrides**

Preflight summary screen shows the conflict list. UI:
- Header strip with three bulk-action buttons: `Skip all` / `Overwrite all` / `Duplicate all`. Default state: all conflicts pre-set to **Skip** (safest non-destructive action).
- Per-row in the conflict list: element name + type + conflict reason + a three-radio-button group to override the default for that one element.
- Footer: `Cancel` (returns to picker step) + `Commit copy` (disabled if any unresolved errors like missing references).

### 5. "Many conflicts" threshold — **soft banner above 10 conflicts; do not hard-block**

If preflight reports more than 10 conflicts, render a soft banner above the list: *"Many conflicts detected (N). Consider cancelling and refining your selection — this often means the target already overlaps significantly with the source."* User can dismiss the banner and proceed to resolve. **No hard block.**

### 6. Post-copy summary — **single rich toast on success**

After successful commit:
- Wizard closes.
- Fire success toast: *"Copied N elements from `<source-name>` (skipped: X, overwrote: Y, duplicated: Z)"* — counts from the commit response.
- User is already in the target architecture (it's the active one) — they can navigate the meta-model to verify.
- `refreshArchitectures()` is called for completeness (in case the copy created any tags or metadata changes — none expected in V1, but safe).

---

## Decisions Made Inline (technical — no user input needed)

| # | Decision | Rationale |
|---|---|---|
| 7 | **Two-phase backend API:** `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight` (body `{sourceArchitectureId, elementIds: [...]}`) returns conflict report. `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit` (body `{sourceArchitectureId, elementIds: [...], resolutions: [{elementId, action: 'skip'|'overwrite'|'duplicate'}]}`) returns summary `{copied, skipped, overwritten, duplicated, autoIncluded}`. | Two-phase keeps the user-facing flow predictable and allows the UI to render the picker → preflight → resolution → commit progression cleanly. |
| 8 | **Preflight response shape:** `{conflicts: [{elementId, elementType, name, conflictReason: 'same_uuid'|'missing_reference', referencedBy?: [...]}], autoIncluded: [{elementId, elementType, name, includedBecause: '<parent>'}], summary: {totalSelected, conflictCount, autoIncludedCount, willCopyCount}}`. | Includes auto-include report so nothing is hidden. |
| 9 | **Atomic commit** wrapped in `@Transactional`. Any per-element insert/update failure rolls back the entire copy. | Non-negotiable per locked rules. |
| 10 | **Reuse `ArchitectureCloneService`'s generic JdbcTemplate + DatabaseMetaData per-table mechanism** — the new `ArchitectureSelectiveCopyService` calls a per-table copy method that accepts an id-filter (only copy rows matching the elementIds). FK rewiring uses the same UUID-old-to-new map approach. The 60-table in-scope list from spec #6 directly applies. | Maximises code reuse; reduces test surface to "selective semantics on top of clone semantics". |
| 11 | **Conflict detection (UUID match)**: for every elementId in the user's selection set, query target architecture's corresponding table for an existing row with the same id. If present → conflict (`same_uuid`). | Globally-unique-UUID rule from spec #1 means same id = conceptually same element. |
| 12 | **Conflict resolution semantics**: `skip` — element not copied; `overwrite` — target row UPDATEd with source row's data (id preserved); `duplicate` — element copied with NEW UUID, FKs from other elements in the copy set rewired to the new id (other elements keep references intact); references TO this element from non-copied target elements are NOT updated (would be cross-element scope creep). | Matches the design note's three actions. The 'duplicate' action's reference rewiring is local to the copy set — anything outside the copy set is untouched. |
| 13 | **Missing-reference detection**: for every selected element with FK columns, check whether each referenced id exists in the target (either pre-existing or in the copy set itself). If missing → flag as `missing_reference`. The auto-include logic from decision #3 handles this proactively (auto-includes missing refs into the copy set). The user can un-tick an auto-included element, which would re-surface the missing-reference error at preflight; commit refuses if any unresolved missing references remain. | Reference integrity is non-negotiable; auto-include is the helpful default; user can override but commit holds the line. |
| 14 | **Refuse archived source**: backend throws new `ArchivedArchitectureSourceException` (already exists from spec #6) → 422 `{code: "archived_source"}`. UI hides the `Copy from…` button for archived rows (already inherent — Manage modal hides archived rows per spec #3). | Defence in depth; reuse existing exception type. |
| 15 | **Refuse same-architecture self-copy**: backend throws 422 `{code: "same_architecture", message: "Cannot selectively copy into the same architecture"}`. UI also disables the button when row.id === activeArchitectureId per decision #1. | Defence in depth. |
| 16 | **No new schema, no new Liquibase changesets.** | Per locked constraints. |
| 17 | **Frontend wizard component**: new `frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx` — a multi-step modal (overlay shell from spec #6's `CloneArchitectureModal.tsx`). Step 1: source/target confirmation header. Step 2: element picker tree. Step 3: preflight summary + conflict resolution (collapsed if zero conflicts, fast-path direct to commit). Step 4: success toast (modal closes). Stepper indicator at the top. | Wizard pattern within a single modal keeps state cohesive. |
| 18 | **Picker tree component**: new `frontend/src/components/TopBar/SelectiveCopyElementPicker.tsx` — receives the source architecture's full element inventory + handles checkbox state + auto-include badging. Backend provides the inventory via a new lightweight `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory` endpoint that returns `{domains: [{name, types: [{name, instances: [{id, name, archived?}]}]}]}` for tree rendering. | Inventory endpoint is read-only meta and reusable for future selective-copy variants. |
| 19 | **Search and tri-state**: search input filters tree client-side (no API round-trip). Tri-state checkbox state is computed from descendant state. | Standard React patterns. |
| 20 | **Conflict-resolution component**: new `frontend/src/components/TopBar/SelectiveCopyConflictResolution.tsx` — receives preflight result + emits resolution map. Bulk-action buttons set the default for all rows; per-row radios override. Default on first render: all-Skip. | Self-contained component; testable in isolation. |
| 21 | **Frontend API client**: add `selectiveCopyPreflight(projectId, targetArchitectureId, payload)` and `selectiveCopyCommit(projectId, targetArchitectureId, payload)` to `frontend/src/api/architecturesApi.ts`. Both return typed responses; throw `ArchitecturesApiError` on non-2xx. | Reuse spec #3's typed error class. |
| 22 | **Gateway proxy**: two new pass-through routes in `gateway/src/routes/architectures.ts`. Byte-for-byte error envelope round-trip. | Same pattern as spec #6 clone proxy. |
| 23 | **Test strategy**: Backend integration test (`@SpringBootTest` + H2) for graph-correctness — selective copy of a partial subset preserves FK rewiring within the subset; conflict resolution actions (skip/overwrite/duplicate) each tested; auto-include path exercised; refuse-archived 422; refuse-same-architecture 422. Backend unit tests for service-layer logic. Gateway proxy tests. Frontend tests for picker tree (tri-state, search, auto-include badging), conflict resolution component (bulk + per-row), wizard step progression. | Mirror spec #6's testing depth. |

---

## Out of Scope (deferred indefinitely)

- **Comparison UI** between architectures.
- **Unarchive UI**.
- **Cross-project copy** (different project).
- **Copying threads + Discovery runs** (locked).
- **Selective copy from selector dropdown footer** — only `ManageArchitecturesModal` per-row entry.
- **"What was copied" highlight overlay** in the target architecture's view (would require canvas integration; toast suffices for V1).
- **Copy as link** (i.e. shared element across architectures) — design note explicitly locks "fully isolated" — there are no cross-architecture references.
- **Bulk-select across architectures** (copy from multiple sources in one wizard) — V1 is one-source-at-a-time.

---

## Critical Files (anticipated)

**Backend (`architecture-model-service`):**
- `src/main/java/com/example/architecturemodel/service/ArchitectureSelectiveCopyService.java` (new) — preflight + commit logic. Class-level Javadoc references the same in-scope-table list documented in `ArchitectureCloneService`.
- `src/main/java/com/example/architecturemodel/service/ArchitectureElementInventoryService.java` (new) — builds the tree structure for the picker.
- `src/main/java/com/example/architecturemodel/controller/ArchitectureController.java` (modify) — add 3 endpoints (preflight, commit, elements-inventory).
- `src/main/java/com/example/architecturemodel/exception/SameArchitectureCopyException.java` (new) — mapped to 422 in `GlobalExceptionHandler`.
- `src/main/java/com/example/architecturemodel/exception/GlobalExceptionHandler.java` (modify) — add `same_architecture` mapping.
- DTOs (new): `SelectiveCopyPreflightRequest`, `SelectiveCopyPreflightResponse`, `SelectiveCopyCommitRequest`, `SelectiveCopyCommitResponse`, `ElementInventoryResponse` (with nested domain/type/instance shape).
- New tests: `ArchitectureSelectiveCopyServiceTest.java`, `ArchitectureSelectiveCopyControllerTest.java`, `ArchitectureSelectiveCopyIntegrationTest.java`, `ArchitectureElementInventoryServiceTest.java`.

**Gateway:**
- `gateway/src/routes/architectures.ts` (modify) — add 3 proxy routes.
- `gateway/src/services/architectureModelClient.ts` (modify) — add `selectiveCopyPreflight`, `selectiveCopyCommit`, `getElementsInventory` helpers.
- New tests in `gateway/src/__tests__/multiArchitectureSelectiveCopyProxy.test.ts`.

**Frontend:**
- `frontend/src/api/architecturesApi.ts` (modify) — add 3 client functions + types.
- `frontend/src/components/TopBar/SelectiveCopyWizardModal.tsx` (new) — outer wizard modal.
- `frontend/src/components/TopBar/SelectiveCopyWizardModal.module.css` (new).
- `frontend/src/components/TopBar/SelectiveCopyElementPicker.tsx` (new) — tree + checkboxes + search.
- `frontend/src/components/TopBar/SelectiveCopyElementPicker.module.css` (new).
- `frontend/src/components/TopBar/SelectiveCopyConflictResolution.tsx` (new) — bulk + per-row resolution.
- `frontend/src/components/TopBar/SelectiveCopyConflictResolution.module.css` (new).
- `frontend/src/components/TopBar/ManageArchitecturesModal.tsx` (modify) — add per-row `Copy from…` button + nested wizard wiring (mirror Clone wiring from spec #6 Group 7).
- `frontend/src/components/TopBar/ManageArchitecturesModal.test.tsx` (modify) — add Copy-from button visibility + click test (regression).
- New tests: `SelectiveCopyWizardModal.test.tsx`, `SelectiveCopyElementPicker.test.tsx`, `SelectiveCopyConflictResolution.test.tsx`.

---

## Visual Assets

None provided. UI follows established patterns: wizard modal mirrors `CloneArchitectureModal` shell; tree picker uses standard collapsible group + indeterminate-checkbox patterns; conflict-resolution component uses same modal-content styling as spec #6 modals.
