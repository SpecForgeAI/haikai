# Specification: Java/Spring Boot Extension Pack

## Goal
Implement the first concrete Extension Pack for Java/Spring Boot codebases that runs after LLM file-level analysis and deterministically sharpens candidates using tree-sitter AST parsing of Java annotations, JPA metadata, Spring MVC mappings, inter-service call patterns, database connection metadata, and lightweight Liquibase changelog cross-referencing.

## User Stories
- As an architect running discovery on a Java/Spring Boot codebase, I want deterministic annotation-derived metadata (exact table names, column types, HTTP paths, FK relationships) to sharpen and validate the LLM's candidate proposals so that my architecture model has 100% accurate structural facts.
- As a migration planner, I want inter-service HTTP call dependencies (RestTemplate, WebClient, FeignClient) and database connection metadata automatically detected so that I can map service coupling and data flow without manual code review.

## Specific Requirements

**Pack identity, registration, and activation**
- Implement the `ExtensionPack` interface with `id: 'java-spring-boot'`, `name: 'Java/Spring Boot Extension Pack'`, and `when: { language: 'Java', technology: 'Spring Boot' }`
- Auto-activates via `matchesPredicate()` when `techHints` contain a Java/Spring Boot entry; no need to be listed in `extensionPacks: string[]`
- Register via `registerPack()` in a new startup registration file (`discovery-service/src/services/extensionPacks/register.ts`) imported by the discovery service entry point
- The pack module lives at `discovery-service/src/services/extensionPacks/javaSpringBoot/index.ts`

**tree-sitter-based Java AST parsing**
- Add `tree-sitter` and `tree-sitter-java` as npm dependencies in `discovery-service/package.json`
- Create a parser instance, set the Java language, and parse each Java file's source code into a syntax tree
- Traverse AST nodes to extract annotation declarations, class declarations, method declarations, field declarations, and type references
- Fall back gracefully if tree-sitter parsing fails for a specific file (log warning, skip file, continue with remaining files)
- Filter `ExtensionPackContext.sourceFiles` to only `.java` files whose paths match `techHints` entries for Java/Spring Boot
- Exclude test files (paths containing `/src/test/` or `/test/`) from candidate extraction

**JPA entity and table detection (physical_entity candidates)**
- Detect `@Entity` classes from both `jakarta.persistence` and `javax.persistence` imports
- Extract table name from `@Table(name = "...")`, fall back to lowercased/underscored class name; also extract `schema` and `catalog` from `@Table`
- Each detected `@Entity` class produces or sharpens a `physical_entity` candidate
- Cross-reference with existing LLM-identified `physical_entity` candidates for the same file using multi-level matching (see candidate sharpening requirement)

**Field and column detection (physical_attribute candidates)**
- Parse all instance fields on `@Entity` classes; extract `@Column` attributes: `name`, `columnDefinition`, `nullable`, `length`, `unique`, `precision`, `scale`, `insertable`, `updatable`
- Detect `@Id`, `@GeneratedValue` (strategy + generator), `@Enumerated` (ORDINAL/STRING), `@Temporal` (DATE/TIME/TIMESTAMP), `@Lob`, `@Version`
- Detect Spring Data auditing annotations: `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy`
- Detect `@Embedded` fields and `@Embeddable` classes; exclude `@Transient` fields from candidate creation
- Each non-transient field produces or sharpens a `physical_attribute` candidate with all metadata in the `data` payload

**JPA relationship annotation parsing**
- Detect `@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany` on entity fields; extract `@JoinColumn(name)`, `@JoinTable` metadata, `mappedBy`, `fetch` (LAZY/EAGER), and `cascade` types
- Each JPA relationship produces an `EvidenceRelationship` with `relationshipType: 'uses_data'`, `confidence: 1.0`, and a data payload containing FK column, cardinality, fetch strategy, cascade types, and mapped-by field
- Conform the data payload to the `UsesDataRelationshipData` interface shape

**Controller and interface detection (interface + class candidates)**
- Detect `@RestController` and `@Controller` classes; extract base path from class-level `@RequestMapping`
- Each controller produces or sharpens both an `interface` candidate and a `class` candidate, cross-referenced via `data.alsoInterface: true` / `data.alsoPhysicalEntity: true`
- Detect `@ConditionalOnProperty` and record as metadata for migration awareness

