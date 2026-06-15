# Spec Requirements: Java/Spring Boot Extension Pack

## Initial Description
First concrete Extension Pack implementation for Java/Spring Boot codebases. Runs after the universal LLM file-level analysis (from Increment 1) and adds deterministic precision by parsing Java annotations, JPA metadata, Spring MVC mappings, and Liquibase changelogs. Sharpens LLM-identified candidates with exact metadata (table names, column types, HTTP paths, FK relationships) and catches entities the LLM may have missed. Also detects inter-service HTTP calls (RestTemplate/WebClient/FeignClient) as service dependency evidence for migration planning. Captures database connection metadata.

## Requirements Discussion

### First Round Questions

**Q1:** The initialization describes "deterministic annotation parsing" but does not specify the parsing mechanism. Given this pack runs inside the discovery-service (TypeScript/Node.js), not in a Java runtime, I am assuming we will use regex-based line-by-line parsing of Java source files (similar to how the `stringPatternExtractor.ts` works), rather than invoking a Java parser library or tree-sitter. Is regex-based parsing correct, or should we use a more sophisticated approach like tree-sitter with a Java grammar? Regex would be simpler but could miss multi-line annotations or annotations with complex arguments. Tree-sitter would be more robust but adds a native dependency.
**Answer:** tree-sitter with a Java grammar

**Q2:** The initialization says the pack "sharpens LLM-identified candidates" by matching them to deterministic findings. Concretely, how should matching work? I am assuming we match by file path + entity name -- e.g., the LLM produced a `physical_entity` candidate named "DiscoveryRunEntity" from file `DiscoveryRunEntity.java`, and the pack's `@Table` parser found `@Table(name = "discovery_run")` in the same file. The pack would then update the candidate's `data` payload with `{ tableName: "discovery_run", schema: null }` and boost its confidence. Is this file-path + name matching approach correct, or should we also support fuzzy matching (e.g., LLM called it "DiscoveryRun" but the class is "DiscoveryRunEntity")?
**Answer:** "You decide what is best. The more accurate/thorough, the better"

**Q3:** Looking at the `ExtensionPackResult` interface, the `candidates` array replaces the input candidates. When the pack "sharpens" an existing LLM candidate, should it: (a) mutate the candidate's data and confidence in-place and return the modified array, or (b) create a new candidate object with the enriched data? Also, for candidates the pack finds that the LLM missed, should these new candidates have `status: 'proposed'` and a high confidence?
**Answer:** Mutate the candidate's data and confidence in-place

**Q4:** For `@Column` parsing on JPA entity fields, the initialization lists extracting: column name, type, nullable, length, unique, precision, scale, plus `@Id`/`@GeneratedValue`, `@Enumerated`, `@Temporal`, `@Lob`. That is a lot of detail. I am assuming all of this goes into the `data: Record<string, unknown>` payload on the `physical_attribute` candidate. Should we also capture `@Version`, `@CreatedDate`/`@LastModifiedDate`, and `@Embedded`/`@Embeddable` patterns, or should we limit to what is listed?
**Answer:** Capture as much as possible

**Q5:** The initialization says Liquibase parsing is "secondary, if cheap." Looking at the actual codebase, your changelogs are raw SQL files referenced from a YAML master (`db.changelog-master.yaml` -> `sql/064-discovery-config.sql`). Parsing SQL `CREATE TABLE`/`ALTER TABLE` statements is feasible via regex but carries edge cases. Should we do a lightweight version (parse YAML master for SQL references, regex-scan for CREATE TABLE/ALTER TABLE patterns, cross-reference with JPA), skip complex DDL, or skip Liquibase entirely for v1?
**Answer:** A lightweight version

**Q6:** The initialization mentions detecting `RestTemplate`, `WebClient`, and `@FeignClient` usage. In your actual architecture-model-service codebase, I did not see any of these patterns. Should the pack still implement these detectors for general-purpose use on other Java codebases? And for the output -- should inter-service calls produce relationship evidence using the existing `EvidenceRelationship` type, or new evidence atoms?
**Answer:** Implement these detectors for general-purpose use on other Java codebases. To be crystal clear, the phase 0 asks about the git repos that should be scanned, so it's nothing to do with architecture-model-service and all about the repos/codebase the user wants to scan.

