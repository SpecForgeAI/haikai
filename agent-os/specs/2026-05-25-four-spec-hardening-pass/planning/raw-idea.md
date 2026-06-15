# Raw Idea: Four-Spec Hardening Pass

## Why this spec exists

Specs 1–4 of the migration-workflow rework shipped end-to-end. They work. But each verification report flagged small caveats that didn't justify their own follow-up specs individually — dead code left behind, a stale URL relying on a redirect, an empty-state badge that only fires for the selected draft, a frontend↔gateway sync hazard. None of them are bugs you'd file. All four are real quality gaps that get worse as the codebase ages and other contributors touch the surrounding files.

This spec is a **focused hardening pass** to close those four specific gaps in one small commit. It is deliberately narrow — it is not a place to expand scope, add features, or re-litigate v1 design decisions that were intentionally deferred. If an item isn't on the four-item list below, it does NOT belong in this spec.

## What this spec is (and isn't)

**This spec is:**
- Delete one orphan file (`TargetArchitectureDiagramView.tsx`) plus any unused imports it still has hanging around.
- Update one stale URL in `DashboardView.tsx` to use the new sub-route directly (eliminating reliance on Spec 1's redirect for the "Author target" button).
- Extend the existing target-architectures list response with per-draft `elementCount` so the Drafts panel can badge every empty draft, not just the selected one.
- Replace the manually-mirrored frontend `questionLibraryScopes.ts` file with a runtime fetch — new gateway endpoint that serves the scope map, frontend hook that loads it on Architect Conversation tab mount.

**This spec is not:**
- A v2 of any of the four shipped specs — no feature additions, no LLM behaviour changes, no new conversation surfaces, no new PM tasks.
- An opportunity to revisit deliberate v1 decisions (no PATCH on captured decisions, no decision-code enum validation, no resolver size cap, no transcript resolver, no concurrent-user locking, no streaming responses — all of these stay as-is).
- A test-infrastructure cleanup (the pre-existing AMS test-compile failures, the `<maven.test.skip>true</maven.test.skip>` workaround, etc — separate spec).
- A `@JsonNaming` audit sweep across remaining AMS DTOs — separate cleanup spec.
- The Standards Registry Read API (that's Spec 5).
- The API Test Harness & Reconciliation loop (separate 2-3 spec effort).
- Spec 4's optional story-level scope cross-check tightening — not in this scope.

## Decisions already made (don't re-litigate in shape-spec)

These were settled in the conversation that produced this raw idea:

1. **Exactly four items.** Anything else is out of scope; the spec is deliberately small.
2. **One commit boundary.**
3. **Item 4 uses runtime fetch, not build-time generator.** Simpler, no build pipeline change, works in dev without a regenerate step.
4. **Item 3 extends the existing target-architectures list endpoint** with a new `elementCount: number | null` field rather than adding a new lightweight counts endpoint. Additive change, backward compatible.
5. **No frontend changes for Item 2 beyond the one URL update.** No new tests just for that single-line change — covered by manual smoke or the existing dashboard render test.
6. **Backend-only changes for Items 3 and 4 ship with new tests; frontend integration tests for those two items capped at 2-4 each.**
7. **Item 1 needs zero new tests** — file deletion + grep-verified-empty-imports is enough.

## Specific requirements (rough — let shape-spec refine)

### Item 1: Delete `TargetArchitectureDiagramView.tsx` (dead code)

- File: `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx`.
- Spec 1 removed the import + tab usage but left the file on disk.
- Grep-verify no live imports across `frontend/src/` (the file should have zero importers).
- Delete the file. Delete its `.module.css` if a paired one exists. Delete its test file if any.
- No new tests needed.

### Item 2: Fix `DashboardView.tsx:547` to use new route directly

- File: `frontend/src/components/DashboardView/DashboardView.tsx` around line 547.
- Current behaviour: button navigates to OLD `/projects/:p/architectures/:a/target-architecture` URL. Works only because Spec 1's `<Navigate replace>` redirect transparently re-routes it to `/projects/:p/architectures/:a/architecture-design/target-state`.
- Update the URL string to the new path directly.
- Add a brief inline comment that the redirect still exists as a safety net for any other stale callers / bookmarks.
- No new tests required — the existing dashboard render tests should keep passing because the redirect still works either way.

### Item 3: Empty-draft badge across all drafts (lightweight counts)

**Backend (Architecture Model Service):**
- Extend the existing target-architectures list endpoint response DTO with a new field `elementCount: Long` (nullable boxed type per `project_primitive_double_dto_overwrite.md`) — count of all in-scope element rows under the draft's `architecture_id` (reuse the parent-chain semantics from `ArchitectureScopeResolver` per the 2026-05-22 spec).
- The count is bounded — these are user-visible drafts; a single SQL `SELECT COUNT(*) FROM <each-supertype-table> WHERE architecture_id = ?` per draft + aggregate. Acceptable to issue N small queries; the drafts list is typically small (single-digit per project).
- Alternative if perf is a concern: precomputed cached count column on `architecture` itself, refreshed on element insert/delete via trigger. Not needed for v1 given draft list size.
- Endpoint URL stays the same; response shape gains the new field; backward-compatible additive change.

**Gateway:**
- Pass-through — the existing proxy route forwards the response verbatim. No new client method needed; the existing `listTargetArchitectures` (or equivalent) typed wrapper picks up the new field by extending its TypeScript type.

**Frontend:**
- Drafts panel inside `TargetArchitectureWorkspace.tsx` already renders the "empty" badge on the selected draft using inventory-loaded element counts. Extend to use the new `elementCount` field for ALL drafts in the list — no fan-out of N inventory calls.
- Remove the lazy "only selected draft is badged" comment that the Spec 1 implementer left.

**Tests:**
- AMS service test: list endpoint returns correct `elementCount` per draft (mixed empty + populated drafts). 2-4 tests.
- Frontend test: Drafts panel renders the badge on every empty draft, not just selected. 2-3 tests.

### Item 4: `questionLibraryScopes.ts` via runtime fetch

**Gateway:**
- New endpoint `GET /api/v1/architect-conversation/question-library/scopes` (or `/api/architect-conversation/question-library-scopes` — match existing convention).
- Returns the scope map: `{ <decisionCode>: { allowedExceptionScopes: <ScopeRefType>[] } }` extracted from the existing `gateway/src/config/architect-conversation/questionLibrary.ts` `QUESTION_LIBRARY` constant via a small projection helper.
- Pure read; no auth beyond whatever the gateway already requires for the other architect-conversation routes.
- Cached in-process at startup (the question library is a frozen TS constant; no need to recompute per request).

**Frontend:**
- New API client function `fetchQuestionLibraryScopes()` in the existing `architectConversationApi.ts`.
- Architect Conversation tab fetches the scope map on mount (or via a React Query / SWR hook if the project uses one — match existing pattern).
- Cache the result in memory for the session; no re-fetch unless the tab is closed and reopened.
- Replace the static `questionLibraryScopes.ts` file's contents with the runtime-resolved value. Delete the static file once the new fetch is wired and the exception-pinning sub-dialog reads from the live state instead.
- If the fetch fails: the exception sub-dialog gracefully degrades to "no exception scopes available — try again later" rather than letting the user pick from a stale local mirror.

**Tests:**
- Gateway: new endpoint returns the projected scope map; matches the library shape; cached on second call. 2-4 tests.
- Frontend: ArchitectConversation tab calls the fetch on mount; exception sub-dialog renders correct scopes from the fetched data; fetch-failure shows the graceful-degrade message. 2-4 tests.

## Out of Scope

- Adding any new features to the four shipped specs.
- Backfilling historical data for any of the four shipped specs.
- The deliberate v1 design decisions listed in "What this spec is not" above.
- Spec 5 (Standards Registry Read API).
- AMS test-infrastructure cleanup.
- `@JsonNaming` audit sweep on remaining AMS DTOs.
- `DiscoveryRunDetailView.module.css` rename (cosmetic; deferred).
- Story-level scope cross-check tightening (Spec 4's deferred-but-borderline item).
- Any UX enrichments mentioned in the four-spec follow-up summary (Compare View decoration, conversation transcript export, per-question context lead-ins, mapping-notes pretty rendering).

## Dependencies

- Specs 1–4 all shipped + committed.
- `2026-05-22-architecture-scope-via-parent-not-leaf` — relevant for Item 3 (the `elementCount` query should use the parent-chain scope, not the leaf column).
- `@JsonNaming(LowerCamelCaseStrategy.class)` pattern — Item 3's extended DTO field still snake-cases correctly under the existing convention.

## Open questions for shape-spec to clarify

1. **Item 3 — extend existing list endpoint vs add new counts endpoint?** Raw idea proposes extending the existing list endpoint with the new `elementCount` field. Alternative would be a separate `GET .../target-architectures/element-counts` endpoint. My instinct: **extend the existing endpoint** — additive, backward compat, frontend's existing fetch already runs at the right time. Confirm?

2. **Item 3 — exact counting semantic.** Should `elementCount` be (a) total across all entity tables (every supertype + every relationship row), (b) only the "user-visible" tables (the four supertypes per the existing Mark-Decommissioned UX), or (c) a structured breakdown `{component: N, api: N, dataEntity: N, infrastructure: N}` so the badge can be richer than "empty / non-empty"? My instinct: **(a) total across all tables** — simplest, drives the badge accurately ("empty if total == 0"). (c) is overkill for the "empty" badge use case; if richer per-domain counts ever matter, add then.

3. **Item 3 — refresh semantics.** After Mark Decommissioned (or any other mutation that adds/removes elements), does the Drafts panel auto-refresh the `elementCount`? My instinct: **yes** — extend the existing `refreshDrafts()` (or equivalent) callback that the workspace already runs after mutations to also re-fetch the list. Cheap.

4. **Item 4 — endpoint authentication.** The new scopes endpoint serves config-derived static data; no per-project filtering. Should it require auth at all? My instinct: **whatever the gateway's other architect-conversation routes require** — consistency over special-casing.

5. **Item 4 — what happens to the `questionLibraryScopes.ts` static file?** Two options: (a) **delete it entirely**, frontend reads only from the runtime fetch; (b) keep it as a fallback in case the fetch fails. My instinct: **(a) delete it** — keeping a stale fallback defeats the entire purpose of moving to runtime fetch. If the fetch fails, the exception sub-dialog shows the graceful-degrade message and the user retries.

6. **Item 4 — cache invalidation.** The cached scope map at the frontend lives until tab close. Is that acceptable, or do we need a TTL / manual refresh? My instinct: **session-cached, no TTL** — the scope map only changes when the gateway's question library is edited and redeployed; a session refresh covers that.

7. **Item 1 — paired CSS/test files.** Does `TargetArchitectureDiagramView.tsx` have a paired `.module.css` or `.test.tsx` to also delete? Implementer should grep + delete any orphans introduced alongside the original component.

8. **Tests cap.** Four items, mostly small. My instinct: **cap at 4 backend + 4 frontend tests for the spec total**, not per item. Confirm?

## Verification

After this spec:
- `git grep "TargetArchitectureDiagramView"` returns zero matches anywhere in `frontend/`.
- The `DashboardView` "Author target" button navigates directly to the new sub-route (verifiable in browser DevTools network tab — no redirect 30x response).
- Every empty draft in the Drafts panel shows the "empty" badge, not just the selected one.
- The frontend `questionLibraryScopes.ts` static file is gone; the exception sub-dialog reads from the runtime-fetched scope map.
- All previously-passing tests continue to pass.

## Commit boundary

One commit covering all four items: file deletion, URL update, AMS DTO extension + counts query, gateway scope-map endpoint + frontend fetch wiring, plus the small number of new tests.
