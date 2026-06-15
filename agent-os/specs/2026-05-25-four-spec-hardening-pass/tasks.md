# Task Breakdown: Four-Spec Hardening Pass

## Overview
Total Tasks: 4 task groups, 30 sub-tasks. One commit boundary. Hard cap: 4 backend + 4 frontend new tests (spec-total, shared across Items 3 + 4; Items 1 + 2 add zero tests).

## Task List

### Group 1: No-Test Items — Dead-Code Deletion + URL Substitution (Items 1 + 2)

#### Task Group 1: Delete orphan `TargetArchitectureDiagramView.tsx` + surgical CSS cleanup + Dashboard URL fix
**Dependencies:** None
**Tests added:** 0 (per spec — covered by existing dashboard render tests and grep verification)

- [x] 1.0 Complete Items 1 + 2 (no new tests)
  - [x] 1.1 Delete the orphan component file
    - Delete `frontend/src/components/Architecture/TargetArchitectureDiagramView.tsx` (177 lines)
    - No paired `.module.css` or `.test.tsx` to delete — only the `.tsx` file itself
  - [x] 1.2 Surgical CSS cleanup in `TargetArchitectureWorkspace.module.css`
    - For each of the 10 class names imported by the deleted file — `diagramViewPanel`, `diagramViewHeader`, `readonlyBadge`, `emptyMessage`, `errorBanner`, `diagramList`, `diagramCard`, `diagramCardName`, `diagramCardMeta`, `diagramCardLink` — grep the rest of `frontend/src/`
    - Delete only those class definitions whose ONLY remaining reference was inside the deleted component
    - Preserve class definitions still referenced by sibling workspace components — do NOT blanket-delete
  - [x] 1.3 Update `DashboardView.tsx:547` "Author target" navigation URL
    - File: `frontend/src/components/DashboardView/DashboardView.tsx`, line 547
    - Replace `/projects/${activeProject.id}/architectures/${activeArchitectureId}/target-architecture` with `/projects/${activeProject.id}/architectures/${activeArchitectureId}/architecture-design/target-state`
    - Add a one-line inline comment noting that Spec 1's `<Navigate replace>` redirect still exists as a safety net for other stale callers / bookmarks but that this call site no longer relies on it
    - Do NOT touch the `data-testid="card-hla-author-target-button"` attribute or surrounding render code
  - [x] 1.4 Grep-verify zero residue for Item 1
    - Run `git grep "TargetArchitectureDiagramView"` over `frontend/` — must return zero matches
  - [x] 1.5 Confirm no test additions for this group
    - Per spec-total cap, Items 1 + 2 contribute zero new tests
    - Existing dashboard render tests must continue to pass (verified later in Group 4)

**Acceptance Criteria:**
- `TargetArchitectureDiagramView.tsx` file no longer exists on disk
- `git grep "TargetArchitectureDiagramView"` returns zero matches across `frontend/`
- Only the CSS class definitions whose sole remaining reference was inside the deleted component are gone; all other class definitions in `TargetArchitectureWorkspace.module.css` still in use elsewhere are preserved
- The "Author target" button in `DashboardView.tsx:547` navigates directly to `.../architecture-design/target-state` (no 30x redirect when clicked)
- The inline safety-net comment is present at the updated call site
- Zero new test files created by this group

---

### Group 2: Item 3 — `elementCount` on target-architectures list (AMS + frontend)

#### Task Group 2: Add nullable `elementCount: Long` field + 4 grouped count queries + Drafts-panel badge
**Dependencies:** None (independent of Group 1)
**Tests added:** 2 backend + 1 frontend (out of the spec-total 4 + 4 cap)

