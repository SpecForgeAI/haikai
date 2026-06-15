# Specification: Target State Sub-tab + Deterministic Suggest

## Goal

Replace the broken May-20 LLM-driven "Suggest target architecture from current" flow with a deterministic one-click path that clones the current architecture 1:1 into a new target draft and writes equivalence mappings for every cloned element, and re-home the orphaned top-level "Target Architecture" tab as a "Target State" sub-tab under Architecture & Design. This unblocks downstream Migration Discovery Context, Book of Work, and Shape-Spec generation against a populated, mapped target draft.

## User Stories

- As a migration architect, I want to open Architecture & Design, switch to the new Target State sub-tab, and click Suggest once to get a fully-populated target draft so that the downstream Migration Discovery Context, Book of Work, and Shape-Spec generation flows have a real target to operate on.
- As a returning user with a deep-linked bookmark to the old `/target-architecture` route, I want my bookmark to keep working so that I don't have to re-navigate to find the relocated workspace.
- As a project owner viewing my drafts panel, I want any zero-element draft to be visibly badged "empty" so that I can identify and clean up the legacy broken drafts from before this fix.
- As a developer extending the workflow in later specs, I want the deterministic seed to live in its own dedicated endpoint and service so that the existing `TargetArchitectureSeed` modes (`clone-current` / `blank` / `from-template`) and the future architect-persona conversation can evolve without entangled regressions.

## Specific Requirements

### Frontend navigation

- Remove the existing top-level `path="target-architecture"` route in `frontend/src/App.tsx` (line 776) that renders `<TargetArchitectureWorkspace />` as a peer to dashboard / metamodel / diagrams.
- Mount `<TargetArchitectureWorkspace />` as a child route under the Architecture & Design page (`metamodel`) at `/projects/:p/architectures/:a/architecture-design/target-state`. The existing Architecture & Design surface becomes the "Current State" sub-tab by default; the new sub-route is the "Target State" peer.
- Add a `<Navigate replace>` redirect from `/projects/:p/architectures/:a/target-architecture` to `/projects/:p/architectures/:a/architecture-design/target-state`, preserving both path params.
- Add a sub-tab nav strip inside the Architecture & Design page with two peers: "Current State" (default, existing metamodel domain view) and "Target State" (the new sub-route). Active sub-tab reflects the URL, not local component state, so deep-linking and browser back/forward survive.
- The TopBar "Architecture & Design" button continues to land on the Current State sub-tab; users reach Target State via the in-page sub-tab strip or directly via URL.

### Target State sub-tab contents

- When zero target drafts exist for the architecture: render a centered empty-state card with copy "Target State is your proposed end-state architecture. Click Suggest to generate a 1:1 clone of your current architecture as a starting point." plus a single Suggest button. The Drafts panel, table editor, Compare with Current view, and Unmapped current elements panel are all hidden in this state.
- When one or more drafts exist: render the existing layout (Drafts panel left, Suggest button in header, table editor centre grouped by domain, Compare with Current tab, Unmapped current elements panel right with Mark Decommissioned action) exactly as today, minus the removed elements below.
- After a successful Suggest, the newly-created draft is auto-selected in the Drafts panel. The new draft is NOT auto-promoted to active.
- Each entry in the Drafts panel gets an inline "empty" badge when the draft's element count is zero, so legacy broken drafts are visually flagged.
- Suggest button is disabled while a Suggest request is in flight (frontend guard).
- The following elements are removed from the workspace: `handleAddElement` and the "Add Component / Add API / Add Data entitie / Add Infrastructur" inline-add buttons in the table editor, the Diagram View tab, the `suggestPending` "Suggesting... may take 10-30s" spinner copy, and the `overlaysByTargetId` LLM-provenance overlay stamping.

### Deterministic seed endpoint (AMS)

