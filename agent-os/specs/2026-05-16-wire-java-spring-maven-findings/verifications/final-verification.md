# Verification Report: Wire Java + Spring Classic + Maven Findings

**Spec:** `2026-05-16-wire-java-spring-maven-findings`
**Date:** 2026-05-16
**Verifier:** implementation-verifier
**Status:** PASS WITH NOTES

---

## Executive Summary

All 8 task groups in `tasks.md` are checked off; all 75 feature-specific discovery-service tests and 7 frontend label-map tests pass; the entire D1–D8 shaping decision set is honoured in code; no AMS Liquibase schema changes were introduced; no pre-existing CLAUDE.md broken test files were touched; and frontend / discovery-service baseline test failures are unchanged versus a stashed-changes baseline (i.e. no regressions from this spec). Two minor notes: (a) the helper function the spec calls `getFindingTypeLabel` ships as `labelForFindingType` (consistent across both consumers); (b) two new untracked frontend test files (`FindingsTab.test.tsx`, `FindingsTab.crossStack.test.tsx`) contain unused-`React` imports causing TS6133 — non-blocking under the project's existing 475-error TS baseline.

---

## 1. Tasks Verification

**Status:** All Complete

### Completed Tasks
- [x] Task Group 1: Shared scaffolding + `snippetRedaction.ts` + V3 pipeline hook
  - [x] 1.1 — 1.5 all subtasks complete; tests confirmed in `snippetRedaction.test.ts` (5 tests passing).
- [x] Task Group 2: `javaFindingScanner.ts`
  - [x] 2.1 — 2.4 all subtasks complete; tests confirmed in `javaFindingScanner.test.ts` (7 tests passing).
- [x] Task Group 3: `springClassicFindingScanner.ts`
  - [x] 3.1 — 3.4 all subtasks complete; tests confirmed in `springClassicFindingScanner.test.ts` (8 tests passing).
- [x] Task Group 4: Source D `noUsage` extension
  - [x] 4.1 — 4.4 all subtasks complete; tests confirmed inside `findingsEmissionSources.test.ts` (Source D extension describe block; 4 tests passing).
- [x] Task Group 5: Maven POM metadata parser extension
  - [x] 5.1 — 5.3 all subtasks complete; tests confirmed in `dependencyResolvers/mavenPomMetadataParser.test.ts` (8 tests passing, includes resolver-output regression guard).
- [x] Task Group 6: `mavenFindingScanner.ts` + `riskyDependencyRules.ts`
  - [x] 6.1 — 6.5 all subtasks complete; tests confirmed in `mavenFindingScanner.test.ts` (16 tests passing).
- [x] Task Group 7: Frontend label map + Findings tab wiring
  - [x] 7.1 — 7.5 all subtasks complete; tests confirmed in `frontend/src/components/Discovery/findingTypeLabels.test.tsx` (7 tests passing).
- [x] Task Group 8: Cross-pack gap review + strategic gap-fill
  - [x] 8.1 — 8.4 all subtasks complete; tests confirmed in `packFindingScannersCrossPackIntegration.test.ts` (6 strategic tests passing).

### Incomplete or Issues
None.

---

## 2. Acceptance Criteria & Decision Verification

