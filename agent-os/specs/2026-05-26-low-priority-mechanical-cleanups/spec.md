# Specification: Low-Priority Mechanical Cleanups (Batched #10, #13, #14)

## Goal

Ship three independent mechanical cleanups in one commit: add the missing test for Spec 1's redirect shim (#10), rename `DiscoveryRunDetailViewWithTabs` to `DiscoveryRunDetailView` atomically (#13), and establish drift detection for the duplicated `ScopeRefType` union via a JSON source-of-truth (#14). Frontend + gateway only, no backend changes, ~50-150 LOC total.

## User Stories

- As a maintainer scanning the Discovery codebase, I want the canonical detail view to be named `DiscoveryRunDetailView` (not `...WithTabs`) so that the file/component names reflect the fact that the tabbed view IS the canonical view, with no implied non-tabbed sibling.
- As a future contributor adding an 8th `ScopeRefType` value to the gateway, I want a Vitest contract test to fail loudly so that I cannot silently drift the gateway and frontend declarations apart.
- As a maintainer reviewing test coverage of Spec 1's redirect shim, I want one MemoryRouter test asserting `/target-architecture` redirects to `/architecture-design/target-state` so that the shim has explicit coverage rather than relying on the in-tree caller (`DashboardView.tsx:547`) to exercise it incidentally.

## Specific Requirements

