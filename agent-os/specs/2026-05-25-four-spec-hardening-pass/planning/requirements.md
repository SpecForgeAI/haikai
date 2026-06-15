# Spec Requirements: Four-Spec Hardening Pass

## Initial Description

(See `planning/raw-idea.md` for the full narrative.) Focused hardening pass to close four small quality gaps flagged across Specs 1-4 of the migration-workflow rework, shipped in one commit:

1. **Item 1** — Delete the dead component `TargetArchitectureDiagramView.tsx` (Spec 1 unhooked it but left the file on disk).
2. **Item 2** — Fix `DashboardView.tsx` "Author target" button to navigate to the new sub-route directly (eliminating reliance on Spec 1's `<Navigate replace>` safety-net redirect).
3. **Item 3** — Surface `elementCount` on every target-architecture in the list response so the Drafts panel can badge every empty draft (today only the selected draft is badged).
4. **Item 4** — Replace the static frontend `questionLibraryScopes.ts` mirror with a runtime fetch from a new gateway endpoint, eliminating the frontend↔gateway sync hazard.

This spec is deliberately narrow. If an item isn't on the four-item list, it does NOT belong here. No v2 of any shipped spec, no feature additions, no re-litigation of deliberate v1 design decisions.

## Settled Decisions (carried from raw idea — DO NOT re-litigate)

1. **Exactly four items.** Anything else is out of scope.
2. **One commit boundary** covering all four items.
3. **Item 4 uses runtime fetch, not build-time generator.** Simpler, no build-pipeline change, works in dev without a regenerate step.
4. **Item 3 extends the existing `GET /api/projects/{projectId}/target-architectures` endpoint** with a new nullable `elementCount: Long` field rather than adding a new lightweight counts endpoint. Additive, backward-compatible.
5. **No frontend changes for Item 2 beyond the one URL update.** No new tests for that single-line change — covered by existing dashboard render tests.
6. **Backend-only changes for Items 3 and 4 ship with new tests; frontend integration tests for those two items capped at 2-4 each.**
7. **Item 1 needs zero new tests** — file deletion + grep-verified empty-imports is enough.

## Pre-shape audit findings (file-grounded — load-bearing for spec-writer)

### Item 1: `TargetArchitectureDiagramView.tsx`
- File: `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx` (177 lines).
- Imports `loadModelByProjectId` from `../../api/modelApi` and shared `ArchitectureModel`/`Diagram` types.
- Uses CSS classes from `TargetArchitectureWorkspace.module.css` (a SHARED stylesheet — no paired `.module.css` file of its own).
- `grep` over `frontend/src` returns ONE match — the file itself. Zero importers anywhere.
- No paired `TargetArchitectureDiagramView.test.tsx` or `TargetArchitectureDiagramView.module.css` exists.
- CSS classes referenced from the shared workspace stylesheet: `diagramViewPanel`, `diagramViewHeader`, `readonlyBadge`, `emptyMessage`, `errorBanner`, `diagramList`, `diagramCard`, `diagramCardName`, `diagramCardMeta`, `diagramCardLink`.

### Item 2: `DashboardView.tsx:547`
- Confirmed at line 547. Current line:
  ```ts
  navigate(`/projects/${activeProject.id}/architectures/${activeArchitectureId}/target-architecture`);
  ```
- The "Author target" button has `data-testid="card-hla-author-target-button"`.
- Target replacement: `/projects/.../architectures/.../architecture-design/target-state`.

### Item 3: `ArchitectureDto` + list endpoint
- DTO is a Java record at `architecture-model-service/.../model/dto/ArchitectureDto.java` with 10 canonical fields. Boxed types throughout (already follows `project_primitive_double_dto_overwrite.md`).
- It has a backward-compatible 8-arg constructor that defaults `kind` and `draftState` to null — same pattern we'd follow when adding `elementCount` (nullable Long, new arg appended, old constructors delegate with null).
- List endpoint: `GET /api/projects/{projectId}/target-architectures` (controller line 225) returns `List<ArchitectureDto>` via `promoteService.listTargets(projectId)`.
- Gateway proxy: `gateway/src/routes/targetArchitectures.ts` (already exists, `GET /projects/:projectId/target-architectures` registered) — pure pass-through, no client method changes needed.
- Frontend client: `frontend/src/api/targetArchitecturesApi.ts` `listTargetArchitectures(projectId)` returns `TargetArchitectureDto[]` via a wire-to-domain mapper — extending the wire DTO + mapper adds the new field cleanly.

### Item 4: `questionLibraryScopes.ts` + gateway library
- **Correct static-file path:** `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` (the raw idea referenced an incorrect path; this audit-corrected path is the one to use).
- Sole consumer of the static file: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`.
  - Imports `QUESTION_LIBRARY_ALLOWED_SCOPES` and `resolveAllowedExceptionScopes`.
  - Also **re-exports** `QUESTION_LIBRARY_ALLOWED_SCOPES` at line 609 — the implementer MUST grep for this re-export name and remove all consumers (or the re-export itself) as part of the deletion.
- Gateway-side authoritative library: `gateway/src/config/architect-conversation/questionLibrary.ts`. `QUESTION_LIBRARY` is a frozen TS constant; each entry has `allowedExceptionScopes: readonly ScopeRefType[]` (line 128 of the type def, present on every one of the 51 entries).
- `ScopeRefType` union: `'service' | 'interface' | 'endpoint' | 'physical_data_entity' | 'physical_data_attribute' | 'method' | 'class'`. **Same union name lives independently in the frontend at `frontend/src/api/architectConversationApi.ts`.** Both sides stay independent for this spec (see Q11 answer below).
- Existing gateway architect-conversation router: `gateway/src/routes/architectConversation.ts` (`architectConversationRouter`, registered in `server.ts`) — natural home for the new endpoint.

## Requirements Discussion

### Clarifying Questions and Answers

**Q1: Item 3 — endpoint shape (extend existing list endpoint vs new counts endpoint)?**
**Answer:** Extend the existing `GET /api/projects/{projectId}/target-architectures` with a nullable `elementCount: Long` field on the response DTO. Additive, backward-compatible. No new endpoint.

**Q2: Item 3 — counting semantic (a) total across all entity tables, (b) only the four user-visible supertype tables, or (c) structured per-domain breakdown?**
**Answer (override → b):** Count only the four user-visible supertype tables (the same four supertypes used by the existing Mark-Decommissioned UX). NOT every entity table; NOT a per-domain breakdown. A single aggregate `elementCount: Long` is sufficient.

**Q3: Item 3 — refresh semantics after mutation?**
**Answer:** Piggyback on the existing `refreshDrafts()` callback that the workspace already runs after mutations to re-fetch the list. No separate invalidation channel.

**Q4: Item 4 — endpoint authentication?**
**Answer:** Match whatever middleware `architectConversationRouter` already applies. No special-casing for the new endpoint.

**Q5: Item 4 — what happens to the static `questionLibraryScopes.ts` file?**
**Answer:** Delete it entirely. Correct path: `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts`. Implementer must also grep for the `QUESTION_LIBRARY_ALLOWED_SCOPES` re-export from `ArchitectConversationTab.tsx` (line 609) and remove it as part of the deletion. No fallback — the runtime fetch is authoritative.

**Q6: Item 4 — cache invalidation (TTL or session-cached)?**
**Answer:** Session-cached, no TTL, no manual refresh control. The scope map only changes when the gateway's question library is edited and redeployed; a session refresh covers that.

**Q7: Item 1 — paired CSS/test files and CSS cleanup approach?**
**Answer (override → b, surgical cleanup):** No paired `.module.css` or `.test.tsx` exists. For the shared `TargetArchitectureWorkspace.module.css`: grep each classname imported from that shared stylesheet against the rest of `frontend/src/` and delete any class definitions whose ONLY remaining reference was inside the deleted `TargetArchitectureDiagramView.tsx` file. Surgical, not blanket.

**Q8: Tests cap — per item or spec total?**
**Answer:** Hard cap at **4 backend + 4 frontend** new tests, **spec-total** (not per item).

**Q9: Item 3 — counting query strategy?**
**Answer:** Use 4 grouped queries (one per supertype table, `WHERE architecture_id IN (...) GROUP BY architecture_id`), NOT N×4 per-draft `COUNT(*)` queries. Aggregate the four grouped results in service code keyed by `architecture_id`. Reuses the parent-chain scope semantics from `ArchitectureScopeResolver` per the 2026-05-22 spec.

**Q10: Item 4 — endpoint URL?**
**Answer:** `GET /api/architect-conversation/question-library/scopes` (no `/v1/` prefix; matches existing convention).

**Q11: Item 4 — unify `ScopeRefType` union across gateway and frontend?**
**Answer:** Defer unification to a separate cleanup spec. This spec just removes the static mirror. Gateway and frontend keep their independent `ScopeRefType` unions for now.

**Q12: Item 4 — graceful-degrade UX when fetch fails?**
**Answer (override → a):** Sub-dialog still OPENS, but the scope picker shows "no exception scopes available — try again later" and is disabled. User can cancel out. The dialog does NOT block opening on fetch failure.

### Existing Code to Reference

**Similar features identified (from raw idea + audit; no additional references provided):**
- `ArchitectureScopeResolver` (architecture-model-service) — parent-chain scope semantics from `2026-05-22-architecture-scope-via-parent-not-leaf` spec. Item 3's counting query must respect this scope semantic (count rows in scope via the parent chain, not the leaf `architecture_id` column directly).
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern on existing AMS DTOs — Item 3's extended DTO field follows the existing snake-case wire convention transparently.
- `project_primitive_double_dto_overwrite.md` — Item 3's new `elementCount` field MUST be a boxed `Long` (not primitive `long`), with null guards in any update handler that touches `ArchitectureDto`.
- `ArchitectureDto.java` backward-compatible 8-arg constructor pattern — replicate for the new 11-arg constructor that takes `elementCount`; older constructors delegate with `null`.
- `gateway/src/routes/architectConversation.ts` (`architectConversationRouter`) — natural home for Item 4's new endpoint; reuse its existing middleware.
- `gateway/src/config/architect-conversation/questionLibrary.ts` — source-of-truth `QUESTION_LIBRARY` constant; Item 4's endpoint projects `allowedExceptionScopes` per decision code from this constant.
- `frontend/src/api/targetArchitecturesApi.ts` `listTargetArchitectures` wire-to-domain mapper — extend for Item 3's new `elementCount` field.
- `frontend/src/api/architectConversationApi.ts` — new `fetchQuestionLibraryScopes()` client function goes here for Item 4.

No additional reusability references provided by the user beyond what the raw idea and audit identified.

### Follow-up Questions
None. All 12 clarifying questions answered in one round; no contradictions or critical gaps surfaced.

## Visual Assets

### Files Provided
Bash check of `planning/visuals/` returned no visual files. None expected for a hardening pass.

### Visual Insights
N/A — prose-only spec.

## Requirements Summary

### Functional Requirements

**Item 1 — Delete `TargetArchitectureDiagramView.tsx`:**
- Delete the file at `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx`.
- Surgical CSS cleanup in shared `TargetArchitectureWorkspace.module.css`: grep each of the 10 classnames the deleted file imports (`diagramViewPanel`, `diagramViewHeader`, `readonlyBadge`, `emptyMessage`, `errorBanner`, `diagramList`, `diagramCard`, `diagramCardName`, `diagramCardMeta`, `diagramCardLink`) against the rest of `frontend/src/`; delete any class definition whose only remaining reference was inside the deleted file.
- Grep-verify zero remaining matches of `TargetArchitectureDiagramView` across `frontend/`.
- No new tests.

**Item 2 — Fix `DashboardView.tsx:547`:**
- Replace the old `/target-architecture` URL string with the new `/architecture-design/target-state` sub-route directly.
- Add a brief inline comment that Spec 1's `<Navigate replace>` redirect still exists as a safety net for any other stale callers / bookmarks.
- No new tests; existing dashboard render tests must continue to pass.

**Item 3 — `elementCount` across all drafts:**
- **AMS:** Extend `ArchitectureDto` with new nullable `elementCount: Long` field appended after the 10 existing fields. Add an 11-arg constructor; older constructors delegate with `null`.
- **AMS service:** `promoteService.listTargets(projectId)` populates `elementCount` per draft. Counting query strategy: 4 grouped SQL queries (one per supertype table) of the form `SELECT architecture_id, COUNT(*) FROM <supertype_table> WHERE architecture_id IN (:draftIds) GROUP BY architecture_id`, aggregated in service code into a single `Long` per `architecture_id`. Uses parent-chain scope semantics per `ArchitectureScopeResolver`.
- **Gateway:** `gateway/src/routes/targetArchitectures.ts` pass-through — no code change; the new field flows verbatim.
- **Frontend wire type:** Extend the wire DTO in `frontend/src/api/targetArchitecturesApi.ts` and its wire-to-domain mapper to carry `elementCount`.
- **Frontend UI:** Drafts panel inside `TargetArchitectureWorkspace.tsx` reads `elementCount` for every draft and renders the "empty" badge on every draft with `elementCount === 0` (or null-safe equivalent). Remove the "only selected draft is badged" lazy-loading comment Spec 1 left.
- **Frontend refresh:** Existing `refreshDrafts()` callback already runs after mutations — no new wiring needed; the re-fetch picks up updated counts naturally.

**Item 4 — `questionLibraryScopes` via runtime fetch:**
- **Gateway:** New endpoint `GET /api/architect-conversation/question-library/scopes` on `architectConversationRouter`. Returns the projected scope map: `{ <decisionCode>: { allowedExceptionScopes: ScopeRefType[] } }` derived from the existing `QUESTION_LIBRARY` constant via a small in-file projection helper. Cached in-process at module load (the library is a frozen TS constant). Uses whatever middleware the router already applies — no special auth.
- **Frontend client:** New `fetchQuestionLibraryScopes()` function in `frontend/src/api/architectConversationApi.ts`.
- **Frontend integration:** Architect Conversation tab fetches the scope map on mount (matching whatever pattern the existing hook conventions use — React Query / SWR / manual `useEffect`). Cache in memory for the session; no TTL; re-fetch only on tab close + reopen.
- **Static-file deletion:** Delete `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` entirely. Grep for and remove the `QUESTION_LIBRARY_ALLOWED_SCOPES` re-export from `ArchitectConversationTab.tsx` (line 609 today) plus any downstream consumers of that re-export.
- **Graceful-degrade UX on fetch failure:** Exception sub-dialog still OPENS but the scope picker shows the message "no exception scopes available — try again later" and is disabled. User can cancel out. The dialog does NOT block opening on fetch failure.

### Reusability Opportunities
- Replicate `ArchitectureDto`'s existing additive-constructor pattern for the `elementCount` extension.
- Reuse `architectConversationRouter`'s existing middleware for the new scopes endpoint — no bespoke auth.
- Reuse `ArchitectureScopeResolver`'s parent-chain semantics for the counting query — don't reinvent scope traversal.
- Reuse the existing `refreshDrafts()` callback in the workspace for Item 3's refresh path.

### Scope Boundaries

**In Scope:**
- The four items above, exactly as specified.
- Hard cap of 4 backend + 4 frontend new tests, spec-total.
- One commit covering all four items.

**Out of Scope (do not expand into any of these):**
- A v2 of any of the four shipped specs — no feature additions, no LLM behaviour changes, no new conversation surfaces, no new PM tasks.
- Revisiting deliberate v1 decisions: no PATCH on captured decisions, no decision-code enum validation, no resolver size cap, no transcript resolver, no concurrent-user locking, no streaming responses — all stay as-is.
- AMS test-infrastructure cleanup (pre-existing `<maven.test.skip>true</maven.test.skip>` workaround, etc.) — separate spec.
- `@JsonNaming` audit sweep across remaining AMS DTOs — separate spec.
- Standards Registry Read API (Spec 5).
- API Test Harness & Reconciliation loop.
- Spec 4's optional story-level scope cross-check tightening.
- `DiscoveryRunDetailView.module.css` rename (cosmetic; deferred).
- Backfilling historical data for any of the four shipped specs.
- Compare View decoration, conversation transcript export, per-question context lead-ins, mapping-notes pretty rendering.
- **Unifying `ScopeRefType` across gateway and frontend** — explicitly deferred to a separate cleanup spec (Q11). This spec keeps both sides' independent unions.
- A new `/api/v1/...` URL prefix convention — endpoint stays on the existing `/api/...` convention per Q10.

### Technical Considerations

- **Database/scope semantics:** Item 3's counting query MUST use the parent-chain scope semantics from `2026-05-22-architecture-scope-via-parent-not-leaf` via `ArchitectureScopeResolver`. The query strategy is 4 grouped queries (one per supertype table) keyed by `architecture_id IN (...)`, not N×4 per-draft `COUNT(*)` calls.
- **Boxed types:** `elementCount` MUST be `Long` (not primitive `long`) per `project_primitive_double_dto_overwrite.md`. Any handler that PATCHes `ArchitectureDto` must null-guard the field so missing JSON does not silently wipe to `0L`.
- **Backward compatibility:** `ArchitectureDto`'s existing 8-arg backward-compatible constructor is the model — add a new 11-arg constructor; older constructors delegate with `elementCount = null`.
- **`@JsonNaming(LowerCamelCaseStrategy.class)`:** Already applied via the existing convention; `elementCount` serializes correctly without bespoke annotation.
- **Frontend wire-to-domain mapper:** Extend the existing mapper in `targetArchitecturesApi.ts` so the domain `TargetArchitectureDto` carries `elementCount` (nullable). Domain consumers null-check before treating `0` as "empty".
- **`ScopeRefType` independence:** Gateway endpoint serializes scopes using the gateway union; frontend deserializes into the frontend union. Both unions today have identical members — keep them in lock-step manually until the deferred unification spec.
- **In-process gateway cache:** Module-load-time projection — no per-request recomputation. Cached value can be a module-level `const` or a memoized singleton.
- **No build-pipeline change:** Item 4 is runtime fetch only — no code generator, no build hook, no `prebuild` script.

### Tests (cap: 4 backend + 4 frontend, spec-total)

**Backend (AMS + gateway, up to 4 new tests):**
- AMS service test: list endpoint returns correct `elementCount` per draft for mixed empty + populated drafts (covers 4-supertype aggregation).
- AMS service test: `elementCount` respects parent-chain scope semantics (a child draft's count includes elements inherited via the parent chain, per `ArchitectureScopeResolver`).
- Gateway test: new scopes endpoint returns the projected scope map matching the library shape; in-process cache hit on second call.
- (One reserve slot — implementer's discretion if a gap surfaces during write.)

**Frontend (up to 4 new tests):**
- Drafts panel: every empty draft renders the "empty" badge (not just the selected one).
- ArchitectConversation tab: calls `fetchQuestionLibraryScopes` on mount.
- Exception sub-dialog: renders correct scopes from the fetched data.
- Exception sub-dialog: fetch-failure path shows the "no exception scopes available — try again later" message AND the sub-dialog still opens with a disabled scope picker.

### Commit Boundary

**One commit** covering all four items: file deletion (+ surgical CSS cleanup), URL update, AMS DTO extension + counts query + gateway pass-through, gateway scope-map endpoint + frontend fetch wiring + static-file deletion + re-export removal, plus the new tests (capped at 4 + 4).

### Verification

After this spec lands:
- `git grep "TargetArchitectureDiagramView"` returns zero matches anywhere in `frontend/`.
- `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES"` returns zero matches anywhere in `frontend/`.
- The `DashboardView` "Author target" button navigates directly to `/architecture-design/target-state` (verifiable in browser DevTools network tab — no 30x redirect response).
- Every empty draft in the Drafts panel shows the "empty" badge, not just the selected one.
- The frontend `questionLibraryScopes.ts` static file is gone; the exception sub-dialog reads from the runtime-fetched scope map; on fetch failure the sub-dialog opens with a disabled, message-bearing scope picker.
- All previously-passing tests continue to pass; the 4 + 4 new tests pass.

### Dependencies

- Specs 1–4 all shipped + committed (prerequisite).
- `2026-05-22-architecture-scope-via-parent-not-leaf` — load-bearing for Item 3's counting query.
- `@JsonNaming(LowerCamelCaseStrategy.class)` convention — applies transparently to Item 3's new DTO field.
- `project_primitive_double_dto_overwrite.md` — `elementCount` must be boxed `Long`.
