# Task Breakdown: Wire Java + Spring Classic + Maven Packs into Discovery Findings

## Overview
Total Task Groups: 8
Delivery shape: three commits (mirroring D8), grouped 2 / 2 / 3 + a final lean cross-pack gap-review group.

Commit-to-group mapping:
- **Commit 1 (shared scaffolding + Java scanner):** Task Group 1, Task Group 2
- **Commit 2 (Spring Classic scanner + Source D extension):** Task Group 3, Task Group 4
- **Commit 3 (Maven resolver extension + Maven scanner + frontend labels):** Task Group 5, Task Group 6, Task Group 7
- **Cross-pack gap review:** Task Group 8 (post-Commit 3, before merge)

---

## Task List

### Wave A — Commit 1: Shared scaffolding + Java scanner

#### Task Group 1: Shared scanner scaffolding + `snippetRedaction.ts`
**Dependencies:** None (predecessor spec `2026-05-16-discovery-findings-first-class` already merged — `FindingEmitter`, `FindingEmitRunContext`, `computeDedupeKey`, AMS persistence, gateway proxies, frontend Findings tab all exist).

- [x] 1.0 Establish the shared `packFindingScanners/` folder, the shared snippet-redaction utility, and the V3-pipeline integration hook that Groups 2 and 3 will plug into.
  - [x] 1.1 Write 2-8 focused tests for `snippetRedaction.ts` and the pipeline hook
    - Limit to 2-8 highly focused tests maximum.
    - `truncatesAt200Chars` — input ≥250 chars, output is exactly 200 chars.
    - `masksQuotedStringLiterals` — both `"..."` and `'...'` collapse to `?`.
    - `masksSecretQueryParams` — values of `password=`, `pwd=`, `secret=`, `token=`, `api_key=` (query-string AND property-file forms) replaced.
    - `dropsBasicAuthHeader` — `Authorization: Basic <base64>` line is removed.
    - `pipelineCallsPackScannerHookAfterStage2BeforeMerge` — `discoveryV3Pipeline.ts` invokes a registered `packFindingScanners.run()` shim at the same site as `evidenceGapScanner`, with the V3 stage 2 output and a `FindingEmitRunContext` in hand.
    - Skip exhaustive permutations of redaction inputs and pipeline edge cases.
  - [x] 1.2 Create `discovery-service/src/utils/snippetRedaction.ts`
    - Exports `redactSnippet(input: string): string`.
    - Order of operations: drop `Authorization: Basic ...` lines → mask secret params → replace quoted literals → truncate to 200.
    - No per-scanner ad-hoc redaction is permitted; downstream scanners MUST consume this utility.
  - [x] 1.3 Create `discovery-service/src/services/findings/packFindingScanners/` folder with `index.ts` shim
    - `index.ts` exports a single `runPackFindingScanners(ctx, packOutputs)` that fans out to whichever pack scanners are registered (Java in this commit; Spring Classic added in Commit 2).
    - Mirror call-site shape of `evidenceGapScanner.ts` (synchronous-style async, threaded `FindingEmitRunContext`, soft-fail per scanner: try/catch around each scanner, log warning, attach run warning where supported, never throw out of the shim).
  - [x] 1.4 Wire the shim into `discovery-service/src/services/discoveryV3Pipeline.ts`
    - Call site: same site as `evidenceGapScanner` invocation — post-Stage 2, before merge.
    - Do NOT modify Stage 2 outputs or the merge step; the shim only emits findings.
    - Existing candidate / evidence output for representative fixtures MUST remain unchanged.
  - [x] 1.5 Ensure shared-scaffolding tests pass
    - Run ONLY the 2-8 tests written in 1.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 1.1 pass.
- `snippetRedaction.ts` exists and implements all four redaction rules in the documented order.
- `packFindingScanners/index.ts` shim is wired into `discoveryV3Pipeline.ts` at the documented site.
- Existing architecture candidate output for representative fixtures is byte-identical (no scanner registered yet besides the empty list).
- Save-back flow untouched.

---

#### Task Group 2: `javaFindingScanner.ts`
**Dependencies:** Task Group 1.