**Q7:** The initialization says to extract datasource configuration from `application.yml`/`application.properties`. Looking at the actual `application.yml`, the connection details include sensitive data (passwords). Should we extract only non-sensitive metadata? Should this metadata be attached to every Physical Entity candidate's data payload, or a single evidence atom at the run level? Should we handle Spring profiles?
**Answer:** "If it's useful, yes. You decide how it should be used."

**Q8:** The `DiscoveryConfigPayload` has an `extensionPacks: string[]` field. Should the Java/Spring Boot pack auto-activate based on `techHints` matching alone (the `when` predicate), or does it also need to be explicitly listed in `extensionPacks`?
**Answer:** Yes, techHints should help the discovery service know which available extension packs should be used during the discovery run.

**Q9:** The pack's deterministic findings are qualitatively different from LLM analysis. Should we introduce a new `EvidenceAtomType` (e.g., `'extension_pack_analysis'`) for the pack's evidence atoms, or reuse existing atom types?
**Answer:** "I am not sure how a new EvidenceAtomType (e.g., 'extension_pack_analysis') could help but if you do, add it"

**Q10:** Beyond what I have inferred, is there anything to explicitly exclude from this increment? E.g., DTO cross-referencing, Lombok annotation handling, Spring configuration class parsing, Spring Security annotation parsing, test class exclusion?
**Answer:** "You decide but be thorough, so there would need to be a good reason to exclude something"

### Existing Code to Reference

**Similar Features Identified:**
- Feature: String Pattern Extractor - Path: `discovery-service/src/services/extractors/stringPatternExtractor.ts` -- regex-based file scanning, directory walking, file filtering patterns
- Feature: Extension Pack Interface - Path: `discovery-service/src/types/extensionPack.ts` -- the exact `ExtensionPack` interface this pack implements, including `ExtensionPackContext`, `ExtensionPackResult`, `ExtensionPackPredicate`
- Feature: Extension Pack Registry - Path: `discovery-service/src/services/extensionPackRegistry.ts` -- `registerPack()`, `matchesPredicate()`, `runPacks()` functions the pack integrates with
- Feature: LLM File Analysis Step - Path: `discovery-service/src/services/llmFileAnalysisStep.ts` -- where the pack hooks in via `extensionPackRegistry.runPacks()`, the `convertResultToCandidates()` pattern for candidate creation
- Feature: Phase 1a Analyzer Pack - Path: `discovery-service/src/services/phase1aAnalyzerPack.ts` -- repo iteration, parallel sub-extraction, error handling with `failedRepos`, result aggregation
- Feature: Candidate Types - Path: `discovery-service/src/types/candidate.ts` -- `DiscoveryCandidate` interface with `data: Record<string, unknown>` payload, `CandidateType` union
- Feature: Evidence Types - Path: `discovery-service/src/types/evidenceAtom.ts` -- `EvidenceAtom` interface, `EvidenceAtomType` union, `EvidenceAtomData` union
- Feature: Relationship Types - Path: `discovery-service/src/types/relationship.ts` -- `EvidenceRelationship` interface, `RelationshipType` union
- Feature: Project Context - Path: `discovery-service/src/types/projectContext.ts` -- `DiscoveryConfigPayload` with `techHints` and `extensionPacks` fields
- Feature: Scan Plan Builder - Path: `discovery-service/src/services/scanPlanBuilder.ts` -- `ScanPlanEntry` interface showing what file metadata is available to the pack

### Follow-up Questions
No follow-up questions were needed. The user's answers were clear and decisive, with a consistent direction: be thorough, use the best available tools, and capture as much architectural metadata as possible.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements

#### FR1: Pack Identity and Registration
- Implement the `ExtensionPack` interface from `discovery-service/src/types/extensionPack.ts`
- Pack ID: `'java-spring-boot'`
- Display name: `'Java/Spring Boot Extension Pack'`
- Applicability predicate: `when: { language: 'Java', technology: 'Spring Boot' }`
- Auto-activated when `techHints` match via the existing `matchesPredicate()` logic in `extensionPackRegistry.ts` (case-insensitive language/technology comparison)
- Registered in the extension pack registry at discovery-service startup via `registerPack()`
- Runs after LLM file-level analysis, receiving the full `ExtensionPackContext` (candidates, atoms, relationships, sourceFiles, techHints)