- New `POST /api/projects/{projectId}/target-architectures/suggest-from-current` endpoint on a new controller (or co-located with the existing target-architecture controller, whichever matches the existing convention).
- Request body carries `currentArchitectureId` captured at click time on the client so a mid-flight architecture switch cannot redirect the clone to the wrong source. No server-side lock on the active architecture.
- Phase 1: load the current architecture via `loadModelByProjectIdAndArchitectureId(projectId, currentArchitectureId)`. If the loaded model has zero elements across all in-scope tables, reject with HTTP 422 and message "Current architecture has no elements to suggest from".
- Phase 2: delegate the deep-copy to `ArchitectureCloneService.cloneArchitecture(projectId, currentArchitectureId, newName, newDescription, includedTables)`. Pass an `includedTables` list that covers every meta-model entity table (applications, application_components, services, interfaces, endpoints, classes, methods, application_points, logical/physical data entities + attributes, business entities, UI entities, infrastructure entities and their typed children, events, states) and explicitly excludes diagram tables (`sequence_diagrams`, `sequence_fragments`, etc.) consistent with Selective Copy behaviour. Every cloned element preserves name, description, attributes, cardinalities, physical structure (table/column names, types), and interface contract (paths, methods, schemas, status codes).
- Phase 3: in the SAME `@Transactional` boundary as Phase 2, insert one row per cloned element into `architecture_element_mappings` with `mapping_type='equivalent'`, `status='confirmed'`, `confidence=1.0`, `created_by_task='target-state-suggest'`, `source_element_id` = original current-state element id, `target_element_id` = new cloned element id, `source_architecture_id` = `currentArchitectureId`, `target_architecture_id` = new draft id.
- New draft is `kind='target'`, `draft_state='draft'`. Provenance on each cloned element is uniformly `'cloned-from-current'`.
- Back-reference from cloned element to its source is encoded ONLY via the `architecture_element_mappings` row; no new columns are added to any entity table.
- Auto-name: `Target State - Suggested YYYY-MM-DD`. If a draft with that exact name already exists today in the same project, append ` (2)`, ` (3)`, etc. (incrementing suffix scan).
- Double-click guard: if a draft with the resolved auto-generated name was created within the last 5 seconds, return HTTP 409 with a message identifying the existing draft. Server-side guard complements the frontend pending-disable.
- Existing target drafts in the project are NOT touched: Suggest always creates a NEW draft. No warning, no auto-archive, no confirmation modal.
- The existing `POST /target-architectures/seed` endpoint and its `clone-current` / `blank` / `from-template` modes are kept untouched. The new endpoint is independent.

### Backend service shape

- New `SuggestFromCurrentService` class in `architecture-model-service/src/main/java/com/example/architecturemodel/service/`. Single `@Transactional` public method that orchestrates Phase 1 (load + empty check), Phase 2 (delegate to `ArchitectureCloneService.cloneArchitecture`), Phase 3 (bulk insert mapping rows via the existing `ArchitectureElementMappingRepository` or `ArchitectureElementMappingService`).
- Auto-name resolution lives in this service: scan for same-day collisions, increment numeric suffix, retry on 409.
- Empty-source check uses the loaded model's per-domain element counts (zero across all six meta-model domains triggers 422).
- Any new request / response DTOs follow the established `@JsonNaming(LowerCamelCaseStrategy.class)` annotation pattern from the selective-copy DTOs.

### Frontend Suggest wiring

- Replace the existing `handleSuggestFromCurrent` in `TargetArchitectureWorkspace.tsx` (lines 646-683) with a call to the new deterministic endpoint via a new `suggestTargetFromCurrent(projectId, currentArchitectureId)` function in `frontend/src/api/targetArchitecturesApi.ts`.
- On success: dispatch the AppShell cache invalidation per `project_appshell_model_cache.md` (same-architecture LOAD_MODEL dispatch since the new draft is a sibling architecture under the same project), refresh the drafts list, and auto-select the newly-created draft.
- Drop the `suggestPending` "may take 10-30s" spinner copy in favour of a normal short-duration loading state.
- Drop the `overlaysByTargetId` LLM-provenance overlay stamping — provenance is now uniformly `'cloned-from-current'`.

### Removal of broken LLM stack

