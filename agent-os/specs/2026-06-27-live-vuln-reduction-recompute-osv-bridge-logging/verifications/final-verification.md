# Verification Report: Live vulnerability-reduction recompute + OSV gateway→discovery bridge + explicit logging (Spec C)

**Spec:** `2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging`
**Date:** 2026-06-27
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All five task groups are implemented and verified end-to-end across discovery, gateway, and frontend with no AMS change. Every confirmed requirement (1–6) is satisfied: the new discovery raw-query endpoint, the never-throwing gateway bridge adapter behind a kill-switch, the inverse decision-code→coordinate map with a real-registry drift guardrail, the `skipOsv` compute flag, the greppable `[VulnReduction]`/`[OSV]`/`[OSV bridge]` logging, and the frontend conversational sourcing + live recompute + ~3s OSV throttle. All targeted test runners pass (discovery 7, gateway 39, frontend 37), the gateway and discovery type-check clean (0 errors), the frontend touched files are clean in isolation, the drift/guardrail test reads the REAL registry, and no mojibake was found in any touched file.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

### Completed Tasks
- [x] Task Group 1: Raw-query OSV batch endpoint (discovery)
  - [x] 1.1–1.6 — `POST /discovery/vulnerabilities/osv-query-batch` added to `discovery-service/src/routes/vulnerabilityEnrichment.ts`, calls `OsvDevVulnerabilitySource.queryBatch` via a DI seam, projects to the lean shape (heavy `Advisory` fields dropped), always HTTP 200, `[VulnEnrich]` logging retained + query-count/outcome log added.
- [x] Task Group 2: `DiscoveryOsvBridgeSource` adapter + bootstrap wiring + kill-switch (gateway)
  - [x] 2.1–2.7 — `discoveryOsvBridgeSource.ts` implements `TargetVulnerabilitySource`, `query`→`queryBatch`, ~20s `AbortController` timeout, never rejects, full failure-matrix reason mapping; `OSV_REDUCTION_BRIDGE_ENABLED` (default true) in `config.ts`; resolver wired once in `server.ts`; flag=false → null.
- [x] Task Group 3: Inverse map + guardrail + `skipOsv` flag (gateway)
  - [x] 3.1–3.6 — `capturedDecisionOsvCoordinates.ts` explicit allow-list, byte-consistent labels, unmapped→null; guardrail reads REAL `ALL_COORDINATE_RULE_ANSWERS`/`COORDINATE_ANSWERABLE_CODES`; `skipOsv`/`skip_osv` threaded through `runReductionCompute` (single shared path).
- [x] Task Group 4: Explicit greppable logging (gateway)
  - [x] 4.1–4.5 — info lifecycle + warn degrade, `requestId` correlation, `osv.logLines` emitted to logger AND retained in response, counts logged, `[OSV bridge]` request/outcome lines.
- [x] Task Group 5: Conversational versions feed + live recompute + throttle (frontend)
  - [x] 5.1–5.6 — `conversationalTargetDeps.ts` + frontend mirror `capturedDecisionOsvCoordinates.ts`, merged into target deps (manifest wins on overlap), per-answer `skipOsv:true` recompute, ~3s debounced full OSV scan + upload/close full scans, fail-soft preserved.

### Incomplete or Issues
None. All checkboxes were already `- [x]` in `tasks.md` and each was confirmed against the implemented code.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (non-blocking)

### Implementation Documentation
- The `implementation/` folder exists but is EMPTY — no per-task-group implementation reports were written.

### Verification Documentation
- This report: `agent-os/specs/2026-06-27-live-vuln-reduction-recompute-osv-bridge-logging/verifications/final-verification.md`

