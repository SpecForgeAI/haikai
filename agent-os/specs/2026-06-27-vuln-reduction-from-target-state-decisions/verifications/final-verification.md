# Verification Report: Vulnerability reduction driven by target-state Decisions (replacement-aware)

**Spec:** `2026-06-27-vuln-reduction-from-target-state-decisions`
**Date:** 2026-06-27
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

The spec is fully implemented across gateway + frontend with no AMS schema change. Server-side fate derivation is now the single source of truth: the pure `targetFateDerivation.ts` engine rebuilds the full `mapped` + `removed` fate map from injected captured Decisions, the target-manifest resolved set, and the current vulnerable coordinates; the route wires both compute entry points through it (client body fate map merged UNDER, server wins); the delta service carries additive `removalVia`/`removalProvenance` provenance; and the frontend hook no longer short-circuits to null when the client has no target deps — the key fix. All 56 touched-gateway tests and 45 isolated frontend tests pass, the touched files typecheck clean against the (pre-existingly red) frontend baseline, the no-over-counting guard is proven by a dedicated test, and no mojibake was found.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

### Completed Tasks
- [x] Task Group 1: Server-side fate-map derivation module (pure) — `gateway/src/services/vulnerabilityReduction/targetFateDerivation.ts`
  - [x] 1.1–1.6 (8 focused tests; both removal paths, both guard branches, mapped reconstruction, count-only logging)
- [x] Task Group 2: Wire derivation into the route + reconstruct full fate map — `gateway/src/routes/vulnerabilityReduction.ts`
  - [x] 2.1–2.6 (6 route tests; both compute entry points share one derivation; client map ignored as source of truth; fail-soft)
- [x] Task Group 3: Provenance (`via`) on the delta output — `gateway/src/services/vulnerabilityReduction/vulnerabilityDeltaService.ts`
  - [x] 3.1–3.5 (additive optional `removalVia` on `CoordinateOutcome` + `removalProvenance` on `ClassifiedVulnerability`; classification unchanged)
- [x] Task Group 4: Stop sending client fate map + surface provenance — `useVulnerabilityReduction.ts`, `vulnerabilityReductionApi.ts`, `VulnerabilityReductionPanel.tsx`
  - [x] 4.1–4.5 (hook no longer gates on client fate map; reactivity preserved; minimal provenance labels)
- [x] Task Group 5: Test review & gap analysis (folded into this verification — see §4)
  - [x] 5.1–5.4 (coverage reviewed; feature-scoped; ~35 feature tests, well within the 18–42 band; no additional tests required)

### Incomplete or Issues
None. Group 5 was marked complete here: existing coverage is adequate and feature-scoped (≤10 added — in fact 0 needed), with the two removal paths, the over-counting guards, and both provenance labels all covered end to end.

Note: the spec's `implementation/` folder is empty (no per-group implementation reports were written). This is a documentation gap only — the code, in-code rationale, and tests are all present and verified.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
- No files present in `implementation/` (empty directory). Each touched module instead carries a thorough in-code header documenting the spec rationale, the two removal paths, the guardrails, and the deterministic precedence.

### Verification Documentation
- This report: `verifications/final-verification.md`.

### Missing Documentation
- Per-task-group implementation reports (`implementation/1-*.md` … `4-*.md`) were not produced. Not blocking; flagged as a follow-up.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the architecture meta-model editor roadmap (diagram CRUD/editing phases). It contains no vulnerability-reduction / target-state item matching this spec, so there is nothing to mark complete.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (feature-scoped, per spec verification constraints — the application runs on a different machine; no servers/network were started)

### Gateway (jest, in isolation — touched + regression suites)
- **Test Suites:** 9 passed / 9
- **Tests:** 56 passed / 56
- Suites run: `targetFateDerivation` (8), `vulnerabilityReductionFateDerivation` (6), `vulnerabilityReduction` (9), `vulnerabilityReductionSkipOsv` (2), `vulnerabilityReductionLogging` (6), `vulnerabilityDeltaService`, plus no-regression `osvTargetScan` and `capturedDecisionOsvCoordinates` (incl. guardrail).

