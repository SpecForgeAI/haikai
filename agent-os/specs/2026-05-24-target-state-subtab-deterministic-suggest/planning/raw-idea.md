# Raw Idea: Target State Sub-tab + Deterministic Suggest

## Why this spec exists

The current "Target Architecture" top-level tab (built by spec `2026-05-20-target-architecture-authoring-flow`) is structurally broken and blocks the migration workflow. The user gets to a screen with an empty draft, can't add anything, and can't move forward. End-to-end testing confirmed:

- **"Suggest target architecture from current"** produces an empty draft. The gateway handler POSTs each LLM-suggested element to AMS endpoints that don't exist (`/architectures/{id}/components`, `/apis`, `/data-entities`, `/infrastructure-elements`). Per-element failure isolation swallows every 404. Draft is named but empty.
- **"Add Component / API / Data entitie / Infrastructur" buttons** are explicit stubs (`handleAddElement` in `TargetArchitectureWorkspace.tsx:605`) — the comment inside acknowledges the work was deferred to a "Group 8 follow-up" that never happened.
- **The LLM Suggest prompt itself is wrong**: it constrains the output to four invented bucket names (`component | api | data-entity | infrastructure`) rather than the actual meta-model entity types the rest of the system uses. Even if the wiring worked, the output would be semantically wrong.
- **Diagram View** is wired but unreachable — every draft is empty, and even clone-seeded drafts have no diagrams because Selective Copy intentionally excludes diagram tables.
- **Top-level tab placement** ("Target Architecture" as a peer to "Architecture & Design") is wrong. Target state isn't a separate concern — it's a slice of architecture-and-design work. The workspace also conflates pure meta-model authoring with what will eventually be backlog review, decision capture, etc.

The fundamental issue: "what does adding a target element even mean?" was never answered, so the workspace was built around bare CRUD that has no semantic anchor. Patching the missing endpoints would lock in the wrong model.

## What this spec is (and isn't)

**This spec** delivers the navigation re-home and the deterministic seed flow that gives the user a populated, mapped target state in one click. It unblocks the rest of the migration workflow.