**Endpoint detection (endpoint candidates)**
- Detect `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping` on methods
- Compose full HTTP path from class-level base path + method-level path; extract HTTP method, `@RequestBody` type, `@PathVariable` names, `@RequestParam` (name, required, defaultValue), and return type including `ResponseEntity<T>` unwrapping
- Endpoint candidates are children of their parent `interface` candidate via `parentCandidateId`

**DTO detection from endpoint signatures (class candidates)**
- Identify request/response parameter types that are DTOs: `@RequestBody` parameter types, `ResponseEntity<T>` generic arguments, or direct return types that are not primitive/wrapper/String/void
- Each DTO produces or sharpens a `class` candidate with `data.classType: 'dto'`

**Spring stereotype class detection (class candidates)**
- Detect `@Service`, `@Component`, `@Repository`, `@Configuration` classes as `class` candidates (NOT `service` candidates -- "Service" means a deployed runtime unit)
- Capture package name, annotations present, implemented interfaces, extended superclass
- Record Lombok annotations (`@Data`, `@Builder`, `@AllArgsConstructor`, `@NoArgsConstructor`, `@Getter`, `@Setter`, `@Slf4j`, `@RequiredArgsConstructor`) as metadata
- Skip anonymous inner classes, classes under `src/test/`, inner `*Builder` classes, and pure static-only utility classes without Spring stereotype annotations

**Method detection (method candidates)**
- Detect public methods on `@RestController`, `@Service`, `@Component`, `@Repository` classes
- Skip getters (`get*`/`is*` with no params), setters (`set*` with one param and void), `toString`, `hashCode`, `equals`, builder methods, and constructors
- Capture return type, parameter types, and annotations (`@Transactional`, `@Cacheable`, `@Async`, `@Scheduled`, `@EventListener`)
- Method candidates are children of their parent `class` candidate via `parentCandidateId`

**Spring configuration and security annotation parsing**
- Detect `@Configuration` classes and their `@Bean` methods; record bean definitions as metadata on the parent `class` candidate
- Detect `@Value("${...}")` and `@ConfigurationProperties` for configuration dependency metadata
- Detect `@PreAuthorize`, `@PostAuthorize`, `@Secured`, `@RolesAllowed` on classes and methods; capture the security expression/role string as metadata

**Inter-service dependency detection**
- Detect `RestTemplate` field declarations and method calls (`getForObject`, `getForEntity`, `postForObject`, `postForEntity`, `exchange`, `put`, `delete`); extract URL argument where identifiable
- Detect `WebClient`/`WebClient.Builder` field declarations and chained calls (`.get()`, `.post()`, `.put()`, `.delete()`, `.patch()` followed by `.uri()`); extract URI argument
- Detect `@FeignClient` interfaces; extract `name`/`value`, `url`, `path` attributes and each method as an inter-service endpoint call
- Each detected call produces an `EvidenceRelationship` with `relationshipType: 'calls'`, `confidence: 1.0`, and data payload conforming to `CallsRelationshipData`

**Database connection metadata extraction**
- Parse `application.yml`, `application.properties`, and profile variants (`application-{profile}.yml`/`.properties`) found in the scanned repo
- Extract non-sensitive metadata: database type from JDBC URL prefix, database name, host/port, and password-masked URL; record which Spring profile each datasource config belongs to
- Store as `extension_pack_analysis` evidence atoms (one per config file) and attach database metadata (`data.databaseType`, `data.databaseName`, `data.databaseUrl`) to all `physical_entity` candidates for the same repo

**Lightweight Liquibase changelog parsing**
- Parse the master changelog file (`db.changelog-master.yaml` or `db-changelog-master.xml`) to discover referenced SQL migration files
- Regex-scan each referenced SQL file for `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`, and `DROP TABLE`/`DROP COLUMN` statements
- Record changeset metadata (ID, author, SQL file path) for migration history traceability
- Cross-reference: if a table name appears in both JPA and Liquibase, boost confidence and add `data.liquibaseValidated: true`; if Liquibase shows a table with no JPA entity, flag as metadata for review
- Skip complex DDL (triggers, stored procedures, indexes) and Liquibase XML-embedded changesets; only parse raw SQL referenced via `sqlFile`