#### FR2: Java Source Parsing via tree-sitter
- Use tree-sitter with the Java grammar (`tree-sitter-java` npm package) for robust AST-based parsing
- Parse all Java source files from the `ExtensionPackContext.sourceFiles` map whose paths match `techHints` entries with `language: 'Java'`
- tree-sitter handles multi-line annotations, nested annotation arguments, complex generics, and Lombok-generated patterns correctly -- this is the primary reason for choosing it over regex
- Build an AST for each Java file and traverse nodes to extract annotation metadata, class declarations, method declarations, field declarations, and type references
- Fall back gracefully if tree-sitter parsing fails for a specific file (log warning, skip file, continue)

#### FR3: Data Domain Extraction -- JPA Entity and Table Detection
- Detect classes annotated with `@Entity` (from `jakarta.persistence` or `javax.persistence`)
- Extract table name: prefer `@Table(name = "...")`, fall back to class name (lowercased, underscored)
- Extract schema name from `@Table(schema = "...")`
- Extract catalog name from `@Table(catalog = "...")`
- Each detected `@Entity` class produces or sharpens a `physical_entity` candidate
- Cross-reference with any LLM-identified `physical_entity` candidate for the same file to sharpen rather than duplicate

#### FR4: Data Domain Extraction -- Field and Column Detection
- For each `@Entity` class, parse all fields (instance variables)
- Extract column metadata from `@Column` annotation attributes:
  - `name` (or default: field name)
  - `columnDefinition`
  - `nullable` (default: true)
  - `length` (default: 255)
  - `unique` (default: false)
  - `precision`, `scale`
  - `insertable`, `updatable`
- Detect `@Id` annotation for primary key identification
- Detect `@GeneratedValue` with strategy (AUTO, IDENTITY, SEQUENCE, TABLE) and generator name
- Detect `@Enumerated` with value (ORDINAL, STRING)
- Detect `@Temporal` with value (DATE, TIME, TIMESTAMP)
- Detect `@Lob` for large object fields
- Detect `@Version` for optimistic locking fields
- Detect `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy` (Spring Data auditing)
- Detect `@Embedded` fields and `@Embeddable` classes (composite value objects)
- Detect `@Transient` to exclude non-persisted fields from physical attribute candidates
- Each detected field (excluding `@Transient`) produces or sharpens a `physical_attribute` candidate
- All extracted metadata stored in the candidate's `data: Record<string, unknown>` payload

#### FR5: Data Domain Extraction -- JPA Relationship Annotations
- Detect `@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany` on entity fields
- Extract `@JoinColumn(name = "...")` for FK column identification
- Extract `@JoinTable` for many-to-many join table metadata
- Detect `mappedBy` attribute for bidirectional relationship detection
- Detect `fetch` attribute (LAZY, EAGER) for coupling analysis
- Detect `cascade` attribute for data lifecycle dependency analysis
- Each detected JPA relationship produces an `EvidenceRelationship` with:
  - `relationshipType: 'uses_data'` (physical FK relationship between entities)
  - `confidence: 1.0` (deterministic from annotation)
  - Detailed data payload including: FK column name, relationship cardinality, fetch strategy, cascade types, mapped-by field

#### FR6: Application Domain Extraction -- Controller and Interface Detection
- Detect classes annotated with `@RestController` or `@Controller`
- Extract base path from class-level `@RequestMapping(value = "...")` or `@RequestMapping("...")`
- Detect `@ConditionalOnProperty` and similar conditional annotations (metadata only, for migration awareness)
- Each detected controller produces or sharpens an `interface` candidate
- Also produces or sharpens a `class` candidate for the same class (cross-referenced)

#### FR7: Application Domain Extraction -- Endpoint Detection
- Detect methods annotated with `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping`
- Compose full HTTP path: class-level base path + method-level path
- Extract HTTP method from annotation type (or `method` attribute for `@RequestMapping`)
- Extract method parameter annotations: `@RequestBody` (type), `@PathVariable` (name), `@RequestParam` (name, required, defaultValue)
- Extract return type from method signature (including generic wrapper types like `ResponseEntity<T>`)
- Each detected endpoint produces or sharpens an `endpoint` candidate
- Endpoint candidates are children of their parent `interface` candidate via `parentCandidateId`

