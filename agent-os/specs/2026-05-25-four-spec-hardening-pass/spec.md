# Specification: Four-Spec Hardening Pass

## Goal

Close four small quality gaps flagged across Specs 1-4 of the migration-workflow rework in a single commit: delete an orphan component, eliminate one stale URL's reliance on a safety-net redirect, badge every empty draft (not just the selected one) via a new `elementCount` field on the target-architectures list response, and replace the static frontend `questionLibraryScopes.ts` mirror with a runtime fetch from a new gateway endpoint. This is a deliberately narrow hardening pass — not a v2 of any shipped spec.

## User Stories

- As a frontend maintainer, I want the orphan `TargetArchitectureDiagramView.tsx` file removed (along with its now-unused CSS class definitions in the shared workspace stylesheet), so the codebase has no stale dead-code references waiting to confuse future contributors.
- As a user clicking "Author target" on the Dashboard, I want the button to navigate directly to the new `architecture-design/target-state` sub-route, so the action does not depend on Spec 1's redirect safety-net to land on the correct page.
- As a migration architect viewing the Drafts panel, I want every empty draft to display the "empty" badge — not just the currently-selected draft — so I can see at a glance which drafts have no elements without clicking each one in turn.
- As a frontend developer maintaining the architect-conversation exception sub-dialog, I want the allowed-exception-scopes map fetched at runtime from the gateway, so a future edit to the gateway's question library no longer requires a hand-mirrored update to a frontend constant file.
- As an operator opening the exception sub-dialog when the scopes fetch fails, I want the dialog to still open with a disabled scope picker showing "no exception scopes available — try again later", so I can read context and cancel cleanly rather than hitting a blocked or empty modal.

## Specific Requirements

### Item 1: Delete `TargetArchitectureDiagramView.tsx` (dead code)

- Delete `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx` (177 lines, zero importers per audit).
- No paired `.module.css` or `.test.tsx` exists alongside the component — nothing additional to delete beyond the `.tsx` file itself.
- Surgical CSS cleanup in the shared `TargetArchitectureWorkspace.module.css`: grep each of the 10 class names the deleted file imports (`diagramViewPanel`, `diagramViewHeader`, `readonlyBadge`, `emptyMessage`, `errorBanner`, `diagramList`, `diagramCard`, `diagramCardName`, `diagramCardMeta`, `diagramCardLink`) against the rest of `frontend/src/`; delete class definitions whose only remaining reference was inside the deleted component.
- Do not blanket-delete; classes still referenced by sibling workspace components stay put.
- Grep-verify zero remaining matches of `TargetArchitectureDiagramView` across `frontend/`.
- No new tests for this item per spec-total cap (file deletion + empty-imports grep is sufficient verification).

### Item 2: Fix `DashboardView.tsx:547` to use new sub-route directly

- File: `frontend/src/components/DashboardView/DashboardView.tsx`, line 547.
- Replace the current navigation target `/projects/${activeProject.id}/architectures/${activeArchitectureId}/target-architecture` with the new sub-route `/projects/${activeProject.id}/architectures/${activeArchitectureId}/architecture-design/target-state`.
- Add a one-line inline comment noting that Spec 1's `<Navigate replace>` redirect still exists as a safety net for any other stale callers / bookmarks but that this call site no longer relies on it.
- Button `data-testid` (`card-hla-author-target-button`) and surrounding render code are untouched.
- No new tests — covered by existing dashboard render tests, which must continue to pass.

### Item 3: `elementCount` across all drafts (lightweight counts)