- [x] 2.0 Complete `elementCount` end-to-end
  - [x] 2.1 Write 3 focused tests for Item 3 (2 backend AMS + 1 frontend)
    - **Backend test 1 (AMS service):** list endpoint returns correct `elementCount` per draft for a fixture mixing empty drafts and populated drafts across all four user-visible supertype tables (aggregation correctness)
    - **Backend test 2 (AMS service):** `elementCount` respects parent-chain scope semantics — a child draft correctly includes elements inherited via the parent chain per `ArchitectureScopeResolver`
    - **Frontend test 1:** Drafts panel inside `TargetArchitectureWorkspace.tsx` renders the "empty" badge on EVERY draft with `elementCount === 0` (null-safe), not just the currently-selected draft
    - Tests live alongside the code they exercise; no LLM mocking required (no LLM calls in this item)
  - [x] 2.2 Extend `ArchitectureDto.java` with nullable `elementCount: Long`
    - File: `architecture-model-service/.../model/dto/ArchitectureDto.java`
    - Append `elementCount` as the 11th field — MUST be boxed `Long` (never primitive `long`) per `project_primitive_double_dto_overwrite.md`
    - Add an 11-arg canonical constructor
    - Existing 8-arg and 10-arg backward-compatible constructors delegate with `elementCount = null` (follow the established additive-constructor pattern)
    - `@JsonNaming(LowerCamelCaseStrategy.class)` already applied via the existing convention — no bespoke annotation needed
  - [x] 2.3 Implement 4-grouped-query aggregation in `promoteService.listTargets(projectId)`
    - Issue exactly 4 grouped SQL queries — one per user-visible supertype table — of the form `SELECT architecture_id, COUNT(*) FROM <supertype_table> WHERE architecture_id IN (:draftIds) GROUP BY architecture_id`
    - Use the same four supertype tables that the existing Mark-Decommissioned UX uses (counting semantic per Q2 override → option b)
    - MUST honour parent-chain scope semantics from `ArchitectureScopeResolver` per `2026-05-22-architecture-scope-via-parent-not-leaf` — do NOT count by leaf `architecture_id` directly
    - Aggregate the four grouped results in service code keyed by `architecture_id` into a single `Long` per draft, populate `elementCount` on each `ArchitectureDto`
    - Do NOT use N×4 per-draft `COUNT(*)` queries — 4 grouped queries only
    - Null-guard the field in any update handler that PATCHes `ArchitectureDto` so missing JSON does not silently wipe to `0L` (per `project_primitive_double_dto_overwrite.md`)
  - [x] 2.4 Confirm gateway pass-through requires no code change
    - `gateway/src/routes/targetArchitectures.ts` is already a pure pass-through for `GET /projects/:projectId/target-architectures` — the new field flows through verbatim
    - Verify with a quick read of the route handler that no field allow-listing strips `elementCount`
  - [x] 2.5 Extend frontend wire DTO + wire-to-domain mapper
    - File: `frontend/src/api/targetArchitecturesApi.ts`
    - Add `elementCount: number | null` to the wire DTO type
    - Add `elementCount: number | null` to the domain `TargetArchitectureDto` type
    - Extend the wire-to-domain mapper to thread the field through (additive, nullable)
    - Trace the full data flow end-to-end from `promoteService.listTargets` through the gateway pass-through into the Drafts panel render path (per `feedback_trace_before_coding.md`) before changing the mapper
  - [x] 2.6 Update Drafts panel badge logic in `TargetArchitectureWorkspace.tsx`
    - Read `elementCount` for every draft (not just the selected one)
    - Render the "empty" badge on every draft where `elementCount === 0` (null-safe — null means "count unknown", so do NOT badge nulls)
    - Remove the "only selected draft is badged" lazy-loading comment Spec 1 left behind
    - Rely on the existing `refreshDrafts()` callback for re-fetch after mutations — no new invalidation channel
  - [x] 2.7 Ensure Item 3 tests pass
    - Run ONLY the 3 tests written in 2.1
    - Verify the AMS service tests pass against the test fixture
    - Verify the frontend Drafts-panel badge test passes
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3 tests written in 2.1 pass
- `ArchitectureDto` has a nullable `elementCount: Long` 11th field with the 11-arg constructor and backward-compatible delegation from the 8-arg / 10-arg constructors
- `promoteService.listTargets(projectId)` issues exactly 4 grouped count queries (one per supertype table) and populates `elementCount` per draft, honouring parent-chain scope semantics
- `GET /api/projects/{projectId}/target-architectures` returns `ArchitectureDto` records with the new `elementCount` field populated; existing callers that ignore the field continue to function (backward-compatible)
- The Drafts panel renders the "empty" badge on every draft with `elementCount === 0`, not just the selected one; the lazy-loading comment is gone

---

### Group 3: Item 4 — Runtime fetch for `questionLibraryScopes` (gateway + frontend)

