Feature name: Wire Java + Spring Classic + Maven Packs into Discovery Findings/Evidence

Feature summary:
Extend the existing Java language pack, Spring Classic framework pack, and Maven dependency pack so they emit first-class Discovery Findings/Evidence during codebase discovery.

This builds on the new DiscoveryFinding platform capability (spec 2026-05-16-discovery-findings-first-class). The goal is to make code discovery output more migration-useful by surfacing risks, ambiguities, evidence gaps, framework-specific concerns, dependency risks, and implementation clues that may not belong directly in the architecture model.

Primary goal:
For Java 8 / Spring Classic / Maven legacy services, discovery should produce:
- Current State Architecture candidates (unchanged)
- Discovery Evidence (unchanged)
- Discovery Findings (NEW emission from these 3 packs)

These findings should help future migration workflows generate an accurate hierarchical book of work for like-for-like migration to a modern target state (e.g. Java 21 / Spring Boot / GCP).

V1 scope:
- Wire Java language pack into DiscoveryFinding emission
- Wire Spring Classic framework pack into DiscoveryFinding emission
- Wire Maven dependency pack into DiscoveryFinding emission
- Reuse the generic FindingEmitter from the predecessor spec
- Emit findings from DETERMINISTIC pack analysis first (LLM-enrichment compatible shape but no LLM dependency in v1)
- Link findings to evidence/candidates/relationships/source locations where available
- Keep existing architecture candidate generation unchanged
- Keep existing candidate review/save-back flow unchanged
- Add tests for emitted findings

Out of scope:
- Database discovery packs (Sybase/PostgreSQL)
- Migration book-of-work generation
- API Behaviour Baseline generation
- Automatic remediation
- Creating backlog items directly from findings
- Rewriting the Java/Spring/Maven discovery packs themselves
- Full semantic business-rule extraction
- Full call-graph completeness guarantees
- Spring Boot-specific findings unless already detected by shared Spring logic
- Online vulnerability lookup (use local rules only)

Services touched:
- discovery-service (main work)
- architecture-model-service only if minor DTO/client adjustments needed
- frontend only if existing findings UI needs label-map updates for new finding types
- gateway: no expected changes

Assumptions:
- DiscoveryFinding, DiscoveryFindingLink, FindingEmitter, and Findings Review UI already exist from spec 2026-05-16-discovery-findings-first-class
- Existing Java/Spring/Maven packs already produce candidates/evidence/intermediate analysis data
- This spec ADDS findings on top, doesn't replace existing output

---

**Part 1 — Java language pack findings:**

1. `raw_sql_detected` (migration_risk / medium / source=java-language-pack / createdByStage=deterministic_java_analysis) — JDBC Statement/PreparedStatement, inline SQL strings, SQL string construction, native query. detail_json: filePath, className, methodName, redacted/truncated SQL snippet, queryType, referenced tables if inferred, confidence, sourceLine. Links: source evidence, class/method candidate, physical data entity candidate if inferred.

2. `hardcoded_endpoint_or_url` (migration_risk / medium / source=java-language-pack) — hardcoded http(s):// strings, service endpoints in constants, RestTemplate/HTTP literal URLs, legacy internal hostnames. detail_json: filePath, class/method, redacted URL, client library, likely dependency/integration name, confidence. Links: source evidence, service/interface/integration candidate.

3. `legacy_java_api_usage` (migration_risk / low or medium / source=java-language-pack) — deprecated Java APIs, old date/time, reflection-heavy, serialization APIs, custom classloaders, SecurityManager, javax.* → jakarta concerns. detail_json: API/package/class, file/class/method, migration concern, confidence.

4. `complex_business_logic_candidate` (business_logic / medium / source=java-language-pack) — large methods/classes, high branch count, business-rule conditionals, money/risk/eligibility/status/pricing/limits calcs, many domain entity reads/writes in one method. detail_json: file/class/method, indicators, related entity names, confidence, explanation. Links: method/class candidate, evidence atoms.

5. `state_change_outside_service_boundary` (migration_risk / medium / source=java-language-pack) — mutations in utility/helper classes, direct DB writes in controllers, file-system writes, message-send + DB-update in same method. detail_json: file/class/method, mutation indicators, target resource, confidence.

6. `java_evidence_gap` (evidence_gap / low or medium / source=java-language-pack) — parser couldn't resolve method return type, unresolved imports, uninterpreted annotations, candidate created without method/source detail, class candidate with no methods where expected. detail_json: filePath, candidate type, missing detail, reason.

**Part 2 — Spring Classic framework pack findings:**