- **AMS DTO extension**: add a new nullable `elementCount: Long` field to `architecture-model-service/.../model/dto/ArchitectureDto.java` appended after the 10 existing fields. Add an 11-arg constructor; the existing 8-arg and 10-arg backward-compatible constructors delegate with `elementCount = null`. The field is a boxed `Long` (never primitive `long`) per `project_primitive_double_dto_overwrite.md`.
- **AMS service**: `promoteService.listTargets(projectId)` populates `elementCount` using **4 grouped SQL queries**, one per user-visible supertype table, of the form `SELECT architecture_id, COUNT(*) FROM <supertype_table> WHERE architecture_id IN (:draftIds) GROUP BY architecture_id`. Aggregate the four grouped results in service code, keyed by `architecture_id`, into a single `Long` per draft. The four supertype tables are the same set used by the existing Mark-Decommissioned UX (counting semantic b per Q2). The query strategy MUST respect the parent-chain scope semantics from `ArchitectureScopeResolver` per the `2026-05-22-architecture-scope-via-parent-not-leaf` spec.
- **Gateway**: `gateway/src/routes/targetArchitectures.ts` is a pure pass-through — no code change. The new field flows through verbatim.
- **Frontend wire type and mapper**: extend the wire DTO and its wire-to-domain mapper in `frontend/src/api/targetArchitecturesApi.ts` so the domain `TargetArchitectureDto` carries `elementCount` (nullable). Domain consumers null-check before treating `0` as "empty".
- **Frontend UI**: the Drafts panel inside `TargetArchitectureWorkspace.tsx` reads `elementCount` for every draft and renders the "empty" badge on every draft with `elementCount === 0` (null-safe). Remove the "only selected draft is badged" lazy-loading comment Spec 1 left behind.
- **Refresh path**: the existing `refreshDrafts()` callback already runs after mutations — no new wiring needed; the re-fetch picks up updated counts naturally. No separate invalidation channel.

### Item 4: `questionLibraryScopes` via runtime fetch

- **New gateway endpoint**: `GET /api/architect-conversation/question-library/scopes` registered on the existing `architectConversationRouter` in `gateway/src/routes/architectConversation.ts`. Returns the projected scope map `{ <decisionCode>: { allowedExceptionScopes: ScopeRefType[] } }` derived from the `QUESTION_LIBRARY` constant in `gateway/src/config/architect-conversation/questionLibrary.ts` via a small in-file projection helper. Uses whatever middleware the router already applies — no special auth.
- **In-process gateway cache**: the projection is computed once at module load (the library is a frozen TS constant) and held as a module-level value; second and subsequent calls hit the cached value with no recomputation.
- **Frontend client**: add `fetchQuestionLibraryScopes()` to `frontend/src/api/architectConversationApi.ts` returning the typed scope map.
- **Frontend integration**: the Architect Conversation tab fetches the scope map on mount, following the project's existing hook conventions (`useEffect` or React Query / SWR — match whatever the surrounding code uses). The result is session-cached in memory with **no TTL**; re-fetch only fires on tab close + reopen.
- **Static-file deletion**: delete `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` entirely. No fallback file is kept — the runtime fetch is authoritative.
- **Re-export removal**: grep for `QUESTION_LIBRARY_ALLOWED_SCOPES` across `frontend/src/` and remove the re-export from `ArchitectConversationTab.tsx` (line 609 today) along with any downstream consumers of that re-exported name; route them to the runtime-fetched value instead.
- **Graceful-degrade UX (Q12 option a)**: on fetch failure, the exception sub-dialog still OPENS, but the scope picker is rendered DISABLED and shows the message "no exception scopes available — try again later". The user can cancel out. The sub-dialog does NOT block opening on fetch failure.

### Tests (cap: 4 backend + 4 frontend, spec-total)

- **Backend test 1 (AMS)**: list endpoint returns correct `elementCount` per draft for a fixture mixing empty and populated drafts, covering aggregation across all four supertype tables.
- **Backend test 2 (AMS)**: `elementCount` respects parent-chain scope semantics — a child draft's count correctly includes elements inherited via the parent chain per `ArchitectureScopeResolver`.
- **Backend test 3 (gateway)**: the new `GET /api/architect-conversation/question-library/scopes` endpoint returns the projected scope map matching the library shape, and the in-process cache is exercised on the second call (no recomputation).
- **Backend test 4**: one reserved slot at implementer discretion if a gap surfaces during write.
- **Frontend test 1**: Drafts panel renders the "empty" badge on every draft with `elementCount === 0`, not just the selected draft.
- **Frontend test 2**: Architect Conversation tab calls `fetchQuestionLibraryScopes` on mount.
- **Frontend test 3**: exception sub-dialog renders the correct scopes from the fetched data.
- **Frontend test 4**: on fetch failure, the exception sub-dialog still opens with the scope picker disabled and the "no exception scopes available — try again later" message visible; the user can cancel out cleanly.

## Out of Scope