#### FR8: Application Domain Extraction -- DTO Detection
- When parsing endpoint method signatures, identify request/response parameter types that are DTOs
- A type is considered a DTO if it is: a `@RequestBody` parameter type, a `ResponseEntity<T>` generic type argument, or a direct return type that is not a primitive/wrapper/String/void
- Each identified DTO class produces or sharpens a `class` candidate with `data.classType: 'dto'`
- DTOs are architecturally significant as they define API contract surfaces for migration planning

#### FR9: Application Domain Extraction -- Class Detection
- Detect classes with Spring stereotype annotations: `@Service`, `@Component`, `@Repository`, `@Configuration`
- These produce or sharpen `class` candidates (NOT `service` candidates -- "Service" in the meta-model means a deployed runtime unit)
- Detect `@RestController` classes (also captured as `interface`, cross-referenced via `data.alsoInterface: true`)
- Detect `@Entity` classes (also captured as `physical_entity`, cross-referenced via `data.alsoPhysicalEntity: true`)
- Apply significance filter -- skip:
  - Anonymous inner classes
  - Classes under `src/test/` directories (test classes are not architecturally significant for current-state cataloguing)
  - Builder pattern classes (inner classes named `*Builder`)
  - Pure utility classes with only static methods and no state (unless annotated with a Spring stereotype)
- Capture class metadata: package name, annotations present, implemented interfaces, extended superclass
- Detect Lombok annotations (`@Data`, `@Builder`, `@AllArgsConstructor`, `@NoArgsConstructor`, `@Getter`, `@Setter`, `@Slf4j`, `@RequiredArgsConstructor`) and record them as metadata for the class candidate (these indicate code generation patterns relevant to migration)

#### FR10: Application Domain Extraction -- Method Detection
- Detect public methods on `@RestController` classes (endpoint handlers, cross-referenced with endpoint candidates)
- Detect public methods on `@Service`, `@Component`, `@Repository` classes (business logic methods)
- Apply significance filter -- skip:
  - Getters (`get*`/`is*` with no parameters returning a field type)
  - Setters (`set*` with one parameter and void return)
  - `toString()`, `hashCode()`, `equals()` methods
  - Builder methods (methods returning the enclosing class type on `*Builder` classes)
  - Constructors (captured as class metadata instead)
- Capture method metadata: return type, parameter types, annotations present (e.g., `@Transactional`, `@Cacheable`, `@Async`, `@Scheduled`, `@EventListener`)
- Method candidates are children of their parent `class` candidate via `parentCandidateId`

#### FR11: Spring Configuration Parsing
- Detect `@Configuration` classes and their `@Bean` methods
- Each `@Bean` method produces metadata on the parent `class` candidate indicating what beans are defined
- Detect `@Value("${...}")` and `@ConfigurationProperties` to capture configuration dependency metadata
- This is relevant for migration planning: understanding what runtime configuration a service depends on

#### FR12: Spring Security Annotation Detection
- Detect `@PreAuthorize`, `@PostAuthorize`, `@Secured`, `@RolesAllowed` on classes and methods
- Record as metadata on the relevant `class` or `method` candidate
- Capture the security expression/role string (e.g., `@PreAuthorize("hasRole('ADMIN')")`)
- This is relevant for migration planning: understanding authorization requirements

#### FR13: Inter-Service Dependency Detection
- Detect `RestTemplate` usage patterns:
  - Field declarations of type `RestTemplate`
  - Method calls: `restTemplate.getForObject(...)`, `restTemplate.getForEntity(...)`, `restTemplate.postForObject(...)`, `restTemplate.postForEntity(...)`, `restTemplate.exchange(...)`, `restTemplate.put(...)`, `restTemplate.delete(...)`
  - Extract URL argument (first string parameter) where identifiable
- Detect `WebClient` usage patterns:
  - Field declarations of type `WebClient` or `WebClient.Builder`
  - Chained method calls: `.get()`, `.post()`, `.put()`, `.delete()`, `.patch()` followed by `.uri(...)`
  - Extract URI argument where identifiable
- Detect `@FeignClient` interface declarations:
  - Extract `name`/`value` attribute (service name)
  - Extract `url` attribute (service URL)
  - Extract `path` attribute (base path)
  - Each method on the Feign interface represents an inter-service endpoint call
- Each detected inter-service call produces an `EvidenceRelationship` with:
  - `relationshipType: 'calls'` (inter-service dependency)
  - `confidence: 1.0` (deterministic detection)
  - Data payload: `{ callerSignature: 'ClassName.methodName', calleeSignature: 'targetServiceUrl', line: lineNumber }` conforming to `CallsRelationshipData`
