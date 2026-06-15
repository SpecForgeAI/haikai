# Task Breakdown: Java/Spring Boot Extension Pack

## Overview
Total Tasks: 70

This spec implements the first concrete Extension Pack for the discovery pipeline. The pack is a deterministic, tree-sitter-based Java AST parser that runs after LLM file-level analysis and sharpens candidates with exact annotation-derived metadata. It lives entirely within the `discovery-service` (TypeScript/Node.js), with a minor type addition in the `architecture-model-service` (Java/Spring Boot).

All file paths are relative to the repository root: `C:\Workspaces\SSD\architecture-store-and-diagrams`.

## Task List

### Foundation Layer

#### Task Group 1: Type Extensions and Pack Skeleton
**Dependencies:** None (assumes Increment 1 types exist)

- [x] 1.0 Complete type extensions and pack skeleton
  - [x] 1.1 Write 6 focused tests for type extensions and pack registration
    - Test that `ExtensionPackAnalysisData` interface conforms to the expected shape (`packId`, `filePath`, `findings[]`, `analysisTimestamp`)
    - Test that `EvidenceAtomType` union accepts `'extension_pack_analysis'`
    - Test that the pack object satisfies the `ExtensionPack` interface (`id`, `name`, `description`, `when`, `enrich`)
    - Test that `registerPack()` registers the java-spring-boot pack and `getApplicablePacks()` returns it when techHints contain `{ language: 'Java', technology: 'Spring Boot' }`
    - Test that `matchesPredicate()` returns false when techHints contain only non-Java entries
    - Test that `clearRegistry()` removes the pack and it is no longer applicable
  - [x] 1.2 Add `'extension_pack_analysis'` to `EvidenceAtomType` union in `discovery-service/src/types/evidenceAtom.ts`
    - Add as a new union member: `| 'extension_pack_analysis'`
  - [x] 1.3 Define `ExtensionPackAnalysisData` interface in `discovery-service/src/types/evidenceAtom.ts`
    - Fields: `packId: string`, `filePath: string`, `findings: Array<{ findingType: string, entityName: string, annotationType: string, metadata: Record<string, unknown>, lineNumber: number }>`, `analysisTimestamp: string`
    - Add to `EvidenceAtomData` union: `| ExtensionPackAnalysisData`
    - Follow the same pattern as `LlmFileAnalysisData`
  - [x] 1.4 Create pack module directory and skeleton at `discovery-service/src/services/extensionPacks/javaSpringBoot/index.ts`
    - Export a `javaSpringBootPack` object implementing `ExtensionPack`
    - `id: 'java-spring-boot'`, `name: 'Java/Spring Boot Extension Pack'`
    - `description`: concise string describing the pack's purpose
    - `when: { language: 'Java', technology: 'Spring Boot' }`
    - `enrich()`: initially a pass-through stub returning input candidates unchanged
  - [x] 1.5 Create startup registration file at `discovery-service/src/services/extensionPacks/register.ts`
    - Import `registerPack` from `extensionPackRegistry`
    - Import `javaSpringBootPack` from `./javaSpringBoot/index`
    - Call `registerPack(javaSpringBootPack)`
    - Export a function or use top-level side effect for startup registration
  - [x] 1.6 Import registration file in the discovery service entry point
    - Add import of `./services/extensionPacks/register` in the discovery service's main entry point (e.g., `discovery-service/src/index.ts`) so the pack is registered at startup
  - [x] 1.7 Add `extension_pack_analysis` type value support in `architecture-model-service`
    - Ensure `DiscoveryEvidenceEntity` in the architecture-model-service accepts `extension_pack_analysis` as a valid `type` value
    - This may require updating a validation enum or accepted values list
  - [x] 1.8 Ensure Task Group 1 tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify the pack registers correctly, types compile, and predicate matching works

**Acceptance Criteria:**
- `EvidenceAtomType` union includes `'extension_pack_analysis'`
- `ExtensionPackAnalysisData` interface is defined and included in `EvidenceAtomData` union
- Pack skeleton compiles and satisfies the `ExtensionPack` interface
- `registerPack()` succeeds and `getApplicablePacks()` returns the pack for Java/Spring Boot techHints
- Architecture-model-service accepts `extension_pack_analysis` evidence atoms
- All 6 tests pass

---

### AST Parsing Infrastructure

#### Task Group 2: tree-sitter Integration and Java AST Utilities
**Dependencies:** Task Group 1

