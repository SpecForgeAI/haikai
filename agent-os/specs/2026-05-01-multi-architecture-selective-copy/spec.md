# Specification: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)

## Goal
Add a per-element interactive workflow that copies a chosen subset of entities, relationships, and diagrams from a source architecture into the currently active target architecture in the same project, with two-phase preflight + atomic commit semantics, smart cascading auto-include, and bulk-or-per-row conflict resolution — closing out the multi-architecture-variants initiative by supporting "I cloned current-state, and now I want to selectively pull a few more bits across without re-cloning."

## User Stories
- As an architect, I want to pick specific entities, relationships, and diagrams from another architecture and copy them into the architecture I am working in so that I can selectively borrow elements without re-cloning the whole source.
- As a user, I want a clear preflight summary of which selected elements conflict (same UUID already in target) and which referenced elements were auto-included so that I can resolve issues confidently before anything is written.
- As a user, I want bulk skip / overwrite / duplicate actions plus per-row overrides so that I can resolve large conflict lists quickly while still fine-tuning individual elements.

## Specific Requirements

**Two-phase backend API (preflight + commit) on `architecture-model-service`**
- `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/preflight` — body `{sourceArchitectureId, elementIds: string[]}`; returns `{conflicts: [{elementId, elementType, name, conflictReason: 'same_uuid'|'missing_reference', referencedBy?: [...]}], autoIncluded: [{elementId, elementType, name, includedBecause}], summary: {totalSelected, conflictCount, autoIncludedCount, willCopyCount}}`. No state mutation.
- `POST /api/projects/{projectId}/architectures/{targetArchitectureId}/selective-copy/commit` — body `{sourceArchitectureId, elementIds: string[], resolutions: [{elementId, action: 'skip'|'overwrite'|'duplicate'}]}`; returns `{copied, skipped, overwritten, duplicated, autoIncluded}`.
- `GET /api/projects/{projectId}/architectures/{architectureId}/elements-inventory` — read-only meta endpoint returning `{domains: [{name, types: [{name, instances: [{id, name, archived?}]}]}]}` for the picker tree (Applications, Data, Business, UI, Behavioural, Diagrams).
- All three endpoints return 404 if either architecture id is missing within the project; 422 `{code: "archived_source"}` if the source is archived; 422 `{code: "same_architecture"}` if `sourceArchitectureId === targetArchitectureId`.
- No Liquibase changeset added — the schema is unchanged.

**Atomic transactional commit with FK rewiring**
- New `ArchitectureSelectiveCopyService.commit(...)` wraps the entire commit in a single Spring `@Transactional` boundary; any per-element insert/update failure rolls back the whole copy.
- Reuses spec #6's generic JdbcTemplate + `DatabaseMetaData` per-table copy mechanism, extended with an id-filter argument (only copy rows whose primary key is in the resolved element-id set) and the same `Map<UUID, UUID>` (`oldId → newId`) FK-rewiring strategy. The 60 in-scope architecture-scoped tables enumerated in `ArchitectureCloneService`'s class-level Javadoc apply unchanged.
- Insert order mirrors the clone service: base entities first (applications, data entities, business processes, etc.), then relationships and diagrams + diagram children + join tables.
- The FK rewire map is per-call only — never persisted.

**Conflict detection (UUID match)**
- For every elementId in the user's selection set (after auto-include resolution), query the corresponding architecture-scoped table for a row in the target architecture with the same id. If present → `conflictReason: 'same_uuid'`. The globally-unique-UUID rule from spec #1 means same id = conceptually the same element.
- Conflict reasons are exposed as a discriminated string so future variants (e.g. name collision) can extend the enum without breaking the contract.

**Conflict resolution semantics (skip / overwrite / duplicate)**
- `skip` — element not copied; FK references in other copied elements that point at this id remain pointing at the existing target row (which already has that id, by definition of the conflict).
- `overwrite` — target row UPDATEd in place using the source row's column values; id preserved; downstream references unchanged.
- `duplicate` — element copied with a freshly generated UUID; FK references from OTHER elements in the copy set are rewired to the new id via the same `oldId → newId` map; references from non-copied target elements are NOT updated (out of scope by design — local rewiring only).
- Default resolution on the preflight summary: every conflict pre-set to **Skip** (safest non-destructive action).

**Smart cascading auto-include with UUID-match fallback**
- When a selected element has FK references (e.g. a relationship's source/target entity, a diagram's referenced nodes), the preflight resolves each reference as follows:
  - If the referenced id already exists in the target by UUID match → reuse the existing target element silently. No copy, no conflict, no auto-include entry.
  - If the referenced id is missing in the target → auto-include it in the copy set, surfaced in `autoIncluded` with `includedBecause: '<parent name>'` and rendered in the picker tree with an `auto-included` badge + tooltip.
