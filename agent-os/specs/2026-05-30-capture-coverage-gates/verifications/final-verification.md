# Verification Report: Capture Coverage Gates (Spec 5 — HAIKAI discovery-richness capstone)

**Spec:** `2026-05-30-capture-coverage-gates`
**Date:** 2026-05-30
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All four task groups are implemented end-to-end exactly to the spec: three advisory, computed-on-read coverage dimensions (capture / specification / inventory reconciliation) folded into the existing AMS `assessReadiness` readiness streams as gap codes, mirrored by per-endpoint discovery evidence-gap Findings, proxied byte-for-byte by the gateway, and rendered in the existing frontend readiness card. Every group's focused test suite passes (7 + 8 + 1 + 6), and all spec constraints hold — no new persistence/changeset, no new entity or meta-model type, no `*_points`, no blocking gate, codes-only DTO (no wire shape change), gap codes snake_case. The cross-layer per-protocol "fully specified" bar is consistent between AMS Group 1 and discovery Group 2. No new (spec-caused) regressions were found.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

All task-group and sub-task checkboxes in `tasks.md` were already marked `- [x]`; each is corroborated by code inspection and a passing focused test. No checkbox changes were required. (No `implementation/` report folder exists for this spec; verification rests on direct code evidence + passing focused tests, which is sufficient.)

### Completed Tasks
- [x] Task Group 1: AMS coverage computation + new gap codes in `assessReadiness` (1.0–1.7)
  - [x] 1.1 Focused tests first (`MigrationCaptureCoverageReadinessTest`, 7 tests)
  - [x] 1.2 Three gap-code constants added to `MigrationGapCodes` (snake_case String values)
  - [x] 1.3 Dimension (A) CAPTURE coverage from `api_behaviour_*` tables (session-scoped)
  - [x] 1.4 Dimension (B) SPECIFICATION coverage per-protocol from the persisted model
  - [x] 1.5 Dimension (C) INVENTORY reconciliation (both directions, SOAP-aware key)
  - [x] 1.6 Aggregates threaded through `ReadinessContext` + `build(...)`; codes folded as advisory downgrades
  - [x] 1.7 Group tests green (offline)
- [x] Task Group 2: Discovery dimension-B per-endpoint evidence-gap Findings + run-aggregate rollup (2.0–2.5)
  - [x] 2.1 Focused tests first (`specificationCoverageScanner.test.ts`, 8 tests)
  - [x] 2.2 New sentinels + builder in `emissionSources.ts`
  - [x] 2.3 Per-endpoint completeness in `specificationCoverageScanner.ts` (same bar as AMS)
  - [x] 2.4 Emission wired in `discoveryV3Pipeline.ts`; rollup via existing `getRunAggregate`
  - [x] 2.5 Group tests green (offline; no edits during an in-flight run)
- [x] Task Group 3: Confirm gateway readiness proxy (3.0–3.3)
  - [x] 3.1 Regression test (`migrationDiscoveryContextCoverageGaps.test.ts`, 1 test)
  - [x] 3.2 `migrationContext.ts` confirmed to require NO code change (unchanged in working tree)
  - [x] 3.3 Group test green (offline)
- [x] Task Group 4: Frontend render of new codes in the existing readiness surface (4.0–4.4)
  - [x] 4.1 Focused tests first (`MigrationDeliveryPlanWizardReadinessGaps.test.tsx`, 6 tests)
  - [x] 4.2 No `MigrationReadinessAssessment` type change needed (codes ride existing `gaps?: string[]`)
  - [x] 4.3 `data-testid` added to the existing `Gaps:` row; raw snake_case codes render (consistent with existing codes)
  - [x] 4.4 Group test green (offline)

### Incomplete or Issues
None.

---

## 2. Documentation Verification

**Status:** ✅ Complete (spec-level)

### Implementation Documentation
- No `agent-os/specs/2026-05-30-capture-coverage-gates/implementation/` folder exists; this spec did not produce per-task implementation reports. Not treated as a defect — the code and inline documentation are thorough, and every task is verified by a passing focused test.
- Inline source documentation is comprehensive: `MigrationGapCodes.java`, the coverage section of `MigrationDiscoveryContextService.java`, `specificationCoverageScanner.ts`, the `buildUnderSpecifiedEndpointFinding` builder + `EvidenceGapType` comment in `emissionSources.ts`, and both new proxy/render tests all carry spec-referenced doc blocks.