- These are general-purpose detectors -- the scanned codebase is whatever the user configures in Phase 0 (repos in discovery config), not the architecture-model-service

#### FR14: Database Connection Metadata Extraction
- Parse `application.yml` and `application.properties` files found in the scanned repo
- Extract non-sensitive datasource metadata:
  - Database URL (with password masked/redacted)
  - Database type derived from JDBC URL prefix (e.g., `jdbc:postgresql://` -> `PostgreSQL`, `jdbc:mysql://` -> `MySQL`, `jdbc:oracle:` -> `Oracle`)
  - Database name extracted from JDBC URL path
  - Database host/port extracted from JDBC URL
- Handle Spring profiles: also parse `application-{profile}.yml`/`application-{profile}.properties` files if present, recording which profile each datasource config belongs to
- Store as a single `extension_pack_analysis` evidence atom at the per-file level (one atom per config file analyzed)
- Attach database metadata to all `physical_entity` candidates for the same repo: `data.databaseType`, `data.databaseName`, `data.databaseUrl` (masked)

#### FR15: Liquibase Changelog Parsing (Lightweight)
- Parse the Liquibase master changelog file (`db.changelog-master.yaml` or `db-changelog-master.xml`) to discover referenced SQL migration files
- For each referenced SQL file, apply regex-based parsing (tree-sitter is not needed for SQL migration scripts) to detect:
  - `CREATE TABLE tablename` statements -> extract table name, cross-reference with JPA `@Entity`/`@Table` findings
  - `ALTER TABLE tablename ADD COLUMN columnname` statements -> extract table and column names
  - `ALTER TABLE tablename ADD CONSTRAINT ... FOREIGN KEY` statements -> extract FK relationships
  - `DROP TABLE`, `DROP COLUMN` statements -> capture as migration history (table/column was removed)
- Record changeset metadata: changeset ID, author, and the SQL file path (captures "when was this table/column added/modified")
- Cross-reference Liquibase findings with JPA entity annotations:
  - If a table name appears in both JPA and Liquibase, boost confidence and add `data.liquibaseValidated: true`
  - If Liquibase shows a table that has no JPA entity mapping, flag it as metadata for review (possible legacy or orphaned table)
- Do NOT parse complex DDL: skip trigger definitions, stored procedures, index creation, constraint details beyond FK identification
- Do NOT parse Liquibase XML changesets with embedded `<createTable>`, `<addColumn>` elements -- only raw SQL referenced from the master YAML/XML (matching the actual codebase pattern where SQL files are referenced via `sqlFile`)

#### FR16: Candidate Sharpening Mechanics
- **Matching strategy**: Multi-level matching with priority order:
  1. **Exact match**: Same file path AND same candidate name (case-sensitive)
  2. **Normalized match**: Same file path AND normalized name comparison (strip common suffixes like `Entity`, `Controller`, `Dto`, `Service`, `Repository`; compare case-insensitively)
  3. **Type-aware match**: Same file path AND same `candidateType` when only one candidate of that type exists in the file
- **Sharpening an existing candidate** (in-place mutation):
  - Merge the pack's deterministic metadata into the candidate's `data` payload (existing keys preserved, new keys added, conflicting keys get the deterministic value)
  - Boost `confidence` to `Math.max(candidate.confidence, 0.95)` for deterministic findings
  - Add `data._sharpenedBy: 'java-spring-boot'` marker
  - Add `data._sharpenedAt: ISO timestamp`
  - Add `data._annotationSource: { filePath, lineNumber, annotationType }` for traceability
- **Adding new candidates** (LLM missed):
  - Create new `DiscoveryCandidate` with `status: 'proposed'`, `confidence: 0.95`
  - Set `sourceClusterIds` to the source file path array
  - Set `parentCandidateId` by resolving against existing candidates (e.g., a new `physical_attribute` candidate links to the `physical_entity` candidate for the same `@Entity` class)
  - Add `data._addedBy: 'java-spring-boot'` marker
- **Contradiction handling**:
  - If the pack's deterministic analysis contradicts an LLM candidate (e.g., LLM says "physical_entity" but no `@Entity` annotation found), add `data._contradiction: { reason: '...', packFindings: {...} }` but do NOT change the candidate type or reject it
  - The LLM may have contextual insight the pack lacks (e.g., recognizing entity-like patterns without formal annotations)