- Delete `gateway/src/routes/suggestTargetArchitecture.ts`.
- Delete `gateway/src/services/suggestTargetArchitectureHandler.ts`.
- Delete `gateway/src/config/tasks/product-manager--suggest-target-architecture.json`.
- Delete `gateway/src/config/prompts/product-manager.suggest-target-architecture.task.md`.
- Remove the `suggestTargetArchitecture` function from `frontend/src/api/targetArchitecturesApi.ts`.
- Delete the corresponding test files that exercise the LLM Suggest path (gateway-side handler tests and any frontend test that mounted the LLM Suggest flow).
- Unwire any `server.ts` route registration that bound the deleted route file.

### What gets preserved

- `TargetArchitectureCompareView` — kept as-is, accessible from the Target State sub-tab.
- `TargetArchitectureSeedService` and its `clone-current` / `blank` / `from-template` modes — kept untouched (the new Suggest is a separate endpoint).
- Promote / Delete draft flow + modals — kept as-is.
- Mark Decommissioned action on the Unmapped current elements panel + `TargetArchitectureDecommissionService` — kept as-is.
- `architecture_element_mappings` CRUD endpoints + SelectiveCopyWizardModal's Mapping Review step — kept as-is.
- All `@JsonNaming(LowerCamelCaseStrategy.class)` annotations on selective-copy DTOs and mapping DTOs — kept and re-used as the pattern for any new DTO.
- Parent-chain resolver from `2026-05-22-architecture-scope-via-parent-not-leaf` — kept; the clone walk's read path benefits automatically.

### Tests

- Backend integration test: happy-path `SuggestFromCurrentServiceIntegrationTest` — seed a current architecture with a non-trivial mix (e.g. 1 application, 2 components, 1 service with 1 interface + 2 endpoints, 1 logical data entity with 2 attributes, 1 physical data entity, 1 infrastructure node). Invoke the new endpoint. Assert (a) a new target draft was created with the expected auto-name, kind=`target`, draft_state=`draft`; (b) every source element has a corresponding cloned element in the new draft with matching name/description/attributes and `provenance='cloned-from-current'`; (c) exactly one `architecture_element_mappings` row exists per cloned element with `mapping_type='equivalent'`, `status='confirmed'`, `confidence=1.0`, `created_by_task='target-state-suggest'`; (d) diagram tables are NOT cloned.
- Backend integration test: empty-source 422 — seed a current architecture with zero elements, invoke the endpoint, assert HTTP 422 with the specified message and no new draft / no mapping rows created.
- Frontend test: sub-tab navigation — render the Architecture & Design page, navigate to `/projects/.../architecture-design/target-state`, assert the Target State sub-tab is active and the workspace renders.
- Frontend test: Suggest button disabled while pending — render the Target State sub-tab with at least one draft, click Suggest, assert the button is disabled while the request is in flight and re-enabled on resolution.

## Out of Scope

- LLM-driven Suggest of any flavour — replaced wholesale by the deterministic path. (Future Spec 3.)
- Architect-persona conversation that captures rationale, decisions, exceptions per element. (Spec 3.)
- Captured decisions table + resolver + DTO extension that lets downstream PM tasks read decisions. (Spec 2.)
- Per-element exception pinning ("this one element diverges from the equivalence default"). (Spec 3.)
- Add Component / Add API / Add Data Entity / Add Infrastructure inline-add UI in the table editor. Removed in this spec; re-introduced in Spec 3 ONLY if the architect conversation requires it.
- Target-side diagram authoring + the Diagram View tab inside the sub-tab. (Future spec.)
- Downstream PM-task integration changes (Migration Discovery Context aggregation, Book of Work generation, Shape-Spec generation will continue to work technology-naively against the populated target). (Spec 4.)
- Backfill / cleanup of existing broken "Draft 2026-05-22 #1" empty drafts in user databases — flagged via the new "empty" badge but the user deletes them manually. No cleanup changeset.
- Cross-architecture server-side locking during Suggest — capture-at-click-time only.
- New schema columns on entity tables for back-reference — the `architecture_element_mappings` row is the sole mechanism.
- Extension of the existing `POST /target-architectures/seed` endpoint with a new mode — the new Suggest is a dedicated endpoint, the existing seed modes are untouched.

