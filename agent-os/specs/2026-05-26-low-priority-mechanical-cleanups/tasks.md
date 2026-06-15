# Task Breakdown: Low-Priority Mechanical Cleanups (Batched #10, #13, #14)

## Overview
Total Tasks: 4 task groups, 18 sub-tasks
Commit Boundary: Single commit covering all four task groups. Frontend + gateway only, no backend changes, ~50-150 LOC total. The implementer MAY split per-item if any one of #13 / #14 / #10 escalates — each is independently shippable.

## Critical Pitfalls (read before starting any task group)

1. **#13 — atomic rename, no shim.** All importers update in the same commit as the `git mv`. Do NOT leave a `DiscoveryRunDetailViewWithTabs.tsx` re-export alias / barrel file. The spec explicitly forbids a backward-compat shim.
2. **#13 — header javadoc MUST be rewritten.** The current header text in `DiscoveryRunDetailViewWithTabs.tsx` carries "canonical-in-waiting" and "rename it back when the routing reconciliation is done" language. Post-rename, that language is misleading. ~15 LOC of comment touches; do not skip.
3. **#14 — JSON must drive the gateway TS union.** The gateway's `ScopeRefType` union becomes `typeof ALLOWED_SCOPE_REF_TYPES[number]` where `ALLOWED_SCOPE_REF_TYPES` is derived from the JSON file via `as const`. Do NOT leave the existing literal union declaration in place alongside the JSON — if the JSON becomes a third source-of-truth alongside the two existing TS declarations, the spec defeats its own purpose.
4. **#14 — Vitest cross-package JSON import path.** From `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts`, the relative path to the JSON file is `../../../gateway/src/config/architect-conversation/scopeRefType.json`. `resolveJsonModule: true` is already enabled in `frontend/tsconfig.json` per the requirements investigation; JSON imports should resolve without further config. If `tsconfig.json`'s `"include": ["src"]` blocks resolution of the cross-package JSON, surface IMMEDIATELY rather than rewriting the strategy — Option B was chosen specifically because cross-package TS imports would fail under this constraint, but JSON imports under bundler-mode resolution should work.
5. **#10 — test the redirect, not the destination component.** The new test mounts `<MemoryRouter initialEntries={['/projects/p1/architectures/a1/target-architecture']}>` and asserts the rendered location ends up at `/projects/p1/architectures/a1/architecture-design/target-state`. The point is the `<Navigate replace>` shim and the `..` relative-path resolution preserving `projectId` + `architectureId` path params. Mirror the MemoryRouter + `<Routes>` + landing-page testid pattern from `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx`; do NOT test the destination component's internal behaviour.
6. **Test cap: 3.** Realistic count is 2 (1 redirect-shim test + 1 drift-detection contract test). #13 ships zero new tests (pure mechanical rename). The third slot is reserved headroom; do NOT pre-fill it.
7. **Failure isolation.** Each of #13 / #14 / #10 is independently shippable. If one escalates unexpectedly, the implementer commits the other two and re-scopes the escalating item separately — the single-commit boundary is the DEFAULT, not a hard requirement.

## Task List

### #13 — DiscoveryRunDetailView File and Identifier Rename

#### Task Group 1: Atomic rename of `DiscoveryRunDetailViewWithTabs` to `DiscoveryRunDetailView`
**Dependencies:** None. Do this FIRST (cheapest, zero risk, pure rename).

