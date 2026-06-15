# Raw Idea: Low-Priority Mechanical Cleanups (Batched #10, #13, #14)

## Why this spec exists

Three deferred maintenance items have accumulated from earlier specs in the migration-workflow rework arc. Each is small enough that a dedicated spec would be overkill, but small enough that they keep getting pushed down the priority queue. Batching them into one cleanup spec gets them all off the list with a single commit boundary and a single review pass.

The three items:

1. **#10 — Spec 1 frontend test fallout cleanup.** Spec `2026-05-24-target-state-subtab-deterministic-suggest` reorganised the target-architecture surface from a top-level tab into a sub-tab. Some frontend tests likely have weakened assertions, stale URLs, or pre-existing `act()` warnings that were left in place to keep the suite green during the refactor.

2. **#13 — `DiscoveryRunDetailView.module.css` rename.** The component file pair is currently named `DiscoveryRunDetailViewWithTabs.{tsx,test.tsx,module.css}`. The `WithTabs` suffix was provisional during the introduction of tabs, expecting a non-tabbed sibling that never materialised. The canonical view IS the tabbed view; the suffix is now noise.

3. **#14 — `ScopeRefType` union unification (drift detection).** The same 7-member union is declared in two places — `gateway/src/config/architect-conversation/questionLibrary.ts:28-35` (canonical) and `frontend/src/api/architectConversationApi.ts:43-50` (duplicate with a self-deprecating comment). The frontend's own comment explicitly defers "cross-process unification" to a separate spec.

This is a **Small** spec — three independent mechanical changes, ~50-150 LOC total across the batch, no AMS or schema work, no new features.

## What this spec is (and isn't)

**This spec is:**

- Three independent mechanical cleanups bundled into one commit.
- Each item independently verifiable. If one item turns out harder than expected, the others still ship.
- Discovery-led for #10: the implementer surveys the surface, surfaces the actual list of weakened tests, then applies the cleanup.

**This spec is not:**

- Feature work of any kind.
- A refactor of the underlying behaviours.
- A change to AMS / schema / wire shape.
- An attempt to fully unify `ScopeRefType` via a shared types package (deferred — see Out of Scope). v1 adds a **drift-detection contract test** between the two declarations.
- A full audit of every pre-existing weakened test in the frontend suite — only Spec 1's known fallout.
- A backward-compatibility shim for the renamed file (the existing imports get updated atomically; no alias).

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Batch all three in one commit.** Each is too small on its own; bundled they make a coherent reviewable PR.
2. **#14 ships as drift-detection only.** A proper shared-types package would be more invasive than the rest of this spec combined. v1 keeps the two literal definitions and adds a Vitest contract test that imports both and asserts equality. If the cross-package import resolution turns out fragile, fall back to a JSON-keyed list shared via a tiny utility file.
3. **#13 is an atomic rename** — no compatibility alias. All importers updated in the same commit.
4. **#10 audit scope**: only tests touched by Spec 1's refactor surface. NOT a general "make all pre-existing flaky tests pass" exercise.
5. **No backend changes** in any of the three items.
6. **Test count**: ~3-6 new/tightened tests total across the batch.

## Specific requirements (rough — let shape-spec refine)

### Item 1: Spec 1 frontend test fallout cleanup (#10)

**Audit surface**: tests in `frontend/src/components/` modified by the Spec 1 implementer. Likely candidates from prior implementation summaries:
- `ApiBaselinesListPage.test.tsx` — implementer flagged `act()` warnings during Spec 4 (`api-test-harness-target-side-capture`), unresolved.
- Tests under `frontend/src/components/Architecture/` that test the target-architecture sub-tab routing.
- `frontend/src/App.tsx` route tests (if any) that touch `/architecture-design/target-state`.
- Discovery: grep for `// TODO`, `// FIXME`, `expect.any()`, `expect(...).toMatch(/.*/)`, `it.skip`, `describe.skip` introduced or modified during the Spec 1 commit window.