- [x] 2.0 Complete tree-sitter integration and Java AST utilities
  - [x] 2.1 Write 8 focused tests for tree-sitter parsing and AST traversal utilities
    - Test that tree-sitter parses a simple Java class with `@Entity` annotation and produces a syntax tree with class_declaration and annotation nodes
    - Test that annotation extraction returns the correct annotation name and arguments from a multi-line annotation like `@Table(name = "users", schema = "public")`
    - Test that class declaration extraction returns class name, superclass, implemented interfaces, and all annotations
    - Test that field declaration extraction returns field name, type, and all field annotations (e.g., `@Column`, `@Id`)
    - Test that method declaration extraction returns method name, return type, parameter types, and annotations
    - Test that annotation argument parsing correctly extracts key-value pairs from `@Column(name = "user_id", nullable = false, length = 255)`
    - Test that file filtering correctly includes `.java` files matching techHints and excludes non-Java files
    - Test that test file exclusion correctly skips files with paths containing `/src/test/` or `/test/`
  - [x] 2.2 Add `tree-sitter` and `tree-sitter-java` as npm dependencies in `discovery-service/package.json`
    - Run `npm install tree-sitter tree-sitter-java` (or equivalent prebuild package if available)
    - Verify the native dependency builds or prebuild binaries install correctly
  - [x] 2.3 Create Java parser module at `discovery-service/src/services/extensionPacks/javaSpringBoot/javaParser.ts`
    - Initialize tree-sitter with the Java language grammar
    - Export `parseJavaFile(sourceCode: string): Tree | null` function that parses source code and returns the syntax tree, or null on failure (with warning logged)
    - Export `disposeParser(): void` for cleanup if needed
  - [x] 2.4 Create AST traversal utilities at `discovery-service/src/services/extensionPacks/javaSpringBoot/astUtils.ts`
    - `extractAnnotations(node: SyntaxNode): AnnotationInfo[]` -- extracts all annotations from a node, including argument key-value pairs
    - `extractClassDeclarations(tree: Tree): ClassInfo[]` -- finds all class/interface declarations with their annotations, superclass, interfaces, package
    - `extractFieldDeclarations(classNode: SyntaxNode): FieldInfo[]` -- finds all instance fields with their types and annotations
    - `extractMethodDeclarations(classNode: SyntaxNode): MethodInfo[]` -- finds all method declarations with return type, parameters, and annotations
    - `extractAnnotationArgument(annotation: AnnotationInfo, key: string): string | undefined` -- gets a specific argument value from an annotation
    - `extractImports(tree: Tree): string[]` -- extracts all import statements
    - Define TypeScript interfaces: `AnnotationInfo`, `ClassInfo`, `FieldInfo`, `MethodInfo` with all relevant properties
  - [x] 2.5 Create file filtering utility at `discovery-service/src/services/extensionPacks/javaSpringBoot/fileFilter.ts`
    - `filterJavaFiles(sourceFiles: Map<string, string>, techHints: Record<string, { language: string; technology: string }>): Map<string, string>` -- filters to `.java` files matching Java/Spring Boot techHints
    - `isTestFile(filePath: string): boolean` -- returns true if path contains `/src/test/` or `/test/`
    - `filterConfigFiles(sourceFiles: Map<string, string>): Map<string, string>` -- filters to `application.yml`, `application.properties`, `application-*.yml`, `application-*.properties`, and Liquibase changelog files
  - [x] 2.6 Ensure Task Group 2 tests pass
    - Run ONLY the 8 tests written in 2.1
    - Verify tree-sitter parses Java source correctly
    - Verify AST traversal utilities extract expected metadata

**Acceptance Criteria:**
- tree-sitter and tree-sitter-java dependencies installed and functional
- Parser correctly handles well-formed Java files and fails gracefully on malformed input
- AST utilities correctly extract annotations (including multi-line, nested arguments), class declarations, field declarations, method declarations, and imports
- File filtering correctly includes/excludes based on extension, techHints, and test path patterns
- All 8 tests pass

---

### Data Domain Extractors

#### Task Group 3: JPA Entity, Field, and Relationship Extraction
**Dependencies:** Task Group 2