#### FR17: New Evidence Atom Type for Pack Findings
- Add `'extension_pack_analysis'` to the `EvidenceAtomType` union in `discovery-service/src/types/evidenceAtom.ts`
- Define `ExtensionPackAnalysisData` interface:
  - `packId: string` (e.g., `'java-spring-boot'`)
  - `filePath: string`
  - `findings: Array<{ findingType: string, entityName: string, annotationType: string, metadata: Record<string, unknown>, lineNumber: number }>`
  - `analysisTimestamp: string`
- Add `ExtensionPackAnalysisData` to the `EvidenceAtomData` union
- The pack produces one `extension_pack_analysis` evidence atom per Java file analyzed (persisted via `ExtensionPackResult.atoms`)
- This makes pack-produced evidence queryable and distinguishable from 1a extraction and LLM analysis evidence
- Also add corresponding JPA support: new `type` value `extension_pack_analysis` in `DiscoveryEvidenceEntity` in the architecture-model-service

#### FR18: Pack Output Structure
- The pack's `enrich()` method returns an `ExtensionPackResult` containing:
  - `candidates`: The full candidate array (original LLM candidates mutated in-place + any new candidates the pack creates)
  - `atoms`: Array of `extension_pack_analysis` evidence atoms (one per Java file analyzed) + datasource config evidence atoms
  - `relationships`: Array of new `EvidenceRelationship` objects for JPA FK relationships and inter-service call dependencies
- The registry merges these results: candidates replace the previous set, atoms and relationships are accumulated

### Reusability Opportunities
- `ExtensionPack` interface from Increment 1 (`discovery-service/src/types/extensionPack.ts`) is implemented directly
- `extensionPackRegistry.ts` `registerPack()` function is called to register the pack at startup
- `ExtensionPackContext.sourceFiles` provides pre-loaded Java file contents -- no need for the pack to re-read files from disk
- The `DiscoveryCandidate` `data: Record<string, unknown>` payload is the standard enrichment target
- `EvidenceRelationship` interface with `RelationshipType` union (`'calls'`, `'uses_data'`) is reused for inter-service and JPA relationship evidence
- Scan plan builder (`scanPlanBuilder.ts`) and LLM file analysis step (`llmFileAnalysisStep.ts`) are upstream -- the pack receives their output, not their internals
- The `stringPatternExtractor.ts` file-walking and filtering patterns can inform the Liquibase file discovery logic
- tree-sitter integration pattern: `tree-sitter` and `tree-sitter-java` npm packages, standard parse/walk/query approach used in many Node.js AST tools

### Scope Boundaries

**In Scope:**
- Full `ExtensionPack` implementation registered as `'java-spring-boot'`
- tree-sitter-based Java AST parsing for all annotation and declaration extraction
- JPA entity/field/relationship annotation parsing (FR3, FR4, FR5)
- Spring MVC controller/endpoint parsing (FR6, FR7)
- DTO detection from endpoint signatures (FR8)
- Class detection with Spring stereotype annotations and Lombok metadata (FR9)
- Method detection with significance filtering (FR10)
- `@Configuration` / `@Bean` parsing (FR11)
- Spring Security annotation detection (FR12)
- Inter-service HTTP call detection: RestTemplate, WebClient, FeignClient (FR13)
- Database connection metadata from `application.yml`/`application.properties` (FR14)
- Lightweight Liquibase SQL changelog parsing with JPA cross-reference (FR15)
- Multi-level candidate sharpening with in-place mutation (FR16)
- New `extension_pack_analysis` evidence atom type (FR17)
- Test class exclusion: files under `src/test/` directories are skipped for candidate extraction
- Lombok annotation recording as metadata (not trying to resolve generated code, just recording which Lombok annotations are present)