- Auto-included elements appear in the preflight summary as a clearly-labelled separate group so nothing is hidden from the user.
- The user may manually un-tick an auto-included element; doing so re-runs preflight and surfaces a `missing_reference` conflict for the parent. The commit endpoint refuses with 422 `{code: "missing_reference"}` if any unresolved missing references remain at submit time.

**"Many conflicts" soft banner (no hard block)**
- If preflight reports more than 10 conflicts, the resolution screen renders a soft banner above the list: *"Many conflicts detected (N). Consider cancelling and refining your selection — this often means the target already overlaps significantly with the source."*
- The banner is dismissible and informational only; the user may proceed to resolve and commit. No threshold-based hard block in V1.

**Refuse archived source + same-architecture self-copy**
- Backend reuses spec #6's `ArchivedArchitectureSourceException` → 422 `{code: "archived_source"}` when the source row's `archived === true`.
- New `SameArchitectureCopyException` → 422 `{code: "same_architecture", message: "Cannot selectively copy into the same architecture"}` when `sourceArchitectureId === targetArchitectureId`.
- Both mappings live in `GlobalExceptionHandler`, mirroring spec #3 + spec #6 envelope shapes.

**Excluded from selective copy (never offered in inventory)**
- **Threads** — project-scoped, file-based; never copyable.
- **All `discovery_*` tables** — Discovery's locked "one run → one architecture" rule + immutable provenance preclude copying.
- **All project-scoped tables** — `project`, `delivery_teams`, `organisations`, `work_item*`, `project_artifact`, `product_definitions`. Same exclusion list as spec #6.

**Gateway proxy**
- Three new pass-through routes in `gateway/src/routes/architectures.ts` (`POST .../selective-copy/preflight`, `POST .../selective-copy/commit`, `GET .../elements-inventory`).
- Add `selectiveCopyPreflight`, `selectiveCopyCommit`, `getElementsInventory` helpers to `gateway/src/services/architectureModelClient.ts`.
- Status codes and error envelopes round-tripped byte-for-byte (404, 409, 422 `archived_source`, 422 `same_architecture`, 422 `missing_reference`, 400 validation), matching spec #3 + spec #6 conventions.