- [x] 3.0 Complete JPA entity, field, and relationship extraction
  - [x] 3.1 Write 8 focused tests for JPA extraction
    - Test that a class with `@Entity` and `@Table(name = "discovery_run")` produces a `physical_entity` candidate with correct `data.tableName`, `data.schema`, `data.catalog`
    - Test that a class with `@Entity` but no `@Table` annotation produces a `physical_entity` candidate with table name derived from class name (lowercased, underscored, e.g., `DiscoveryRunEntity` -> `discovery_run_entity`)
    - Test that fields with `@Column(name = "run_id", nullable = false, length = 36)` produce `physical_attribute` candidates with all column metadata in data payload
    - Test that `@Id` + `@GeneratedValue(strategy = GenerationType.IDENTITY)` fields produce candidates with `data.isPrimaryKey: true`, `data.generationStrategy: 'IDENTITY'`
    - Test that `@Transient` fields are excluded from candidate creation
    - Test that `@Embedded` fields and `@Embeddable` classes are detected and recorded as metadata
    - Test that `@ManyToOne` + `@JoinColumn(name = "config_id")` produces an `EvidenceRelationship` with `relationshipType: 'uses_data'`, `confidence: 1.0`, and correct FK column in data payload
    - Test that `@OneToMany(mappedBy = "config", fetch = FetchType.LAZY, cascade = CascadeType.ALL)` produces a relationship with cardinality, fetch strategy, cascade types, and mappedBy field
  - [x] 3.2 Create JPA entity extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/jpaEntityExtractor.ts`
    - Detect `@Entity` annotations (check imports for both `jakarta.persistence` and `javax.persistence`)
    - Extract table name from `@Table(name)`, fall back to lowercased/underscored class name
    - Extract `schema` and `catalog` from `@Table` annotation arguments
    - Produce `physical_entity` candidate data: `{ tableName, schema, catalog, entityClassName, packageName }`
    - Detect both `jakarta.persistence` and `javax.persistence` import prefixes
  - [x] 3.3 Create JPA field extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/jpaFieldExtractor.ts`
    - Parse all instance fields on `@Entity` classes
    - Extract `@Column` attributes: `name`, `columnDefinition`, `nullable`, `length`, `unique`, `precision`, `scale`, `insertable`, `updatable`
    - Detect `@Id`, `@GeneratedValue` (strategy + generator), `@Enumerated` (ORDINAL/STRING), `@Temporal` (DATE/TIME/TIMESTAMP), `@Lob`, `@Version`
    - Detect Spring Data auditing: `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy`, `@LastModifiedBy`
    - Detect `@Embedded` fields and `@Embeddable` classes
    - Exclude `@Transient` fields from candidate creation
    - Produce `physical_attribute` candidate data with all extracted metadata
  - [x] 3.4 Create JPA relationship extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/jpaRelationshipExtractor.ts`
    - Detect `@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany` on entity fields
    - Extract `@JoinColumn(name)` for FK column identification
    - Extract `@JoinTable` metadata for many-to-many relationships
    - Extract `mappedBy`, `fetch` (LAZY/EAGER), and `cascade` types from relationship annotations
    - Produce `EvidenceRelationship` with `relationshipType: 'uses_data'`, `confidence: 1.0`
    - Data payload conforms to `UsesDataRelationshipData` shape plus additional FK/cardinality metadata in an extended data structure
  - [x] 3.5 Ensure Task Group 3 tests pass
    - Run ONLY the 8 tests written in 3.1
    - Verify entity, field, and relationship extraction produces correct candidates and relationships

**Acceptance Criteria:**
- `@Entity` classes correctly produce `physical_entity` candidates with table name, schema, catalog
- Fields on entity classes produce `physical_attribute` candidates with full `@Column` metadata
- `@Id`, `@GeneratedValue`, `@Enumerated`, `@Temporal`, `@Lob`, `@Version`, auditing annotations all captured
- `@Transient` fields excluded; `@Embedded`/`@Embeddable` detected
- JPA relationships produce `EvidenceRelationship` objects with correct type, confidence, and data payload
- All 8 tests pass

---

### Application Domain Extractors

#### Task Group 4: Controller, Endpoint, and DTO Extraction
**Dependencies:** Task Group 2

- [x] 4.0 Complete controller, endpoint, and DTO extraction
  - [x] 4.1 Write 7 focused tests for controller, endpoint, and DTO extraction
    - Test that a class with `@RestController` and `@RequestMapping("/api/discovery")` produces both an `interface` candidate (with `data.basePath: '/api/discovery'`) and a `class` candidate (with `data.alsoInterface: true`)
    - Test that a method with `@GetMapping("/{id}")` on a controller with base path `/api/runs` produces an `endpoint` candidate with `data.httpMethod: 'GET'`, `data.fullPath: '/api/runs/{id}'`
    - Test that `@PostMapping` with `@RequestBody CreateRunDto body` extracts the request body type as a DTO reference
    - Test that `@RequestParam(name = "status", required = false, defaultValue = "active")` is captured in endpoint candidate data
    - Test that `@PathVariable("id")` parameters are captured
    - Test that a method returning `ResponseEntity<RunDto>` produces a DTO candidate for `RunDto` with `data.classType: 'dto'`
    - Test that `@ConditionalOnProperty` on a controller class is recorded as metadata
  - [x] 4.2 Create controller extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/controllerExtractor.ts`
    - Detect `@RestController` and `@Controller` annotations
    - Extract base path from class-level `@RequestMapping`
    - Detect `@ConditionalOnProperty` and record as metadata
    - Produce both an `interface` candidate and a `class` candidate per controller
    - Cross-reference via `data.alsoInterface: true` on the class candidate and `data.alsoClass: true` on the interface candidate
  - [x] 4.3 Create endpoint extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/endpointExtractor.ts`
    - Detect `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping`, `@RequestMapping` on methods
    - Compose full HTTP path from class-level base path + method-level path
    - Extract HTTP method from annotation type (or `method` attribute for generic `@RequestMapping`)
    - Extract `@RequestBody` parameter type, `@PathVariable` names, `@RequestParam` (name, required, defaultValue)
    - Extract return type including `ResponseEntity<T>` unwrapping
    - Produce `endpoint` candidates as children of their parent `interface` candidate via `parentCandidateId`
  - [x] 4.4 Create DTO extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/dtoExtractor.ts`
    - Identify DTO types from endpoint signatures: `@RequestBody` parameter types, `ResponseEntity<T>` generic arguments, direct return types that are not primitive/wrapper/String/void
    - Maintain a set of detected DTO type names to avoid duplicate candidates
    - Produce `class` candidates with `data.classType: 'dto'` for each unique DTO type
    - Primitives/wrappers to exclude: `void`, `Void`, `String`, `Integer`, `Long`, `Boolean`, `Double`, `Float`, `Short`, `Byte`, `Character`, `int`, `long`, `boolean`, `double`, `float`, `short`, `byte`, `char`, `Object`, `ResponseEntity` (without generic)
  - [x] 4.5 Ensure Task Group 4 tests pass
    - Run ONLY the 7 tests written in 4.1
    - Verify controllers, endpoints, and DTOs are correctly extracted