- [x] 1.0 Rename the file trio, the React component identifier, the Props interface, and update all references
  - [x] 1.1 `git mv` the three files in `frontend/src/components/Discovery/`
    - `DiscoveryRunDetailViewWithTabs.tsx` -> `DiscoveryRunDetailView.tsx`
    - `DiscoveryRunDetailViewWithTabs.test.tsx` -> `DiscoveryRunDetailView.test.tsx`
    - `DiscoveryRunDetailViewWithTabs.module.css` -> `DiscoveryRunDetailView.module.css`
    - Use `git mv` (not `mv`) so the rename is preserved in git history.
  - [x] 1.2 Rename identifiers inside `DiscoveryRunDetailView.tsx` (the renamed source file)
    - React component: `export const DiscoveryRunDetailViewWithTabs: React.FC<...>` -> `DiscoveryRunDetailView`. 5 self-references per the requirements inventory (lines 2, 7, 44, 70, 140 pre-rename).
    - Props interface: `export interface DiscoveryRunDetailViewWithTabsProps` -> `DiscoveryRunDetailViewProps`. 2 sites in the source file (declaration + the `React.FC<...>` generic argument).
    - CSS module import path: `import styles from './DiscoveryRunDetailViewWithTabs.module.css'` -> `import styles from './DiscoveryRunDetailView.module.css'`.
  - [x] 1.3 Rewrite the header javadoc of `DiscoveryRunDetailView.tsx` (Pitfall 2)
    - Drop the existing "canonical-in-waiting" framing.
    - Drop the "rename it back when the routing reconciliation is done" sentence.
    - Replace with text that reflects the new canonical status (e.g. describe the tabbed detail view as THE detail view for a Discovery run, with no further rename pending).
    - ~15 LOC of comment touches; this is part of #13, not a follow-up.
  - [x] 1.4 Update identifiers inside `DiscoveryRunDetailView.test.tsx` (the renamed test file)
    - 8 self-references per the inventory (lines 2, 68, 75, 116, 123, 152, 186, 211 pre-rename): header javadoc, CSS mock path, identifier import, describe/render JSX usage (x5).
    - CSS mock path: any `vi.mock('./DiscoveryRunDetailViewWithTabs.module.css', ...)` -> `vi.mock('./DiscoveryRunDetailView.module.css', ...)`.
    - Identifier import: `import { DiscoveryRunDetailViewWithTabs } from './DiscoveryRunDetailViewWithTabs'` -> `import { DiscoveryRunDetailView } from './DiscoveryRunDetailView'`.
    - All `<DiscoveryRunDetailViewWithTabs ... />` JSX usages -> `<DiscoveryRunDetailView ... />`.
  - [x] 1.5 Update the live external importer `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx`
    - Line ~9: update the leading comment ("Mounts `<DiscoveryRunDetailViewWithTabs>`") to reference `<DiscoveryRunDetailView>`.
    - Line ~48: update the imported identifier from `DiscoveryRunDetailViewWithTabs` to `DiscoveryRunDetailView`.
    - Line ~50: update the import path from `'../Discovery/DiscoveryRunDetailViewWithTabs'` to `'../Discovery/DiscoveryRunDetailView'`.
    - Line ~1027: update the JSX usage `<DiscoveryRunDetailViewWithTabs ... />` to `<DiscoveryRunDetailView ... />`.
  - [x] 1.6 Update the live comment-only referencer `frontend/src/components/Discovery/FindingsTab.tsx`
    - Line ~7 javadoc references `DiscoveryRunDetailViewWithTabs`. Update to `DiscoveryRunDetailView`.
  - [x] 1.7 Verify zero remaining references
    - `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns ZERO matches.
    - `git grep "DiscoveryRunDetailViewWithTabsProps" frontend/src/` returns ZERO matches.
    - If either grep returns a hit, fix it before moving on. Pitfall 1 — atomic rename, no leftover references.

**Acceptance Criteria:**
- Three files exist at the new paths with `git mv` preserving history; the old `WithTabs`-suffixed files do not exist.
- React component identifier, Props interface, CSS module import path, and CSS mock path all renamed.
- Header javadoc rewritten to reflect new canonical status (Pitfall 2).
- Both live importers (`DiscoveryRunDetailPage.tsx` + `FindingsTab.tsx`) updated.
- `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches.
- No backward-compat alias / barrel re-export introduced.

### #14 — ScopeRefType Drift Detection via JSON Source-of-Truth

#### Task Group 2: JSON file, gateway type-derivation refactor, and cross-package contract test
**Dependencies:** None (independent of Group 1). Do this SECOND (highest novelty — surface tsconfig friction early).