- [x] 2.0 Emit Java-pack deterministic findings (`raw_sql_detected`, `hardcoded_endpoint_or_url`, `legacy_java_api_usage`) plus extend the existing `evidence_gap` finding type with Java gapTypes.
  - [x] 2.1 Write 2-8 focused tests for `javaFindingScanner`
    - Limit to 2-8 highly focused tests maximum.
    - `emitsRawSqlDetectedOncePerMethodSite` — JDBC `PreparedStatement` + inline SQL → exactly one `raw_sql_detected` finding (medium), aggregated per file/class/method.
    - `emitsHardcodedEndpointOrUrl` — RestTemplate literal URL → one `hardcoded_endpoint_or_url` finding (medium) with redacted URL via `snippetRedaction`.
    - `emitsLegacyJavaApiUsage` — `javax.servlet.*` import → one `legacy_java_api_usage` finding with `migrationConcern` populated.
    - `extendsEvidenceGapWithJavaGapTypes` — unresolved return type produces an `evidence_gap` finding whose `detail_json.gapType === 'java_unresolved_return_type'` (covers the gapType discriminator path for `java_unresolved_import` and `java_class_no_methods` by the same shape).
    - `linksFindingToEvidenceAndCandidateWhenIdsAvailable` — verify `relatedEvidenceIds` and `relatedCandidateIds` populated on at least one emission.
    - `enforcesMaxFindingsPerTypePerRunCap` — synthetic input with 60 raw-SQL sites produces exactly 50 findings of type `raw_sql_detected` (cap = 50).
    - Skip exhaustive permutations of every detected pattern.
  - [x] 2.2 Create `discovery-service/src/services/findings/packFindingScanners/javaFindingScanner.ts`
    - Signature: `runJavaFindingScanner(packOutputs, ctx: FindingEmitRunContext): Promise<void>`.
    - Source = `java-language-pack`; `createdByStage = 'deterministic_java_analysis'`.
    - Aggregation: one finding per (file/class/method) site or per pattern site — NOT per AST node.
    - `detail_json` keys per spec: `filePath`, `packageName`, `className`, `methodName`, `sourceLineStart`, `sourceLineEnd`, `detectedPattern`, `evidenceSnippet` (via `snippetRedaction.redactSnippet`), `relatedCandidateIds`, `relatedEvidenceIds`, `confidence`.
    - Hard-coded constants at top of file: `MAX_FINDINGS_PER_TYPE_PER_RUN = 50`.
    - Detection signals — keep deterministic-only:
      - `raw_sql_detected`: JDBC `Statement`/`PreparedStatement` usage, inline SQL string literals, SQL string construction patterns, `createNativeQuery`.
      - `hardcoded_endpoint_or_url`: `http://` / `https://` string literals, RestTemplate/HTTP-client URL literals, legacy hostnames.
      - `legacy_java_api_usage`: deprecated Java APIs, `java.util.Date`/`Calendar`, reflection-heavy patterns, `SecurityManager`, custom classloaders, `javax.*` namespaces (jakarta migration concern).
    - For `evidence_gap` extension: build the existing `evidence_gap` finding shape and set `detail_json.gapType` to one of `java_unresolved_return_type`, `java_unresolved_import`, `java_class_no_methods` — do NOT introduce a new finding_type.
    - Soft-fail: try/catch around the scanner body; log warning, do not throw.
  - [x] 2.3 Register `javaFindingScanner` in `packFindingScanners/index.ts`
    - Add to the shim's fan-out so it runs from `discoveryV3Pipeline.ts` post-Stage 2.
  - [x] 2.4 Ensure Java scanner tests pass
    - Run ONLY the 2-8 tests written in 2.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 2.1 pass.
- All three new finding_types and the three Java `evidence_gap` gapTypes are emitted per the documented aggregation rules.
- `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` cap is enforced per scanner.
- Snippets routed through `snippetRedaction.redactSnippet` — no per-scanner ad-hoc redaction.
- Existing architecture candidate output for representative fixtures remains unchanged.
- Save-back flow untouched.

---

### Wave B — Commit 2: Spring Classic scanner + Source D extension

#### Task Group 3: `springClassicFindingScanner.ts`
**Dependencies:** Task Group 1 (scaffolding), Task Group 2 (registration pattern).