**Item 1 — Redirect-shim test (#10)**
- New test file `frontend/src/__tests__/redirectShim.test.tsx` (implementer may instead append to an existing routing-tests file).
- Mounts `App` (or its `<Routes>` subtree) with `<MemoryRouter initialEntries={['/projects/p1/architectures/a1/target-architecture']}>`.
- Asserts the rendered route is `/projects/p1/architectures/a1/architecture-design/target-state`.
- Verifies the path params (`projectId`, `architectureId`) survive the `<Navigate replace to="../architecture-design/target-state">` because of the `..` prefix.
- Mirrors the MemoryRouter + `<Routes>` + landing-page testid pattern from `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx`.
- ~30 LOC of test code. No production changes.

**Item 2 — `DiscoveryRunDetailView` file + identifier + interface rename (#13)**
- Atomic `git mv` of 3 files in `frontend/src/components/Discovery/`: `DiscoveryRunDetailViewWithTabs.tsx` → `DiscoveryRunDetailView.tsx`; `DiscoveryRunDetailViewWithTabs.test.tsx` → `DiscoveryRunDetailView.test.tsx`; `DiscoveryRunDetailViewWithTabs.module.css` → `DiscoveryRunDetailView.module.css`.
- Rename the React component: `DiscoveryRunDetailViewWithTabs` → `DiscoveryRunDetailView` (5 self-references in source; 8 in the test file).
- Rename the props interface: `DiscoveryRunDetailViewWithTabsProps` → `DiscoveryRunDetailViewProps`.
- Update the CSS module import path inside the source file and the CSS mock path inside the test file.
- Update 2 importer sites: `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` (4 lines: comment, identifier, import path, JSX usage) and `frontend/src/components/Discovery/FindingsTab.tsx` (javadoc reference on line 7).
- Rewrite the renamed `.tsx` file's header javadoc: drop "canonical-in-waiting" and "rename it back when the routing reconciliation is done" language; reflect the new canonical status. ~15 LOC of comment touches.
- No backward-compat shim, no alias re-export, no CSS class-name changes (zero `WithTabs` selectors per investigation), no test-id renames (`discovery-run-detail-tab-*` prefix unchanged).
- Verification: `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches.

**Item 3 — `ScopeRefType` drift detection via JSON source-of-truth (#14)**
- New file `gateway/src/config/architect-conversation/scopeRefType.json` containing the canonical 7-value array (`service, interface, endpoint, physical_data_entity, physical_data_attribute, method, class`) plus a top-level `_doc` field for human context (JSON has no native comments).
- Gateway `questionLibrary.ts`: import the JSON, derive `export const ALLOWED_SCOPE_REF_TYPES = ... as const`, derive `export type ScopeRefType = typeof ALLOWED_SCOPE_REF_TYPES[number]`, delete the literal union declaration at lines 28-35. The JSON becomes the single source of truth.
- Gateway `loadConfigs.ts` keeps its `ALLOWED_SCOPE_REF_TYPES` re-export pointing at the JSON-derived constant.
- Frontend `architectConversationApi.ts` keeps its literal `ScopeRefType` union (lines 43-50) and `ALLOWED_SCOPE_REF_TYPES` constant (lines 52-60) unchanged — no cross-package production-code import. The new contract test catches drift.
- Drop the "deferred to a separate spec" / "cross-process unification of `ScopeRefType` is deferred" comments around `architectConversationApi.ts:681` — drift detection ships in this spec, the deferral note is stale.

**Item 3 contract test (#14)**
- New test `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts` (matches the colocated test convention in `frontend/src/api/__tests__/`).
- Imports `ALLOWED_SCOPE_REF_TYPES` from `../architectConversationApi`.
- Imports the JSON values via relative path from `../../../gateway/src/config/architect-conversation/scopeRefType.json` (`resolveJsonModule: true` is already enabled per investigation).
- Assertion 1 (inter-package): `[...frontendValues].sort()` deep-equals `[...jsonValues].sort()`.
- Assertion 2 (intra-package): the frontend's `ScopeRefType` union literal members match the JSON values (compile-time satisfied by the type-test pattern + runtime equality check).
- One test file, 1-2 `it()` blocks, ~30 LOC.

**Implementation order and commit boundary**
- Single commit covering all three items; implementer may split per-item if any one escalates.
- Order: #13 → #14 → #10 (cheapest → most-novel → simplest). #13 is pure rename (zero risk). #14 has the highest novelty (JSON-derived TypeScript union) so surface tsconfig friction early. #10 ships once #14's test infrastructure is validated.
- Items are independent; failure of one does not block the other two.

**Test cap**
- 3 new tests maximum across the batch. Realistic count is 2 (1 redirect-shim + 1 drift contract); the third slot is reserved headroom for a sub-test if one emerges naturally.

**Combined verification**
- `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches.
- `cd frontend && npm test` — redirect-shim test passes, drift-detection test passes, no regressions.
- `cd gateway && npm test` — existing tests (notably `questionLibrary.test.ts`) pass with the JSON-derived `ScopeRefType` union.
- `git grep "ALLOWED_SCOPE_REF_TYPES" frontend/src/ gateway/src/` shows both copies still declare the constant.

## Existing Code to Leverage

**`frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx`**
- Direct pattern source for the new #10 redirect-shim test.
- MemoryRouter + `<Routes>` + landing-page testid assertion already established by Spec 1.
- The new test slots in next to this one structurally.

**`frontend/src/api/__tests__/` colocated test directory**
- 16 existing colocated api tests follow the same naming convention.
- The new `scopeRefType.contractWithGateway.test.ts` lands here naturally.

**`gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts`**
- Closest precedent for cross-source validation — validates the canonical `ScopeRefType` union via loader-time checks.
- The new frontend-side contract test is the cross-package mirror of this intent.

**`gateway/src/config/personas/*.json` and `frontend/src/config/*.json`**
- Both packages already follow a "TS reads JSON config" convention.
- Adding `gateway/src/config/architect-conversation/scopeRefType.json` is consistent with this established pattern; no new infrastructure required.

**`frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` and `frontend/src/components/Discovery/FindingsTab.tsx`**
- The two live importers / referencers of `DiscoveryRunDetailViewWithTabs`.
- Update atomically in the same commit as the `git mv`; no compat alias needed.

## Out of Scope

- A shared types package between gateway and frontend (deferred to v2 — too invasive).
- Renaming any OTHER `...WithTabs` files (only the Discovery one exists per investigation).
- A `<Navigate>` shim or backward-compat alias for the old `DiscoveryRunDetailViewWithTabs` file path (atomic rename — no compatibility alias).
- Refactoring the underlying behaviours of either component.
- AMS / gateway-runtime / discovery-service backend behaviour changes.
- A general flaky-test sweep beyond Spec 1's fallout (MEMORY.md's pre-existing flakes remain pre-existing).
- Code-generation pipelines (`tsc --build`, `quicktype`, etc.) for cross-package types.
- A unified types module for OTHER duplicated cross-package types (may exist; deferred unless they cause real drift).
- Spec 2 / Spec 3 / Spec 4 frontend test fallout — only Spec 1 per the priority list (and Spec 1's audit came back empty).
- Cleanup of `DashboardView.tsx:547` stale URL navigation (raised by Spec 1 verifier as follow-up; it works because the shim is in place).
- Cleanup of `TargetArchitectureDiagramView.tsx` orphan dead file (raised by Spec 1 verifier as follow-up; not part of this spec).