## Existing Code to Leverage

### `ArchitectureCloneService.cloneArchitecture`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureCloneService.java:652`
- Existing public method that deep-copies an architecture, used by `TargetArchitectureSeedService` for its `clone-current` mode. The new `SuggestFromCurrentService` delegates Phase 2 directly to this method, passing an explicit `includedTables` list covering the full meta-model and excluding diagrams. No changes to the clone service itself.

### `ModelService.loadModelByProjectIdAndArchitectureId`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java`
- Canonical "what's in this architecture?" surface, parent-chain-aware post-`2026-05-22-architecture-scope-via-parent-not-leaf`. Used by Phase 1 of the new service for both the empty-source check and any pre-clone validation.

### `architecture_element_mappings` table + repository + service
- `architecture-model-service/src/main/java/com/example/architecturemodel/repository/entity/ArchitectureElementMappingRepository.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/ArchitectureElementMappingService.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ArchitectureElementMappingController.java`
- Existing CRUD for mapping rows. Phase 3 reuses the repository (or service) for the bulk insert. No schema changes, no new columns. The same table powers the existing SelectiveCopyWizardModal Mapping Review step.

### `TargetArchitectureDecommissionService`
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/TargetArchitectureDecommissionService.java`
- Powers the Mark Decommissioned action in the Unmapped current elements panel. Kept as-is, accessible from the Target State sub-tab without modification.

### `TargetArchitectureSeedService` (untouched reference pattern)
- `architecture-model-service/src/main/java/com/example/architecturemodel/service/TargetArchitectureSeedService.java`
- Existing peer service that orchestrates the `clone-current` / `blank` / `from-template` seed modes by calling `ArchitectureCloneService.cloneArchitecture`. The new `SuggestFromCurrentService` follows the same orchestration shape (single `@Transactional`, delegate to clone service, decorate result) but writes mapping rows on top. NOT extended — kept untouched.

### Frontend `TargetArchitectureWorkspace.tsx` + Compare view + targetArchitecturesApi
- `frontend/src/components/Architecture/TargetArchitectureWorkspace.tsx`
- `frontend/src/components/Architecture/TargetArchitectureCompareView.tsx`
- `frontend/src/api/targetArchitecturesApi.ts`
- Workspace component, Compare view, and API client all retained. The workspace is re-mounted under the new sub-route (no file move required), the Compare view is unchanged, and the API client gains a new `suggestTargetFromCurrent` function while shedding the deleted `suggestTargetArchitecture` LLM function.

## Implementation Notes

- **Single `@Transactional` boundary**: Phase 2 (clone) and Phase 3 (mapping inserts) must share one transaction. If any mapping insert fails, the entire clone rolls back. Use Spring's default propagation; do not introduce `REQUIRES_NEW`.
- **Capture-at-click-time architecture id**: the request body must carry `currentArchitectureId` explicitly. The server uses ONLY that value for Phase 1 + Phase 2 + Phase 3 source attribution. Any "active architecture" header / session value is ignored to keep the clone deterministic against the user's intent at click time.
- **Auto-name collision and double-click guard**: server-side scan for an existing draft named `Target State - Suggested YYYY-MM-DD` (or with the next `(N)` suffix) created within the last 5 seconds returns 409. Outside that window, append the next available numeric suffix and proceed.
- **AppShell cache invalidation** (per `project_appshell_model_cache.md`): the new draft is a sibling architecture under the same project. Frontend must dispatch the appropriate cache action after Suggest completes so the Drafts panel and any cross-architecture views surface the new draft without a manual refresh. Cross-architecture cache rules from the memory note apply.
- **Diagram tables skipped**: pass an explicit `includedTables` list to `ArchitectureCloneService.cloneArchitecture` that excludes `sequence_diagrams`, `sequence_fragments`, and any other diagram-domain tables, matching the existing Selective Copy exclusion. If the clone service does not currently expose a way to opt out of diagrams, audit + extend its parameter handling minimally — but only the inclusion list, not a behaviour change.
- **`@JsonNaming(LowerCamelCaseStrategy.class)` annotations**: any new request / response DTO (the `SuggestFromCurrentRequest` body, the response containing the new draft id + auto-resolved name + mapping count) carries this annotation, consistent with the selective-copy + mapping DTO pattern.
- **Naming convention** (per project memory `feedback_no_invented_acronyms.md`): write "Architecture Model Service" rather than "AMS" in user-facing copy, error messages, and any new doc comments. Internal class names follow existing project conventions.
- **No edits to applied Liquibase changesets** (per project memory `feedback_liquibase_immutable_changesets.md`): this spec introduces no schema changes. If a follow-up adds a schema concern, it goes in a new changeset.
- **Pre-existing test failures** (per `CLAUDE.md`): the listed pre-existing failures (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-*`, `chatV2-panel-*`) are unrelated to this work — do not touch them.
- **Trace before coding** (per project memory `feedback_trace_before_coding.md`): before deleting any LLM-stack file, grep for incoming references and unwire the route registration cleanly so the gateway still boots.