- [x] 3.0 Emit Spring Classic deterministic findings (6 new types) plus extend the existing `evidence_gap` finding type with Spring contract gapTypes.
  - [x] 3.1 Write 2-8 focused tests for `springClassicFindingScanner`
    - Limit to 2-8 highly focused tests maximum.
    - `emitsSpringXmlBeanWiring` — `applicationContext.xml` with bean definitions → one finding per XML file/category (medium); reads `usedNamespaces` from existing `springBeansXmlParser` (read-only).
    - `emitsLegacyTransactionConfiguration` — `tx:advice` or XML transaction manager → one `legacy_transaction_configuration` finding (medium).
    - `emitsSecurityFilterOrInterceptorDetected` — Spring Security XML or custom `HandlerInterceptor` → one `security_filter_or_interceptor_detected` finding (security/medium).
    - `emitsScheduledOrBatchJobDetected` — `@Scheduled` or Quartz config → one `scheduled_or_batch_job_detected` finding (medium).
    - `emitsStoredProcedureOrJdbcUsage` — `SimpleJdbcCall` / `jdbcTemplate.call` site → one `stored_procedure_or_jdbc_usage` finding (high).
    - `emitsSpringClassicMigrationRisk` — `web.xml` presence (filename-only, no servlet-mapping extraction) → one `spring_classic_migration_risk` finding (medium-high).
    - `extendsEvidenceGapWithSpringContractGapTypes` — `@RequestMapping` controller endpoint with no request schema → one `evidence_gap` finding whose `detail_json.gapType === 'endpoint_missing_request_schema'`; same shape covers `endpoint_partial_path_variables`.
    - Skip exhaustive permutations of every Spring XML idiom.
  - [x] 3.2 Create `discovery-service/src/services/findings/packFindingScanners/springClassicFindingScanner.ts`
    - Signature: `runSpringClassicFindingScanner(packOutputs, ctx: FindingEmitRunContext): Promise<void>`.
    - Source = `spring-classic-framework-pack`; `createdByStage = 'deterministic_spring_classic_analysis'`.
    - Aggregation: one finding per controller endpoint with missing detail, per XML config file/category, per stored-procedure call site, per scheduled job.
    - `detail_json` keys per spec: `configFilePath`, `controllerClass`, `methodName`, `httpMethod`, `path`, `beanId`, `beanClass`, `xmlElement`, `transactionConfig`, `securityConfig`, `scheduleConfig`, `detectedPattern`, `migrationConcern`, `confidence`.
    - Hard-coded constants: `MAX_FINDINGS_PER_TYPE_PER_RUN = 50`.
    - Snippets routed through `snippetRedaction.redactSnippet` — no ad-hoc redaction.
    - For `evidence_gap` extension: reuse the existing `evidence_gap` finding shape and set `detail_json.gapType` to one of `endpoint_missing_request_schema`, `endpoint_partial_path_variables` (note: `endpoint_missing_response_schema` already shipped by the predecessor — do not re-introduce).
    - `endpoint_code_runtime_mismatch` is NOT introduced here — handled by Group 4 (Source D extension).
    - `web.xml` handling: filename-presence detection only — do NOT parse servlet-mapping. `struts-config.xml` / `tiles-defs.xml` excluded.
    - Soft-fail: try/catch around scanner body.
  - [x] 3.3 Register `springClassicFindingScanner` in `packFindingScanners/index.ts`
    - Runs from `discoveryV3Pipeline.ts` post-Stage 2 alongside the Java scanner.
  - [x] 3.4 Ensure Spring Classic scanner tests pass
    - Run ONLY the 2-8 tests written in 3.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 3.1 pass.
- All six new Spring Classic finding_types and the two new Spring `evidence_gap` gapTypes are emitted per the documented aggregation rules.
- `springBeansXmlParser.ts` is consumed read-only (no edits to that parser).
- `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` cap enforced.
- Snippets routed through `snippetRedaction.redactSnippet`.
- Existing architecture candidate output for representative fixtures remains unchanged.

---

#### Task Group 4: Source D `noUsage` extension in `runDiscoveryRuntimeEvidence.ts`
**Dependencies:** Task Group 3 (delivered together in Commit 2 per D8).