**Acceptance Criteria:**
- `@RestController`/`@Controller` classes produce both `interface` and `class` candidates
- Endpoints compose full HTTP paths correctly and capture all parameter metadata
- DTO types identified from request/response signatures produce `class` candidates with `data.classType: 'dto'`
- `parentCandidateId` correctly links endpoint candidates to their interface parent
- All 7 tests pass

---

#### Task Group 5: Class, Method, and Spring Stereotype Extraction
**Dependencies:** Task Group 2

- [x] 5.0 Complete class, method, and Spring stereotype extraction
  - [x] 5.1 Write 7 focused tests for class, method, and stereotype extraction
    - Test that a class with `@Service` produces a `class` candidate with `data.stereotype: 'Service'`, `data.packageName`, and annotations list
    - Test that a class with `@Repository` produces a `class` candidate (NOT a `service` candidate)
    - Test that Lombok annotations (`@Data`, `@Builder`, `@Slf4j`, `@RequiredArgsConstructor`) are recorded in `data.lombokAnnotations` array
    - Test that a public method `createRun(CreateRunDto dto)` on a `@Service` class produces a `method` candidate with return type, parameter types, and `parentCandidateId` linking to the class
    - Test that getters (`getId()`), setters (`setId(String)`), `toString()`, `hashCode()`, `equals()` are skipped
    - Test that classes under `src/test/` paths are excluded from class candidate creation
    - Test that `@Configuration` + `@Bean` methods produce metadata on the class candidate listing bean definitions
  - [x] 5.2 Create class extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/classExtractor.ts`
    - Detect Spring stereotypes: `@Service`, `@Component`, `@Repository`, `@Configuration`
    - Cross-reference: `@RestController` classes get `data.alsoInterface: true`, `@Entity` classes get `data.alsoPhysicalEntity: true`
    - Apply significance filters: skip anonymous inner classes, test classes, `*Builder` inner classes, pure static-only utility classes without Spring stereotypes
    - Capture: package name, all annotations, implemented interfaces, extended superclass
    - Detect and record Lombok annotations: `@Data`, `@Builder`, `@AllArgsConstructor`, `@NoArgsConstructor`, `@Getter`, `@Setter`, `@Slf4j`, `@RequiredArgsConstructor`
    - Produce `class` candidates with all metadata
  - [x] 5.3 Create method extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/methodExtractor.ts`
    - Detect public methods on `@RestController`, `@Service`, `@Component`, `@Repository` classes
    - Apply significance filters: skip getters (`get*`/`is*` with no params), setters (`set*` with one param and void return), `toString`, `hashCode`, `equals`, builder methods, constructors
    - Capture: return type, parameter types and names, annotations (`@Transactional`, `@Cacheable`, `@Async`, `@Scheduled`, `@EventListener`)
    - Produce `method` candidates as children of their parent `class` candidate via `parentCandidateId`
  - [x] 5.4 Create Spring configuration extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/configExtractor.ts`
    - Detect `@Configuration` classes and their `@Bean` methods
    - Record bean definitions as metadata on the parent `class` candidate: `data.beanDefinitions: Array<{ methodName, returnType, beanName }>`
    - Detect `@Value("${...}")` field declarations and record as `data.configDependencies: string[]`
    - Detect `@ConfigurationProperties(prefix = "...")` and record as `data.configurationPropertiesPrefix`
  - [x] 5.5 Create Spring Security annotation extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/securityExtractor.ts`
    - Detect `@PreAuthorize`, `@PostAuthorize`, `@Secured`, `@RolesAllowed` on classes and methods
    - Capture the security expression or role string (e.g., `hasRole('ADMIN')`, `ROLE_USER`)
    - Record as metadata: `data.securityAnnotations: Array<{ annotation, expression, target: 'class' | 'method' }>`
  - [x] 5.6 Ensure Task Group 5 tests pass
    - Run ONLY the 7 tests written in 5.1
    - Verify classes, methods, configuration, and security annotations are correctly extracted

**Acceptance Criteria:**
- Spring stereotype classes produce `class` candidates (NOT `service` candidates)
- Lombok annotations recorded as metadata
- Method significance filter correctly skips boilerplate methods
- `@Configuration` + `@Bean` methods captured as bean definition metadata
- `@Value` and `@ConfigurationProperties` captured as configuration dependencies
- Security annotations captured with expressions
- `parentCandidateId` correctly links methods to their parent class
- All 7 tests pass

---

### External Dependency and Configuration Extractors

#### Task Group 6: Inter-Service Dependency and Database Metadata Extraction
**Dependencies:** Task Group 2

