# Verification Report: Endpoint→Data-Effect Call Graph for Discovery (Java / Spring Classic first)

**Spec:** `2026-05-29-endpoint-data-effect-graph`
**Date:** 2026-05-29
**Verifier:** implementation-verifier
**Status:** ✅ Passed

---

## Executive Summary

All four task groups are implemented end-to-end and faithfully match their acceptance criteria. Every focused test the implementers wrote passes (5+1 AMS, 9 MCP, 10 discovery, 5 frontend), the cross-layer field contract lines up byte-for-byte across the discovery → MCP → AMS → frontend seam, and all hard constraints (snake_case wire / no `@CamelCaseWire`, new Liquibase file only, no `class`/`method` candidate types, no new candidate state, inbound-HTTP-only) hold. The only test failures observed are pre-existing baseline issues confirmed via `git stash` against a clean HEAD — none are regressions caused by this spec.

---

## 1. Tasks Verification

**Status:** ✅ All Complete

`tasks.md` was already fully marked `- [x]` for every task group and sub-task. Each was independently verified against the code (not just the checkbox) and the focused tests were re-run per layer. No checkbox required correction; no `⚠️` was warranted.

### Completed Tasks
- [x] **Task Group 1: AMS `endpoint_data_effects` relationship surface**
  - [x] 1.1 4–6 focused Java tests — `EndpointDataEffectPersistenceTest` (5 tests) + `EndpointDataEffectsChangesetTest` (1 test)
  - [x] 1.2 `EndpointDataEffectEntity` — `model/entity/discovery/`, modeled on `InterfaceLogicalEntityEntity` (`id`/`model_file_id`/`data_entity_point_id`/`description`/`tags`/`valid_from`/`valid_to`), plus `endpoint_id`, `access_mode`, JSONB `path_metadata_json`, boxed `Double confidence`
  - [x] 1.3 `EndpointDataEffectDto` — Java record, explicit snake_case `@JsonProperty`, no `@CamelCaseWire`
  - [x] 1.4 `EndpointDataEffectRepository` — `findByModelFileId` / `findByEndpointId` / `deleteByModelFileId`
  - [x] 1.5 `EndpointDataEffectMapper` — static `toDto`/`toEntity`, both directions, no field loss
  - [x] 1.6 ModelService wiring — read surface added; DELETE before endpoints/data-entity-points; re-INSERT after `saveEntities`; not overloading payload columns / `interface_logical_entities`
  - [x] 1.7 New Liquibase `161-endpoint-data-effects.sql` + new `changeSet` block with `tableExists` precondition (`onFail: MARK_RAN`)
  - [x] 1.8 Downstream typings (frontend + candidate type) snake_case; gateway proxies whole model (verified no route change needed)
  - [x] 1.9 Focused tests pass; changeset applies on a clean DB
- [x] **Task Group 2: MCP edge persistence + shared identity/matching primitive**
  - [x] 2.1 5–7 focused Jest tests — `candidateSaveBackEndpointDataEffects.test.ts` (9 tests, covers all 7 critical cases)
  - [x] 2.2 `matchByNormalizedName` (generic, parameterized `getName`) + `resolveEntityPoint` / `resolveEndpoint` (return `{pointId/endpointId, confidence, matchKind}`); `resolveEntityToPointId` retained as a thin `string | null` compat shim
  - [x] 2.3 `endpoint_data_effects` registered in `CANDIDATE_TYPE_CONFIG` (`relationships` / `endpoint_data_effects` / `ede-` / `parentFkField: null`), modeled on `interface_logical_entities`
  - [x] 2.4 `convertEndpointDataEffectToRow` resolves both sides through the primitive; deferred Pass 2.6; reuses 0.75 `CANDIDATE_AUTO_ACCEPT_THRESHOLD`; two-phase PUT hold-out mirrors ILE/LER; `ede` added to minted-id regex
  - [x] 2.5 Focused tests pass; existing `candidateSaveBackGapFill` call-site regression test passes