**Candidate sharpening mechanics**
- Multi-level matching priority: (1) exact file path + exact name, (2) same file path + normalized name (strip Entity/Controller/Dto/Service/Repository suffixes, case-insensitive), (3) same file path + same candidateType when only one of that type exists
- Sharpen existing candidates in-place: merge deterministic metadata into `data` (new keys added, conflicts take deterministic value), boost `confidence` to `Math.max(candidate.confidence, 0.95)`, add `data._sharpenedBy`, `data._sharpenedAt`, `data._annotationSource`
- New candidates (LLM missed): `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'java-spring-boot'`, resolve `parentCandidateId` against existing candidates
- Contradiction handling: add `data._contradiction: { reason, packFindings }` but do NOT change candidateType or reject the candidate

**New extension_pack_analysis evidence atom type**
- Add `'extension_pack_analysis'` to the `EvidenceAtomType` union in `discovery-service/src/types/evidenceAtom.ts`
- Define `ExtensionPackAnalysisData` interface: `packId`, `filePath`, `findings` array (each with `findingType`, `entityName`, `annotationType`, `metadata`, `lineNumber`), `analysisTimestamp`
- Add to `EvidenceAtomData` union; produce one `extension_pack_analysis` atom per Java file analyzed
- Add corresponding `extension_pack_analysis` type value support in `DiscoveryEvidenceEntity` in the architecture-model-service

**Pack output structure**
- The `enrich()` method returns `ExtensionPackResult` with: the full candidate array (mutated originals + new candidates), `extension_pack_analysis` evidence atoms (one per file + datasource configs), and `EvidenceRelationship` objects for JPA FK relationships and inter-service calls
- The registry merges results: candidates replace the previous set, atoms and relationships are accumulated

## Visual Design
No visual mockups provided.

## Existing Code to Leverage

**`discovery-service/src/types/extensionPack.ts` -- ExtensionPack interface**
- Defines `ExtensionPack`, `ExtensionPackPredicate`, `ExtensionPackContext`, and `ExtensionPackResult` that this pack directly implements
- `ExtensionPackContext.sourceFiles` is a `Map<string, string>` providing pre-loaded file contents so the pack does not re-read files from disk
- `ExtensionPackResult` shape dictates that `candidates` replaces the input set while `atoms` and `relationships` are accumulated

**`discovery-service/src/services/extensionPackRegistry.ts` -- registry and predicate matching**
- `registerPack()` registers the pack at startup; `matchesPredicate()` evaluates `when: { language, technology }` against `techHints` using case-insensitive comparison
- `runPacks()` calls each applicable pack's `enrich()` sequentially, merging results; on pack failure it logs the error and continues with current candidates unchanged
- `clearRegistry()` is available for test isolation

**`discovery-service/src/types/evidenceAtom.ts` -- evidence atom types and data unions**
- `EvidenceAtomType` union must be extended with `'extension_pack_analysis'`; `EvidenceAtomData` union must include the new `ExtensionPackAnalysisData` interface
- Follow the same pattern as `LlmFileAnalysisData` for defining the new data interface

**`discovery-service/src/types/relationship.ts` -- relationship types and data shapes**
- `RelationshipType` already includes `'calls'` and `'uses_data'` needed for inter-service and JPA relationship evidence
- `CallsRelationshipData` (callerSignature, calleeSignature, line) and `UsesDataRelationshipData` (accessType, dataIdentifier) are the target data payload shapes

**`discovery-service/src/services/extractors/stringPatternExtractor.ts` -- file walking and regex patterns**
- Demonstrates the directory walking, file filtering, line-by-line regex matching, and evidence atom production pattern
- The Liquibase SQL file scanning can follow this same approach: walk referenced SQL files, regex-match DDL statements, produce structured findings

## Out of Scope
- Lombok code generation resolution (record annotations as metadata only; do not synthesize generated getters/setters/toString/hashCode/equals)
- AOP aspect parsing (`@Aspect`, `@Around`, `@Before`, `@After` pointcut definitions)
- Spring Integration, Spring Batch, and Spring Cloud Stream channel/messaging definitions
- XML-based Spring configuration (`applicationContext.xml`, `beans.xml`)
- Gradle/Maven dependency analysis (`build.gradle`, `pom.xml`)
- JavaDoc extraction for candidate descriptions
- Multi-module project structure resolution (Maven/Gradle parent-child module relationships)
- Changes to the frontend candidate review UI or dashboard (new candidate types render via existing table)
- Changes to steps 1a, 1b, or the LLM file analysis step itself (this pack hooks in after them)
- Token budget optimization or streaming within the pack (the pack is deterministic, no LLM calls)