### Verification Documentation
- This report: `agent-os/specs/2026-05-30-capture-coverage-gates/verifications/final-verification.md`.

### Missing Documentation
None required.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` describes the architecture-store-and-diagrams product (Phase 1–5: meta-model CRUD, diagram rendering/editing, backend/persistence/deployment). It contains no items for the HAIKAI migration program — no migration coverage, discovery richness, readiness gates, or capture/specification/reconciliation coverage. This spec belongs to that separate later workstream, so no roadmap item matches and no update is appropriate.

---

## 4. Test Suite Results

**Status:** ✅ All Passing (focused, per the spec's verification approach)

Per the explicit verification instruction ("Run ONLY each group's NEW focused tests … Scope to the groups' tests + targeted tsc; do not run whole slow suites"), the four new focused suites were run, plus the two AMS test files modified for the constructor-signature change, plus targeted `tsc` on all three TypeScript services.

### Test Summary (focused suites executed)
- **Total Tests:** 38
- **Passing:** 38
- **Failing:** 0
- **Errors:** 0

| Suite | Layer | Result |
| --- | --- | --- |
| `MigrationCaptureCoverageReadinessTest` (Group 1) | AMS / Maven | 7 passed, 0 failed |
| `MigrationDiscoveryContextServiceTest` (existing, constructor touch) | AMS / Maven | 12 passed, 0 failed |
| `MigrationDiscoveryContextAggregationTest` (existing, constructor touch) | AMS / Maven | 4 passed, 0 failed |
| `specificationCoverageScanner.test.ts` (Group 2) | discovery / Jest | 8 passed, 0 failed |
| `migrationDiscoveryContextCoverageGaps.test.ts` (Group 3) | gateway / Jest | 1 passed, 0 failed |
| `MigrationDeliveryPlanWizardReadinessGaps.test.tsx` (Group 4) | frontend / Vitest | 6 passed, 0 failed |

The AMS `MigrationCaptureCoverageReadinessTest` run reported `BUILD SUCCESS`, which means the entire AMS main module (new constructor params, new records, new helpers) and the test module compiled cleanly.

### Targeted type-checks
- frontend `tsc --noEmit`: **513 errors** — exactly the documented pre-existing baseline (this spec added **0**).
- discovery-service `tsc --noEmit`: **0 errors**.
- gateway `tsc --noEmit`: **0 errors**.

### Failed Tests
None in the executed focused scope.

### Notes — pre-existing failures (NOT run; documented as non-regressions)
Per the verification brief and project memory, the following are known pre-existing failures unrelated to this spec and were intentionally not executed (whole slow suites were out of scope):
- discovery `discoveryV3Pipeline.techHints.test.ts` (2 fails — `mockStartRun` arg shape; file untouched by this spec).
- frontend `tsc --noEmit` ~513-error baseline + pre-existing frontend test failures per project memory.
- AMS `@WebMvcTest` controller 404s + `BusinessLogicIntegrationTest` H2 reserved-word.
No new (spec-caused) regressions were observed: the two AMS test files this spec modified still pass (16/16), and all three TS services this spec touched type-check at or below their documented baselines.

---

## 5. Cross-Layer Consistency Check (per-protocol "fully specified" bar)

**Status:** ✅ Consistent

The dimension-B per-protocol bar matches between AMS Group 1 and discovery Group 2:

| Protocol | AMS `computeSpecificationCoverage` | discovery `scanForSpecificationCoverage` |
| --- | --- | --- |
| REST | "fully specified" iff `EndpointDataEffectRepository.findByEndpointId(ep.getId())` is non-empty | "fully specified" iff an `endpoint_data_effects` candidate references the endpoint **by name** (`data.endpointName`) — the same save-back resolution key, because the persisted endpoint id does not exist until save-back |
| SOAP | "fully specified" iff `InterfaceLogicalEntityRepository.findByInterfaceId(ep.getInterfaceId())` is non-empty | "fully specified" iff an `interface_logical_entities` candidate is bound to the parent interface **by name** (`data.interfaceClassName`), with a belt-and-braces `data.requestEntity`/`data.responseEntity` fallback |
| behaviour | `business_logics.behavior` never consulted | `business_logics.behavior` never consulted (explicit BONUS-only test asserts a REST endpoint with behaviour but no data effect is still under-specified) |

SOAP-vs-REST detection is equivalent: AMS `isSoapEndpoint` reads `EndpointEntity.protocol`/`endpoint_type`; the discovery scanner reads the candidate signals that PRODUCE `protocol='SOAP'` at save-back (`interface_type==='SOAP_API'`, `soap_action`/`request_root_element`, `_addedBy` SOAP marker). The discovery sentinels (`endpoint_missing_data_effect`, `soap_operation_missing_message_binding`) align with the per-protocol bars one-to-one.

---

## 6. Constraint Conformance

**Status:** ✅ All constraints satisfied

- **Computed-on-read / no new persistence:** all three dimensions are pure reads inside `assessReadiness`/`build`. No new Liquibase changeset, no new entity, no new table (`git status` shows zero changes under `src/main/resources/` and no new entity files). The only AMS source changes are `MigrationGapCodes.java` and `MigrationDiscoveryContextService.java`.
- **No new repository finders:** all eight finders used (`findBySessionIdOrderByCreatedAtAsc`, `findBySessionIdOrderByCapturedAtAsc`, `findBySourceBaselineId`, `findByDiffIdOrderByMethodAscPathAsc`, `findByProjectIdAndArchitectureId`, `findByModelFileId`, `findByEndpointId`, `findByInterfaceId`) already existed; no repository interface was modified.
- **No new meta-model entity TYPE / no `*_points`:** none created; coverage is treated as migration-process reality, not architecture.
- **Advisory, never blocking:** the only status mutation the gates apply is `downgradeToPartial` (`sufficient → partial`; `partial`/`insufficient` left unchanged; never promotes, never blocks). Asserted by the `coverageGapsFoldAdvisorilyAndDedupe` test (streams move to `partial`, not `insufficient`).
- **Captured-but-never-replayed → no false diff error:** the (A) code is driven by capture completeness (`CaptureCoverage.isIncomplete()`), not by the diff signal; `anyDiffed` is informational only. Asserted by `captureCoverageCurrentOnlyBaselineNoFalseDiffError` (complete capture + no diff emits no `incomplete_capture_coverage`).
- **SOAP-aware reconciliation key:** dimension (C) keys SOAP endpoints on `soap::<soap_action|request_root_element>` (with an endpoint-id fallback) so sibling SOAP ops on one servlet path stay distinct; REST keys on `<METHOD> <path>`. Asserted by `inventoryReconciliationBothDirectionsSoapAwareKey` (two SOAP ops on the same path counted distinctly).
- **Gateway byte-for-byte:** `migrationContext.ts` unchanged; deep-equality round-trip test passes.
- **Codes-only DTO (camelCase intact):** `ReadinessAssessmentDto` and `MigrationReadinessAssessment` (frontend) are unchanged — no metric VALUE fields added; new gap codes ride the existing `gaps` list. The DTO's existing per-field camelCase `@JsonProperty` convention is untouched, so no mixed-casing risk arises.
- **Gap codes snake_case:** `incomplete_capture_coverage`, `under_specified_endpoints`, `discovery_harness_inventory_mismatch` — matching the existing eight codes.
- **`gaps` still deduped:** the existing end-of-method dedupe is preserved; asserted (`doesNotHaveDuplicates`) even though (A) and (C) both touch two streams.
- **Deterministic, no LLM:** all coverage logic is plain compute on already-loaded data.

---

## 7. New (Spec-Caused) Regressions vs Pre-existing Failures

- **New regressions introduced by this spec:** None.
  - AMS main module + all test modules compile (`BUILD SUCCESS`).
  - The two AMS test files modified for the constructor signature pass (16/16).
  - discovery-service and gateway `tsc`: 0 errors. frontend `tsc`: 513 (baseline; +0).
- **Pre-existing failures (non-regressions, not executed):** discovery `discoveryV3Pipeline.techHints.test.ts` (2); frontend tsc ~513 baseline + pre-existing frontend test failures; AMS `@WebMvcTest` controller 404s + `BusinessLogicIntegrationTest` H2 reserved-word. None attributable to this spec.

---

## Final Verdict

✅ **Passed.** All four task groups are complete and correct, every focused test passes (38/38), the cross-layer per-protocol bar is consistent, and all spec constraints (computed-on-read, advisory/never-blocking, no schema/persistence/meta-model change, codes-only camelCase-stable DTO, snake_case gap codes, SOAP-aware key, no false diff error) are satisfied. No new regressions were introduced; the only test failures in the repository are the documented pre-existing ones.