- A v2 of any of the four shipped specs (Specs 1-4 of the migration-workflow rework) — no feature additions, no LLM behaviour changes, no new conversation surfaces, no new PM tasks.
- Revisiting deliberate v1 design decisions: no PATCH on captured decisions, no decision-code enum validation, no resolver size cap, no transcript resolver, no concurrent-user locking, no streaming responses — all stay as-is.
- AMS test-infrastructure cleanup (the pre-existing `<maven.test.skip>true</maven.test.skip>` workaround and related test-compile failures) — a separate spec.
- `@JsonNaming(LowerCamelCaseStrategy.class)` audit sweep across remaining AMS DTOs — a separate cleanup spec.
- Standards Registry Read API (Spec 5).
- API Test Harness & Reconciliation loop.
- Spec 4's optional story-level scope cross-check tightening.
- `DiscoveryRunDetailView.module.css` rename (cosmetic; deferred).
- Backfilling historical data for any of the four shipped specs.
- Compare View decoration, conversation transcript export, per-question context lead-ins, mapping-notes pretty rendering.
- Unifying `ScopeRefType` across gateway and frontend — explicitly deferred to a separate cleanup spec (Q11). Both sides' independent unions stay in lock-step manually until that spec lands.
- A new `/api/v1/...` URL prefix convention — the new scopes endpoint stays on the existing `/api/...` convention per Q10.

## Existing Code to Leverage

### `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx`

- The 177-line dead-code component to delete (Item 1). Imports `loadModelByProjectId` from `../../api/modelApi` and shared `ArchitectureModel` / `Diagram` types; uses 10 named classes from the shared `TargetArchitectureWorkspace.module.css`. Zero importers across `frontend/src/` confirmed by audit.

### `frontend/src/components/DashboardView/DashboardView.tsx` (line 547)

- The "Author target" button's navigation site (Item 2). Existing dashboard render tests cover the surrounding render path; the one-line URL substitution should not break any of them. The `data-testid="card-hla-author-target-button"` attribute stays untouched.

### `architecture-model-service/.../model/dto/ArchitectureDto.java`

- The 10-field Java record extended in Item 3. Already uses boxed types throughout (in line with `project_primitive_double_dto_overwrite.md`) and already has a backward-compatible 8-arg constructor that defaults newer fields to null — replicate that pattern when adding the 11-arg constructor for `elementCount`.

### `ArchitectureScopeResolver` (AMS, `2026-05-22-architecture-scope-via-parent-not-leaf` spec)

- Parent-chain scope semantics that Item 3's grouped count queries must honour. The four grouped SQL queries count rows in scope via the parent chain (not the leaf `architecture_id` column directly); reuse the resolver's traversal rather than reinventing it.

### `frontend/src/api/targetArchitecturesApi.ts` (`listTargetArchitectures` wire-to-domain mapper)

- The mapper extended in Item 3. Add `elementCount` to both the wire DTO type and the domain DTO type; the mapper extension is additive and nullable.

### `gateway/src/routes/architectConversation.ts` (`architectConversationRouter`) and `gateway/src/config/architect-conversation/questionLibrary.ts`

- The natural home for Item 4's new `GET /api/architect-conversation/question-library/scopes` endpoint, and the source-of-truth `QUESTION_LIBRARY` constant the endpoint projects from. The new endpoint inherits whatever middleware the router already applies — no bespoke auth. The `allowedExceptionScopes: readonly ScopeRefType[]` field is present on every one of the 51 library entries; the projection is mechanical.

## Implementation Notes

