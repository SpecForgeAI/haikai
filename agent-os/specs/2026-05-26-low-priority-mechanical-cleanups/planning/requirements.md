# Spec Requirements: Low-Priority Mechanical Cleanups (Batched #10, #13, #14)

## Initial Description

Per `planning/raw-idea.md`: three deferred maintenance items batched into one cleanup spec —

1. **#10**: Spec 1 (`2026-05-24-target-state-subtab-deterministic-suggest`) frontend test fallout — audit-led tightening of weakened assertions / stale URLs / unresolved markers attributable to that spec.
2. **#13**: Atomic rename of `DiscoveryRunDetailViewWithTabs.{tsx,test.tsx,module.css}` → drop the `WithTabs` suffix from file names AND the React component identifier.
3. **#14**: Drift-detection contract test between the duplicate `ScopeRefType` declarations in `gateway/src/config/architect-conversation/questionLibrary.ts` and `frontend/src/api/architectConversationApi.ts`.

Decisions already settled in the raw idea (do NOT re-litigate): one-commit batch, drift-detection only for #14 (no shared types package), atomic rename for #13 (no compat alias), no AMS/schema/backend changes.

---

## Research Findings

### #10 — Spec 1 Frontend Test Fallout Audit

**Commit window identified:** Spec 1 shipped as commit `a245bfa` (2026-05-24 14:15:42, "Bug fixes - spec 1 of 'target state' redesign"). This is a mega-commit that bundles three uncommitted in-flight specs plus Spec 1; the Spec-1-attributable frontend test surface is identified below by cross-referencing the Spec 1 verification report against the commit's file list.

**Frontend test files attributable to Spec 1:**

| File | Spec 1 Role | Status |
| --- | --- | --- |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.suggestPending.test.tsx` | NEW (Task Group 5.1) | Clean — zero weakened patterns |
| `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx` | NEW (Task Group 5.1) | Clean — zero weakened patterns |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.group7.test.tsx` | MODIFIED (3 obsolete tests removed; 3 surviving tests retained with tight assertions) | Clean — surviving tests use tight assertions; the legitimate `toMatch(/stale/i)` at L308 and `expect.objectContaining({dryRun:false})` at L363 are NOT weakened, they are precision tools for the assertions they make |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.test.tsx` | INDIRECT (workspace component refactored; this test was already on the populated-layout path) | Clean — 410 LOC, zero TODO/FIXME/expect.any/.skip hits |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.group10.test.tsx` | DELETED by Spec 1 (obsolete UI surface) | N/A — file does not exist |
| `frontend/src/components/Architecture/TargetArchitectureWorkspace.group8.test.tsx` | DELETED by Spec 1 (obsolete UI surface) | N/A — file does not exist |

**Searches run on the above files (all returned ZERO hits):**

```
grep -nE "TODO|FIXME|expect\.any\(|toMatch\(/\.\*/\)|it\.skip|describe\.skip|xit\(|xdescribe\("
```

**`ApiBaselinesListPage.test.tsx`** (the raw-idea's speculative candidate from Spec 4 fallout) — checked separately:
- 82 LOC, zero hits on weakened-assertion patterns
- Spec 4's verification report does NOT mention `act()` warnings on this file (the raw-idea's claim appears to be speculative)
- Spec 4's verification reports "43/43 tests pass across 11 files, with no regressions"
- **Conclusion: not a #10 finding.**

**`frontend/src/setupTests.ts`** — verified bare-bones (only `@testing-library/jest-dom` import). No `console.warn` / `console.error` suppression that could hide `act()` warnings.