- [x] 6.0 Complete inter-service dependency and database metadata extraction
  - [x] 6.1 Write 7 focused tests for inter-service and database extraction
    - Test that a field `private RestTemplate restTemplate` plus a call `restTemplate.getForObject("http://user-service/api/users", ...)` produces an `EvidenceRelationship` with `relationshipType: 'calls'`, `confidence: 1.0`, and `data.calleeSignature` containing the URL
    - Test that a `WebClient` usage with `.get().uri("http://order-service/api/orders")` produces a `calls` relationship
    - Test that a `@FeignClient(name = "inventory-service", url = "http://inventory-service", path = "/api/inventory")` interface produces relationships for each method, with correct service name and path
    - Test that `application.yml` with `spring.datasource.url: jdbc:postgresql://localhost:5432/archdb` extracts `databaseType: 'PostgreSQL'`, `databaseName: 'archdb'`, `databaseHost: 'localhost'`, `databasePort: '5432'`
    - Test that `application.properties` with `spring.datasource.url=jdbc:mysql://dbhost:3306/mydb` extracts correct MySQL metadata
    - Test that password values in datasource URLs are masked/redacted in the output
    - Test that Spring profile-specific config files (`application-dev.yml`) are parsed and the profile name is recorded
  - [x] 6.2 Create inter-service dependency extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/interServiceExtractor.ts`
    - Detect `RestTemplate` field declarations and method calls (`getForObject`, `getForEntity`, `postForObject`, `postForEntity`, `exchange`, `put`, `delete`); extract URL argument where identifiable from string literals
    - Detect `WebClient`/`WebClient.Builder` field declarations and chained calls (`.get()`, `.post()`, `.put()`, `.delete()`, `.patch()` followed by `.uri()`); extract URI argument from string literals
    - Detect `@FeignClient` interfaces; extract `name`/`value`, `url`, `path` attributes; produce a relationship for each method on the interface
    - Produce `EvidenceRelationship` objects with `relationshipType: 'calls'`, `confidence: 1.0`, data conforming to `CallsRelationshipData` shape: `{ callerSignature: 'ClassName.methodName', calleeSignature: 'targetURL', line }`
  - [x] 6.3 Create database metadata extractor at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/databaseMetadataExtractor.ts`
    - Parse `application.yml` files using a YAML parser (e.g., `js-yaml` -- add as dependency if not already present)
    - Parse `application.properties` files using line-by-line key=value parsing
    - Extract `spring.datasource.url` (or `spring.datasource.jdbc-url`) and derive: database type from JDBC prefix, database name from URL path, host/port from URL, password-masked URL
    - Handle Spring profiles: parse `application-{profile}.yml`/`.properties`, record profile name alongside metadata
    - Produce `extension_pack_analysis` evidence atoms (one per config file)
    - Expose extracted database metadata to be attached to `physical_entity` candidates: `data.databaseType`, `data.databaseName`, `data.databaseUrl`
  - [x] 6.4 Ensure Task Group 6 tests pass
    - Run ONLY the 7 tests written in 6.1
    - Verify inter-service dependencies and database metadata are correctly extracted

**Acceptance Criteria:**
- RestTemplate, WebClient, and FeignClient usage patterns produce `calls` relationships
- URLs extracted where identifiable from string literals
- Database metadata correctly parsed from both YAML and properties formats
- JDBC URL prefix correctly maps to database type (PostgreSQL, MySQL, Oracle, etc.)
- Passwords/credentials redacted in output
- Spring profiles handled correctly
- All 7 tests pass

---

### Liquibase Integration

#### Task Group 7: Lightweight Liquibase Changelog Parsing
**Dependencies:** Task Group 3 (needs JPA entity data for cross-referencing)