#### Task Group 3: New scopes endpoint + frontend fetch hook + static-file deletion + graceful-degrade UX
**Dependencies:** None (independent of Groups 1 + 2)
**Tests added:** 1 backend + 3 frontend (completing the spec-total 4 + 4 cap when combined with Group 2's 2 + 1)

- [x] 3.0 Complete `questionLibraryScopes` runtime-fetch migration
  - [x] 3.1 Write 4 focused tests for Item 4 (1 backend gateway + 3 frontend)
    - **Backend test 3 (gateway):** new `GET /api/architect-conversation/question-library/scopes` endpoint returns the projected scope map matching the gateway library shape; the second call hits the module-load cache with no recomputation (exercise both code paths in one test or two tightly-scoped tests within the single test slot)
    - **Frontend test 2:** Architect Conversation tab calls `fetchQuestionLibraryScopes` on mount
    - **Frontend test 3:** exception sub-dialog renders the correct scopes from the fetched data
    - **Frontend test 4:** on fetch failure the exception sub-dialog still OPENS with the scope picker disabled and the message "no exception scopes available — try again later" visible; the user can cancel out cleanly
    - This consumes the last backend slot (slot 4 was reserved at implementer discretion — assign it to the gateway endpoint test here) and the remaining 3 frontend slots
  - [x] 3.2 Add the new gateway endpoint + projection helper
    - File: `gateway/src/routes/architectConversation.ts`
    - Register `GET /api/architect-conversation/question-library/scopes` on the existing `architectConversationRouter` — URL exactly as written, no `/v1/` prefix (per Q10)
    - Use whatever middleware the router already applies — no special auth (per Q4)
    - Add a small in-file projection helper that derives the scope map `{ <decisionCode>: { allowedExceptionScopes: ScopeRefType[] } }` from the `QUESTION_LIBRARY` constant in `gateway/src/config/architect-conversation/questionLibrary.ts`
    - Use plain English in error messages, log lines, and doc comments — write "Architecture Model Service" rather than shorthand (per `feedback_no_invented_acronyms.md`)
  - [x] 3.3 In-process gateway cache at module load
    - Compute the projection ONCE at module load (the library is a frozen TS constant) and hold it as a module-level value (e.g. a top-level `const` or a memoized singleton)
    - Second and subsequent endpoint calls hit the cached value with no recomputation
    - No TTL, no manual invalidation surface
  - [x] 3.4 Add `fetchQuestionLibraryScopes()` to the frontend API client
    - File: `frontend/src/api/architectConversationApi.ts`
    - Returns the typed scope map (gateway `ScopeRefType` union deserialised into the frontend's independent `ScopeRefType` union — both unions have identical members today; keep them in lock-step manually per Q11)
  - [x] 3.5 Wire `fetchQuestionLibraryScopes()` into the Architect Conversation tab on mount
    - File: `frontend/src/components/targetState/architectConversation/ArchitectConversationTab.tsx`
    - Fetch on tab mount using whichever hook convention the surrounding code already uses (React Query / SWR / manual `useEffect`)
    - Cache in memory for the session — no TTL, re-fetch only on tab close + reopen (per Q6)
  - [x] 3.6 Implement graceful-degrade UX on fetch failure (Q12 → option a)
    - On fetch failure, the exception sub-dialog still OPENS
    - Render the scope picker DISABLED with the message "no exception scopes available — try again later"
    - The user can cancel out cleanly
    - The sub-dialog MUST NOT block opening on fetch failure
  - [x] 3.7 Delete the static `questionLibraryScopes.ts` file
    - Delete `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` entirely
    - No fallback file is kept — the runtime fetch is authoritative
  - [x] 3.8 Remove the `QUESTION_LIBRARY_ALLOWED_SCOPES` re-export and reroute consumers
    - Grep for `QUESTION_LIBRARY_ALLOWED_SCOPES` across `frontend/src/` before deleting anything
    - Remove the re-export from `ArchitectConversationTab.tsx` (line 609 today)
    - Route any downstream consumers of that re-exported name to the runtime-fetched value first; only then is the static file safe to delete (verify sequencing against task 3.7)
  - [x] 3.9 Ensure Item 4 tests pass
    - Run ONLY the 4 tests written in 3.1
    - Verify the gateway endpoint test exercises both first-call computation and second-call cache-hit
    - Verify all three frontend tests pass
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 3.1 pass
- `GET /api/architect-conversation/question-library/scopes` returns the projected scope map matching the gateway library shape; the in-process cache hit on the second call is verified by test
- `frontend/src/components/targetState/architectConversation/questionLibraryScopes.ts` no longer exists on disk
- `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES"` returns zero matches across `frontend/`
- The Architect Conversation tab fetches the scope map on mount and caches it in memory for the session with no TTL
- On fetch failure, the exception sub-dialog still opens with the scope picker disabled and the "no exception scopes available — try again later" message visible

---

### Group 4: Verification — Full test sweeps + grep sweeps + DoD walkthrough

#### Task Group 4: End-to-end verification before the single commit
**Dependencies:** Task Groups 1, 2, 3
**Tests added:** 0 (verification only — no new tests; cap of 4 + 4 already consumed by Groups 2 + 3)

- [x] 4.0 Verify the full spec is done and ready for the single commit
  - [x] 4.1 Run the spec-specific test suite
    - Run all 7 new tests added by this spec (2 + 1 from Group 2; 1 + 3 from Group 3 — total 4 backend + 4 frontend)
    - Confirm zero new tests beyond the 4 + 4 cap
    - Confirm all 7 new tests pass
  - [x] 4.2 Confirm previously-passing tests still pass for the touched surfaces
    - Run the surrounding AMS tests covering `promoteService` and `ArchitectureDto`
    - Run the surrounding gateway tests covering `architectConversationRouter` and `targetArchitecturesApi`
    - Run the surrounding frontend tests covering `DashboardView`, `TargetArchitectureWorkspace`, and `ArchitectConversationTab`
    - Do NOT run the entire application test suite — scope is the touched surfaces only
  - [x] 4.3 Grep-sweep for banned residue
    - `git grep "TargetArchitectureDiagramView"` across `frontend/` — must return zero matches
    - `git grep "QUESTION_LIBRARY_ALLOWED_SCOPES"` across `frontend/` — must return zero matches
    - `git grep "questionLibraryScopes"` across `frontend/` — must return zero matches (the static file is gone)
    - Confirm the deleted CSS class definitions have no orphan references in `TargetArchitectureWorkspace.module.css`
  - [x] 4.4 Reachability + behaviour smoke checks
    - Confirm `GET /api/architect-conversation/question-library/scopes` is reachable on the gateway and returns a non-empty scope map
    - Confirm the Dashboard "Author target" button navigates directly to `.../architecture-design/target-state` with no 30x redirect (verifiable in browser DevTools network tab)
    - Confirm the Drafts panel renders the "empty" badge on every empty draft, not just the selected one
    - Confirm the exception sub-dialog opens with the disabled-picker + message UX when the scopes fetch is forced to fail (e.g. by blocking the gateway URL temporarily)
  - [x] 4.5 Walk the Definition of Done bullet-by-bullet against `spec.md`
    - Tick each of the 10 DoD bullets in `spec.md` — every one must be satisfied
    - Confirm exactly one commit boundary covers all four items + the 4 + 4 tests
    - Confirm no Liquibase changesets were added
    - Confirm no AppShell cache invalidation changes were made (per `project_appshell_model_cache.md` — this spec adds no in-AppShell model writes)
    - Confirm no expansion beyond the four items (per `feedback_no_phantom_tasks.md` — if any item was already done at implementation time, that fact was confirmed and the gap was NOT filled with new work)

**Acceptance Criteria:**
- All 4 backend + 4 frontend new tests pass (exactly 8 new tests, spec-total)
- All previously-passing tests on the touched surfaces continue to pass
- All three `git grep` sweeps return zero matches for the banned identifiers
- All 10 DoD bullets in `spec.md` are demonstrably satisfied
- Exactly one commit is created covering all four items + the 8 new tests
- No Liquibase changesets, no AppShell cache invalidation changes, no scope expansion beyond the four items

## Execution Order

Recommended implementation sequence:
1. **Group 1** — Items 1 + 2 (no tests, low-risk file deletion + URL fix; clears the surface for the riskier items)
2. **Group 2** — Item 3 (AMS DTO + 4 grouped queries + Drafts-panel badge; 2 + 1 tests)
3. **Group 3** — Item 4 (gateway endpoint + frontend fetch + static-file deletion + graceful-degrade; 1 + 3 tests)
4. **Group 4** — Verification (full test sweeps + grep sweeps + DoD walkthrough; no new tests)

Groups 1, 2, 3 are independent of each other (the four items have no inter-item dependencies) — they could be done in any order or in parallel by different contributors. The order above is recommended for risk-laddering (smallest blast radius first). Group 4 MUST run last as it depends on all three preceding groups being complete.

The single commit is created AFTER Group 4 passes.