1. `missing_contract_detail` (evidence_gap / medium / source=spring-classic-framework-pack / createdByStage=deterministic_spring_classic_analysis) — @RequestMapping endpoint with unresolved request/response schema, unknown response type, unknown body type, undetected status codes, partial path variables/query params. detail_json: controllerClass, methodName, HTTP method, path, missing fields, request type, response type, confidence. Links: endpoint candidate, interface candidate, controller/method evidence.

2. `spring_xml_bean_wiring` (migration_risk / medium / source=spring-classic-framework-pack) — applicationContext.xml or similar, bean definitions, property/constructor injection, import/resource refs. detail_json: XML file path, bean count, key bean ids/classes, imported XML files, migration concern summary, confidence. Links: evidence atoms, application component/service candidates.

3. `legacy_transaction_configuration` (migration_risk / medium / source=spring-classic-framework-pack) — XML transaction manager, tx:advice/AOP transaction config, @Transactional, programmatic transaction templates. detail_json: config source, transaction manager bean, affected classes/methods, propagation/isolation hints, confidence.

4. `security_filter_or_interceptor_detected` (security / medium / source=spring-classic-framework-pack) — Spring Security XML, servlet filters, HandlerInterceptor, custom auth filters, security context usage. detail_json: file/class/config path, filter/interceptor name, protected path patterns, migration concern, confidence.

5. `scheduled_or_batch_job_detected` (migration_risk / medium / source=spring-classic-framework-pack) — @Scheduled, Quartz, Spring batch, cron in XML/properties, timer/task executor beans. detail_json: job name/class/method, schedule/cron, input/output resources, related entities, confidence. Links: service/component candidates, data movement candidates, evidence.

6. `stored_procedure_or_jdbc_usage` (business_logic / **high** / source=spring-classic-framework-pack) — SimpleJdbcCall, StoredProcedure, CallableStatement, jdbcTemplate.call, procedure/function names in SQL strings. detail_json: class/method, procedure name, input/output params, related tables, migration implication, confidence. Links: method/class evidence, business logic candidate, physical data entity candidate.

7. `spring_classic_migration_risk` (migration_risk / medium-high / source=spring-classic-framework-pack) — web.xml DispatcherServlet, ContextLoaderListener, old servlet version, XML-heavy config, legacy Spring version signal from Maven, removed/deprecated Spring APIs. detail_json: detected pattern, file/config path, migration concern, recommended follow-up, confidence.

8. `endpoint_code_runtime_mismatch` (runtime_usage / medium / source=spring-classic-framework-pack) — Spring endpoint candidate exists but no runtime evidence, runtime path observed but Spring endpoint not discovered, method/path mismatch. detail_json: code endpoint, runtime endpoint, usage count, status distribution, confidence.

**Part 3 — Maven dependency pack findings:**

1. `java_version_detected` (dependency / info-medium by age / source=maven-dependency-pack) — maven.compiler.source/target, release property, sourceCompatibility, plugin compiler config. detail_json: detected version, source of version, pom path, migration target relevance, confidence.

2. `spring_version_detected` (dependency / medium-high by age / source=maven-dependency-pack) — spring-core/spring-webmvc/spring-context deps, dependency management properties, parent POM versions. detail_json: detected Spring modules, versions, pom path, Spring Classic indicator, migration concern, confidence.

3. `risky_dependency` (dependency / medium-high / source=maven-dependency-pack) — old logging/Apache Commons/Jackson/Gson/servlet/test framework versions, libraries incompatible with Java 21, KNOWN legacy via LOCAL RULES (no online CVE lookup). detail_json: groupId, artifactId, version, reason, scope, pom path, confidence.

4. `database_driver_detected` (dependency / medium / source=maven-dependency-pack) — Sybase JDBC driver/jConnect, PostgreSQL, Oracle, SQL Server, DB2 drivers. detail_json: driver dependency, version, database vendor inferred, pom path, migration relevance, confidence. Links: data store candidate if available, evidence.

5. `maven_build_plugin_risk` (migration_risk / medium / source=maven-dependency-pack) — old maven-compiler-plugin, old surefire/failsafe, custom plugins, generated source plugins, old dependency plugin config, unusual packaging. detail_json: plugin group/artifact/version, config summary, risk reason, pom path, confidence.

6. `dependency_version_conflict` (dependency / medium / source=maven-dependency-pack) — same artifact multiple versions, dependency management override, transitive conflict if tree available, property unresolved. detail_json: dependency coordinates, versions seen, source POMs, unresolved properties, confidence.

7. `test_build_gap` (testability / medium / source=maven-dependency-pack) — no test deps, no surefire/failsafe, no integration test profile, skipped tests property, old JUnit only. detail_json: pom path, test deps found, plugins found, migration implication, confidence.