**Frontend API client**
- Add `selectiveCopyPreflight(projectId, targetArchitectureId, payload)`, `selectiveCopyCommit(projectId, targetArchitectureId, payload)`, and `getElementsInventory(projectId, architectureId)` to `frontend/src/api/architecturesApi.ts`.
- All three throw `ArchitecturesApiError` (typed error from spec #3) on non-2xx so the wizard can branch on `body.code`.

**Wizard modal and entry point in `ManageArchitecturesModal` only**
- Add a fourth per-row action button — **`Copy from…`** — to `ManageArchitecturesModal` (alongside Edit, Clone, Archive from spec #6). The clicked row IS the source; target is always the currently active architecture.
- Disabled with tooltip when `row.id === activeArchitectureId`: *"Cannot copy into itself — switch to a different architecture first."*
- No selector dropdown footer entry — the wizard lives only in the Manage modal, mirroring spec #6's Clone discoverability rule.
- Archived rows are already filtered from `ManageArchitecturesModal` by spec #3, so the button is inherently unreachable for archived sources.

**`SelectiveCopyWizardModal.tsx` (new)**
- Multi-step wizard inside a single modal shell (reused from spec #6's `CloneArchitectureModal` pattern), with a stepper indicator at the top.
- Step 1 — confirmation header showing *"Copying from `<source>` into `<active-target>`"*.
- Step 2 — `SelectiveCopyElementPicker` tree.
- Step 3 — preflight summary + `SelectiveCopyConflictResolution`. Auto-skipped to step 4 if zero conflicts AND zero auto-includes (fast path direct to commit).
- Step 4 — calls commit; on success closes the modal and fires the post-copy toast.
- Footer buttons: `Cancel` (always closes wizard) + `Back` + step-specific primary (`Next` / `Run preflight` / `Commit copy`). Primary disabled while invalid or in flight.

**`SelectiveCopyElementPicker.tsx` (new)**
- Receives the source architecture's full element inventory from `getElementsInventory`.
- Tree structure: top-level domain groups (Applications, Data, Business, UI, Behavioural) with **Diagrams** as a separate bottom-level group. Each domain expands to entity types; each type expands to instances.
- Tri-state checkboxes at every internal node — checking a domain checks all its types, checking a type checks all its instances; descendant state computes the parent's indeterminate vs checked vs unchecked render.
- Search box at the top filters tree nodes client-side by name across all domains and types (no API round-trip).
- Auto-included elements receive a visual badge + tooltip (`"Auto-included because referenced by <parent>"`) once preflight has run; the user may un-tick to manually exclude (which re-triggers preflight and surfaces the resulting missing-reference conflict).
- Tree rows are read-only metadata views — clicking an instance name does not navigate; only the checkbox is interactive.

**`SelectiveCopyConflictResolution.tsx` (new)**
- Renders the preflight `conflicts` and `autoIncluded` arrays with the soft "many conflicts" banner above the list when `conflictCount > 10`.
- Header strip with three bulk-action buttons: `Skip all` / `Overwrite all` / `Duplicate all` — applies the chosen action to every row's default in one click.
- Per-row: element name, type, conflict reason, and a three-radio-button group (`Skip` / `Overwrite` / `Duplicate`) overriding the bulk default for that row.
- Default state on first render: all conflicts pre-set to **Skip**.
- Emits a resolution map up to the wizard for the commit call. Self-contained component so it is testable in isolation.

**Post-copy success behaviour**
- Wizard closes immediately on commit success.
- Single rich toast: *"Copied N elements from `<source-name>` (skipped: X, overwrote: Y, duplicated: Z)"* — counts pulled from the commit response.
- The user is already in the target architecture (it is the active one), so no navigation is required. `refreshArchitectures()` is called for completeness in case of future tag/metadata side-effects.
- No "what was copied" highlight overlay in the target architecture's view (deferred — toast suffices for V1).

**Test strategy**
- Backend integration tests (`@SpringBootTest` + H2): selective copy of a partial subset preserves FK rewiring within the subset; each conflict resolution action (skip / overwrite / duplicate) round-trips; auto-include path exercised; un-ticking an auto-included element produces the `missing_reference` 422; refuse-archived 422; refuse-same-architecture 422; atomic rollback verified by forcing a per-row failure mid-commit.
- Backend unit tests for the inventory builder (`ArchitectureElementInventoryService`) — domain ordering, type grouping, archived-row handling.
- Gateway proxy tests — round-trip success and error envelopes for all three new routes.
- Frontend Vitest tests: `SelectiveCopyElementPicker` (tri-state propagation, search filtering, auto-included badge), `SelectiveCopyConflictResolution` (bulk + per-row overrides, soft banner threshold), `SelectiveCopyWizardModal` (step progression, fast-path skip when zero conflicts, post-success toast + close), and an addition to `ManageArchitecturesModal.test.tsx` asserting the per-row `Copy from…` button visibility, disabled-on-self tooltip, and click wiring.

## Existing Code to Leverage

**`ArchitectureCloneService` (spec #6)**
- Generic `JdbcTemplate` + `DatabaseMetaData` per-table copy mechanism is reused by `ArchitectureSelectiveCopyService` with an added id-filter argument so only rows matching the resolved element-id set are copied.
- The `Map<UUID, UUID>` (`oldId → newId`) FK-rewiring map and per-table insert-order ordering apply directly to selective copy with no behavioural change.
- The class-level Javadoc enumerating the 60 in-scope architecture-scoped tables is the authoritative scope list for selective copy too.

**`CloneArchitectureModal` shell + `ArchivedArchitectureSourceException` (spec #6)**
- Modal shell pattern (portal overlay + header + scrollable content + footer with Cancel / primary buttons; click-outside; Esc dismiss; primary disabled until valid) is the direct template for `SelectiveCopyWizardModal` — extended to a stepper-driven multi-step body without changing the outer chrome.
- `ArchivedArchitectureSourceException` is reused verbatim for the `archived_source` 422 path; only the new `SameArchitectureCopyException` needs adding.

**`ManageArchitecturesModal` (spec #3 + spec #6)**
- Per-row action button wiring pattern (right-aligned action group with click handlers opening modals against the row's architecture) is the pattern the new `Copy from…` button follows; it slots in as a fourth button alongside Edit, Clone, Archive.
- Archived-row filtering and last-architecture protection logic stay untouched.

**`ArchitectureContext` — `refreshArchitectures()` + `setActiveArchitecture()` (specs #2 + #3)**
- `refreshArchitectures()` is called after a successful selective copy to repopulate the dropdown and Manage modal — same pattern Edit / Archive / Create / Clone modals already use.
- `activeArchitectureId` from context drives the wizard's "target" header line and the disabled-on-self check on the per-row button.

**`ArchitecturesApiError` typed error class (spec #3)**
- Existing error class with `{status, body}` shape is thrown by all three new client functions on non-2xx, so the wizard can branch cleanly on `body.code` (`archived_source`, `same_architecture`, `missing_reference`, validation envelopes).

## Out of Scope
- Comparison / diffing UI between architectures (deferred indefinitely).
- Unarchive UI (deferred indefinitely).
- Cross-project copy (V1 is same-project only).
- Copying threads or Discovery runs (locked out — project-scoped file storage + immutable Discovery provenance).
- Selective copy entry point in the selector dropdown footer (only `ManageArchitecturesModal` per-row entry per locked decision).
- "What was copied" highlight overlay in the target architecture's canvas view (toast-only in V1).
- Copy-as-link / shared elements across architectures (design note locks "fully isolated" — no cross-architecture references).
- Bulk-select across multiple source architectures in one wizard pass (V1 is one source per wizard run).
- Async / background copy with progress UI; V1 is synchronous and the request blocks for the duration of the transaction.
- Any Liquibase schema changes (selective copy is purely a data-level operation).