- **Audit-corrected file paths from `planning/requirements.md`**: (1) the static frontend mirror is at `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` — the raw idea's path was incorrect. (2) The shape-spec uses no `.module.css` paired with `TargetArchitectureDiagramView.tsx`; only the shared `TargetArchitectureWorkspace.module.css` requires the surgical class-name sweep. Both corrections are threaded into the requirements above.
- **Re-export sweep for Item 4 (per Q5)**: the implementer must grep for `QUESTION_LIBRARY_ALLOWED_SCOPES` (the named re-export from `ArchitectConversationTab.tsx:609`) before deleting the static file. Any consumer that imports the re-exported name needs rerouting to the runtime-fetched value first; only then is the static file safe to delete.
- **Boxed types (per `project_primitive_double_dto_overwrite.md`)**: `elementCount` MUST be `Long` (not primitive `long`). Any handler that PATCHes `ArchitectureDto` must null-guard this field so missing JSON does not silently wipe to `0L`.
- **Counting semantic (Q2 override → b)**: count only the four user-visible supertype tables (the same four supertypes used by the Mark-Decommissioned UX). NOT every entity table; NOT a per-domain breakdown. The query strategy is 4 grouped queries (Q9), not N×4 per-draft `COUNT(*)` calls.
- **Graceful-degrade UX (Q12 override → a)**: the exception sub-dialog opens even on fetch failure, with a disabled scope picker and the "no exception scopes available — try again later" message. The dialog must NOT be blocked from opening on fetch failure.
- **Session-cached, no TTL (Q6)**: the frontend caches the fetched scope map in memory for the session. The gateway's question library only changes on edit + redeploy; a session refresh covers that.
- **Independent `ScopeRefType` unions (Q11)**: gateway serialises scopes using its gateway union; frontend deserialises into its frontend union. Both unions today have identical members — keep them in lock-step manually until the deferred unification spec lands.
- **No build-pipeline change**: Item 4 is runtime fetch only — no code generator, no build hook, no `prebuild` script.
- **Refresh path for Item 3 (Q3)**: piggyback on the existing `refreshDrafts()` callback in the workspace — no new invalidation channel.
- **Frontend cache invariants (per project memory)**: this spec does not introduce any new in-AppShell model writes; the existing AppShell per-(project, architecture) model cache is unaffected by the four items.
- **No phantom tasks (per `feedback_no_phantom_tasks.md`)**: if any item in the four-item list appears already done at implementation time (e.g. another contributor deletes the orphan file), simply confirm it and move on — do NOT expand to fill the gap.
- **Trace before coding (per `feedback_trace_before_coding.md`)**: before extending the wire-to-domain mapper in Item 3, trace the full data flow from `promoteService.listTargets` through the gateway pass-through into the Drafts panel render path so the nullable `elementCount` field is handled correctly at every hop.
- **No new acronyms (per `feedback_no_invented_acronyms.md`)**: write "Architecture Model Service" in error messages, log lines, and doc comments rather than compressing to shorthand.

## Commit Boundary

One commit covering all four items:

- Item 1: file deletion + surgical CSS-class cleanup in the shared workspace stylesheet.
- Item 2: one-line URL substitution + inline safety-net comment in `DashboardView.tsx:547`.
- Item 3: `ArchitectureDto` field + 11-arg constructor + service-side 4-grouped-query aggregation + frontend wire DTO + mapper + Drafts-panel badge update + lazy-loading comment removal.
- Item 4: new gateway endpoint + projection helper + module-load cache + frontend client function + tab-mount fetch wiring + session cache + graceful-degrade UX + static-file deletion + `QUESTION_LIBRARY_ALLOWED_SCOPES` re-export removal across consumers.
- All new tests (capped at 4 backend + 4 frontend, spec-total).

No Liquibase changesets, no new Architecture Model Service endpoints beyond the additive field on the existing list response, no new gateway client methods beyond the new `fetchQuestionLibraryScopes`, no AppShell cache invalidation changes.

## Definition of Done

- `git grep "TargetArchitectureDiagramView"` returns zero matches anywhere in `frontend/`.
- `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES"` returns zero matches anywhere in `frontend/`.
- The shared `TargetArchitectureWorkspace.module.css` no longer contains any class definitions whose only remaining reference was inside the deleted `TargetArchitectureDiagramView.tsx`; all other class definitions still in use elsewhere are preserved.
- The Dashboard "Author target" button navigates directly to `/projects/{projectId}/architectures/{architectureId}/architecture-design/target-state` (verifiable in browser DevTools network tab — no 30x redirect response). The Spec 1 `<Navigate replace>` safety-net redirect still exists for stale bookmarks but is not exercised by this button.
- `GET /api/projects/{projectId}/target-architectures` returns `ArchitectureDto` records with a nullable `elementCount: Long` populated by the 4-grouped-query aggregation. Existing callers that ignore the new field continue to function (backward-compatible).
- The Drafts panel inside `TargetArchitectureWorkspace.tsx` renders the "empty" badge on every draft with `elementCount === 0` — not just the selected one. The "only selected draft is badged" lazy-loading comment is gone.
- The new `GET /api/architect-conversation/question-library/scopes` endpoint returns the projected scope map matching the gateway library shape; the second call hits the module-load cache with no recomputation.
- `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` is deleted; the Architect Conversation tab fetches the scope map on mount via `fetchQuestionLibraryScopes()` and caches the result in memory for the session with no TTL.
- On scopes-fetch failure, the exception sub-dialog opens with the scope picker disabled and the message "no exception scopes available — try again later" displayed; the user can cancel out cleanly.
- All new tests pass (cap: 4 backend + 4 frontend, spec-total). All previously-passing tests continue to pass.
- Total commit count for this spec: one.
