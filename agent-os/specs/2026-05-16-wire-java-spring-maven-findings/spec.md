# Specification: Wire Java + Spring Classic + Maven Packs into Discovery Findings

## Goal
Extend the Java language pack, Spring Classic framework pack, and Maven dependency pack so each emits first-class Discovery Findings during discovery runs, surfacing migration risks, dependency concerns, and evidence gaps without touching existing candidate output or AMS schema.

## User Stories
- As a migration architect, I want Java/Spring Classic/Maven discovery to emit deterministic findings (raw SQL, hardcoded URLs, XML bean wiring, risky dependencies, etc.) so I can plan a like-for-like migration to a modern target stack.
- As a reviewer, I want each new finding rendered with a friendly label and useful detail (file/class/method, endpoint, dependency coordinate, redacted snippet) in the existing Findings tab so I can triage without reading source.

## Specific Requirements

**Three new pack-finding scanners under a shared folder**
- New folder `discovery-service/src/services/findings/packFindingScanners/` containing `javaFindingScanner.ts`, `springClassicFindingScanner.ts`, `mavenFindingScanner.ts`.
- Pattern mirrors existing `discovery-service/src/services/findings/evidenceGapScanner.ts` (input = pack output + `FindingEmitRunContext`; output = emissions via `findingEmitter`).
- Pack `LanguagePack.extract()` / `FrameworkPack.adapt()` contracts are NOT modified — scanners consume their output downstream.
- Existing candidate, evidence, and architecture-model save-back flows remain untouched.

**Wire points (do NOT add new orchestration plumbing)**
- Java + Spring Classic scanners called from `discovery-service/src/services/discoveryV3Pipeline.ts` post-Stage 2, before merge (same site as `evidenceGapScanner`).
- Maven scanner called from `discovery-service/src/services/runManager.ts` after `buildRepoLookupTable` (Maven resolver lives outside the V3 pipeline).
- Reuse predecessor `FindingEmitter` (`discovery-service/src/services/findings/FindingEmitter.ts`) and its `computeDedupeKey(runId + findingType + category + title + primaryLinkedTarget)`.

**Java pack findings (4 deterministic types + new `evidence_gap` gapTypes)**
- New finding_types: `raw_sql_detected` (medium), `hardcoded_endpoint_or_url` (medium), `legacy_java_api_usage` (low/medium).
- Extend existing predecessor `evidence_gap` type with new gapTypes carried inside `detail_json`: `java_unresolved_return_type`, `java_unresolved_import`, `java_class_no_methods`.
- Aggregate one finding per (file/class/method) or per pattern site; do NOT emit per AST node.
- Source = `java-language-pack`; createdByStage = `deterministic_java_analysis`.
- detail_json keys: `filePath`, `packageName`, `className`, `methodName`, `sourceLineStart/End`, `detectedPattern`, `evidenceSnippet` (redacted), `relatedCandidateIds`, `relatedEvidenceIds`, `confidence`.
- Link to source evidence + class/method candidate where IDs are available.

**Spring Classic pack findings (6 deterministic types + new `evidence_gap` gapTypes)**
- New finding_types: `spring_xml_bean_wiring` (medium), `legacy_transaction_configuration` (medium), `security_filter_or_interceptor_detected` (security/medium), `scheduled_or_batch_job_detected` (medium), `stored_procedure_or_jdbc_usage` (high), `spring_classic_migration_risk` (medium-high).
- Extend `evidence_gap` with new gapTypes: `endpoint_missing_request_schema`, `endpoint_partial_path_variables` (plus existing `endpoint_missing_response_schema` already shipped by predecessor).
- `endpoint_code_runtime_mismatch` is NOT introduced — handled by D2 (Source D extension below).
- Aggregate: one finding per controller endpoint with missing detail, per XML config file/category, per stored-procedure call site, per scheduled job.
- Source = `spring-classic-framework-pack`; createdByStage = `deterministic_spring_classic_analysis`.
- detail_json keys: `configFilePath`, `controllerClass`, `methodName`, `httpMethod`, `path`, `beanId`, `beanClass`, `xmlElement`, `transactionConfig`, `securityConfig`, `scheduleConfig`, `detectedPattern`, `migrationConcern`, `confidence`.