**Out of Scope:**
- Lombok code generation resolution: We record that `@Data` is present on a class but do NOT attempt to synthesize the getters/setters/toString/hashCode/equals that Lombok generates. Rationale: Lombok-generated methods are boilerplate and not architecturally significant; the annotations themselves are more informative for migration planning.
- AOP aspect parsing: `@Aspect`, `@Around`, `@Before`, `@After` pointcut definitions are complex and rarely define first-class architectural entities. Future increment if needed.
- Spring Integration / Spring Batch / Spring Cloud Stream channel definitions: These are specialized frameworks with their own annotation vocabularies. Each would warrant a dedicated extension pack or pack module.
- XML-based Spring configuration (`applicationContext.xml`, `beans.xml`): Modern Spring Boot codebases use annotation-based configuration. XML config support is a future increment if legacy XML-configured codebases are encountered.
- Gradle/Maven dependency analysis (`build.gradle`, `pom.xml`): Dependency manifests are language-agnostic and could be a separate pack. Not Java-annotation-specific.
- JavaDoc extraction: While JavaDoc can provide descriptions for candidates, parsing it adds complexity with limited architectural value. The LLM already captures descriptive context.
- Multi-module project structure resolution: The pack processes files individually; it does not reason about Maven/Gradle multi-module parent-child relationships. Module boundaries are captured by Phase 0 repo configuration.

### Technical Considerations

#### tree-sitter Integration
- Add `tree-sitter` and `tree-sitter-java` as npm dependencies in `discovery-service/package.json`
- tree-sitter is a native dependency requiring node-gyp build (or pre-built binaries via `@aspect-build/tree-sitter-java` or similar)
- Initialization: create a parser instance, set the Java language, parse source code into a syntax tree
- Query patterns: use tree-sitter query syntax or manual node traversal to find annotation declarations, class declarations, method declarations, field declarations
- Performance: tree-sitter parsing is fast (milliseconds per file) and handles files of any size -- no concern about the `DISCOVERY_FILE_LINE_LIMIT` truncation affecting AST validity since truncated files will produce partial ASTs gracefully

#### File Filtering
- The pack receives `ExtensionPackContext.sourceFiles` which is a `Map<string, string>` of all source files from the scan plan
- The pack must filter to only Java files: file paths ending in `.java`
- The pack must further filter to files within paths matching the `techHints` entries for Java/Spring Boot
- Test files (paths containing `/src/test/` or `/test/`) are excluded from candidate extraction but may still be scanned for inter-service dependency detection patterns if they reveal service URLs
- Non-Java config files (`application.yml`, `application.properties`, `db.changelog-master.yaml`) are scanned separately using regex (not tree-sitter) for database metadata and Liquibase parsing

#### Dependency on Increment 1
- This spec assumes all Increment 1 task groups are complete:
  - Task Group 1: `CandidateType` union includes `'endpoint'`, `'class'`, `'method'`, `'physical_attribute'`
  - Task Group 5: `ExtensionPack` interface, `ExtensionPackContext`, `ExtensionPackResult`, `ExtensionPackPredicate` types exist
  - Task Group 5: `extensionPackRegistry.ts` with `registerPack()`, `getApplicablePacks()`, `runPacks()` exists
  - Task Group 8: `llmFileAnalysisStep.ts` calls `extensionPackRegistry.runPacks()` with the full context
- If Increment 1 is not complete, this pack cannot be integrated into the pipeline (but can be developed and tested in isolation using mocked context)

#### Pack Registration Mechanism
- The pack auto-activates via `techHints` predicate matching -- no need to be listed in `extensionPacks: string[]` array
- A new file (e.g., `discovery-service/src/services/extensionPacks/javaSpringBoot/index.ts`) exports the pack object
- A startup registration file (e.g., `discovery-service/src/services/extensionPacks/register.ts`) imports all available packs and calls `registerPack()` for each
- This registration file is imported by the discovery service entry point (`discovery-service/src/index.ts`)

#### Existing Codebase Patterns (from the scanned Java repo)
- JPA entities use `jakarta.persistence.*` imports (not `javax.persistence.*` -- but the pack should handle both for general-purpose use)
- Entities use Lombok (`@Getter`, `@Setter`, `@NoArgsConstructor`, `@AllArgsConstructor`, `@Builder`) -- fields are private with no explicit getter/setter methods
- `@Column` annotations specify `name` and `nullable` consistently
- Controllers use `@RestController` + `@RequestMapping` at class level + `@GetMapping`/`@PostMapping`/etc. at method level
- Controllers inject services via `@RequiredArgsConstructor` (Lombok constructor injection)
- `@ConditionalOnProperty` is used on some controllers for feature toggling
- Liquibase uses a YAML master changelog referencing SQL files: `db.changelog-master.yaml` -> `sql/*.sql`
- SQL migration files use standard PostgreSQL DDL syntax