**This spec is not** the architect-persona conversation (that's Spec 3 in the four-spec plan), the captured-decisions data plane (Spec 2), or the downstream PM integration (Spec 4). Those land separately.

After this spec ships, the user can:
1. Open Architecture & Design → click the new Target State sub-tab.
2. Click "Suggest target architecture from current" (the only Suggest path now).
3. Get a populated target draft that's a structural 1:1 clone of current state, with every element mapped via `architecture_element_mappings` (mapping_type=equivalent, status=confirmed, confidence=1.0).
4. Run the existing Migration Discovery Context aggregation, Book of Work generation, and Shape-Spec generation against the populated target — all of which already work end-to-end.

The Book of Work output will be technology-naive (assumes no tech change because the architect conversation hasn't been built yet). That's acceptable — strictly better than being stuck.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea. The shape-spec agent should treat them as given:

1. **Navigation**: "Target Architecture" stops being a top-level tab. It becomes a "Target State" sub-tab under "Architecture & Design". URL changes from `/projects/:p/architectures/:a/target-architecture` to something nested under `/architecture-design`. Deep-linking preserved.
2. **Deterministic seed only**: Suggest is now a deterministic walk over the current architecture, NOT an LLM call. It does Phase 1 (load current via `loadModelByProjectIdAndArchitectureId`), Phase 2 (clone every entity 1:1 with `provenance='cloned-from-current'`), Phase 3 (write `architecture_element_mappings` rows transactionally). No LLM in this spec.
3. **Full meta-model coverage**: the clone walks every meta-model entity type (applications, application_components, services, interfaces, endpoints, classes, methods, application_points, all data entity tables, business entities, UI entities, infrastructure entities + their typed children, sequence diagrams, events, states, etc.). NOT the four invented buckets the broken Suggest used.
4. **Drop Add Component/API/Data entitie/Infrastructur buttons**. They have no meaning without the architect conversation. Re-introduce in Spec 3.
5. **Drop Diagram View** entirely from the sub-tab. Bring back as its own spec when target-side diagram authoring is real work. Compare with Current view stays.
6. **Mark Decommissioned** in the unmapped-current-elements panel stays — it already works correctly via `TargetArchitectureDecommissionService`.
7. **Promote / Delete** draft flow stays (verified working in code; only blocked by the broken Add/Suggest in the user's test session).
8. **One commit boundary** per existing project pattern.
9. **The broken May-20 spec's Suggest path is replaced wholesale**, not extended.

## Specific requirements (rough — let shape-spec refine)

### Frontend navigation

- New "Target State" sub-tab inside the existing Architecture & Design page (or wherever the meta-model view currently lives).
- Sub-tab is peer to "Current State" (default).
- URL pattern TBD by shape-spec — preference is a sub-route or `?state=target` search param so deep-linking + browser back/forward survives.
- Existing `/projects/:p/architectures/:a/target-architecture` route is removed. Anyone deep-linked there gets a redirect to the new path (or just a 404 if too costly to implement a redirect — TBD).

### Target State sub-tab contents (v1)

- Drafts panel (left, existing) — list of target drafts, active one highlighted, click to switch focus.
- Suggest button (header) — fires the deterministic seed. Replaces the broken LLM call.
- Table editor (centre, existing) — renders the selected draft's element inventory, grouped by domain (Applications / Data / Business / UI / Behavioural / Infrastructure / Diagrams — the canonical six+ domains the inventory endpoint returns).
- Compare with Current tab (existing) — stays.
- Unmapped current elements panel (right, existing) — stays. Mark Decommissioned action stays.

What's removed:
- "Add Component / API / Data entitie / Infrastructur" inline-add UI in the table editor.
- Diagram View tab.
- "Suggest target architecture from current" LLM call — replaced by deterministic seed.

### Deterministic seed (the core)

- New AMS endpoint OR extension to existing `POST /api/projects/{p}/target-architectures/seed` with a new mode value (`suggest-from-current` or similar — shape-spec to decide).
- Phase 1: load current architecture via `loadModelByProjectIdAndArchitectureId(projectId, currentArchId)`.
- Phase 2: deep-copy every element to a new target draft. Reuse `ArchitectureCloneService.cloneArchitecture` where possible. Every cloned element gets:
  - Same name, description, attributes, cardinalities.
  - Same physical structure (table/column names, types).
  - Same interface contract (paths, methods, schemas, status codes).
  - `provenance='cloned-from-current'`.
  - Back-reference to source element id (mechanism TBD — could be a synthetic mapping row, could be a provenance metadata field).
  - Target's own `architecture_id` is the new draft's id.
- Phase 3: write one row per cloned element into `architecture_element_mappings`:
  - `mapping_type='equivalent'`, `status='confirmed'`, `confidence=1.0`
  - `created_by_task='target-state-suggest'`
  - Same `@Transactional` boundary as the clone.
- New target draft is `kind='target'`, `draft_state='draft'`, auto-named (e.g. "Target State - Suggested from Current YYYY-MM-DD"). User can rename inline.
- Empty current state → reject with 422 + clear message ("Current architecture has no elements to suggest from").
- Existing target drafts in the project → NOT touched. Suggest always creates a NEW draft. The user can delete prior drafts via the existing Delete button.

### Frontend Suggest wiring

- Replace the existing `handleSuggestFromCurrent` in `TargetArchitectureWorkspace.tsx` (lines 646-683) to call the deterministic seed endpoint instead of the LLM gateway task.
- Drop the `suggestPending` spinner copy ("Suggesting... may take 10-30s") in favour of a normal loading state (deterministic should be near-instant).
- Drop the `overlaysByTargetId` LLM-provenance overlay stamping — provenance is now uniformly `cloned-from-current` per phase 2.
- AppShell cache invalidation pattern stays (per `project_appshell_model_cache.md`).

### Removal of the broken Suggest LLM stack

- Gateway: delete `gateway/src/routes/suggestTargetArchitecture.ts` and `gateway/src/services/suggestTargetArchitectureHandler.ts` (or mark them as deprecated and unwire from `server.ts` — TBD by shape-spec).
- Gateway: delete `gateway/src/config/tasks/product-manager--suggest-target-architecture.json` and `gateway/src/config/prompts/product-manager.suggest-target-architecture.task.md`.
- Frontend API client: remove `suggestTargetArchitecture` from `targetArchitecturesApi.ts`.
- Tests: any test exercising the LLM Suggest path gets deleted alongside.

### Re-home navigation

- `App.tsx` route for `/projects/:p/architectures/:a/target-architecture` removed.
- New sub-route inside Architecture & Design — shape-spec to decide whether it's a child route or a query param.
- The `<TargetArchitectureWorkspace>` component itself moves files OR gets re-mounted inside the Architecture & Design page; TBD.

### What gets preserved

- `TargetArchitectureCompareView` — kept.
- `TargetArchitectureSeed` endpoint's `clone-current` / `blank` / `from-template` modes — kept.
- `Promote` / `Delete` flow + their modals — kept.
- `Mark Decommissioned` action + the underlying `TargetArchitectureDecommissionService` — kept.
- `architecture_element_mappings` CRUD endpoints + the SelectiveCopyWizardModal's Mapping Review step — kept (this is the alternate manual path, complements Suggest).
- All the `@JsonNaming` annotations applied during the Bug #2 fix — kept.
- All the parent-chain resolver work from `2026-05-22-architecture-scope-via-parent-not-leaf` — kept (Suggest will benefit from the read-path fix).

### Out of scope

- LLM-driven Suggest (Spec 3).
- Architect-persona conversation (Spec 3).
- Captured decisions table + resolver + DTO extension (Spec 2).
- Per-element exception pinning (Spec 3).
- Add Component / Add Element flows (Spec 3 — only if the architect conversation needs them, otherwise dropped permanently).
- Target-side diagram authoring (future).
- Updates to the PM tasks that consume migration context (Spec 4).
- Backfilling existing user data (the user has a broken "Draft 2026-05-22 #1" that should just be deleted by the user before they try Suggest).

## Dependencies

- `2026-05-22-architecture-scope-via-parent-not-leaf` — already shipped. Read paths now use parent chain. Suggest's clone walk will benefit (it'll see every element the Architecture & Design view shows).
- `@JsonNaming` annotations on selective-copy DTOs — already shipped. Not directly relevant to this spec but confirms the pattern is in place if any new DTOs are added.

## Open questions for shape-spec to clarify

1. **Route shape** — sub-route under `/architecture-design/target-state`, or query param `/architecture-design?state=target`? Sub-routes are cleaner but more refactor; query params are tinier but mix concerns in one URL.
2. **Endpoint shape** — extend `POST /target-architectures/seed` with a new mode value, OR add a new dedicated `POST /target-architectures/suggest-from-current` endpoint? Existing seed modes (`clone-current` / `blank` / `from-template`) suggest extension is natural; but Suggest writes mappings while existing modes don't, which suggests separate endpoint.
3. **Auto-mappings or not** — should the deterministic Suggest ALWAYS write equivalence mappings, or should that be a separate optional step the user confirms? My instinct: always. Mapping rows are what downstream stages cite; an unmapped Suggest is useless.
4. **Naming convention** — what should auto-generated draft names be? "Target State - Suggested 2026-05-24" or "Target State Draft #N" or something else?
5. **Idempotency** — what happens if Suggest is clicked twice in quick succession? Two drafts? Reject the second? One draft, second click overwrites?
6. **Existing-draft handling** — if the user has 3 prior drafts and clicks Suggest, do we just add a 4th? Warn? Auto-archive the prior ones?
7. **Active target promotion** — does Suggest auto-promote the new draft to active? My instinct: no, user explicitly promotes via the existing button.
8. **Empty-state UX** — what does the Target State sub-tab show when the user has zero drafts AND has never clicked Suggest? Just a Suggest button with explainer copy?
9. **Cross-architecture safety** — Suggest runs against the user's currently-active architecture. What if they switch architecture mid-Suggest? Should we lock the active arch during the operation or capture it at click-time?
10. **What happens to the broken Draft 2026-05-22 #1 in the user's database?** No backfill needed; user can delete manually. But should we add a "this draft is empty and stale, delete?" hint in the drafts panel?

## Verification

After this spec:
- The user can run "Create Target Baseline" from any non-active architecture row (existing path) OR click "Suggest target architecture from current" in the new Target State sub-tab (new path) and get a populated, mapped target draft.
- The Target Architecture top-level tab is gone.
- Add Component etc. buttons are gone.
- Diagram View is gone.
- Downstream stages (Migration Discovery Context, Book of Work, Shape-Spec generation) work against the new draft.
- Existing tests for the kept pieces (Promote/Delete/Mark Decommissioned/Compare) continue to pass.

## Commit boundary

One commit covering: backend (endpoint + service), frontend (sub-tab + Suggest rewire + removed buttons/views), removal of broken LLM stack, route migration, tests.