- [x] 7.0 Complete lightweight Liquibase changelog parsing
  - [x] 7.1 Write 5 focused tests for Liquibase parsing and JPA cross-referencing
    - Test that a `db.changelog-master.yaml` referencing `sql/064-discovery-config.sql` via `sqlFile` entries correctly discovers the SQL file paths
    - Test that a SQL file containing `CREATE TABLE discovery_config (...)` extracts table name `discovery_config`
    - Test that `ALTER TABLE discovery_run ADD COLUMN status VARCHAR(50)` extracts both table name and column name
    - Test that `ALTER TABLE discovery_evidence ADD CONSTRAINT fk_evidence_run FOREIGN KEY (run_id) REFERENCES discovery_run(id)` extracts the FK relationship
    - Test that cross-referencing adds `data.liquibaseValidated: true` to a `physical_entity` candidate whose table name matches a Liquibase CREATE TABLE, and flags Liquibase-only tables as metadata for review
  - [x] 7.2 Create Liquibase parser at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/liquibaseExtractor.ts`
    - Parse YAML master changelog (`db.changelog-master.yaml`) to discover referenced SQL file paths (via `sqlFile` entries)
    - Parse XML master changelog (`db-changelog-master.xml`) to discover referenced SQL file paths (via `<sqlFile>` elements) as a fallback
    - For each referenced SQL file found in `sourceFiles`, apply regex-based parsing:
      - `CREATE TABLE <tableName>` -- extract table name
      - `ALTER TABLE <tableName> ADD COLUMN <columnName> <type>` -- extract table and column name
      - `ALTER TABLE <tableName> ADD CONSTRAINT ... FOREIGN KEY (<col>) REFERENCES <targetTable>(<targetCol>)` -- extract FK relationship
      - `DROP TABLE <tableName>`, `DROP COLUMN` -- capture as migration history
    - Record changeset metadata: changeset ID, author, SQL file path
    - Skip triggers, stored procedures, indexes, and Liquibase XML-embedded changesets
  - [x] 7.3 Create Liquibase cross-reference utility at `discovery-service/src/services/extensionPacks/javaSpringBoot/extractors/liquibaseCrossRef.ts`
    - Accept JPA-extracted `physical_entity` candidates and Liquibase-extracted table names
    - If a table name appears in both JPA and Liquibase: add `data.liquibaseValidated: true` and `data.liquibaseChangesets: Array<{ changesetId, author, sqlFile }>` to the candidate
    - If Liquibase shows a table with no JPA entity mapping: produce a metadata finding flagging it as a potential legacy/orphaned table for review
    - Use case-insensitive table name comparison
  - [x] 7.4 Ensure Task Group 7 tests pass
    - Run ONLY the 5 tests written in 7.1
    - Verify Liquibase parsing and cross-referencing produce correct results

**Acceptance Criteria:**
- YAML master changelog correctly parsed to discover SQL file references
- SQL files correctly parsed for CREATE TABLE, ALTER TABLE, FK constraints
- Changeset metadata (ID, author, file path) captured
- Cross-reference correctly boosts JPA entity candidates with `data.liquibaseValidated: true`
- Tables in Liquibase but not in JPA flagged for review
- Complex DDL (triggers, procedures, indexes) correctly skipped
- All 5 tests pass

---

### Candidate Sharpening Engine

#### Task Group 8: Candidate Matching and Sharpening Logic
**Dependencies:** Task Groups 3, 4, 5 (needs all extractors to produce findings)

- [x] 8.0 Complete candidate matching and sharpening logic
  - [x] 8.1 Write 8 focused tests for candidate matching and sharpening
    - Test exact match: LLM candidate named "DiscoveryRunEntity" at file path `src/.../DiscoveryRunEntity.java` is matched by the pack's finding for the same file and name
    - Test normalized match: LLM candidate named "DiscoveryRun" is matched to the pack's finding "DiscoveryRunEntity" after stripping the `Entity` suffix (case-insensitive)
    - Test type-aware match: when only one `physical_entity` candidate exists for a file, it matches the pack's `physical_entity` finding for the same file
    - Test that sharpening in-place adds deterministic metadata (`data.tableName`, `data.schema`) without removing existing LLM-provided data keys
    - Test that confidence is boosted to `Math.max(original, 0.95)` and markers `data._sharpenedBy`, `data._sharpenedAt`, `data._annotationSource` are added
    - Test that a new candidate (LLM missed the entity) is created with `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'java-spring-boot'`, and correct `parentCandidateId`
    - Test contradiction handling: when pack finds no `@Entity` annotation on a file the LLM labeled as `physical_entity`, `data._contradiction` is added but `candidateType` is NOT changed
    - Test that `parentCandidateId` is correctly resolved for new `physical_attribute` candidates linking to their parent `physical_entity` candidate
  - [x] 8.2 Create candidate matcher at `discovery-service/src/services/extensionPacks/javaSpringBoot/candidateMatcher.ts`
    - Implement multi-level matching priority:
      1. Exact match: same file path + same candidate name (case-sensitive)
      2. Normalized match: same file path + normalized name (strip `Entity`, `Controller`, `Dto`, `Service`, `Repository`, `Impl` suffixes; case-insensitive comparison)
      3. Type-aware match: same file path + same `candidateType` when only one candidate of that type exists in the file
    - Return the matched candidate or `null` if no match found
    - Export helper: `normalizeName(name: string): string` for suffix stripping
  - [x] 8.3 Create candidate sharpener at `discovery-service/src/services/extensionPacks/javaSpringBoot/candidateSharpener.ts`
    - `sharpenCandidate(candidate: DiscoveryCandidate, packFindings: Record<string, unknown>, filePath: string, lineNumber: number, annotationType: string): void` -- mutates candidate in-place
      - Merge `packFindings` into `candidate.data` (new keys added, conflicts take deterministic value)
      - Set `candidate.confidence = Math.max(candidate.confidence, 0.95)`
      - Set `candidate.data._sharpenedBy = 'java-spring-boot'`
      - Set `candidate.data._sharpenedAt = new Date().toISOString()`
      - Set `candidate.data._annotationSource = { filePath, lineNumber, annotationType }`
    - `createNewCandidate(type: CandidateType, name: string, filePath: string, data: Record<string, unknown>, runId: string, parentCandidateId?: string): DiscoveryCandidate` -- creates a new candidate the LLM missed
      - `status: 'proposed'`, `confidence: 0.95`, `data._addedBy: 'java-spring-boot'`
      - `sourceClusterIds: [filePath]`
    - `addContradiction(candidate: DiscoveryCandidate, reason: string, packFindings: Record<string, unknown>): void` -- adds `data._contradiction` without changing type
  - [x] 8.4 Create parent candidate resolver at `discovery-service/src/services/extensionPacks/javaSpringBoot/parentResolver.ts`
    - Resolve `parentCandidateId` for new candidates by matching against existing candidates:
      - New `physical_attribute` -> parent `physical_entity` in the same file
      - New `endpoint` -> parent `interface` in the same file
      - New `method` -> parent `class` in the same file
    - Accept the full candidate array and return the resolved parent candidate ID or undefined
  - [x] 8.5 Ensure Task Group 8 tests pass
    - Run ONLY the 8 tests written in 8.1
    - Verify matching, sharpening, new candidate creation, and contradiction handling all work correctly

**Acceptance Criteria:**
- Multi-level matching correctly identifies the best match with priority order
- In-place sharpening merges metadata, boosts confidence, and adds traceability markers
- New candidates created with correct status, confidence, and `_addedBy` marker
- Contradiction handling adds `_contradiction` without changing candidate type
- Parent candidate resolution correctly links child candidates to their parents
- All 8 tests pass

---

### Orchestration Layer

#### Task Group 9: Pack Orchestration (enrich method)
**Dependencies:** Task Groups 3, 4, 5, 6, 7, 8

- [x] 9.0 Complete pack orchestration
  - [x] 9.1 Write 6 focused tests for the end-to-end enrich method
    - Test that `enrich()` with an empty `sourceFiles` map returns candidates unchanged (no-op)
    - Test that `enrich()` with a single `@Entity` Java file sharpens the matching LLM candidate and produces an `extension_pack_analysis` evidence atom
    - Test that `enrich()` with a `@RestController` file produces sharpened interface, class, and endpoint candidates
    - Test that `enrich()` adds new candidates when the LLM missed entities, and the new candidates have `data._addedBy: 'java-spring-boot'`
    - Test that `enrich()` returns the correct `ExtensionPackResult` shape: candidates array (mutated originals + new), atoms array (one per file + config files), relationships array (JPA + inter-service)
    - Test that if tree-sitter fails on one file, the pack logs a warning and continues processing remaining files (graceful degradation)
  - [x] 9.2 Implement the full `enrich()` method in `discovery-service/src/services/extensionPacks/javaSpringBoot/index.ts`
    - Step 1: Filter source files to Java files matching techHints (via `fileFilter.ts`)
    - Step 2: Filter config files (application.yml/properties, Liquibase changelogs)
    - Step 3: For each Java file (excluding test files):
      - Parse with tree-sitter (`javaParser.ts`)
      - Run JPA entity extractor, JPA field extractor, JPA relationship extractor
      - Run controller extractor, endpoint extractor, DTO extractor
      - Run class extractor, method extractor
      - Run config extractor, security extractor
      - Collect all findings per file
    - Step 4: Run inter-service dependency extractor across all Java files
    - Step 5: Run database metadata extractor on config files
    - Step 6: Run Liquibase extractor and cross-referencing
    - Step 7: Apply candidate sharpening (match + sharpen or create new)
    - Step 8: Attach database metadata to `physical_entity` candidates
    - Step 9: Build `extension_pack_analysis` evidence atoms (one per file analyzed)
    - Step 10: Return `ExtensionPackResult` with candidates, atoms, relationships
  - [x] 9.3 Wire error handling for graceful degradation
    - Wrap each file's processing in a try-catch
    - Log warning on per-file failure and continue with remaining files
    - Log pack-level summary: files processed, candidates sharpened, new candidates added, relationships produced
  - [x] 9.4 Ensure Task Group 9 tests pass
    - Run ONLY the 6 tests written in 9.1
    - Verify end-to-end pack behavior

**Acceptance Criteria:**
- `enrich()` correctly orchestrates all extractors and returns the full `ExtensionPackResult`
- Candidates are sharpened in-place where matches exist, new candidates added where LLM missed
- One `extension_pack_analysis` evidence atom produced per analyzed Java file
- JPA relationships and inter-service calls produce `EvidenceRelationship` objects
- Graceful degradation: per-file failures do not abort the entire pack
- All 6 tests pass

---

### Test Gap Analysis

#### Task Group 10: Test Review and Gap Fill
**Dependencies:** Task Groups 1-9

- [x] 10.0 Review existing tests and fill critical gaps only
  - [x] 10.1 Review tests from Task Groups 1-9
    - Review the 6 tests from Task Group 1 (types and registration)
    - Review the 8 tests from Task Group 2 (tree-sitter and AST utilities)
    - Review the 8 tests from Task Group 3 (JPA extraction)
    - Review the 7 tests from Task Group 4 (controller/endpoint/DTO extraction)
    - Review the 7 tests from Task Group 5 (class/method/stereotype extraction)
    - Review the 7 tests from Task Group 6 (inter-service/database extraction)
    - Review the 5 tests from Task Group 7 (Liquibase parsing)
    - Review the 8 tests from Task Group 8 (candidate matching/sharpening)
    - Review the 6 tests from Task Group 9 (orchestration)
    - Total existing tests: approximately 62 tests
  - [x] 10.2 Analyze test coverage gaps for this feature only
    - Identify critical integration points that lack test coverage
    - Focus on end-to-end workflows: LLM candidates -> pack sharpening -> output verification
    - Check for gaps in multi-extractor interaction (e.g., controller extraction feeding endpoint extraction feeding DTO extraction)
    - Check for gaps in edge cases that could cause runtime failures (e.g., malformed annotations, empty files, files with only imports)
  - [x] 10.3 Write up to 10 additional strategic tests to fill gaps
    - Integration test: full enrich() call with a realistic multi-class Java codebase (entity + controller + service) verifying the complete candidate set
    - Integration test: enrich() with both LLM candidates and pack findings, verifying that sharpening and new candidate creation interact correctly
    - Edge case: Java file with no annotations produces no candidates and no errors
    - Edge case: annotation with empty arguments (e.g., `@Entity()`, `@Column()`) uses defaults
    - Edge case: class with multiple Spring stereotypes (e.g., `@Service @Transactional`) is handled correctly
    - Edge case: FeignClient interface with no methods produces a relationship for the service but no per-method relationships
    - Edge case: Liquibase master changelog referencing non-existent SQL files (files not in sourceFiles map) skips gracefully
    - Verify `extension_pack_analysis` atoms have correct `packId`, `filePath`, `findings` structure
    - Verify database metadata is attached to all `physical_entity` candidates (not just ones in the same file as the config)
    - Verify the pack runs as no-op when techHints do not include Java/Spring Boot
  - [x] 10.4 Run all feature-specific tests
    - Run ALL tests related to this spec (Task Groups 1-9 tests plus gap-fill tests)
    - Expected total: approximately 72 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All approximately 72 feature-specific tests pass
- Critical integration workflows for this feature are covered
- No more than 10 additional tests added
- Testing focused exclusively on the Java/Spring Boot Extension Pack feature

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Extensions and Pack Skeleton** -- establishes the foundation types, pack skeleton, and registration mechanism. No dependencies.
2. **Task Group 2: tree-sitter Integration and AST Utilities** -- creates the parsing infrastructure all extractors depend on.
3. **Task Groups 3, 4, 5, 6 (parallel)** -- the four extractor groups are independent of each other and depend only on Task Group 2. They can be developed in parallel:
   - Task Group 3: JPA Entity, Field, and Relationship Extraction
   - Task Group 4: Controller, Endpoint, and DTO Extraction
   - Task Group 5: Class, Method, and Spring Stereotype Extraction
   - Task Group 6: Inter-Service Dependency and Database Metadata Extraction
4. **Task Group 7: Liquibase Changelog Parsing** -- depends on Task Group 3 (needs JPA entity data for cross-referencing).
5. **Task Group 8: Candidate Matching and Sharpening Logic** -- depends on Task Groups 3, 4, 5 (needs extractor output to sharpen against).
6. **Task Group 9: Pack Orchestration** -- depends on all extractor and sharpening groups (3-8). Wires everything together in the `enrich()` method.
7. **Task Group 10: Test Review and Gap Fill** -- depends on all previous groups. Reviews and fills critical test gaps.

```
Group 1 (Foundation)
    |