**Source D runtime-evidence extension (replaces dropped `endpoint_code_runtime_mismatch`)**
- Extend existing emission site in `discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (around lines 670–722) to also emit one info-severity finding per `noUsage` entry currently computed but not emitted.
- Reuse existing Source D builder in `discovery-service/src/services/findings/emissionSources.ts` — extend its shape rather than introducing a new builder.
- Keeps all runtime-vs-code mismatch detection in one place (D2).
- Finding_type remains under the existing runtime-source vocabulary; NO new Spring-specific type.

**Maven pack findings (7 types) + Maven resolver parser extension**
- New finding_types: `java_version_detected`, `spring_version_detected`, `risky_dependency`, `database_driver_detected`, `maven_build_plugin_risk`, `dependency_version_conflict`, `test_build_gap`.
- Extend `discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts` (or add sibling `mavenPomMetadataParser.ts`) to parse `<properties>`, `<build><plugins>`, `<parent>` version, `<dependencyManagement>` contents — needed by `java_version_detected`, `spring_version_detected`, `maven_build_plugin_risk`.
- NOT in scope: transitive dependency tree walking — conflicts flagged only where the same POM declares multiple versions or `dependencyManagement` overrides.
- Source = `maven-dependency-pack`; createdByStage = `deterministic_maven_analysis`.
- Aggregate: one finding per dependency coordinate, per plugin, per POM file.
- detail_json keys: `pomPath`, `groupId`, `artifactId`, `version`, `scope`, `plugin`, `propertyName`, `resolvedValue`, `unresolvedValue`, `riskReason`, `migrationConcern`, `confidence`.

**Risky-dependency ruleset (D4) and severity cutoffs (D5)**
- New file `discovery-service/src/services/findings/packFindingScanners/riskyDependencyRules.ts` — hand-curated TypeScript array, shape `{ groupId, artifactId, versionPredicate, reason, severity }[]`. Seed ~20-30 entries (e.g. `commons-logging` 1.0.x, `log4j` 1.x, `jackson-databind` <2.13, `javax.servlet:*`).
- Same file also holds per-plugin hard-coded rules consumed by `maven_build_plugin_risk` (e.g. `maven-compiler-plugin < 3.8.0` = medium, `< 3.0` = high).
- Java version cutoffs: `>=17` info, `11-16` medium, `8` medium, `<8` high.
- Spring Framework cutoffs: `6.x` info, `5.x` medium, `4.x-or-older` high.
- NO JSON/YAML config; rules are version-controlled and code-reviewed.

**Shared snippet-redaction utility (D6)**
- New file `discovery-service/src/utils/snippetRedaction.ts` (no existing redactor in codebase).
- Rules: truncate to 200 chars; replace quoted string literals (`"..."`, `'...'`) with `?`; mask `password=`, `pwd=`, `secret=`, `token=`, `api_key=` values (query-string and property-file forms); drop HTTP `Authorization: Basic ...` headers.
- Consumed by both Java and Spring Classic scanners when populating `detail_json.evidenceSnippet`.

**Caps + soft-fail (D7)**
- Hard-coded constants in scanner code: `MAX_FINDINGS_PER_TYPE_PER_RUN = 50`, `EMIT_INFO_FINDINGS_FOR_MAVEN_VERSION = true`.
- Do NOT extend `config_snapshot` schema for v1.
- Scanner-level failure logs a warning and emits a run warning where supported; discovery run does NOT fail.
- AppShell model cache does NOT need invalidation on finding writes (findings live outside architecture model per predecessor spec).

**Frontend label map (drop-in only)**
- New file `frontend/src/components/Discovery/findingTypeLabels.ts` exporting `FINDING_TYPE_LABELS: Record<string, string>` + `getFindingTypeLabel(type)` helper.
- ~16 new entries plus any existing types FindingsTab already references for filter dropdowns.
- Drop-in usage in `frontend/src/components/Discovery/FindingsTab.tsx` at the `distinctFindingTypes` rendering site (currently shows raw type strings).
- Existing filters (category/type/severity/status) must continue to work for new types — no new filter logic.

**Three-commit delivery sequence (D8)**
- Commit 1: shared scaffolding + `javaFindingScanner.ts` + `snippetRedaction.ts` + Java scanner tests; wired into `discoveryV3Pipeline.ts`.
- Commit 2: `springClassicFindingScanner.ts` + Source D extension in `runDiscoveryRuntimeEvidence.ts` + Spring/runtime tests.
- Commit 3: Maven metadata parser extension + `mavenFindingScanner.ts` + `riskyDependencyRules.ts` + frontend `findingTypeLabels.ts` + Maven/frontend tests; wired into `runManager.ts`.
- Each commit's build/test runs only when no discovery run is active (per `feedback_no_src_edits_during_run.md`).

## Existing Code to Leverage

**`discovery-service/src/services/findings/evidenceGapScanner.ts`**
- Closest existing pattern for a post-pack analyzer that produces findings.
- Mirror its input/output shape, run-context threading, and emission idioms for all three new scanners.
- Calling convention from `discoveryV3Pipeline.ts` is the template for wiring the Java + Spring Classic scanners.

**`discovery-service/src/services/findings/FindingEmitter.ts` + `emissionSources.ts`**
- Reuse singleton `findingEmitter`, `FindingEmitRunContext`, and `computeDedupeKey` from predecessor spec — do NOT duplicate persistence.
- Per-source builders A/B/C/D/E/F/H live in `emissionSources.ts`; Source D builder is extended in Commit 2 to cover the `noUsage` case.

**`discovery-service/src/services/runtimeEvidence/runDiscoveryRuntimeEvidence.ts` (lines ~670–722)**
- Existing soft-fail emission exemplar.
- Already computes `noUsage` per endpoint but does not emit — Commit 2 adds emission at this site.

**`discovery-service/src/services/extensionPacks/languageExtractors/java/springBeansXmlParser.ts`**
- Already produces `usedNamespaces` data consumed by Spring Classic finding types `spring_xml_bean_wiring` and `security_filter_or_interceptor_detected`.
- Read-only consumer — no edits to this parser.

**`discovery-service/src/services/dependencyResolvers/maven/MavenDependencyResolver.ts`**
- Today parses only `<dependency>` blocks + project coordinates.
- Commit 3 extends to also parse `<properties>`, `<build><plugins>`, `<parent>` version, `<dependencyManagement>` contents.
- Existing dependency output for representative fixtures must remain unchanged.

## Out of Scope
- AMS schema or Liquibase changes — `discovery_findings.finding_type`/`category`/`severity` are unconstrained TEXT with no DB CHECK and no Java whitelist; no changeset edits.
- Transitive Maven dependency tree walking — Maven resolver does not walk transitives today.
- Deep `web.xml` structured parsing — filename-presence detection only (`web.xml` exists → flag); no servlet-mapping extraction.
- `struts-config.xml`, `tiles-defs.xml` parsing — excluded (matches Spring Classic adapter's documented exclusions).
- `complex_business_logic_candidate` and `state_change_outside_service_boundary` finding types — deferred to a future LLM-enrichment / method-body-analysis spec (Java IR has no method bodies or cyclomatic complexity; deterministic detection is too noisy).
- New `java_evidence_gap` / `missing_contract_detail` / `endpoint_code_runtime_mismatch` finding_types — folded into existing `evidence_gap` via `gapType` discriminator (D1) and Source D extension (D2).
- Pack-level `config_snapshot` extension for caps — caps are hard-coded constants in scanner code (D7).
- LLM enrichment of findings — deterministic v1 only.
- Database discovery packs (Sybase/PostgreSQL), migration book-of-work generation, API behaviour baseline generation, automatic remediation, backlog item creation, online CVE/vulnerability lookup.
- Edits to any pre-existing broken tests listed in CLAUDE.md memory; AppShell model cache invalidation on finding writes.