- [x] 2.0 Create the JSON source-of-truth, refactor gateway to derive from it, and add a Vitest contract test
  - [x] 2.1 Write 1 focused contract test
    - File: `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts` (matches the colocated test convention in `frontend/src/api/__tests__/`).
    - Imports:
      - `import { ALLOWED_SCOPE_REF_TYPES } from '../architectConversationApi'` (frontend declaration).
      - `import scopeRefTypeJson from '../../../gateway/src/config/architect-conversation/scopeRefType.json'` (the new JSON source-of-truth — Pitfall 4 for the path).
    - Assertion 1 (inter-package): `[...ALLOWED_SCOPE_REF_TYPES].sort()` deep-equals `[...scopeRefTypeJson.values].sort()` (or whatever top-level array key the JSON file uses — keep consistent with 2.2's shape decision).
    - Assertion 2 (intra-package): the frontend's `ScopeRefType` literal-union members match the JSON values. Use a compile-time type-test pattern (e.g. assign each JSON value to a `ScopeRefType`-typed variable in the test file so the TS compiler enforces equality at test-compile time) PLUS a runtime equality check on `ALLOWED_SCOPE_REF_TYPES` length and contents.
    - One test file, 1-2 `it()` blocks, ~30 LOC.
    - If the cross-package JSON import fails to resolve at test-runtime, STOP and surface the failure (Pitfall 4). Do NOT attempt to rewrite the strategy mid-task — the spec selected Option B specifically because Option A's cross-package TS imports were ruled out by the frontend's strict tsconfig.
  - [x] 2.2 Create the JSON source-of-truth file
    - File: `gateway/src/config/architect-conversation/scopeRefType.json`.
    - Shape: top-level object with a `_doc` string field (human-context note since JSON has no native comments) and a `values` array containing the 7 members: `service`, `interface`, `endpoint`, `physical_data_entity`, `physical_data_attribute`, `method`, `class`.
    - Example structure (adjust naming to fit team convention if needed):
      ```json
      {
        "_doc": "Canonical ScopeRefType members. Both gateway (questionLibrary.ts) and frontend (architectConversationApi.ts) derive from this list. Drift is enforced by scopeRefType.contractWithGateway.test.ts.",
        "values": ["service", "interface", "endpoint", "physical_data_entity", "physical_data_attribute", "method", "class"]
      }
      ```
  - [x] 2.3 Refactor `gateway/src/config/architect-conversation/questionLibrary.ts` to derive from the JSON
    - Import the JSON: `import scopeRefTypeJson from './scopeRefType.json'`.
    - Derive the constant: `export const ALLOWED_SCOPE_REF_TYPES = scopeRefTypeJson.values as readonly [...]` — use `as const` semantics so the array element types narrow to the literal-string union. The exact incantation may be `scopeRefTypeJson.values as readonly ('service' | 'interface' | 'endpoint' | 'physical_data_entity' | 'physical_data_attribute' | 'method' | 'class')[]` if `as const` on imported JSON doesn't propagate; the implementer picks the minimal form that yields a literal-string-narrowed array.
    - Derive the union: `export type ScopeRefType = typeof ALLOWED_SCOPE_REF_TYPES[number]`.
    - DELETE the existing literal `export type ScopeRefType = 'service' | 'interface' | ...` union declaration at lines 28-35.
    - Pitfall 3: do NOT leave the literal union in place alongside the derived form. The JSON is the single source of truth.
  - [x] 2.4 Verify `gateway/src/config/architect-conversation/loadConfigs.ts` still re-exports correctly
    - The existing `loadConfigs.ts` re-export of `ALLOWED_SCOPE_REF_TYPES` (lines 45-53 pre-refactor) should continue to point at the constant exported by `questionLibrary.ts`.
    - If the re-export pattern uses a literal-array clone rather than a re-export of the imported constant, refactor it to re-export the derived constant directly so the JSON remains the only source.
  - [x] 2.5 Drop the stale deferral comment in `frontend/src/api/architectConversationApi.ts`
    - Locate the comment around line 681 referencing "deferred to a separate spec" / "cross-process unification of `ScopeRefType` is deferred".
    - Delete the comment (drift detection ships in this spec; the deferral note is now stale).
    - Leave the frontend's literal `ScopeRefType` union declaration (lines 43-50) and `ALLOWED_SCOPE_REF_TYPES` constant (lines 52-60) UNCHANGED. The contract test in 2.1 enforces equality; the frontend keeps its own declarations for now.
  - [x] 2.6 Run gateway tests
    - `cd gateway && npm test`.
    - Existing `questionLibrary.test.ts` and any other tests touching `ScopeRefType` / `ALLOWED_SCOPE_REF_TYPES` should pass with the JSON-derived form.
    - If a gateway test breaks, the most likely cause is a `as const` / readonly-array variance issue on the derived constant — fix the derivation incantation in 2.3 rather than restoring the literal union.
  - [x] 2.7 Ensure the contract test passes
    - Run ONLY the test written in 2.1: `cd frontend && npm test -- scopeRefType.contractWithGateway.test.ts` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 1 test in 2.1 passes (both inter-package and intra-package assertions).
- `gateway/src/config/architect-conversation/scopeRefType.json` exists and is the single source of truth.
- Gateway's `ScopeRefType` union is derived from the JSON via `typeof ALLOWED_SCOPE_REF_TYPES[number]` (Pitfall 3).
- Frontend production code is unchanged except for the deletion of the stale deferral comment around `architectConversationApi.ts:681`.
- `cd gateway && npm test` passes with no regressions.
- `git grep "ALLOWED_SCOPE_REF_TYPES" frontend/src/ gateway/src/` shows both copies still declare the constant.
- `git grep "cross-process unification of \`ScopeRefType\`" frontend/src/` returns zero matches.

### #10 — Redirect-Shim Test

#### Task Group 3: New Vitest test for the `<Navigate replace>` shim at `App.tsx:783-784`
**Dependencies:** Task Group 2 (no production code dep, but Group 2 validates the test infrastructure first per the spec's execution order). Do this THIRD.

- [x] 3.0 Add one new test verifying the `/target-architecture` -> `/architecture-design/target-state` redirect preserves path params
  - [x] 3.1 Write 1 focused redirect-shim test
    - File: `frontend/src/__tests__/redirectShim.test.tsx` (new file). Implementer MAY instead append the test to an existing routing-tests file if the team's convention favours consolidation — confirm during implementation.
    - Mounts the `App` route tree (or its `<Routes>` subtree) with `<MemoryRouter initialEntries={['/projects/p1/architectures/a1/target-architecture']}>`.
    - Asserts the rendered location is `/projects/p1/architectures/a1/architecture-design/target-state` — i.e. the `<Navigate replace to="../architecture-design/target-state">` shim correctly resolves the `..` prefix against the parent route segment, preserving the `projectId` and `architectureId` path params.
    - Use the landing-page testid pattern from `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx` — render the target-state landing page's testid as evidence that the redirect landed at the correct destination.
    - Pitfall 5: assert the URL / landing-page testid, not the destination component's internal behaviour. The point is the shim's path-param preservation.
    - ~30 LOC of test code. No production changes.
  - [x] 3.2 Ensure the redirect-shim test passes
    - Run ONLY the test written in 3.1: `cd frontend && npm test -- redirectShim.test.tsx` (or project equivalent).
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 1 test in 3.1 passes.
- The test mounts a `MemoryRouter` at the old `/target-architecture` URL and asserts arrival at the new `/architecture-design/target-state` URL with `projectId` and `architectureId` path params intact (Pitfall 5).
- The test mirrors the `TargetStateSubTabNavigation.test.tsx` structure.
- No production-code changes in this task group.

### Verification

#### Task Group 4: Combined verification + final grep sweep (no commit)
**Dependencies:** Task Groups 1-3

- [x] 4.0 Run the new tests + verification commands; sweep for leftover references
  - [x] 4.1 Run the 2 new feature-specific tests (cap is 3 per Pitfall 6; realistic count is 2)
    - `cd frontend && npm test -- scopeRefType.contractWithGateway.test.ts redirectShim.test.tsx` (or project equivalent based on the actual test filenames chosen).
    - Expected: both pass.
  - [x] 4.2 Spot-check the renamed `DiscoveryRunDetailView` tests
    - `cd frontend && npm test -- DiscoveryRunDetailView.test.tsx` (the renamed test file from Task Group 1).
    - Expected: all pre-existing tests in this file continue to pass post-rename.
  - [x] 4.3 Run the gateway test suite
    - `cd gateway && npm test`.
    - Expected: no regressions. `questionLibrary.test.ts` passes with the JSON-derived `ScopeRefType` (Pitfall 3 validation).
  - [x] 4.4 Verify zero remaining `WithTabs` references
    - `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns ZERO matches.
    - `git grep "DiscoveryRunDetailViewWithTabsProps" frontend/src/` returns ZERO matches.
    - `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/ gateway/src/` returns ZERO matches.
  - [x] 4.5 Verify the stale deferral comment is gone
    - `git grep "cross-process unification of \`ScopeRefType\`" frontend/src/` returns ZERO matches.
    - `git grep "deferred to a separate spec" frontend/src/api/architectConversationApi.ts` returns ZERO matches.
  - [x] 4.6 Verify both `ALLOWED_SCOPE_REF_TYPES` copies still declare the constant
    - `git grep "ALLOWED_SCOPE_REF_TYPES" frontend/src/ gateway/src/` shows both packages still export / declare the constant (the JSON file is the single source; the TS declarations remain on both sides for now).
  - [x] 4.7 Final regression check on a wider slice (optional but recommended)
    - `cd frontend && npm test` — confirm previously-passing tests continue to pass. Pre-existing flakes listed in MEMORY.md may stay red; do NOT touch them.

**Acceptance Criteria:**
- The 2 new feature-specific tests (1 contract + 1 redirect-shim) pass.
- The renamed `DiscoveryRunDetailView.test.tsx` continues to pass post-rename.
- `cd gateway && npm test` passes.
- All four grep sweeps in 4.4 + 4.5 + 4.6 return the expected results (zero / non-zero as documented).
- Wider frontend test suite is green modulo pre-existing unrelated failures.
- Single commit covers all four task groups per the spec's Commit Boundary (or implementer splits per-item if escalation occurs — Pitfall 7).

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — `DiscoveryRunDetailView` rename (cheapest, zero risk, pure mechanical rename — no new tests).
2. Task Group 2 — `ScopeRefType` JSON source-of-truth + gateway refactor + contract test (highest novelty; surface tsconfig / JSON-import friction early per Pitfall 4).
3. Task Group 3 — Redirect-shim test (simplest; ships once Group 2 validates the cross-package test infrastructure).
4. Task Group 4 — Combined verification + final grep sweep (final gate before commit).

All four task groups land in a single commit per the spec's Commit Boundary, UNLESS one of #13 / #14 / #10 escalates — in which case the implementer commits the others independently per Pitfall 7.