Group 2 (tree-sitter)
    |
    +--- Group 3 (JPA) ---+--- Group 7 (Liquibase) ---+
    |                      |                            |
    +--- Group 4 (Controllers) ----+                    |
    |                              |                    |
    +--- Group 5 (Classes) -------+--- Group 8 (Sharpening)
    |                              |         |
    +--- Group 6 (Inter-service) --+         |
                                             |
                                     Group 9 (Orchestration)
                                             |
                                     Group 10 (Test Gaps)
```

## File Structure Summary

All new files created by this spec:

```
discovery-service/src/services/extensionPacks/
  register.ts                          (Task 1.5)
  javaSpringBoot/
    index.ts                           (Task 1.4, 9.2)
    javaParser.ts                      (Task 2.3)
    astUtils.ts                        (Task 2.4)
    fileFilter.ts                      (Task 2.5)
    candidateMatcher.ts                (Task 8.2)
    candidateSharpener.ts              (Task 8.3)
    parentResolver.ts                  (Task 8.4)
    extractors/
      jpaEntityExtractor.ts            (Task 3.2)
      jpaFieldExtractor.ts             (Task 3.3)
      jpaRelationshipExtractor.ts      (Task 3.4)
      controllerExtractor.ts           (Task 4.2)
      endpointExtractor.ts             (Task 4.3)
      dtoExtractor.ts                  (Task 4.4)
      classExtractor.ts                (Task 5.2)
      methodExtractor.ts               (Task 5.3)
      configExtractor.ts               (Task 5.4)
      securityExtractor.ts             (Task 5.5)
      interServiceExtractor.ts         (Task 6.2)
      databaseMetadataExtractor.ts     (Task 6.3)
      liquibaseExtractor.ts            (Task 7.2)
      liquibaseCrossRef.ts             (Task 7.3)
```

Modified files:

```
discovery-service/src/types/evidenceAtom.ts        (Tasks 1.2, 1.3)
discovery-service/src/index.ts                     (Task 1.6)
discovery-service/package.json                     (Task 2.2)
architecture-model-service/.../DiscoveryEvidenceEntity.java  (Task 1.7)
```