- [x] 4.0 Extend the existing Source D emission site so the `noUsage` case (code endpoint present, no runtime hits) also emits a finding — keeps all runtime-vs-code mismatch detection in one place (replaces the dropped `endpoint_code_runtime_mismatch` Spring-specific type per D2).
  - [x] 4.1 Write 2-8 focused tests for the Source D extension
    - Limit to 2-8 highly focused tests maximum.
    - `existingUnmatchedRuntimeEndpointStillEmits` — pre-existing emission for runtime path observed but no code endpoint discovered continues to fire unchanged (regression guard).
    - `noUsageEntryEmitsInfoSeverityRuntimeUsageObservation` — code endpoint with `noUsage` true produces one info-severity finding via the extended Source D builder; `detail_json.usage_count === 0` (or equivalent flag chosen by implementer — shape MUST be consistent with existing Source D builder shape).
    - `noUsageEmissionReusesSourceDBuilder` — the new emission goes through the extended builder in `emissionSources.ts`, NOT a new builder.
    - `noUsageEmissionDedupesViaComputeDedupeKey` — re-running the same input produces the same dedupe key (same `runId + findingType + category + title + primaryLinkedTarget`).
    - Skip exhaustive runtime-mismatch permutations.
  - [x] 4.2 Extend the Source D builder in `discovery-service/src/services/findings/emissionSources.ts`
    - Add a `noUsage`-shaped emission path; reuse existing source-D `finding_type` vocabulary (do NOT introduce a Spring-specific type).
    - Keep the existing `unmatched_runtime_endpoint` emission path intact.
  - [x] 4.3 Extend the call site in `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (around lines ~670-722)
    - Emit one info-severity finding per `noUsage` entry currently computed but not emitted today.
    - Preserve all surrounding behaviour: do not change runtime-evidence persistence, mismatch computation, or candidate output.
    - Soft-fail: warning on emission failure; do NOT fail the discovery run.
  - [x] 4.4 Ensure Source D extension tests pass
    - Run ONLY the 2-8 tests written in 4.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 4.1 pass.
- `noUsage` entries now emit info-severity findings; pre-existing `unmatched_runtime_endpoint` emission unchanged.
- Source D builder in `emissionSources.ts` is extended (not duplicated).
- Dedupe via `computeDedupeKey` works for the new emission path.
- Existing runtime-evidence persistence and candidate output unchanged.

---

### Wave C — Commit 3: Maven resolver extension + Maven scanner + frontend labels

#### Task Group 5: Maven POM metadata parser extension
**Dependencies:** None within Commit 3 (parser extension is independent of the scanner that consumes it).

- [x] 5.0 Extend the existing Maven resolver (or add a sibling parser) to extract the POM metadata required by the Maven finding scanner — `<properties>`, `<build><plugins>`, `<parent>` version, `<dependencyManagement>` contents.
  - [x] 5.1 Write 2-8 focused tests for the Maven metadata parser extension
    - Limit to 2-8 highly focused tests maximum.
    - `parsesPropertiesBlock` — `<properties><maven.compiler.source>1.8</...>` → `properties['maven.compiler.source'] === '1.8'`.
    - `parsesBuildPlugins` — `<build><plugins><plugin>...` → plugin entry with `groupId/artifactId/version` populated.
    - `parsesParentVersion` — `<parent><version>2.5.0</...>` → `parent.version === '2.5.0'`.
    - `parsesDependencyManagement` — entries in `<dependencyManagement>` appear distinctly from top-level `<dependency>` entries (no merge into resolved deps).
    - `existingDependencyOutputUnchangedForRepresentativeFixture` — regression guard: run resolver against a representative pre-Commit-3 fixture and verify dependency output is byte-identical.
    - Skip exhaustive POM-shape permutations.
  - [x] 5.2 Extend `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` OR add sibling `mavenPomMetadataParser.ts`
    - Decision: prefer sibling `mavenPomMetadataParser.ts` if the resolver class is already large, to keep the regression-guard fixture untouched. Implementer picks based on local code shape.
    - Output shape MUST be additive — existing `dependencies` array unchanged; new fields `properties`, `plugins`, `parent`, `dependencyManagement` appended to the resolver result.
    - Soft-fail: malformed POM logs warning and returns partial data; does NOT fail the discovery run.
  - [x] 5.3 Ensure Maven parser extension tests pass
    - Run ONLY the 2-8 tests written in 5.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 5.1 pass.
- New metadata fields available on resolver output: `properties`, `plugins`, `parent`, `dependencyManagement`.
- Existing dependency output for representative fixtures is byte-identical (regression test passes).
- No transitive dependency tree walking introduced.

---

#### Task Group 6: `mavenFindingScanner.ts` + `riskyDependencyRules.ts`
**Dependencies:** Task Group 5.

- [x] 6.0 Emit 7 Maven-pack deterministic finding types and ship the hand-curated risky-dependency ruleset (D4) with severity cutoffs (D5).
  - [x] 6.1 Write 2-8 focused tests for `mavenFindingScanner` + `riskyDependencyRules`
    - Limit to 2-8 highly focused tests maximum.
    - `emitsJavaVersionDetectedWithSeverityByCutoff` — `maven.compiler.source=17` → info; `=11` → medium; `=8` → medium; `=1.7` → high. (One test, parameterised over the four cutoff bands per D5.)
    - `emitsSpringVersionDetectedWithSeverityByMajor` — `spring-core` 6.x → info; 5.x → medium; 4.x → high.
    - `emitsRiskyDependencyFromRuleset` — `log4j` 1.x in deps → one `risky_dependency` finding with severity from the rule entry; ruleset is a hand-curated TypeScript array, shape `{ groupId, artifactId, versionPredicate, reason, severity }[]`.
    - `emitsDatabaseDriverDetected` — Sybase jConnect dep → one `database_driver_detected` finding with `databaseVendor` inferred.
    - `emitsMavenBuildPluginRisk` — `maven-compiler-plugin` < 3.8.0 → medium; < 3.0 → high (per-plugin rules in the same `riskyDependencyRules.ts` file).
    - `emitsDependencyVersionConflict` — same artifact declared twice in one POM → one `dependency_version_conflict` finding (no transitive walking).
    - `emitsTestBuildGap` — POM with no test deps and no surefire/failsafe → one `test_build_gap` finding.
    - `mavenScannerCallSiteAfterBuildRepoLookupTable` — `runManager.ts` calls the Maven scanner once, after `buildRepoLookupTable`.
    - Skip exhaustive permutations of every ruleset entry.
  - [x] 6.2 Create `discovery-service/src/services/findings/packFindingScanners/riskyDependencyRules.ts`
    - Hand-curated TypeScript array of shape `{ groupId, artifactId, versionPredicate, reason, severity }[]`.
    - Seed ~20-30 entries: `commons-logging` 1.0.x, `log4j` 1.x, `jackson-databind` < 2.13, `javax.servlet:*`, etc.
    - Also contains per-plugin hard-coded rules consumed by `maven_build_plugin_risk` (e.g. `maven-compiler-plugin` < 3.8.0 = medium, < 3.0 = high).
    - No JSON/YAML config — version-controlled, code-reviewed only.
  - [x] 6.3 Create `discovery-service/src/services/findings/packFindingScanners/mavenFindingScanner.ts`
    - Signature: `runMavenFindingScanner(resolverOutput, ctx: FindingEmitRunContext): Promise<void>`.
    - Source = `maven-dependency-pack`; `createdByStage = 'deterministic_maven_analysis'`.
    - Aggregation: one finding per dependency coordinate, per plugin, per POM file.
    - `detail_json` keys per spec: `pomPath`, `groupId`, `artifactId`, `version`, `scope`, `plugin`, `propertyName`, `resolvedValue`, `unresolvedValue`, `riskReason`, `migrationConcern`, `confidence`.
    - Hard-coded constants at top of file: `MAX_FINDINGS_PER_TYPE_PER_RUN = 50`, `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true`.
    - Severity cutoffs (D5):
      - Java: `>=17` info / `11-16` medium / `8` medium / `<8` high.
      - Spring Framework: `6.x` info / `5.x` medium / `4.x-or-older` high.
      - Plugins + risky deps: severity comes from the rule entry in `riskyDependencyRules.ts`.
    - Soft-fail: try/catch; scanner-level failure logs warning, attaches run warning, does NOT fail the run.
  - [x] 6.4 Wire `mavenFindingScanner` into `discovery-service/src/services/runManager.ts`
    - Call site: after `buildRepoLookupTable` (the Maven resolver lives outside the V3 pipeline).
    - Existing dependency output for representative fixtures MUST remain unchanged (regression test in Group 5).
  - [x] 6.5 Ensure Maven scanner tests pass
    - Run ONLY the 2-8 tests written in 6.1.
    - Do NOT run the entire discovery-service test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 6.1 pass.
- All 7 Maven finding_types emit per documented aggregation rules.
- `riskyDependencyRules.ts` ships as a hand-curated TS array (no JSON/YAML config).
- Severity cutoffs hard-coded per D5; per-plugin rules co-located in the same rules file.
- `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` and `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true` enforced.
- Scanner wired into `runManager.ts` after `buildRepoLookupTable`.
- No transitive dependency tree walking introduced.

---

#### Task Group 7: Frontend label map + Findings tab wiring
**Dependencies:** Task Groups 2, 3, 6 (so the full list of new finding_types is known before labels are authored).

- [x] 7.0 Add the friendly-label map for ~16 new finding_types and wire it into the existing Findings tab without changing filter logic.
  - [x] 7.1 Write 2-8 focused tests for the label map and Findings tab integration
    - Limit to 2-8 highly focused tests maximum.
    - `getFindingTypeLabelReturnsFriendlyLabelForKnownType` — `getFindingTypeLabel('raw_sql_detected')` returns the friendly label string (not the raw type).
    - `getFindingTypeLabelFallsBackToRawTypeForUnknown` — unknown finding_type returns the raw string unchanged (no crash).
    - `findingsTabRendersFriendlyLabelInFilterDropdown` — `distinctFindingTypes` rendering site shows the friendly label, not the raw string.
    - `findingsTabFiltersWorkAcrossCategoryTypeSeverityStatusForNewTypes` — existing filter logic unchanged; selecting a new finding_type filters rows correctly.
    - Skip exhaustive label-string assertions for every entry.
  - [x] 7.2 Create `frontend/src/components/Discovery/findingTypeLabels.ts`
    - Exports `FINDING_TYPE_LABELS: Record<string, string>` plus helper `getFindingTypeLabel(type: string): string`.
    - ~19 entries total: 3 Java (`raw_sql_detected`, `hardcoded_endpoint_or_url`, `legacy_java_api_usage`), 6 Spring Classic (`spring_xml_bean_wiring`, `legacy_transaction_configuration`, `security_filter_or_interceptor_detected`, `scheduled_or_batch_job_detected`, `stored_procedure_or_jdbc_usage`, `spring_classic_migration_risk`), 7 Maven (`java_version_detected`, `spring_version_detected`, `risky_dependency`, `database_driver_detected`, `maven_build_plugin_risk`, `dependency_version_conflict`, `test_build_gap`), plus the existing predecessor types already used by the Findings tab filter dropdowns.
    - Helper falls back to the raw type string if the type is not in the map (no crash, no missing-label warning).
  - [x] 7.3 Drop-in usage in `frontend/src/components/Discovery/FindingsTab.tsx`
    - Replace raw type-string rendering at the `distinctFindingTypes` site with `getFindingTypeLabel(type)`.
    - Existing filter logic (category / type / severity / status) MUST remain unchanged structurally — labels are display-only.
  - [x] 7.4 Wire labels into `FindingDetailDrawer.tsx` rendering of pack-specific `detail_json` shapes
    - File/class/method block for Java findings.
    - Endpoint method/path block for Spring Classic findings.
    - Dependency coordinate + POM path block for Maven findings.
    - Migration-concern text rendering across all three packs.
  - [x] 7.5 Ensure frontend label-map tests pass
    - Run ONLY the 2-8 tests written in 7.1.
    - Do NOT run the entire frontend test suite at this stage.

**Acceptance Criteria:**
- The 2-8 tests written in 7.1 pass.
- `findingTypeLabels.ts` exists with ~19 entries plus `getFindingTypeLabel` helper.
- `FindingsTab.tsx` `distinctFindingTypes` rendering uses friendly labels.
- `FindingDetailDrawer.tsx` renders pack-specific `detail_json` shapes cleanly.
- Existing category / type / severity / status filters work for the new finding_types — no new filter logic.

---

### Cross-pack gap review

#### Task Group 8: Cross-pack test review + strategic gap-fill
**Dependencies:** Task Groups 1-7.

- [x] 8.0 Review the per-group tests from Groups 1-7 and add up to 10 additional strategic tests only where genuine cross-pack gaps remain.
  - [x] 8.1 Review tests from Task Groups 1-7
    - Group 1: 2-8 scaffolding + redaction tests.
    - Group 2: 2-8 Java scanner tests.
    - Group 3: 2-8 Spring Classic scanner tests.
    - Group 4: 2-8 Source D extension tests.
    - Group 5: 2-8 Maven parser extension tests.
    - Group 6: 2-8 Maven scanner tests.
    - Group 7: 2-8 frontend label-map tests.
    - Expected total existing tests: approximately 14-56.
  - [x] 8.2 Analyse cross-pack coverage gaps for THIS feature only
    - Focus ONLY on gaps related to this spec's feature requirements.
    - Do NOT assess application-wide test coverage.
    - Prioritise: end-to-end discovery run emitting findings from all three packs in one run; dedupe across packs (same `runId + findingType + category + title + primaryLinkedTarget` collapses across scanners); soft-fail isolation (one scanner throwing does not break the other two); regression guard that the full V3 pipeline still produces unchanged architecture candidate output for a representative Java/Spring/Maven fixture.
  - [x] 8.3 Write up to 10 additional strategic tests maximum IF NECESSARY
    - Add a maximum of 10 new tests to fill identified critical cross-pack gaps.
    - Focus on integration points and end-to-end behaviour across the three commits.
    - Do NOT write comprehensive coverage for all per-pack scenarios already covered.
    - Skip edge cases, performance tests, and accessibility tests unless business-critical.
  - [x] 8.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature: tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, and 8.3.
    - Expected total: approximately 24-66 tests maximum.
    - Do NOT run the entire discovery-service or frontend test suites.
    - Verify critical cross-pack workflows pass.

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-66 tests total).
- Critical cross-pack workflows are covered: end-to-end emission from all three packs, cross-pack dedupe, soft-fail isolation, regression guard for unchanged architecture candidate output.
- No more than 10 additional tests added.
- Testing focused exclusively on this spec's feature requirements.
- Pre-existing broken tests listed in CLAUDE.md memory are NOT touched.

---

## Standing Constraints

These constraints apply to EVERY task group above. Implementers MUST verify before each commit.

- **No source edits during an active discovery run** (per `feedback_no_src_edits_during_run.md`): do NOT edit `discovery-service/src/**` while a discovery run is active — tsx watch auto-reloads kill in-flight runs. Each commit's build/test must happen when no discovery run is active.
- **Pre-existing broken tests listed in CLAUDE.md memory MUST NOT be touched** (`bootstrap-summary-fetching.test.ts`, `conversation-memory-edge-cases.test.ts`, `dashboardSummary*.test.ts`, `hub-bootstrap-4-task-definition.test.ts`, `chatV2-panel-integration.test.ts`, `chatV2-panel-context-and-filtering.test.ts`). Do not attempt to fix or modify them as part of this spec.
- **Existing architecture candidate output MUST remain unchanged** for representative Java/Spring/Maven fixtures. Group 5 ships a regression guard for the Maven resolver; Groups 1-3 must not perturb V3-pipeline candidate output.
- **Existing save-back flow MUST remain unchanged.** No edits to candidate review or AMS save-back code paths.
- **AppShell model cache does NOT need invalidation on finding writes** — findings live outside the architecture model per the predecessor spec.
- **Reuse predecessor infrastructure:** `FindingEmitter` (singleton `findingEmitter` + `FindingEmitRunContext`), `computeDedupeKey(runId + findingType + category + title + primaryLinkedTarget)`, AMS persistence endpoints, gateway proxies, frontend Findings tab — do NOT duplicate persistence in scanners.
- **Zero AMS schema changes.** `discovery_findings.finding_type` / `category` / `severity` / `source` / `status` are unconstrained TEXT with no DB CHECK and no Java whitelist. Adding ~16 new finding_type strings and 4 new categories requires NO Liquibase changeset and NO Java code changes in `architecture-model-service/`. Per `feedback_liquibase_immutable_changesets.md`: do NOT edit applied changeset `135-discovery-findings.sql` (not even SQL comments).
- **DTO numeric / boolean PATCH fields must be boxed.** Frontend TypeScript: `number | null` / `boolean | null` for any partial-update field. (Per `project_primitive_double_dto_overwrite.md` — defensive practice even though this spec adds no AMS DTOs.)
- **Snippet redaction MUST go through `discovery-service/src/utils/snippetRedaction.ts`** — no per-scanner ad-hoc redaction. Java and Spring Classic scanners consume this utility when populating `detail_json.evidenceSnippet`.
- **Per-scanner caps are hard-coded constants:** `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` enforced in each scanner. `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true` enforced in the Maven scanner. Do NOT extend `config_snapshot` schema for v1.
- **Risky-dependency ruleset shape:** hand-curated TypeScript array at `discovery-service/src/services/findings/packFindingScanners/riskyDependencyRules.ts`. Shape `{ groupId, artifactId, versionPredicate, reason, severity }[]`. Same file holds per-plugin rules used by `maven_build_plugin_risk`. No JSON/YAML config in v1.
- **Severity cutoffs hard-coded per D5:** Java `>=17` info / `11-16` medium / `8` medium / `<8` high; Spring Framework `6.x` info / `5.x` medium / `4.x-or-older` high. Plugins + risky deps: per-rule severity field.
- **Soft-fail at scanner level:** each scanner wrapped in try/catch — log warning, attach run warning where supported, never fail the whole discovery run unless underlying pack analysis itself fails.
- **Aggregation discipline:** Java — one finding per (file/class/method) site or per pattern site. Spring Classic — one per controller endpoint with missing detail, per XML config file/category, per stored-procedure call site, per scheduled job. Maven — one per dependency coordinate, per plugin, per POM file.
- **Out of scope (do NOT implement):** transitive Maven dependency tree walking; deep `web.xml` structured parsing (filename-presence only); `struts-config.xml` / `tiles-defs.xml`; `complex_business_logic_candidate` and `state_change_outside_service_boundary` finding types; standalone `java_evidence_gap` / `missing_contract_detail` / `endpoint_code_runtime_mismatch` finding types (folded into `evidence_gap` via gapType discriminator and Source D extension); pack-level `config_snapshot` extension for caps; LLM enrichment; database discovery packs; migration book-of-work generation; online CVE/vulnerability lookup.

---

## Execution Order

Implementers MUST follow the 3-commit boundary documented in D8. Each commit is buildable and testable on its own; merging mid-commit is not permitted.

1. **Commit 1 — Shared scaffolding + Java scanner**
   - Task Group 1 (shared `packFindingScanners/` folder + `snippetRedaction.ts` + pipeline hook)
   - Task Group 2 (`javaFindingScanner.ts` + registration)
   - Build + run tests from 1.1 and 2.1 only. Verify no active discovery run before edits.

2. **Commit 2 — Spring Classic scanner + Source D extension**
   - Task Group 3 (`springClassicFindingScanner.ts` + registration)
   - Task Group 4 (Source D `noUsage` extension in `emissionSources.ts` + `runDiscoveryRuntimeEvidence.ts`)
   - Build + run tests from 3.1 and 4.1 only. Verify no active discovery run before edits.

3. **Commit 3 — Maven resolver extension + Maven scanner + frontend labels**
   - Task Group 5 (Maven POM metadata parser extension + regression guard)
   - Task Group 6 (`mavenFindingScanner.ts` + `riskyDependencyRules.ts` + `runManager.ts` wiring)
   - Task Group 7 (frontend `findingTypeLabels.ts` + `FindingsTab.tsx` + `FindingDetailDrawer.tsx`)
   - Build + run tests from 5.1, 6.1, 7.1 only. Verify no active discovery run before discovery-service edits.

4. **Cross-pack gap review (before merge of Commit 3 to master)**
   - Task Group 8 (review + up to 10 additional strategic tests)
   - Run ONLY feature-specific tests from 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.3.