## Commit Boundary

One commit covering:
- New `SuggestFromCurrentService` + the new `POST /api/projects/{projectId}/target-architectures/suggest-from-current` endpoint + any required new DTOs with `@JsonNaming`.
- Frontend Target State sub-tab mount under `/architecture-design/target-state`, sub-tab nav strip, redirect from old `/target-architecture` route, removal of the top-level route, empty-state card, empty-badge in Drafts panel, auto-select after Suggest, pending-disable on Suggest button.
- Replacement of `handleSuggestFromCurrent` to call the new deterministic endpoint; drop of `suggestPending` "10-30s" spinner copy and `overlaysByTargetId` overlay stamping.
- Removal of the LLM Suggest stack files listed under "Removal of broken LLM stack" plus their tests.
- Removal of `handleAddElement` + the "Add Component / API / Data entitie / Infrastructur" buttons and the Diagram View tab from the workspace.
- The four tests listed under Tests.

## Definition of Done

- Visiting `/projects/:p/architectures/:a/target-architecture` (any old bookmark) lands on `/projects/:p/architectures/:a/architecture-design/target-state` via 200 + replace navigation.
- The top-level "Target Architecture" tab is no longer reachable from the TopBar or any direct route registration.
- On a project with a non-trivial current architecture, clicking Suggest creates a new target draft within ~1 second, populates it with a 1:1 clone of every meta-model element (diagrams excluded), writes one `architecture_element_mappings` row per cloned element with the specified values, and auto-selects the new draft in the Drafts panel without auto-promoting it.
- On a project with an empty current architecture, clicking Suggest yields a 422 with the message "Current architecture has no elements to suggest from" and creates no draft and no mapping rows.
- Clicking Suggest twice in rapid succession results in exactly one new draft: the second click is either blocked by the frontend pending-disable or rejected with a 409 by the server-side double-click guard.
- A draft with zero elements (including any pre-existing broken draft from the May-20 flow) shows the inline "empty" badge in the Drafts panel.
- The Add Component / API / Data entitie / Infrastructur buttons and the Diagram View tab no longer appear anywhere in the workspace.
- All four new tests pass; all existing tests for the kept pieces (Promote / Delete / Mark Decommissioned / Compare / Selective Copy / Mapping CRUD) still pass.
- Downstream Migration Discovery Context aggregation, Book of Work generation, and Shape-Spec generation can be invoked against the new draft and produce technology-naive output (no regressions vs current behaviour on a populated current-state draft).
- Grep across `gateway/src/` returns zero hits for `suggestTargetArchitecture`; grep across `frontend/src/` returns zero hits for the deleted LLM Suggest function name or the `overlaysByTargetId` symbol; the LLM task + prompt files no longer exist.