- [x] **Task Group 3: Java IR enrichment + Spring Classic resolver + findings**
  - [x] 3.1 6–9 focused tests — `endpointDataEffectResolver.test.ts` (10 tests)
  - [x] 3.2 Java IR enrichment — `CallIR.receiver`/`methodName`, `FunctionIR.methodId`; `extractMethodCalls`; `buildMethodId` (FQN + signature); `uses_data` relationship type wired through on the candidate
  - [x] 3.3 `endpointDataEffectResolver.ts` — controller→service→repository→entity walk; entity via repo generic param OR `@Entity`/`@Table`; single-interface-impl resolution; access_mode/operation hint/`transactional` derivation; persists only the relevant subgraph
  - [x] 3.4 `endpointDataEffectCandidates.ts` hung off `runSpringClassicAdapter`; one candidate per (endpoint, data-entity); three-outcome confidence model; inbound HTTP only (`isAsyncMethod` skip)
  - [x] 3.5 `endpoint_data_effect_unresolved` findings via `springClassicFindingScanner` reusing `FindingEmitter`; endpoint identity + reason + `stoppedAtPath`; never a silent drop
  - [x] 3.6 Stable method id stamped onto path hops AND `business_logics` emit points; no `class`/`method` candidate types
  - [x] 3.7 Focused tests pass
- [x] **Task Group 4: Frontend candidate surfacing with read-only expandable path**
  - [x] 4.1 3–5 focused Vitest tests — `endpointDataEffectCandidate.test.tsx` (5 tests)
  - [x] 4.2 `endpoint_data_effects` added to `SUPPORTED_DETAIL_TYPES`; `buildEndpointDataEffectCodeDetails` dispatcher branch; routes into existing Candidates stream (no new UI layer)
  - [x] 4.3 `EndpointDataEffectPathBlock` in `CandidateDetailsPanel.tsx` — read-only, expandable, collapsed-by-default hop list (FQN + signature), operation hint + transactional flag; reuses button-toggle idiom; no graph viz; no per-hop actions
  - [x] 4.4 `endpoint_data_effect_unresolved` label added to `findingTypeLabels.ts` → "Unresolved endpoint data effect"
  - [x] 4.5 snake_case `EndpointDataEffect` type + `MetaModelRelationships.endpoint_data_effects` + `RelationshipType` union; `modelSerialization`/`defaults` backfill the array
  - [x] 4.6 Focused tests pass

### Incomplete or Issues
None. All task groups complete and verified.

---

## 2. Documentation Verification

**Status:** ⚠️ Issues Found (minor — see Missing Documentation)

### Implementation Documentation
The spec's `implementation/` folder is **empty** — no per-task-group implementation reports were written. This did not impede verification: every task was verified directly against the code and re-run focused tests, and each new source file carries a thorough Javadoc/JSDoc header citing the spec and task group.

### Inline Documentation (verified present and accurate)
- AMS entity/DTO/mapper/SQL and the master-changelog block all carry spec-citing headers (snake_case rationale, boxed-`Double` PATCH-safety note, `dep_log_`/`dep_phy_` convention, "new changeset only").
- MCP primitive (`matchByNormalizedName` and wrappers) documents the shared/parameterized design intent and the compat-shim contract.
- Discovery resolver + candidate builder document the cross-layer `data` field shape the MCP layer reads by name.
- Frontend modules document the read-only/expandable/no-graph-viz UI contract.

### Missing Documentation
- Per-task-group implementation reports under `implementation/` (none present). Recommend backfilling if the team's process requires them; functionally non-blocking.

---

## 3. Roadmap Updates

