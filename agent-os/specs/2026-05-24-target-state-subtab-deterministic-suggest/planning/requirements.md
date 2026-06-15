# Spec Requirements: Target State Sub-tab + Deterministic Suggest

## Initial Description

The current "Target Architecture" top-level tab (built by spec `2026-05-20-target-architecture-authoring-flow`) is structurally broken and blocks the migration workflow:

- **"Suggest target architecture from current"** produces an empty draft. The gateway handler POSTs each LLM-suggested element to AMS endpoints that don't exist (`/architectures/{id}/components`, `/apis`, `/data-entities`, `/infrastructure-elements`). Per-element 404s are swallowed by per-element failure isolation. The draft is named but empty.
- **"Add Component / API / Data entitie / Infrastructur"** buttons are explicit stubs (`handleAddElement` in `TargetArchitectureWorkspace.tsx:605`). The deferred "Group 8 follow-up" never happened.
- **The LLM Suggest prompt is wrong** — it constrains output to four invented bucket names (`component | api | data-entity | infrastructure`) rather than the actual meta-model entity types the rest of the system uses.
- **Diagram View** is wired but unreachable — every draft is empty, and even clone-seeded drafts have no diagrams because Selective Copy intentionally excludes diagram tables.
- **Top-level tab placement** ("Target Architecture" as peer to "Architecture & Design") is wrong. Target state isn't a separate concern — it's a slice of architecture-and-design work.

The fundamental issue: "what does adding a target element even mean?" was never answered, so the workspace was built around bare CRUD with no semantic anchor. Patching the missing endpoints would lock in the wrong model.

This spec delivers the navigation re-home AND the deterministic seed flow that gives the user a populated, mapped target state in one click. It unblocks the rest of the migration workflow.

This spec is NOT the architect-persona conversation (Spec 3), the captured-decisions data plane (Spec 2), or the downstream PM integration (Spec 4).

After this spec ships, the user can:
1. Open Architecture & Design → click the new Target State sub-tab.
2. Click "Suggest target architecture from current" (the only Suggest path now).
3. Get a populated target draft that's a structural 1:1 clone of current state, with every element mapped via `architecture_element_mappings` (mapping_type=equivalent, status=confirmed, confidence=1.0).
4. Run the existing Migration Discovery Context aggregation, Book of Work generation, and Shape-Spec generation against the populated target.