**Cleanup actions per finding**:
- Weakened assertion → restore the tight assertion (or document why it can't be tightened).
- `act()` warning → wrap the offending update in `act(() => ...)` or `await waitFor(...)`.
- Stale URL → update to the new sub-tab URL.
- `// TODO` referencing Spec 1 → resolve or convert to a follow-up ticket.

**Out of scope**: pre-existing flakes from earlier specs (MEMORY.md lists them; not this spec's concern).

**Expected output**: 0-N test files touched depending on what the audit surfaces. Each touched file gets a clearer assertion + a one-line comment explaining the fix.

### Item 2: `DiscoveryRunDetailView` rename (#13)

**Rename targets** (atomic via `git mv`):
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.tsx` → `DiscoveryRunDetailView.tsx`
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.test.tsx` → `DiscoveryRunDetailView.test.tsx`
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.module.css` → `DiscoveryRunDetailView.module.css` (verify the CSS file actually has the `WithTabs` suffix — implementer confirms during the rename)

**Importer updates** (5 confirmed sites via grep):
- `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` — update the import path + identifier.
- `frontend/src/components/Discovery/FindingsTab.tsx` — update the Javadoc reference (code comment only).
- Any other importers the rename surfaces (verify via `git grep DiscoveryRunDetailViewWithTabs` post-rename returns zero matches in `src/`).

**Component identifier**: the React component name inside the file MUST also change from `DiscoveryRunDetailViewWithTabs` to `DiscoveryRunDetailView`. Update the function/const declaration and the default export.

**CSS class names**: if the `.module.css` declares classes that happen to include `WithTabs` in their names, those stay — they're internal selectors, not exports.

**Spec / docs references**: old specs reference the file by its old name. Those are historical artefacts; DO NOT update them. Only update live source code references.

**No alias / no shim**: importers update atomically; no `WithTabs.tsx` re-export shim.

**Verification**: `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches; existing tests pass unchanged.

### Item 3: `ScopeRefType` drift-detection contract test (#14)

**Status quo**:
- `gateway/src/config/architect-conversation/questionLibrary.ts:28-35` declares the canonical 7-member union.
- `frontend/src/api/architectConversationApi.ts:43-50` declares the same 7-member union, plus an `ALLOWED_SCOPE_REF_TYPES` constant at line 52-60.
- Gateway has its own `ALLOWED_SCOPE_REF_TYPES` constant in `loadConfigs.ts:45`.

**Goal**: prevent silent drift between the two declarations. If a future contributor adds an 8th scope type to the gateway and forgets the frontend, a test should fail.

**Implementation options** (shape-spec picks):

**Option A — Vitest cross-package import (frontend-side test)**:
- New test `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`.
- Imports `ALLOWED_SCOPE_REF_TYPES` from both `../architectConversationApi.ts` (local) and via relative path from `../../../gateway/src/config/architect-conversation/loadConfigs.ts` (cross-package).
- Asserts `[...frontendValues].sort()` equals `[...gatewayValues].sort()`.
- Risk: Vitest's resolver may complain about reaching outside the frontend's `tsconfig.json` `rootDir`. If so, add `frontend/vitest.config.ts` allow-list entry.
- Pro: zero new code, zero new packages, single test file.
- Con: cross-package import is fragile if either package's build moves.

**Option B — JSON source-of-truth**:
- New file `gateway/src/config/architect-conversation/scopeRefType.json` containing the 7 values.
- Gateway TS reads it and derives the union via `as const`.
- Frontend test reads the same JSON via relative path (more stable than a TS import).
- Frontend production code keeps its own declaration; the test enforces equality.
- Pro: deterministic, doesn't depend on TS build setup.
- Con: adds an indirection that future readers have to learn.

**Option C — Shared types package** (defer to v2):
- Out of scope per Decision 2.

**My instinct: Option A.** Smallest path; if cross-package imports turn out fragile, fall back to B in the same commit.

**Comment updates**: drop the "deferred to a separate spec" comment on line 681 of `architectConversationApi.ts` once the drift-detection test ships.

**Test cap**: 1 new test for this item.

### Combined verification

- `cd frontend && npm test` — new + tightened tests pass; previously-passing tests stay green.
- `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches.
- `git grep "ALLOWED_SCOPE_REF_TYPES" frontend/src/ gateway/src/` shows the contract test is in place AND both copies still declare the constant.
- `cd gateway && npm test` — no regressions (gateway side untouched by this spec but worth sanity-checking).

## Out of Scope

- A shared types package between gateway and frontend (v2; too invasive for this batch).
- A full sweep of pre-existing frontend test failures listed in MEMORY.md (not this spec's concern).
- Renaming any other "...WithTabs" files (there's only the Discovery one).
- A backward-compat alias for the renamed `DiscoveryRunDetailView` file.
- Refactoring the underlying behaviour of the `ScopeRefType` consumers.
- AMS / gateway / discovery-service backend changes.
- A code-generation pipeline (`tsc --build`, `quicktype`, etc.) for types crossing the gateway/frontend boundary.
- A unified types module for OTHER duplicated cross-package types (there may be more; deferred unless they cause real drift).
- Spec 2 / Spec 3 frontend test fallout — only Spec 1 per the priority list.
- New AMS endpoints, schema changes, or wire-shape changes.

## Dependencies

- `2026-05-24-target-state-subtab-deterministic-suggest` (shipped) — the source of #10's fallout.
- `2026-05-16-discovery-findings-first-class` (shipped) — created the `DiscoveryRunDetailViewWithTabs` file (#13 target).
- `2026-05-24-target-state-architect-conversation` (shipped) — established the `ScopeRefType` declarations (#14 target).

No new external dependencies.

## Open questions for shape-spec to clarify

1. **#10 audit completeness criterion.** The audit pass might find 0, 5, or 20+ tests to tighten. What's the cap? My instinct: **cap at 10 file touches for this batch**; if the audit surfaces more, flag the remainder as a follow-up spec and ship the first 10. Keeps the batch from sprawling.

2. **#10 — does "weakened assertion" include `expect.any()` usage that was always there?** Or only those introduced/loosened during Spec 1? My instinct: **only Spec 1 introductions** — verified via `git blame` on the relevant assertions. Pre-Spec-1 weakened assertions are out of scope.

3. **#13 — does `.module.css` actually exist with the `WithTabs` suffix?** Quick verification needed. My instinct: **implementer verifies during the rename**; if the CSS file is already named without the suffix, that part of the rename is a no-op.

4. **#13 — internal React component identifier rename.** Rename the function/component too (`function DiscoveryRunDetailViewWithTabs` → `function DiscoveryRunDetailView`), or only the file? My instinct: **rename both — file AND component identifier** for consistency. Tests that reference `<DiscoveryRunDetailViewWithTabs />` get updated.

5. **#14 — Option A (cross-package import) vs Option B (JSON source-of-truth)?** My instinct: **try Option A first**; if Vitest can't resolve the cross-package import cleanly, fall back to B in the same commit.

6. **#14 — should the test ALSO verify the gateway's `ALLOWED_SCOPE_REF_TYPES` matches the gateway's `ScopeRefType` literal union?** Currently they're separate declarations that happen to match. My instinct: **yes** — same test asserts both inter- and intra-package consistency. Drift detection should be complete.

7. **Commit boundary — one commit or three?** My instinct: **one commit**. The three items are independent but each is too small to justify a separate review pass.

8. **Test cap.** My instinct: **3-6 tests total** across the batch (up to ~10 in the unlikely case #10's audit surfaces a lot of weakened assertions).

9. **Failure isolation: if Item 2 or Item 3 breaks unexpectedly, ship the other items?** My instinct: **yes** — each item is independent. The implementer commits items incrementally and can split the commit if one item escalates.

10. **Naming.** Spec folder is `2026-05-26-low-priority-mechanical-cleanups`. Long, but unambiguous. My instinct: **keep**; the slug describes the batch.

## Verification

After this spec:
- All Spec 1 frontend test-fallout findings either tightened or documented as out-of-scope follow-ups.
- `frontend/src/components/Discovery/DiscoveryRunDetailView.{tsx,test.tsx,module.css}` exist; old `WithTabs`-suffixed files do not; all importers updated; React component identifier renamed.
- New `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts` (or similar) passes; deferring-comment removed from `architectConversationApi.ts`.
- All previously-passing tests still pass; pre-existing flakes unchanged.

## Commit boundary

One commit covering all three items. Implementer may split per-item if one escalates, but the default expectation is a single commit.