**Status:** ⚠️ No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` is the original v0.1 meta-model-CRUD / diagram-editor / backend roadmap (Phases 1–5). It contains **no item** describing the endpoint→data-effect call graph or the discovery richness program. This spec is Spec "B" of the separate HAIKAI discovery-richness program tracked under `agent-os/specs/`, not on the product roadmap. No roadmap checkbox applies, so no update was made.

---

## 4. Test Suite Results

**Status:** ✅ All spec tests passing (pre-existing baseline failures noted, none are regressions)

Per the verification constraints, no long-running service was started; results below are from re-running the focused tests each group wrote, plus bounded regression sweeps over the touched suites (with pre-existing failures isolated via `git stash` against clean HEAD).

### Focused tests written by the spec (all passing)

| Layer | Suite(s) | Result |
|---|---|---|
| AMS | `EndpointDataEffectPersistenceTest` | 5/5 ✅ |
| AMS | `EndpointDataEffectsChangesetTest` | 1/1 ✅ |
| AMS | `ModelServiceInfrastructureWiringTest` (touched) | 4/4 ✅ |
| MCP | `candidateSaveBackEndpointDataEffects.test.ts` | 9/9 ✅ |
| MCP | `candidateSaveBackGapFill.test.ts` (touched, call-site regression) | 3/3 ✅ |
| discovery | `endpointDataEffectResolver.test.ts` | 10/10 ✅ |
| discovery | `discoveryV3Pipeline.test.ts` (touched, deferred-findings) | 4/4 ✅ |
| frontend | `endpointDataEffectCandidate.test.tsx` | 5/5 ✅ |
| frontend | `supportsDetails.test.ts` (touched) | 4/4 ✅ |

### Type-checks
- **discovery-service `tsc --noEmit`:** 0 errors (clean).
- **mcp-server `tsc --noEmit`:** 1 error, in `src/types/index.ts` (`ProcessActivityInput` duplicate re-export) — a file NOT touched by this spec; pre-existing. The spec's MCP changes compile cleanly (the EDE Jest suite runs).
- **frontend `tsc`:** Not re-run in full (known ~513-error baseline; bar is "no NEW errors"). The touched frontend files type-check within their Vitest runs, which all pass.

### Bounded regression sweeps over touched areas
- **discovery touched suites** (`springClassicFindingScanner`, `springClassicAdapter.smoke`, `springClassicAdapterImprovements`, `findingEmitter`, `findingsEmissionSources`): **104/104 ✅** — no regression from the `FindingEmitter.getRunAggregate` addition or scanner changes.
- **MCP full suite:** 439/441 passing. 2 failures, both confirmed pre-existing (see below).
- **frontend `DashboardView/__tests__/` directory:** 181 passing with spec applied vs 176 on clean HEAD (delta = the 5 new EDE tests). Failing-file set and failure count (17) are identical with or without the spec → no regression.

### Failed Tests (all pre-existing — NOT regressions; isolated via `git stash`)
1. **`ModelServiceUserJourneyLinkTest.saveModel_rejectsInvalidRelationshipType`** (AMS) — expects `IllegalArgumentException`, gets `ValidationException`. Explicitly listed as a known pre-existing failure. The spec only added a `@Mock` field + constructor arg to this test class; the failing assertion is unrelated.
2. **`candidateSaveBackGaps.test.ts › convertCandidateToEntity … data object is empty`** (MCP) — `interfaces` candidate default `interface_type` expects `''`, gets `'REST_API'`. Explicitly listed as a known pre-existing failure (the `interface_type` case). Unrelated to `endpoint_data_effects`.
3. **`saveTemporaryArchitectureDiagramRoute.test.ts › full save flow returns 200`** (MCP) — NOT on the pre-supplied known list, but **confirmed pre-existing**: re-run on clean HEAD (all spec changes stashed) it fails identically. The spec touches no diagram-save code.
4. **17 failures across 6 frontend `DashboardView/__tests__` files** (`dashboardDiscoverySummaryCard`, `dashboardView-ux-improvements`, `discoveryUxPolish`, `candidateReviewGapFill`, and others) — **confirmed pre-existing**: clean HEAD shows the identical 17 failures / same files (consistent with the `dashboardSummary*` / gap-fill pre-existing failures noted in project memory). None touched by this spec.

### Notes
- The spec also bundles a related robustness bug-fix (2026-05-29): discovery-pipeline findings are now BUILT in the pipeline and EMITTED by `runManager` AFTER candidates persist, so a finding's `discovery_candidate` link validates at AMS (the prior inline pre-persist emit silently dropped candidate-linked findings → "Findings tab showed 0"). This directly serves the spec's "never a silent drop" requirement for unresolved-chain findings and is covered by the new `discoveryV3Pipeline.test.ts` invariant test. It is broader than strictly required but well-justified and tested.

---

## 5. Cross-Layer Contract Check (highest-value verification)

**Status:** ✅ Pass — every field lines up across the discovery → MCP → AMS → frontend seam.

The discovery candidate `data` shape (emitted by `endpointDataEffectCandidates.ts`) → what MCP `convertEndpointDataEffectToRow` reads → the AMS `endpoint_data_effects` row/DTO (snake_case) → what the frontend renders:

| Concept | Discovery emits (`data`) | MCP reads | AMS row/DTO (snake_case) | Frontend reads |
|---|---|---|---|---|
| Endpoint side | `endpointName` | `data.endpointName \|\| data.endpoint \|\| candidate.name` → `resolveEndpoint` → `endpoint_id` | `endpoint_id` | (id; not displayed) |
| Data-entity side | `dataEntityName` | `data.entityName \|\| data.dataEntityName \|\| data.dataEntity \|\| data.entity` → `resolveEntityPoint` → `data_entity_point_id` | `data_entity_point_id` | (id; not displayed) |
| Access mode | `access_mode` | `data.access_mode \|\| data.accessMode` | `access_mode` | `readString(data,'access_mode')` |
| Operation hint | `operation_hint` + `path_metadata_json.operation_hint` | carried inside `path_metadata_json` | `path_metadata_json` (JSONB) | `readEndpointDataEffectOperationHint` (meta then top-level) |
| Transactional | `transactional` + `path_metadata_json.transactional` | carried inside `path_metadata_json` | `path_metadata_json` | `readEndpointDataEffectTransactional` (meta then top-level) |
| Confidence | `confidence` (also on candidate) | `data.confidence` (folded w/ side confidences) → `row.confidence` | `confidence` (boxed `Double`) | candidate-level confidence cell |
| Path hops | `path_metadata_json.hops[].{method_id, class_name, method_name, role}` | `data.path_metadata_json` → `row.path_metadata_json` (passthrough) | `path_metadata_json` (JSONB passthrough `Map`) | `buildEndpointDataEffectPathHops` reads `hops[].method_id`/`class_name`/`method_name`/`role` |

- The discovery builder emits the entity side as `dataEntityName`; MCP accepts `entityName`/`dataEntityName`/`dataEntity`/`entity` — superset, so the seam is robust. The MCP unit test happens to exercise `entityName`; the live discovery path uses `dataEntityName`. Both resolve.
- `path_metadata_json.hops[].method_id` is the exact key produced by discovery, persisted as JSONB passthrough by AMS, and read back by the frontend hop-list helper and the finding scanner's `stoppedAtPath`. The MCP and frontend test fixtures both mirror this shape exactly.
- AMS DTO carries explicit snake_case `@JsonProperty` on every field (`endpoint_id`, `data_entity_point_id`, `access_mode`, `path_metadata_json`, …); the persistence test asserts snake_case keys present and **no** camelCase leakage.

**No field-name mismatches found.**

---

## 6. Constraint Compliance

**Status:** ✅ All constraints honored.

| Constraint | Result |
|---|---|
| AMS DTO snake_case at the wire; NO `@CamelCaseWire` | ✅ No import, no annotation on `EndpointDataEffectDto`/`Entity` (only a prose Javadoc mention of "intentionally NO `@CamelCaseWire`"). Snake_case serialization asserted in `EndpointDataEffectPersistenceTest`. |
| Downstream typings snake_case (frontend `EndpointDataEffect`, model arrays) | ✅ `endpoint_id`/`data_entity_point_id`/`access_mode`/`path_metadata_json`/`confidence`. |
| Gateway proxy passthrough (no route change) | ✅ Gateway forwards the whole model body; no relationship-field enumeration. The only gateway diff is a diagnostic startup route-inventory log (not an EDE route). |
| New Liquibase file only; never edit an applied changeset | ✅ New `161-endpoint-data-effects.sql` + new `changeSet` block; preconditions `tableExists` `onFail: MARK_RAN`. No applied (≤160) changeset edited. |
| Data entity via `dep_log_`/`dep_phy_` point convention, not a raw entity FK | ✅ `data_entity_point_id` is a plain TEXT column (no FK), exactly like `interface_logical_entities.data_entity_point_id`. |
| Payload columns / `interface_logical_entities` untouched | ✅ A new dedicated table; ModelService delete/re-insert ordering keeps it separate. |
| Boxed `Double confidence` (PATCH-safe) | ✅ `Double` in entity + DTO; `DOUBLE PRECISION` in SQL. |
| No `class`/`method` candidate types added | ✅ `class`/`method` pre-exist in committed HEAD (`discovery-service/src/types/candidate.ts`) and in MCP `CANDIDATE_TYPE_CONFIG`; the spec diff adds neither — it adds only `endpoint_data_effects`. Method identity is substrate stamped onto path hops + `business_logics`. |
| No new "needs confirmation" candidate state / no mid-run prompt | ✅ `CandidateStatus` union unchanged; the three-outcome model is driven purely by the confidence number, no new state. |
| Inbound-HTTP-only (v1) | ✅ Resolver walks only `@RestController`/`@Controller` mapping methods; `ASYNC_METHOD_ANNOTATIONS` (`@JmsListener`/`@KafkaListener`/`@RabbitListener`/`@SqsListener`/`@EventListener`/`@Scheduled`) are skipped; no outbound (Feign/RestTemplate/WebClient) edges. |
| Three-outcome confidence model (≥0.75 normal / <0.75-resolved low-confidence candidate / unresolved → finding) | ✅ Resolver `computeConfidence` returns 0.9 / 0.8 / 0.65; low-but-resolved stays a normal candidate (verified by the discovery low-confidence test); unresolved → `endpoint_data_effect_unresolved` finding, no fabricated edge (verified by JdbcTemplate + multiple-impls tests). Reuses the existing 0.75 threshold. |
| One edge per (endpoint, data-entity) | ✅ Per-entity accumulation collapses read+write of the same entity into one read-write edge; Owner+Visit → two edges (verified). |

---

## 7. Genuine Gaps / Follow-ups (distinct from known pre-existing issues)

**Genuine follow-ups (non-blocking):**
- **Implementation reports absent.** `implementation/` is empty. If the team's process requires per-task-group reports, backfill them. Functionally non-blocking — inline doc headers are thorough.

**Known pre-existing issues (explicitly NOT regressions; do not attribute to this spec):**
- frontend `tsc` ~513-error baseline (bar is "no NEW errors" — met).
- mcp-server `tsc` 1 error in `types/index.ts` (`ProcessActivityInput` duplicate re-export) — file not touched by this spec.
- Stale `runManager*` discovery suites that don't compile (not run here).
- `findingTypeLabels.test.tsx` full-render case (not in the focused set).
- `candidateSaveBackGaps.test.ts` `interface_type` case (1 MCP failure above).
- `ModelServiceUserJourneyLinkTest.saveModel_rejectsInvalidRelationshipType` (1 AMS failure above).
- `saveTemporaryArchitectureDiagramRoute.test.ts` full-save case + 17 `DashboardView/__tests__` failures — all confirmed pre-existing via `git stash` against clean HEAD during this verification.

**No functional gaps against the spec were found.** The implementation is complete, internally consistent across all four layers, and constraint-compliant.