**Severity defaults (consistent across packs):**
- info: descriptive observations (Java version detected, runtime usage confirmation)
- low: minor evidence gaps, weak migration concerns
- medium: ambiguous contracts, old framework config, raw SQL, build/plugin concerns, missing test signals
- high: stored procedure/JDBC business logic, serious dependency migration risk, major unresolved endpoint/data contract issues
- critical: reserve for proven migration blockers; avoid overuse in v1

**Link policy:** each finding should link to at least one supporting object where possible. Preferred: discovery_evidence (source/config), discovery_candidate (candidate-related), discovery_relationship (relationship ambiguity), discovery_decision_task (unresolved decisions), architecture_element (saved/known elements only). If no link possible, detail_json must include enough source context (filePath, className, dependency coordinate, XML path).

**detail_json conventions:**
- Java findings: filePath, packageName, className, methodName, sourceLineStart/End, detectedPattern, evidenceSnippet (truncated/redacted), relatedCandidateIds, relatedEvidenceIds
- Spring Classic findings: configFilePath, controllerClass, methodName, httpMethod, path, beanId, beanClass, xmlElement, transactionConfig, securityConfig, scheduleConfig, detectedPattern, migrationConcern
- Maven findings: pomPath, groupId, artifactId, version, scope, plugin, propertyName, resolvedValue, unresolvedValue, riskReason, migrationConcern

**Implementation requirements:**
- USE existing FindingEmitter (do NOT duplicate persistence in each pack)
- Prefer DETERMINISTIC evidence (Java IR, Spring extraction, Maven POM/dep analysis) — no LLM dependency in v1
- Preserve existing candidate output (small refactor OK only if needed to access evidence/candidate IDs for linking)
- AGGREGATE to avoid noise: one finding per dependency, per controller endpoint with missing detail, per raw SQL method/class, per XML config file or category, per stored procedure usage site
- DEDUPE via generic finding deduplication. Suggested key per finding type: runId + findingType + source + (filePath/configPath/pomPath) + (className/methodName) + (dependency coordinate) + (endpoint method/path)
- Pack-level config (if discovery-service has pack defaults): lowConfidenceThreshold, maxFindingsPerType, emitInfoFindings (default true for Maven version), suppressKnownNoisyPatterns
- Soft-fail: pack finding emission failure → log warning + run warning if pattern supports it; do NOT fail the whole discovery run (unless underlying pack analysis itself fails)

**Frontend (small changes only — Findings UI already exists):**
- New finding types should render cleanly without code changes where possible
- Add friendly labels to label map (19 new entries — see raw idea for full list)
- detail_json rendering for file/class/method, endpoint method/path, dependency coordinates, XML config paths, migration concern text
- Existing filters (category/type/severity/status) should work for new types — verify

**Gateway:** no expected changes.

**Testing requirements:**
Discovery-service tests (30 total in raw idea):
- Java pack: 6 tests (raw_sql, hardcoded URL, legacy API, complex business logic, evidence gap, plus one for link to evidence/candidate)
- Spring Classic pack: 7 tests (missing_contract, xml_bean_wiring, transaction config, security filter, scheduled/batch, stored procedure/JDBC, spring_classic_migration_risk)
- Maven pack: 7 tests (java_version, spring_version, risky_dependency, database_driver, build_plugin_risk, version_conflict, test_build_gap)
- Common: 7 tests (FindingEmitter usage, run/project/architecture IDs, source/createdByStage, category/severity/confidence/title/summary, dedupe, soft-fail, existing candidate output unchanged)

AMS: no new tests expected (existing generic finding persistence covers).
Frontend: only if label maps used — 3 tests (renders new types, detail drawer for dependency + source-code, filtering across categories).

**Acceptance criteria (12):** Java/Spring/Maven packs each emit findings, persisted via generic FindingEmitter, linked to evidence/candidates where available, detail_json useful in UI, existing flows unchanged, save-back unchanged, findings reviewable in Findings tab, reviewer actions work, discovery output richer for Java 8/Spring Classic/Maven legacy services, output suitable for future migration planning.

**Implementation notes:**
- Pack-specific by design
- Do NOT broaden to DB discovery
- Do NOT add migration planning logic
- Deterministic in v1
- Prefer high-value findings over exhaustive low-value noise
- Use detail_json for pack-specific payloads (no new columns)
- Include source file paths and dependency coordinates wherever possible
- Be careful not to leak sensitive literals — truncate/redact evidence snippets
- If a finding can be represented as a candidate, keep the candidate path unchanged AND emit the finding as supporting migration intelligence
- This spec helps assess whether richer discovery output is good enough to support accurate hierarchical migration book-of-work generation