The Book of Work output will be technology-naive (assumes no tech change because the architect conversation hasn't been built yet). That's acceptable — strictly better than being stuck.

## Pre-settled Decisions (load-bearing — do not re-litigate)

These were settled in the conversation that produced the raw idea. Spec-writer must treat them as given:

1. **Navigation**: "Target Architecture" stops being a top-level tab. It becomes a "Target State" sub-tab under "Architecture & Design". URL nests under `/architecture-design`. Deep-linking preserved.
2. **Deterministic seed only**: Suggest is now a deterministic walk over the current architecture, NOT an LLM call. Phase 1 (load current via `loadModelByProjectIdAndArchitectureId`), Phase 2 (clone every entity 1:1 with `provenance='cloned-from-current'`), Phase 3 (write `architecture_element_mappings` rows transactionally). No LLM in this spec.
3. **Full meta-model coverage**: clone walks every meta-model entity type (applications, application_components, services, interfaces, endpoints, classes, methods, application_points, all data entity tables, business entities, UI entities, infrastructure entities + their typed children, sequence diagrams, events, states, etc.) — NOT the four invented buckets the broken Suggest used.
4. **Drop Add Component/API/Data entitie/Infrastructur buttons**. Re-introduce in Spec 3 only if needed.
5. **Drop Diagram View** entirely from the sub-tab. Bring back as its own spec later. Compare with Current view stays.
6. **Mark Decommissioned** in unmapped-current-elements panel stays (works via `TargetArchitectureDecommissionService`).
7. **Promote / Delete** draft flow stays (verified working).
8. **One commit boundary** per existing project pattern.
9. **The broken May-20 spec's Suggest path is replaced wholesale**, not extended.

## Requirements Discussion

### First Round Questions

**Q1: Route shape** — sub-route under `/architecture-design/target-state`, or query param `/architecture-design?state=target`?
**Answer:** Sub-route: `/architecture-design/target-state` (under the existing Architecture & Design page).

**Q2: Endpoint shape** — extend `POST /target-architectures/seed` with a new mode value, OR add a new dedicated endpoint?
**Answer:** New dedicated endpoint: `POST /api/projects/{p}/target-architectures/suggest-from-current`.

**Q3: Auto-mappings** — should Suggest ALWAYS write equivalence mappings, or be a separate opt-in step?
**Answer:** Always write equivalence mappings in the same transaction. No opt-out.

**Q4: Naming convention** — what should auto-generated draft names be?
**Answer:** `Target State - Suggested 2026-05-24` format. If clicked twice the same day, append ` (2)`, ` (3)`, etc. suffix on same-day repeat.

**Q5: Idempotency / double-click guard**
**Answer:** Frontend disables the Suggest button while pending; server-side returns 409 if a draft with the identical auto-generated name was created within last N seconds.

**Q6: Existing-draft handling** — warn? auto-archive? confirm?
**Answer:** No warning modal, no auto-archive, no confirmation — always create the new draft.

**Q7: Promotion + selection** — auto-promote new draft to active? auto-select?
**Answer:** No auto-promote to active; YES auto-select the new draft in the Drafts panel.

**Q8: Empty-state UX** — what does the Target State sub-tab show when zero drafts exist and Suggest has never been clicked?
**Answer:** Centered empty-state card with copy "Target State is your proposed end-state architecture. Click Suggest to generate a 1:1 clone of your current architecture as a starting point." + single Suggest button + no other UI chrome. (Drafts panel hidden, table editor hidden, Compare and Unmapped panels hidden when zero drafts exist.)

**Q9: Cross-architecture safety** — what if user switches architecture mid-Suggest?
**Answer:** Capture-at-click-time. Request payload includes explicit `currentArchitectureId`. No server-side lock.

**Q10(a): Empty-draft hint in Drafts panel?**
**Answer:** YES — add an inline "empty" badge to any draft with zero elements in the Drafts panel.

**Q10(b): Disable Suggest when an empty draft already exists?**
**Answer:** No — unrelated concerns.

**Q11: Back-reference mechanism** — synthetic mapping row vs new columns on entity tables?
**Answer:** Use the `architecture_element_mappings` row only. No new columns on entity tables.

**Q12: Service shape**
**Answer:** New `SuggestFromCurrentService` that delegates to `ArchitectureCloneService.cloneArchitecture` and writes mappings on top.

**Q13: Diagram tables in clone walk**
**Answer:** Skip them. Matches existing Selective Copy behaviour AND the "drop Diagram View" decision.

**Q14: Old-route handling**
**Answer:** Add `<Navigate>` redirect from `/projects/:p/architectures/:a/target-architecture` → `/projects/:p/architectures/:a/architecture-design/target-state` (preserves bookmarks).

**Q15: Test scope**
**Answer:** Moderate: 1 happy-path integration test + 1 empty-source 422 test + sub-tab navigation test + Suggest-button-disabled-while-pending test.

**Q16: Old broken drafts**
**Answer:** Leave alone, no cleanup changeset (consistent with no-backfill rule).

### Existing Code to Reference

No similar existing features were called out by the user for reuse. Spec-writer should figure out controller / service / fixture shape from scratch, while reusing the named existing pieces below:

**Existing pieces to be reused / extended (named in raw idea):**
- `ArchitectureCloneService.cloneArchitecture` — Phase 2 deep-copy delegate for the new `SuggestFromCurrentService`.
- `loadModelByProjectIdAndArchitectureId` — Phase 1 load of current architecture.
- `architecture_element_mappings` table + existing CRUD — Phase 3 mapping row writes (no schema changes).
- `TargetArchitectureDecommissionService` — kept as-is for Mark Decommissioned action.
- `TargetArchitectureCompareView` — kept as-is.
- AppShell cache invalidation pattern per `project_appshell_model_cache.md` — re-applied after Suggest completes.
- Existing seed modes (`clone-current` / `blank` / `from-template`) on `TargetArchitectureSeed` endpoint — kept untouched (new Suggest is a *separate* endpoint).
- Parent-chain resolver work from `2026-05-22-architecture-scope-via-parent-not-leaf` — read-path that the clone walk benefits from.
- `@JsonNaming` annotations from selective-copy DTOs — pattern to follow if any new DTOs are introduced.

**Existing code to be deleted (raw idea):**
- `gateway/src/routes/suggestTargetArchitecture.ts`
- `gateway/src/services/suggestTargetArchitectureHandler.ts`
- `gateway/src/config/tasks/product-manager--suggest-target-architecture.json`
- `gateway/src/config/prompts/product-manager.suggest-target-architecture.task.md`
- `suggestTargetArchitecture` function in frontend `targetArchitecturesApi.ts`
- Any tests exercising the LLM Suggest path
- `handleAddElement` and "Add Component / API / Data entitie / Infrastructur" buttons in `TargetArchitectureWorkspace.tsx`
- Diagram View tab inside the sub-tab
- Existing LLM `handleSuggestFromCurrent` (lines 646-683 in `TargetArchitectureWorkspace.tsx`), the `suggestPending` "may take 10-30s" spinner copy, the `overlaysByTargetId` LLM-provenance overlay stamping

### Follow-up Questions

None. User answered all 16 first-round questions and no genuine contradictions or critical gaps surfaced.

## Visual Assets

### Files Provided

No visual assets provided. Mandatory bash check of `planning/visuals/` returned no files. Spec-writer works from prose only.

## Requirements Summary

### Functional Requirements

**Frontend navigation:**
- Add a "Target State" sub-tab inside the existing Architecture & Design page, peer to "Current State" (which remains default).
- Sub-route: `/projects/:p/architectures/:a/architecture-design/target-state`.
- Add `<Navigate>` redirect from the old top-level `/projects/:p/architectures/:a/target-architecture` route to the new sub-route (preserves bookmarks).
- Remove the existing top-level "Target Architecture" tab from `App.tsx` routes.

**Target State sub-tab contents (v1):**
- When ZERO drafts exist: centered empty-state card with copy *"Target State is your proposed end-state architecture. Click Suggest to generate a 1:1 clone of your current architecture as a starting point."* + single Suggest button + no other UI chrome. (Drafts panel, table editor, Compare panel, Unmapped panel are all hidden.)
- When one or more drafts exist:
  - Drafts panel (left, existing) — list of target drafts, active one highlighted, click to switch focus, with inline "empty" badge on any draft that has zero elements.
  - Suggest button (header) — fires the deterministic seed.
  - Table editor (centre, existing) — renders the selected draft's element inventory grouped by domain (Applications / Data / Business / UI / Behavioural / Infrastructure / Diagrams).
  - Compare with Current tab (existing) — kept.
  - Unmapped current elements panel (right, existing) — kept. Mark Decommissioned action kept.
- After a successful Suggest, auto-select the newly created draft in the Drafts panel.
- Suggest button is disabled while a Suggest request is in flight (frontend guard).

**Deterministic Suggest endpoint:**
- New `POST /api/projects/{p}/target-architectures/suggest-from-current`.
- Request body includes an explicit `currentArchitectureId` captured at click time (no server-side lock on active architecture).
- Phase 1 — load current architecture via `loadModelByProjectIdAndArchitectureId(projectId, currentArchitectureId)`.
- Phase 2 — deep-copy every meta-model entity to a new target draft via `ArchitectureCloneService.cloneArchitecture`. Each cloned element gets:
  - Same name, description, attributes, cardinalities.
  - Same physical structure (table/column names, types).
  - Same interface contract (paths, methods, schemas, status codes).
  - `provenance = 'cloned-from-current'`.
  - The new draft's `architecture_id`.
  - Back-reference to source element id encoded ONLY via the `architecture_element_mappings` row (no new columns on entity tables).
- Phase 3 — write one `architecture_element_mappings` row per cloned element, in the same `@Transactional` boundary as the clone:
  - `mapping_type = 'equivalent'`
  - `status = 'confirmed'`
  - `confidence = 1.0`
  - `created_by_task = 'target-state-suggest'`
- Skip diagram tables in the clone walk (consistent with Selective Copy and the "drop Diagram View" decision).
- New target draft is `kind = 'target'`, `draft_state = 'draft'`.
- Auto-name: `Target State - Suggested YYYY-MM-DD`. If a draft with that exact name already exists today, append ` (2)`, ` (3)`, etc.
- User can rename the draft inline.
- Empty current state → reject with 422 + message *"Current architecture has no elements to suggest from"*.
- Server-side 409 if a draft with the identical auto-generated name was created within the last N seconds (double-click guard).
- Existing target drafts in the project are NOT touched. Suggest always creates a NEW draft. No warning, no auto-archive, no confirmation.
- No auto-promote to active.

**Service shape (backend):**
- New `SuggestFromCurrentService` that:
  - Delegates Phase 1 and Phase 2 to `ArchitectureCloneService.cloneArchitecture`.
  - Writes Phase 3 mappings on top, within the same transaction.

**Frontend Suggest wiring:**
- Replace `handleSuggestFromCurrent` in `TargetArchitectureWorkspace.tsx` (lines 646-683) to call the new deterministic endpoint instead of the LLM gateway task.
- Drop the `suggestPending` "Suggesting... may take 10-30s" spinner copy in favour of a normal short-duration loading state.
- Drop the `overlaysByTargetId` LLM-provenance overlay stamping (provenance is uniformly `cloned-from-current` now).
- AppShell cache invalidation pattern per `project_appshell_model_cache.md` after the Suggest call returns.

**Removal of the broken LLM Suggest stack:**
- Delete `gateway/src/routes/suggestTargetArchitecture.ts`.
- Delete `gateway/src/services/suggestTargetArchitectureHandler.ts`.
- Delete `gateway/src/config/tasks/product-manager--suggest-target-architecture.json`.
- Delete `gateway/src/config/prompts/product-manager.suggest-target-architecture.task.md`.
- Remove `suggestTargetArchitecture` from frontend `targetArchitecturesApi.ts`.
- Delete any tests exercising the LLM Suggest path.

**Removal of stub Add buttons + Diagram View:**
- Remove `handleAddElement` and the "Add Component / API / Data entitie / Infrastructur" inline-add UI from the table editor.
- Remove the Diagram View tab from the sub-tab.

### Test Coverage (moderate scope per Q15)

1. Happy-path integration test for the new `suggest-from-current` endpoint (clones a non-trivial current architecture, asserts cloned entities + mapping rows).
2. Empty-source 422 test (current architecture has no elements → 422 with the specified message).
3. Sub-tab navigation test (verifies the Target State sub-tab loads at the new sub-route).
4. Suggest-button-disabled-while-pending test (frontend behaviour).

### Reusability Opportunities

- `ArchitectureCloneService.cloneArchitecture` is the core Phase 2 reuse — the new service is a thin wrapper.
- `loadModelByProjectIdAndArchitectureId` already returns the parent-chain-aware model (post-`2026-05-22-architecture-scope-via-parent-not-leaf`), so no new read code needed.
- `architecture_element_mappings` table + CRUD already exists — Phase 3 is straightforward inserts.
- Existing Drafts panel, table editor, Compare view, Unmapped panel, Mark Decommissioned, Promote/Delete modals are all kept as-is and just re-hosted under the new sub-route.
- AppShell cache invalidation pattern already documented in `project_appshell_model_cache.md`.

### Scope Boundaries

**In Scope:**
- New "Target State" sub-tab under Architecture & Design.
- Sub-route `/projects/:p/architectures/:a/architecture-design/target-state` + `<Navigate>` redirect from the old top-level route.
- New `POST /api/projects/{p}/target-architectures/suggest-from-current` endpoint.
- New `SuggestFromCurrentService` (deterministic clone + mapping writes, single `@Transactional`).
- Auto-naming with same-day numeric suffix.
- 409 server-side double-click guard + frontend pending-disable.
- Auto-select new draft after Suggest; no auto-promote.
- Empty-state UX (centered card, single button, all other panels hidden).
- Inline "empty" badge on zero-element drafts in the Drafts panel.
- Removal of LLM Suggest stack (gateway routes/services/tasks/prompts + frontend API + tests).
- Removal of stub "Add ..." buttons + Diagram View tab.
- Replace frontend `handleSuggestFromCurrent`, drop "10-30s" spinner copy, drop LLM-provenance overlay stamping.
- Moderate test coverage (4 tests above).
- Single commit boundary covering all of the above.

**Out of Scope:**
- LLM-driven Suggest (Spec 3).
- Architect-persona conversation (Spec 3).
- Captured decisions table + resolver + DTO extension (Spec 2).
- Per-element exception pinning (Spec 3).
- Add Component / Add Element flows (Spec 3 — only if the architect conversation needs them, otherwise dropped permanently).
- Target-side diagram authoring (future spec).
- Updates to the PM tasks that consume migration context (Spec 4).
- Backfilling existing user data — the broken "Draft 2026-05-22 #1" is left alone; user can delete it manually. No cleanup changeset.
- Cross-architecture server-side locking during Suggest.
- New schema columns on entity tables for back-reference (`architecture_element_mappings` row is the sole mechanism).

### Technical Considerations

- **Single transaction**: Phase 2 clone + Phase 3 mapping writes must be in one `@Transactional` boundary. If Phase 3 fails, Phase 2 must roll back.
- **Capture-at-click-time architecture id**: the request payload carries `currentArchitectureId` explicitly so a mid-flight architecture switch on the client cannot redirect the clone to the wrong source. No server-side lock.
- **Auto-name collision**: server checks for an existing draft named `Target State - Suggested YYYY-MM-DD` (or with the next `(N)` suffix) created within the last N seconds — if found, return 409. This is the double-click guard.
- **AppShell cache invalidation**: the new draft must invalidate / dispatch into the AppShell cache per the existing pattern (cross-architecture concern noted in `project_appshell_model_cache.md`).
- **Provenance uniformly `cloned-from-current`**: no overlay stamping logic remains on the frontend.
- **No schema changes**: back-reference is purely via `architecture_element_mappings`. No migrations on entity tables.
- **Diagram tables skipped**: matches existing Selective Copy clone behaviour. If the clone service currently includes diagrams, the new service must explicitly skip them (or call a variant of the clone that excludes them).
- **Route migration**: the redirect from `/target-architecture` → `/architecture-design/target-state` must preserve `:projectId` and `:architectureId` path params.
- **Existing seed endpoint untouched**: `POST /target-architectures/seed` and its `clone-current` / `blank` / `from-template` modes are kept exactly as they are — the new Suggest is a separate endpoint.
- **Kept artefacts** (must continue to compile + pass tests): `TargetArchitectureCompareView`, `TargetArchitectureSeed` endpoint, Promote / Delete flow + modals, Mark Decommissioned action + `TargetArchitectureDecommissionService`, `architecture_element_mappings` CRUD + SelectiveCopyWizardModal's Mapping Review step, all `@JsonNaming` annotations from Bug #2 fix, parent-chain resolver from `2026-05-22-architecture-scope-via-parent-not-leaf`.

## Verification (from raw idea)

After this spec:
- The user can run "Create Target Baseline" from any non-active architecture row (existing path) OR click "Suggest target architecture from current" in the new Target State sub-tab (new path) and get a populated, mapped target draft.
- The Target Architecture top-level tab is gone.
- Add Component / API / Data entitie / Infrastructur buttons are gone.
- Diagram View is gone from the sub-tab.
- Downstream stages (Migration Discovery Context, Book of Work, Shape-Spec generation) work against the new draft.
- Existing tests for the kept pieces (Promote/Delete/Mark Decommissioned/Compare) continue to pass.

## Dependencies

- `2026-05-22-architecture-scope-via-parent-not-leaf` — already shipped. Read paths now use parent chain. Suggest's clone walk benefits.
- `@JsonNaming` annotations on selective-copy DTOs — already shipped. Pattern in place if any new DTOs are added.

## Commit Boundary

Single commit covering: backend (endpoint + service), frontend (sub-tab + Suggest rewire + removed buttons/views + empty-state + empty-badge + auto-select + pending-disable), removal of broken LLM stack, route migration with redirect, the four tests listed under Test Coverage.