### Frontend (vitest, in isolation — touched + regression files)
- **Test Files:** 12 passed / 12
- **Tests:** 45 passed / 45
- Added: `useVulnerabilityReduction.serverDerived` (3), `VulnerabilityReductionPanel.provenance` (4). Regression: `useVulnerabilityReduction.skipOsv` (3), `useVulnerabilityReduction.recompute` (5), `VulnerabilityReductionPanel.test` (5), all `ArchitectConversationTab.*` (19 across 7 files), `steeringSurfaces` (6).

### Isolation typecheck
- Gateway: `tsc --noEmit` exits 0 (clean).
- Frontend: whole-repo `tsc` is pre-existingly RED (553 errors — the known baseline on `main`). Zero of those errors are in any file touched by this spec (`useVulnerabilityReduction.ts`, `vulnerabilityReductionApi.ts`, `VulnerabilityReductionPanel.tsx`, and all added test files). Isolation typecheck: PASS.

### Over-counting guard check
- PASS. Proven by `targetFateDerivation.test.ts` case **(e) "manifest ABSENT => NO manifest-diff removal (Decision-family only, no blanket removal)"**: with no captured Decision and `targetManifestResolvedDependencies: null`, neither the recognised (`org.springframework.boot:spring-boot`) nor an unrecognised coordinate gets any fate — both stay still-vulnerable. Reinforced by case (f) opt-out/unanswered => no removal, the three-part evidence bar in `decisionFamilyFate`, and the route-level fail-soft test (both AMS reads throw => degrade, returns a delta, no 5xx, no removal credit). The user's explicit concern is satisfied.

### Failed Tests
None — all feature-scoped tests passing.

### Mojibake check
- CLEAN across all touched gateway + frontend source and test files (UTF-8 scan for replacement char and common Latin-1 corruption markers found none).

### Notes
The 553 pre-existing frontend `tsc` errors are the documented red baseline on `main` and are NOT regressions from this spec. Per the spec's verification ground rules, no servers were started and no localhost/network probes were made.

---

## Requirement-by-Requirement

1. **Pure derivation** (`targetFateDerivation.ts`) — ✅ PASS. Decision-family classification (different framework => `removed via:'replaced-by-decision:<code>'`; same framework => `mapped`), manifest coordinate diff (`dropped-from-target-manifest`; carried-forward stays `mapped`), no-over-counting gates (manifest absent => no blanket removal; positively-captured concrete Decision required; opt-out/unanswered => no removal), and deterministic 4-level precedence. Pure, fail-soft, count-only logging.
2. **Route wiring** (`vulnerabilityReduction.ts`) — ✅ PASS. Both compute + use-version paths derive the full fate map server-side from `fetchLatestCapturedDecisions` + `fetchLatestTargetManifestArtifacts` + body `currentVulnerabilities`; client body map merged UNDER server-derived (`mergeFateMaps`, server wins); version-bump path not regressed; fail-soft (read failures degrade, never 5xx); skipOsv/OSV/logging preserved. Injectable reader seams added for stub-only testing.
3. **Provenance** (`vulnerabilityDeltaService.ts`) — ✅ PASS. Additive optional `CoordinateOutcome.removalVia` + `ClassifiedVulnerability.removalProvenance`; classification buckets/semantics unchanged.
4. **Frontend** — ✅ PASS. `useVulnerabilityReduction.ts` no longer short-circuits to null on missing client target deps (the key fix); computes whenever `projectId && currentArchitectureId && targetArchitectureId`, always sends `currentVulnerabilities`, sends client target inputs as back-compat hint only; per-answer recompute / `skipOsv` / debounce preserved; `vulnerabilityReductionApi.ts` types mirror the gateway (`removalVia`/`removalProvenance`); `VulnerabilityReductionPanel.tsx` renders "replaced by <code>" / "dropped in target" on eliminated CVEs and no label when `via` is absent.

---

## Gaps / Follow-ups

- Per-task-group implementation reports were not written (empty `implementation/` folder). In-code documentation compensates; consider backfilling for audit consistency.
- An end-to-end route/delta test producing BOTH provenances in a single delta was not added separately. Coverage is adequate via the derivation-level precedence test (g) plus each provenance exercised end to end individually; a combined-delta assertion would be a nice-to-have, not a gap that blocks sign-off.
</content>
</invoke>