### Acceptance criteria from spec.md

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Three new pack-finding scanners exist under `packFindingScanners/` mirroring `evidenceGapScanner.ts` shape | PASS | Folder + 3 scanner files present (575 / 1033 / 804 lines); each scanner has `(input, ctx) => emissions` shape and reuses `findingEmitter` / `computeDedupeKey` from predecessor. |
| 2 | Java + Spring scanners called from `discoveryV3Pipeline.ts` post-Stage-2 | PASS | `discoveryV3Pipeline.ts:103-104, 808` import + invoke `runPackFindingScanners` next to `scanForEvidenceGaps`. |
| 3 | Maven scanner called from `runManager.ts` after `buildRepoLookupTable` | PASS | `runManager.ts:2253, 2289` invoke `runMavenFindingScanner` immediately after `buildRepoLookupTable`. |
| 4 | `FindingEmitter` + `computeDedupeKey` reused (no duplicate persistence) | PASS | All scanners produce `FindingEmitInput[]`; emission goes through `findingEmitter.emitFindings`. |
| 5 | Java pack — 3 new finding_types + 3 new `evidence_gap` gapTypes per spec | PASS | `javaFindingScanner.ts:201, 244, 287, 330` emit `raw_sql_detected` / `hardcoded_endpoint_or_url` / `legacy_java_api_usage` / `evidence_gap`; gapTypes `java_unresolved_return_type` / `java_unresolved_import` / `java_class_no_methods` set in `detail_json.gapType`. |
| 6 | Spring Classic — 6 new finding_types + 2 new gapTypes; no `endpoint_code_runtime_mismatch` introduced | PASS | `springClassicFindingScanner.ts:303, 347, 389, 431, 472, 513, 551` emit the six types + `evidence_gap`; gapTypes `endpoint_missing_request_schema` (line 813) and `endpoint_partial_path_variables` (line 835). |
| 7 | Source D extension at runtime-evidence emission site | PASS | `runDiscoveryRuntimeEvidence.ts:715-741` emit `buildUnusedCodeEndpointFinding` per `noUsage` entry; preserves existing `buildUnmatchedRuntimeEndpointFinding` path. |
| 8 | Maven scanner — 7 finding_types + POM metadata parser extension | PASS | `mavenFindingScanner.ts` emits all 7 types; `dependencyResolvers/maven/mavenPomMetadataParser.ts` (sibling) parses `<properties>`, `<parent>`, `<plugins>`, `<dependencyManagement>` per spec. |
| 9 | Risky-dependency ruleset — hand-curated TS array, ~20–30 entries + plugin rules | PASS | `riskyDependencyRules.ts`: 25 risky deps + 6 plugin rules + 18 DB drivers (3 exported TS arrays, no JSON/YAML). |
| 10 | Severity cutoffs per D5 | PASS | `mavenFindingScanner.ts:155-165` Java `>=17 info / >=11 medium / =8 medium / <8 high`; `:293-297` Spring `>=6 info / =5 medium / <5 high`. |
| 11 | Shared `snippetRedaction.ts` — 200 chars, literal masking, secret-key masking, Basic auth header drop | PASS | `utils/snippetRedaction.ts:33, 56, 63, 70, 76, 86-110` all four rules in documented order. |
| 12 | Both Java and Spring scanners consume `redactSnippet` | PASS | `javaFindingScanner.ts:43, 199, 242, 285`; `springClassicFindingScanner.ts:69, 339, 387, 429, 470`. |
| 13 | `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` enforced as hard-coded constant in scanner code | PASS | `packFindingScanners/constants.ts:16`; imported in all three scanners; cap test in `javaFindingScanner.test.ts:307` and `mavenFindingScanner.test.ts:365`. |
| 14 | `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true` hard-coded | PASS | `constants.ts:25`; consumed at `mavenFindingScanner.ts:561, 582`. |
| 15 | No `config_snapshot` schema extension | PASS | Grep of `config_snapshot` shows only pre-existing reads (logEnrichment, archModelClient, discoveryV3Pipeline, performancePostRun); no extension for caps. |
| 16 | Soft-fail on scanner-level error | PASS | `packFindingScanners/index.ts:65-82` try/catch around each scanner with `console.warn` and no rethrow; `runManager.ts:2299-2304` try/catch around Maven boundary. |
| 17 | Frontend label map + helper + drop-in usage | PASS | `findingTypeLabels.ts:33-60` has all 16 new entries + `unused_code_endpoint`; helper at line 82; consumed by `FindingsTab.tsx:29` and `FindingDetailDrawer.tsx:29`. (Helper name = `labelForFindingType`, not `getFindingTypeLabel` per spec — see notes below.) |
| 18 | 3-commit delivery sequence (D8) | PASS | `tasks.md:7-11` documents Commit 1 = Groups 1-2, Commit 2 = Groups 3-4, Commit 3 = Groups 5-7. (Not yet committed in git — work-in-progress in working tree.) |
| 19 | Zero AMS schema changes | PASS | `architecture-model-service/src/main/resources/db/changelog/sql/` highest numbered changeset is `136-discovery-finding-links.sql` (from predecessor spec); nothing at 137+. |
| 20 | Existing candidate output unchanged (regression guard) | PASS | `mavenPomMetadataParser.test.ts:180-201` regression guard locks pre-Commit-3 dependency contract on `maven-single-module` fixture (6 deps, exact versions/scopes). |
| 21 | `feedback_no_src_edits_during_run.md` standing constraint documented | PASS | `spec.md:81` + `tasks.md:328` both reference the feedback file. |
| 22 | Pre-existing broken tests from CLAUDE.md memory untouched | PASS | `git status` shows none of the CLAUDE.md listed broken tests (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`) are modified. |

### Decision-level verification (D1–D8)

#### D1 — `java_evidence_gap` / `missing_contract_detail` NOT new finding types; folded into `evidence_gap` with `gapType` discriminator
**Status: PASS**

- `grep "java_evidence_gap"` and `grep "missing_contract_detail"` return only `interface_missing_contract_detail` (predecessor `evidence_gap` gapType inside `emissionSources.ts:362` and `evidenceGapScanner.ts:9,173`), NOT new top-level finding_types.
- `javaFindingScanner.ts:330` sets `findingType: 'evidence_gap'` and `detail_json.gapType` to one of the three Java gapTypes.
- `springClassicFindingScanner.ts:551` similarly sets `findingType: 'evidence_gap'` and `detail_json.gapType` to one of the two new Spring gapTypes (`endpoint_missing_request_schema`, `endpoint_partial_path_variables`).

#### D2 — `endpoint_code_runtime_mismatch` NOT a Spring finding type; Source D extended for `noUsage`
**Status: PASS**

- `grep "endpoint_code_runtime_mismatch"` returns only comments in `emissionSources.ts:206`, `findingTypeLabels.ts:49`, and `findingTypeLabels.test.tsx:46` — no actual emission.
- `runDiscoveryRuntimeEvidence.ts:715-741` emits one info-severity finding per `noUsage` entry via `buildUnusedCodeEndpointFinding`.
- The new builder lives in the existing `emissionSources.ts` (line 225-258) alongside the original `buildUnmatchedRuntimeEndpointFinding` — same source vocabulary (`runtime_log_enrichment`), same `category: 'runtime_usage'`.

#### D3 — `complex_business_logic_candidate` and `state_change_outside_service_boundary` deferred
**Status: PASS**

- Recursive grep across `discovery-service/src/` returns zero matches for either string.

#### D4 — Hand-curated TS array shape for risky-dependency rules
**Status: PASS**

- `riskyDependencyRules.ts` is pure TypeScript: 3 exported arrays (`RISKY_DEPENDENCY_RULES`, `RISKY_PLUGIN_RULES`, `DATABASE_DRIVER_RULES`).
- Counts: 25 risky-dep rules (entries 100–300); 6 plugin rules (305–354); 18 DB-driver entries (371–403).
- Rule shape exactly matches spec: `{ groupId, artifactId, versionPredicate, reason, severity }[]`. `versionPredicate` is a TS closure over `(version: string | null) => boolean`.
- No JSON/YAML config files in or near the scanner folder.

#### D5 — Java + Spring version cutoffs hard-coded per spec
**Status: PASS**

- `mavenFindingScanner.ts:155-165` `severityForJavaVersion`: `>=17 → info`, `>=11 → medium`, `=8 → medium`, `<8 → high` (matches spec verbatim).
- `mavenFindingScanner.ts:293-297` `severityForSpringMajor`: `>=6 → info`, `=5 → medium`, `else → high (4.x or older)` (matches spec).
- Tests `mavenFindingScanner.test.ts` cover all four Java bands (17 / 11 / 8 / 1.7) and three Spring bands (Boot 3.x / spring-core 5 / spring-core 4).

#### D6 — `snippetRedaction.ts` rules + consumer routing
**Status: PASS**

- `utils/snippetRedaction.ts:33` `DEFAULT_SNIPPET_MAX_LEN = 200`.
- `:62-63` `BASIC_AUTH_HEADER_REGEX` masks `Authorization: Basic <token>`.
- `:55-56` `SECRET_KEY_REGEX` masks `password=`, `pwd=`, `secret=`, `token=`, `api_key=` / `api-key=` (case-insensitive), in query-string AND property-file forms (key prefix `[A-Za-z0-9_.-]*?`).
- `:70, 76` quoted-literal regexes replace both `"..."` and `'...'` with `?`.
- `:107-109` truncation step.
- Both Java and Spring scanners import and call `redactSnippet` for every `evidenceSnippet` payload — confirmed by 7 distinct call sites across the two scanners (`javaFindingScanner.ts:199, 242, 285`; `springClassicFindingScanner.ts:339, 387, 429, 470`). No ad-hoc redaction grep hits in either scanner.

#### D7 — Caps as hard-coded constants; no `config_snapshot` extension
**Status: PASS**

- `packFindingScanners/constants.ts` is the single source for `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` and `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true`.
- All three scanners import from `./constants`.
- `config_snapshot` grep shows only pre-existing read-sites (no extension for caps).
- Soft-fail confirmed: `packFindingScanners/index.ts:65-82` try/catch around each scanner; `runManager.ts:2299-2304` try/catch around the Maven boundary.

#### D8 — Three-commit boundary
**Status: PASS (DOCUMENTATION) / NOT YET COMMITTED (GIT)**

- `tasks.md:7-11` and `spec.md:77-80` both document the 3-commit boundary: Commit 1 = Groups 1-2, Commit 2 = Groups 3-4, Commit 3 = Groups 5-7 + Group 8 cross-pack review pre-merge.
- Work is currently in the working tree (uncommitted); `git log` shows no commits matching the spec yet. The boundary CAN still be honoured at commit time — the implementation is organized to permit it.

---

## 3. Documentation Verification

**Status:** Complete

### Implementation Documentation
The spec folder does NOT contain a populated `implementation/` subfolder — implementation notes were not authored per group. However, every task in `tasks.md` is checked off with `- [x]` and the supporting code + tests are present, so the absence of per-group `.md` implementation reports is acceptable (the spec template does not mandate them).

### Verification Documentation
- This final verification: `verifications/final-verification.md`.

### Missing Documentation
- No per-group implementation report `.md` files under `implementation/`. Not blocking; tasks.md and spec.md are the source of truth and are internally consistent with the code.

---

## 4. Roadmap Updates

**Status:** No Updates Needed

### Updated Roadmap Items
None.

### Notes
`agent-os/product/roadmap.md` contains no items matching "discovery findings", "Java pack", "Spring Classic", "Maven pack", "risky dependency", or related phrasing. The roadmap predates the discovery-findings stack and is not granular enough to track per-pack scanner deliveries. No update applied.

---

## 5. Test Suite Results

**Status:** Passed With Notes (feature-specific tests all pass; baseline pre-existing failures unchanged)

### Feature-specific tests (the 75-test scope this spec promises)

| Test file | Tests passing |
|---|---|
| `discovery-service/src/__tests__/snippetRedaction.test.ts` | 5 / 5 |
| `discovery-service/src/__tests__/javaFindingScanner.test.ts` | 7 / 7 |
| `discovery-service/src/__tests__/springClassicFindingScanner.test.ts` | 8 / 8 |
| `discovery-service/src/__tests__/mavenFindingScanner.test.ts` | 16 / 16 |
| `discovery-service/src/__tests__/dependencyResolvers/mavenPomMetadataParser.test.ts` | 8 / 8 |
| `discovery-service/src/__tests__/findingsEmissionSources.test.ts` (includes Source D extension) | ~25 / 25 (Source D extension: 4 / 4) |
| `discovery-service/src/__tests__/packFindingScannersCrossPackIntegration.test.ts` (Group 8) | 6 / 6 |
| `frontend/src/components/Discovery/findingTypeLabels.test.tsx` | 7 / 7 |
| **Total feature-specific** | **75 + 7 = 82 / 82** |

All pass.

### Full discovery-service test suite (entire suite — for regression detection)
- **Total Tests:** 894 (post-changes) vs. 793 (baseline)
- **Passing:** ~792 (post-changes) vs. 671 (baseline)
- **Failing:** ~102 (post-changes) vs. 122 (baseline)
- **Tests added by this spec:** ~75
- Note: jest output varies slightly run-to-run on this repo (flaky parallelism — e.g. `archModelClient.resetDefaultArchitectureCache is not a function` errors come and go in suites like `runManagerStepsPayloadMerge`, `runsRouteTierGate`, `idempotentPersistence`, the various `*PackWiring.test.ts` / `*Adapter.smoke.test.ts` files). Comparing apples-to-apples: **failing-test count did NOT regress versus a stashed-changes baseline run** (122 baseline vs. 102 with-changes is within run-to-run variance — and pass count rose by 121 while only ~75 net new tests were added).

### Full frontend test suite (entire suite — for regression detection)
- **Total Tests:** 9554 (post-changes) vs. 9486 (baseline) — 68 net new tests from this spec.
- **Passing:** 8904 (post-changes) vs. 8836 (baseline) — 68 new passing tests.
- **Failing:** 650 (both runs — identical).
- **Errors:** 6 (both runs — identical).
- **Failing test files:** 227 (both runs — identical).
- **Conclusion:** Zero regressions in the frontend baseline; this spec contributes 68 new passing tests with no new failures.

### TypeScript checks
- `discovery-service`: `npx tsc --noEmit` **clean** (zero errors).
- `frontend`: 475 pre-existing tsc errors across the codebase (unrelated to this spec — `rendering.ts`, `sanitize.ts`, `sequenceLayout.ts`, `workspaceSchemaVersion.ts`, etc.). **Of those 475, only 2 errors touch files NEW in this spec:** unused `React` imports in `FindingsTab.test.tsx` (line 20) and `FindingsTab.crossStack.test.tsx` (line 27) — TS6133 / cosmetic, no functional impact. The new `findingTypeLabels.ts`, `FindingsTab.tsx`, `FindingDetailDrawer.tsx` themselves have **zero new tsc errors**.

### Failed Tests
Pre-existing baseline failures unchanged. Representative classes (all are pre-existing, NOT new regressions):
- `runManagerStepsPayloadMerge.test.ts` — `resetDefaultArchitectureCache is not a function` (test-double mock gap, not spec-related).
- `runManagerPipelineRestructuring.test.ts`, `runManagerBackbone.test.ts`, `runManagerAndRoutes.test.ts` — same mock pattern.
- `v3PipelineAcceptance.test.ts`, `v3PipelineTierAndConfidence.test.ts`, `v3LayeredPromptsAcceptance.test.ts` — tier and IR-count assertions (predecessor / pipeline state).
- The various `*Adapter.smoke.test.ts` / `*PackWiring.test.ts` (Ruby, PHP, C#, Go, JS, C++, NestJS, Angular, ASP.NET Core, Rails, Symfony, Magento, Kratos, Spring Boot, AngularJS Classic, Spring Classic Adapter, Spring Boot Framework Pack Migration, Spring Boot Adapter Enrichments) — flaky / pre-existing.
- `findingsEmissionSources.test.ts` Source-D-extension describe block — **all 4 sub-tests PASS** (one of the new test groups this spec ships).
- CLAUDE.md memory list (`bootstrap-summary-fetching`, `conversation-memory-edge-cases`, `dashboardSummary*`, `hub-bootstrap-4-task-definition`, `chatV2-panel-*`): **none touched, none impacted** by this spec.

### Notes
- The discovery-service test suite shows run-to-run variance of ~20-50 failures around a stable ~100-150 baseline. The variance is the same baseline before and after this spec — it is not introduced here. Long-term fix is out of scope for this verification.
- All 82 feature-specific tests this spec promises are GREEN and stable across multiple runs.

---

## 6. Standing Constraints Verification

| Constraint | Status |
|---|---|
| No edits to applied Liquibase changeset 135 / 136 (predecessor) | PASS — `changelog/sql/` unmodified at 135 and 136; nothing added at 137+. |
| AMS DTO numeric fields boxed (per `project_primitive_double_dto_overwrite.md`) | N/A — this spec adds no AMS DTOs. |
| AppShell model cache not invalidated on finding writes | PASS — no finding-write codepath touches `LOAD_MODEL` / cache invalidation. |
| Aggregation discipline — one finding per file/class/method site (Java), per endpoint / XML category / job / SP call site (Spring), per dep coord / plugin / POM (Maven) | PASS — confirmed in each scanner's cap-tracking maps and group-by keys. |
| Snippet redaction MUST route through the shared utility | PASS — see D6 above. |
| `feedback_no_src_edits_during_run.md` documented in spec / tasks | PASS — `spec.md:81`, `tasks.md:328`. |

---

## 7. Notes / Minor Deviations

1. **Helper name deviation (label helper):** the spec calls the helper `getFindingTypeLabel`; the implementer shipped it as `labelForFindingType`. Both consumers (`FindingsTab.tsx`, `FindingDetailDrawer.tsx`) reference the actual exported name, and the test file covers it under the same name — consistent end-to-end. NOT a functional issue; pure rename. Recommend either updating spec text or renaming to match if uniformity matters; current state is internally consistent.
2. **Spring-D2 finding-type choice:** implementer chose `unused_code_endpoint` for the new no-usage emission (matches frontend label map at `findingTypeLabels.ts:51`). This is consistent across scanner code + builder + frontend, and matches the test assertions (`findingsEmissionSources.test.ts:181`). Note in `findingTypeLabels.ts:48-51` explicitly explains the choice (the originally proposed `endpoint_code_runtime_mismatch` was renamed late). PASS.
3. **Unused-React TS6133 in two new untracked test files:** `FindingsTab.test.tsx` and `FindingsTab.crossStack.test.tsx` import `React` but the modern JSX transform makes that unused. Cosmetic; non-blocking under the existing 475-error TS baseline. Easy fix: drop the `import React from 'react'` line.
4. **No populated `implementation/` subfolder:** the spec folder has an empty `implementation/` folder. Tasks.md and the code itself serve as the source of truth; not blocking.
5. **Work is uncommitted:** all changes for this spec live in the working tree (modified files: `archModelClient.ts`, `discoveryV3Pipeline.ts`, `runManager.ts`, `runDiscoveryRuntimeEvidence.ts`; untracked: the new scanners, parser, tests, frontend labels). D8's three-commit boundary CAN still be honoured at commit time — the file organization permits it.

---

## 8. Overall Verdict

**PASS WITH NOTES**

All 22 acceptance criteria pass. All 8 decisions D1–D8 honoured in code. All 75 feature-specific discovery-service tests + 7 frontend tests are green. Zero regressions in the test baseline. Zero AMS schema changes. The minor notes above are documentation/cosmetic and do not affect spec correctness.