**Discovered coverage gap (genuine surprise):**
- Spec 1 added a `<Navigate replace>` shim at `App.tsx:783-784` redirecting the old bookmark `/target-architecture` → `/architecture-design/target-state`.
- Grep across `frontend/src/__tests__/` finds zero tests asserting this redirect.
- `DashboardView.tsx:547` still navigates to the old URL and relies on the shim (per Spec 1 verifier's noted follow-up #2).
- **This is a real gap that lives squarely in #10's scope.** Adding one test asserting the redirect would close it.

**Stale URL audit:**
- Grep for `/target-architecture['"]|/target-architecture` in `frontend/src/` finds only legitimate API paths (`/target-architectures/{t}/...` in `architectConversationApi.ts`). No UI-route stragglers.

**Net audit result:**
- **Concrete findings count: 0 weakened-assertion / TODO / FIXME items + 1 missing-test gap (redirect shim).**
- The Spec 1 implementer worked cleanly. The raw-idea's pessimism about weakened assertions was unfounded.
- **#10 effectively reduces to a single optional test addition for the redirect shim.**

---

### #13 — `DiscoveryRunDetailView` Rename: Verified Inventory

**File-system inventory (confirmed via `ls`):**
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.tsx` (source)
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.test.tsx` (test)
- `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.module.css` (styles — **CSS file DOES have the `WithTabs` suffix**; raw-idea Q3 resolved: it's a real rename, not a no-op)

**Live source-code references to `DiscoveryRunDetailViewWithTabs` (must update on rename):**

| File | Line(s) | Reference type |
| --- | --- | --- |
| `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` | 9 | Comment ("Mounts `<DiscoveryRunDetailViewWithTabs>`") |
| `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` | 48 | Imported identifier |
| `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` | 50 | Import path (`'../Discovery/DiscoveryRunDetailViewWithTabs'`) |
| `frontend/src/components/DashboardView/DiscoveryRunDetailPage.tsx` | 1027 | JSX `<DiscoveryRunDetailViewWithTabs ... />` |
| `frontend/src/components/Discovery/FindingsTab.tsx` | 7 | Javadoc reference (comment only) |
| `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.tsx` | 2, 7, 44, 70, 140 | Self-references: header javadoc (×2), CSS import path, props interface name, component name |
| `frontend/src/components/Discovery/DiscoveryRunDetailViewWithTabs.test.tsx` | 2, 68, 75, 116, 123, 152, 186, 211 | Self-references: header javadoc, CSS mock path, identifier import, describe/render JSX (×5) |

**Live importer count: 1 external (`DiscoveryRunDetailPage.tsx`) + 1 comment-only (`FindingsTab.tsx`).** Plus the 2 self-files. Matches the raw-idea's claim of 2 live importers + 1 javadoc.

**CSS class-name check:** Zero `WithTabs` occurrences inside `DiscoveryRunDetailViewWithTabs.module.css` selectors. Class names are clean (e.g., `.detailContainer`, `.tabButtonActive`). No selector-rename work.

**Test selector / testid check:** Tests use `data-testid="discovery-run-detail-tab-*"` — no `WithTabs` substring. No testid renames needed.

**Identifier surface to rename in source file:**
- `export interface DiscoveryRunDetailViewWithTabsProps` → `DiscoveryRunDetailViewProps`
- `export const DiscoveryRunDetailViewWithTabs: React.FC<...>` → `DiscoveryRunDetailView`
- All header-javadoc text mentioning the old name (cosmetic but consistent)

---

### #14 — `ScopeRefType` Drift Detection: Implementation Option Recommendation

**Current state of declarations:**

| Location | Declaration | Members |
| --- | --- | --- |
| `gateway/src/config/architect-conversation/questionLibrary.ts:28-35` | `export type ScopeRefType` (canonical) | 7 |
| `gateway/src/config/architect-conversation/loadConfigs.ts:45-53` | `export const ALLOWED_SCOPE_REF_TYPES: readonly ScopeRefType[]` | 7 |
| `frontend/src/api/architectConversationApi.ts:43-50` | `export type ScopeRefType` (duplicate) | 7 |
| `frontend/src/api/architectConversationApi.ts:52-60` | `export const ALLOWED_SCOPE_REF_TYPES: readonly ScopeRefType[]` | 7 |
| `frontend/src/api/architectConversationApi.ts:681` | Deferring comment to drop on completion | (comment) |

**All four lists are identical:** `'service' | 'interface' | 'endpoint' | 'physical_data_entity' | 'physical_data_attribute' | 'method' | 'class'`.

**Build / test config investigation:**

- `frontend/vite.config.ts` is the ONLY vitest config (no separate `frontend/vitest.config.ts`). Test block: `{ environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.ts'] }`. No `server.deps.inline` allow-list, no `resolve.alias` for sibling packages.
- `frontend/tsconfig.json` declares `"include": ["src"]` (single-folder root) + `"strict": true, "noUnusedLocals": true, "noUnusedParameters": true`. Cross-package TS imports would land outside `include`.
- `frontend/tsconfig.json` DOES have `"resolveJsonModule": true` — JSON imports work out of the box.
- `gateway/tsconfig.json` declares `"rootDir": "./src"` + `"strict": true`. Symmetric constraint.
- **Zero precedent:** grep `from '../../../gateway'` in `frontend/src/` returns zero matches; grep `from '../../../frontend'` in `gateway/src/` returns zero matches. The two packages have NEVER reached into each other's source tree.

**Recommendation: Option B (JSON source-of-truth).**

Rationale:
- Option A (cross-package TS import) would need vitest `server.deps.inline` config tweaks AND would extend the frontend's TS root outside its declared `include`, fighting `noUnusedLocals` plus type-resolution of gateway-side imports of `mappingMutationRules.ts`. Realistic chance of getting bogged down debugging tsconfig/vitest interactions for a single drift-detection test.
- Option B requires zero new config — JSON modules resolve via standard relative paths under bundler-mode resolution which both packages already have.
- The "indirection" cost the raw-idea worried about (Option B con) is one tiny JSON file that the gateway TS reads with `as const` to derive its union, frontend test reads the same JSON via relative path. Easy to find, easy to extend.
- v2 shared-types package, if it ever happens, can absorb the JSON file unchanged.

If user prefers Option A, the implementer should be prepared to fall back to B in the same commit (per raw-idea Decision 2).

---

## Surprises / Notes

1. **#10 was effectively a non-issue.** The raw-idea anticipated weakened assertions / `act()` warnings; the audit found none. This collapses #10 to either (a) zero test changes, or (b) one new test for the `<Navigate replace>` redirect shim that has no current coverage.

2. **The Spec 4 `act()` warning claim was unverifiable.** The raw-idea cited "implementer flagged `act()` warnings during Spec 4" but Spec 4's own verification report makes no such claim, and the current `ApiBaselinesListPage.test.tsx` has no detectable weakness. Treat as a stale rumour.

3. **#13 has more self-references than the raw-idea implied** (8 in the test file + 5 in the source file + 4 in the importer). Still mechanical, but the rename touches more lines than "2 importers" implies. The `git mv` covers file paths; the identifier-and-comment rewrite is the bulk of the work.

4. **#14's Option A vs B decision is not 50/50.** Investigation revealed zero precedent for cross-package imports in this repo, and the frontend's strict tsconfig has constraints that would actively resist Option A. The shape-spec should default to Option B and only fall back to A if there's a project-architecture reason to prefer it.

5. **Discovered an in-#10-scope coverage gap that the raw-idea did not anticipate**: no test covers the `App.tsx:783-784` `<Navigate replace>` shim. Adding one is the only substantive #10 work, and it's a single ~30-LOC test using the same MemoryRouter pattern as `TargetStateSubTabNavigation.test.tsx`.

---

## Existing Code to Reference

**Similar Features Identified:**

- **#10 (redirect-shim test, if added):** Mirror the pattern in `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx` (MemoryRouter + `<Routes>` + landing-page testid assertion). The pattern is already established for Spec 1 and a redirect-shim test would slot in naturally.

- **#13 (file rename pattern):** No comparable in-repo rename precedent found. Standard `git mv` + identifier rewrite is sufficient.

- **#14 (drift-detection test pattern):**
  - `frontend/src/api/__tests__/` contains 16 colocated api tests — the new contract test would land here.
  - Closest precedent for cross-source validation: `gateway/src/config/architect-conversation/__tests__/questionLibrary.test.ts` validates the canonical union via loader-time checks. The new test would be the cross-package mirror of that intent.

- **For Option B JSON-source-of-truth specifically:**
  - `frontend/src/config/*.json` exists (the frontend already consumes JSON config files), so the pattern of "TS reads JSON" is established.
  - Gateway also reads JSON config files for personas (`gateway/src/config/personas/*.json`). Establishing a config JSON for `scopeRefType` is consistent with existing gateway patterns.

---

## Requirements Summary

### Functional Requirements

**#10:**
- Audit confirmed zero weakened assertions / TODOs / FIXMEs / `expect.any()` / `.skip` markers in Spec 1's frontend test surface.
- Optional addition: one new test asserting the `<Navigate replace>` shim from `/target-architecture` → `/architecture-design/target-state` (closes the only real gap discovered).
- No other test files require touching.

**#13:**
- Atomic rename via `git mv` of 3 files: `DiscoveryRunDetailViewWithTabs.{tsx,test.tsx,module.css}` → `DiscoveryRunDetailView.{tsx,test.tsx,module.css}`.
- Rename the React component identifier: `DiscoveryRunDetailViewWithTabs` → `DiscoveryRunDetailView` (5 sites in source file).
- Rename the props interface: `DiscoveryRunDetailViewWithTabsProps` → `DiscoveryRunDetailViewProps` (2 sites in source file).
- Update 1 external importer (`DiscoveryRunDetailPage.tsx` — 4 lines).
- Update 1 javadoc comment in `FindingsTab.tsx`.
- Update 8 self-references inside the renamed test file.
- Update the CSS module import path inside the renamed source file (`./DiscoveryRunDetailViewWithTabs.module.css` → `./DiscoveryRunDetailView.module.css`).
- Update the CSS module mock path inside the renamed test file.
- Header-javadoc text in both renamed files: drop "canonical-in-waiting" / "rename it back when the routing reconciliation is done" language since the rename now IS the canonical form.
- Verification: `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` returns zero matches.

**#14:**
- Default implementation: **Option B (JSON source-of-truth)**.
  - New file `gateway/src/config/architect-conversation/scopeRefType.json` containing the 7-member list.
  - Gateway TS derives `ALLOWED_SCOPE_REF_TYPES` via JSON import + `as const`; the type union stays declared in `questionLibrary.ts` but is now `typeof ALLOWED_SCOPE_REF_TYPES[number]` derived.
  - Frontend production code unchanged (keeps its own declaration — drift-detection test enforces equality).
  - New test `frontend/src/api/__tests__/scopeRefType.contractWithGateway.test.ts` imports the JSON via relative path AND `ALLOWED_SCOPE_REF_TYPES` from the local frontend file, asserts `[...a].sort()` deep-equals `[...b].sort()`.
  - Test ALSO asserts intra-gateway consistency (`questionLibrary.ts ScopeRefType` ↔ `loadConfigs.ts ALLOWED_SCOPE_REF_TYPES`) — drift detection should be complete (raw-idea Q6 resolved: yes).
  - Drop the "deferred to a separate spec" comment at `architectConversationApi.ts:681`.
- Fall-back: Option A (cross-package TS import) only if shape-spec or implementer has a project-architecture reason to prefer it.
- Test cap: 1 new test for this item.

### Reusability Opportunities

- `frontend/src/components/Architecture/TargetStateSubTabNavigation.test.tsx` MemoryRouter pattern (for the optional #10 redirect-shim test).
- `frontend/src/api/__tests__/` colocated test pattern (for the new #14 contract test).
- Existing JSON config file convention in both `frontend/src/config/` and `gateway/src/config/personas/` (for Option B's JSON file).

### Scope Boundaries

**In Scope:**

- #10: Audit confirmation (already done) + optional 1 new test for the redirect shim.
- #13: 3-file rename + identifier rename + 14 reference-site updates across 4 files.
- #14: Option B JSON source-of-truth + new drift-detection contract test + comment removal.

**Out of Scope (per raw-idea):**

- Shared types package for gateway↔frontend.
- General sweep of MEMORY.md's listed pre-existing flakes.
- Renaming other `*WithTabs` files (only one exists).
- Backward-compat alias for renamed file.
- Behavioural refactor of `ScopeRefType` consumers.
- AMS / gateway-runtime / discovery-service backend behaviour changes.
- Spec 2 / Spec 3 frontend test fallout (only Spec 1 per the priority list).
- Cleanup of `TargetArchitectureDiagramView.tsx` orphan dead file (raised by Spec 1 verifier as follow-up, NOT part of this spec).
- Cleanup of `DashboardView.tsx:547` stale URL navigation (raised by Spec 1 verifier as follow-up, NOT part of this spec — it works because the shim is in place).

### Technical Considerations

- **Single commit boundary** (per raw-idea Decision 1 + Q7). Implementer may split per-item if one escalates.
- **No backend changes** (raw-idea Decision 5).
- **Test cap:** raw-idea suggests 3-6 total. Given #10 reduces to at most 1 test, realistic estimate is **2 new tests total** (1 for #10 redirect shim + 1 for #14 contract). #13 is pure mechanical, zero new tests.
- **JSON file location for #14:** `gateway/src/config/architect-conversation/scopeRefType.json` aligns with gateway's existing config-file convention.
- **Verification commands** (from raw-idea):
  - `cd frontend && npm test` — green.
  - `git grep "DiscoveryRunDetailViewWithTabs" frontend/src/` — zero matches.
  - `git grep "ALLOWED_SCOPE_REF_TYPES" frontend/src/ gateway/src/` — both copies still declare; contract test exists.
  - `cd gateway && npm test` — no regressions.

---

## Clarifying Questions for Shape-Spec / User

> The 10 open questions in the raw-idea have been merged / dropped / refined based on research findings. The list below is what genuinely needs user input.

1. **#10 — Add the redirect-shim test, or close #10 with zero changes?**
   The audit found zero weakened assertions. The only real gap is that the `<Navigate replace>` from `/target-architecture` → `/architecture-design/target-state` has no test. Adding one is ~30 LOC, mirrors `TargetStateSubTabNavigation.test.tsx`. My instinct: **add it** — it's the only thing #10 has to ship, and zero-test #10 looks suspicious in a "cleanup" spec. Otherwise consider dropping #10 from the batch entirely and re-titling the spec to "#13 + #14".

2. **#14 — Option A (cross-package TS import) vs Option B (JSON source-of-truth)?**
   Investigation revealed zero cross-package import precedent + strict tsconfig constraints that would resist Option A. My instinct: **Option B by default.** Option A only if you have a project-architecture reason. (Raw-idea Q5 resolved with research data.)

3. **#13 — internal React component identifier rename: agreed?**
   Rename `DiscoveryRunDetailViewWithTabs` (component) AND `DiscoveryRunDetailViewWithTabsProps` (interface) in the source file. My instinct: **yes** — file rename without identifier rename would leave the inconsistency the spec is fixing. (Raw-idea Q4 resolved: yes — but want to confirm including the Props interface.)

4. **#14 — gateway-side refactor scope for Option B?**
   Option B implies the gateway's `questionLibrary.ts` `ScopeRefType` union becomes derived from the JSON file (via `typeof ALLOWED_SCOPE_REF_TYPES[number]`). This is a small but real refactor — touches the type declaration, not just the constant. My instinct: **yes, derive the union from JSON** — otherwise the JSON file becomes a third source of truth alongside the two existing TS declarations, which defeats the purpose. Alternative: leave the gateway TS untouched and the JSON file becomes the contract for the test only. Less invasive but odder shape.

5. **#14 — test ALSO asserts gateway-internal consistency (`ScopeRefType` literal union ↔ gateway `ALLOWED_SCOPE_REF_TYPES`)?**
   Raw-idea Q6 — my instinct: **yes** — drift detection should be complete. The test runs frontend-side via Vitest; asserting both inter- and intra-package consistency in one test is trivial.

6. **#13 header-javadoc cleanup scope.**
   The renamed source file's header javadoc currently says "canonical-in-waiting" + "rename it back when the routing reconciliation is done". After the rename, that language is misleading. My instinct: **rewrite the header javadoc** to reflect the new canonical status — drop the "canonical-in-waiting" framing entirely. Touches ~15 LOC of comments.

7. **Failure isolation — ship items independently if one escalates?**
   Raw-idea Q9 — my instinct: **yes**, the items are independent. Implementer commits in order #13 → #14 → #10 (cheapest → most-novel → simplest). If any single item runs into trouble, the others still ship. Single commit unless escalation.

8. **Test cap.**
   Raw-idea Q8 said 3-6. Research findings reduce realistic count to ~2 (1 for #10 redirect + 1 for #14 contract). My instinct: **cap at 3** — leaves headroom if #14's contract test needs an intra-gateway companion or #10's audit surfaces something on closer reading.

---

## Visual Assets

No visual assets — code-only spec.

---

## Accepted Answers (2026-05-26)

User accepted all defaults. Decisions to encode in the spec:

- **Q1 #10 — add the redirect-shim test.** The Spec 1 audit found zero
  weakened assertions, so #10's only real cleanup is adding a test for
  the `<Navigate replace>` shim at `App.tsx:783-784` (`/target-architecture`
  → `/architecture-design/target-state`). ~30 LOC, mirrors
  `TargetStateSubTabNavigation.test.tsx`. Keeps #10 in the batch with a
  concrete deliverable.

- **Q2 #14 — Option B (JSON source-of-truth).** Zero cross-package
  import precedent; frontend `tsconfig.json` has `"include": ["src"]` +
  `noUnusedLocals` that would resist Option A; `resolveJsonModule: true`
  already enabled. New file `gateway/src/config/architect-conversation/
  scopeRefType.json` holds the 7-member array; both packages derive
  their constants from it.

- **Q3 #13 — also rename `DiscoveryRunDetailViewWithTabsProps`
  interface.** Rename file + React component identifier + Props
  interface. File rename without identifier rename leaves the
  inconsistency the spec is fixing.

- **Q4 #14 — derive gateway `ScopeRefType` union from the JSON.**
  Gateway's `questionLibrary.ts` `ScopeRefType` union becomes
  `typeof ALLOWED_SCOPE_REF_TYPES[number]` where the array is
  loaded from `scopeRefType.json`. JSON IS the single source of
  truth. Otherwise the JSON file becomes a third source alongside
  the two existing TS declarations — defeats the unification purpose.

- **Q5 #14 — test asserts inter- AND intra-package consistency.** One
  Vitest test in the frontend imports both the frontend's
  `ALLOWED_SCOPE_REF_TYPES` and the JSON file, asserts both match.
  Drift detection should be complete; one test covering both
  consistency dimensions is trivial.

- **Q6 #13 — rewrite the misleading header javadoc.** Current
  "canonical-in-waiting" + "rename it back when the routing
  reconciliation is done" language is wrong post-rename. Rewrite to
  reflect the new canonical status. ~15 LOC of comment touches.

- **Q7 Failure isolation order: #13 → #14 → #10** (cheapest → most-
  novel → simplest). Single commit unless one escalates; items are
  independent so the implementer can split per-item if needed.

- **Q8 Test cap: 3.** Realistic count is ~2 (1 for #10 redirect-shim
  + 1 for #14 contract); cap at 3 gives headroom if a sub-test
  emerges naturally.

**Net effect on sizing:** Confirmed **Small**. Three independent
items in one commit. ~50-150 LOC: new `scopeRefType.json`, gateway
type-derivation refactor (~20 LOC), file renames (3 files + 2
importers + identifier+interface rename + header rewrite), redirect-
shim test (~30 LOC), drift-detection contract test (~30 LOC).