### Missing Documentation
- Per-task-group implementation reports under `implementation/`. Code-level evidence is strong (extensive in-file doc-comments + passing tests carrying explicit spec/task references), so completion is not in doubt; the missing reports are a documentation-hygiene gap only.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` describes a separate architecture meta-model / diagramming product (Phases 1–5). It contains no item matching vulnerability reduction, the OSV bridge, or the target-state conversation. This spec belongs to the post-merge vuln/target-state initiative which is not tracked in that roadmap. No update applicable.

---

## 4. Requirement-by-Requirement Verification

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | Discovery `POST /vulnerabilities/osv-query-batch` over raw `{coordinate,version,ecosystem}`, lean projection, always 200, degrade-soft | ✅ Pass | `discovery-service/src/routes/vulnerabilityEnrichment.ts` (route + `projectAdvisory` lean projection + `buildRawQueries` + always-200, 500 reserved). Tests: `osvQueryBatchRoute.test.ts` (4). |
| 2 | Gateway `DiscoveryOsvBridgeSource` implements `TargetVulnerabilitySource`, ~20s timeout, never throws, reason-code mapping, wired once in `server.ts`, `OSV_REDUCTION_BRIDGE_ENABLED` default true, flag=false→null | ✅ Pass | `discoveryOsvBridgeSource.ts` (`OSV_BRIDGE_FETCH_TIMEOUT_MS=20_000`, `classifyBridgeTransportFailure`, `query`→`queryBatch`); `config.ts` (`osvReductionBridgeEnabled`); `server.ts` (single `setTargetOsvSourceResolver`). Tests: `discoveryOsvBridgeSource.test.ts` (8 incl. bootstrap flag). |
| 3 | Inverse `(decisionCode,framework)→{coordinate,ecosystem}` map, label-consistent, guardrail reads REAL registry, unmapped→null | ✅ Pass | `capturedDecisionOsvCoordinates.ts` (`coordinateForCapturedVersion`, explicit allow-list). Tests: `capturedDecisionOsvCoordinates.test.ts` + `.guardrail.test.ts` (reads `ALL_COORDINATE_RULE_ANSWERS`/`COORDINATE_ANSWERABLE_CODES`). |
| 4 | `skipOsv` (accepts skipOsv/skip_osv) computes delta WITHOUT invoking OSV; default unchanged | ✅ Pass | `vulnerabilityReduction.ts` (`asBool`, `skippedOsvSlice`, `osvSource = skipOsv ? null : resolve...`, threaded into `runReductionCompute`; also use-version route). Tests: `vulnerabilityReductionSkipOsv.test.ts` (2). |
| 5 | Logging `[VulnReduction]`/`[OSV]`/`[OSV bridge]`, info lifecycle + warn degrade, `osv.logLines` to logger (and still in response), counts, requestId | ✅ Pass | `vulnerabilityReduction.ts` (`correlationIdFrom`, `emitOsvLogLines`, decision-point logs); `discoveryOsvBridgeSource.ts` `[OSV bridge]` lines. Tests: `vulnerabilityReductionLogging.test.ts` (6). |
| 6 | Frontend captured answers → mirror map → merged (manifest wins), per-answer skipOsv:true, throttled full compute on upload+close+~3s debounce, fail-soft | ✅ Pass | `conversationalTargetDeps.ts` (`deriveConversationalTargetDeps`/`mergeTargetDeps`), mirror `capturedDecisionOsvCoordinates.ts`, `useVulnerabilityReduction.ts` (`recompute`/`recomputeFull`/`scheduleFullRecompute`, `skipOsv` per compute), `ArchitectConversationTab.tsx` (per-answer cheap + debounced OSV; upload/close full). Tests: `conversationalTargetDeps.test.ts` (4) + `useVulnerabilityReduction.skipOsv.test.tsx` (3). |

No behaviour change beyond the spec was observed: the default OSV path is unchanged when `skipOsv` is absent and the flag is on; logging additions are emission-only (`osv.logLines` remain in the HTTP response); the absent-vs-empty `newly_introduced` and "estimate, not a guarantee" semantics are untouched (`osvTargetScan` contract unchanged, regression green).

---

## 5. Test Suite Results

**Status:** ✅ All Passing (targeted runners, injected stubs, no network)

### Discovery (jest)
- `osvQueryBatchRoute.test.ts` — 4 passed
- `vulnerabilityEnrichmentRoute.test.ts` (regression) — 3 passed
- **Subtotal: 7 passed / 0 failed**
- `tsc --noEmit`: **0 errors**

### Gateway (jest)
- `discoveryOsvBridgeSource.test.ts` — 8 passed
- `capturedDecisionOsvCoordinates.test.ts` — (incl. in run) passed
- `capturedDecisionOsvCoordinates.guardrail.test.ts` — 5 passed (reads REAL registry)
- `vulnerabilityReductionSkipOsv.test.ts` — 2 passed
- `vulnerabilityReductionLogging.test.ts` — 6 passed
  - (the 5-file Spec C run reported **24 passed**)
- `osvTargetScan.test.ts` (regression) — 6 passed
- `vulnerabilityReduction.test.ts` (regression) — 9 passed
- **Subtotal: 39 passed / 0 failed**
- `tsc --noEmit`: **0 errors**

### Frontend (vitest)
- `conversationalTargetDeps.test.ts` — 4 passed
- `useVulnerabilityReduction.skipOsv.test.tsx` — 3 passed
- `useVulnerabilityReduction.recompute.test.tsx` (regression) — 5 passed
- `steeringSurfaces.test.tsx` (regression) — 6 passed
- `ArchitectConversationTab.test.tsx` + `.savedResume`/`.cascadeOverrideSync`/`.export`/`.prefillBanner`/`.rightPanelOrder` (regression) — 19 passed
- **Subtotal: 37 passed / 0 failed**

### Test Summary
- **Total Tests (targeted):** 83
- **Passing:** 83
- **Failing:** 0
- **Errors:** 0

### Failed Tests
None — all targeted tests passing.

---

## 6. Isolation Typecheck, Guardrail, and Mojibake

- **Gateway typecheck:** `tsc --noEmit` → 0 errors total.
- **Discovery typecheck:** `tsc --noEmit` → 0 errors total.
- **Frontend isolation typecheck:** whole-repo `tsc --noEmit` reports 552 errors — the pre-existing RED baseline on `main` (documented). **NONE** of those errors are in this spec's touched files (`conversationalTargetDeps.ts`, `capturedDecisionOsvCoordinates.ts`, `useVulnerabilityReduction.ts`, `ArchitectConversationTab.tsx`, `vulnerabilityReductionApi.ts`). The spec's frontend changes are clean in isolation; no regression introduced.
- **Guardrail / drift test:** `capturedDecisionOsvCoordinates.guardrail.test.ts` passes and asserts every `(decisionCode, framework)` pair against the REAL `ALL_COORDINATE_RULE_ANSWERS` / `COORDINATE_ANSWERABLE_CODES` exported from `manifestCodeMapping.ts` (not a fixture copy) — label/registry drift will go RED in CI.
- **Mojibake check:** scanned all 17 touched/new files for replacement chars and common UTF-8 double-encoding patterns — none found. (Note: files carry LF→CRLF git warnings on Windows checkout, which is line-ending normalization only, not content corruption.)

---

## 7. Gaps / Follow-ups

1. **Missing implementation reports (documentation only).** The `implementation/` folder is empty; no per-task-group reports were authored. Functionality is fully evidenced by code + passing tests, but the standard implementation docs are absent.
2. **Module location vs. spec hint (cosmetic).** The spec suggested the inverse map at `targetManifest/capturedDecisionOsvCoordinates.ts`; it was authored at `services/vulnerabilityReduction/capturedDecisionOsvCoordinates.ts` (alongside `osvTargetScan.ts`, which it imports `OsvEcosystem` from). The spec wording was "e.g."; placement is sound and consistent. No action required.
3. **Frontend mirror-map drift risk (by design, mitigated).** The frontend `capturedDecisionOsvCoordinates.ts` is a hand-copied subset of the gateway map; only the gateway side carries the real-registry guardrail. This is the intended design (the client cannot import gateway code), but the mirror has no automated sync check. Consider a future shared-fixture or generated-mirror check if the allow-list grows.
4. **Working-tree intermixing (informational).** The working tree also contains the two sibling specs' changes (`...-right-panel-ux`, `...-version-unknown-pending-questions`). This verification scoped strictly to Spec C's files; no cross-contamination affecting Spec C's results was observed.
