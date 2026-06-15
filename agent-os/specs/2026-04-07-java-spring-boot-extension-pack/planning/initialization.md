# Initialization

## Spec Name
java-spring-boot-extension-pack

## Summary
First concrete Extension Pack implementation for Java/Spring Boot codebases. Runs after the universal LLM file-level analysis (from Increment 1) and adds deterministic precision by parsing Java annotations, JPA metadata, Spring MVC mappings, and Liquibase changelogs. Sharpens LLM-identified candidates with exact metadata (table names, column types, HTTP paths, FK relationships) and catches entities the LLM may have missed. Also detects inter-service HTTP calls (RestTemplate/WebClient/FeignClient) as service dependency evidence for migration planning. Captures database connection metadata.

## Context

### Product context
This tool is a full Product Delivery Lifecycle (PDLC) tool. Discovery feeds not just current state architecture documentation but also target state architecture design and implementation planning for legacy migration projects. The Java/Spring Boot Extension Pack must capture evidence that supports both current state cataloguing AND migration decision-making (e.g., inter-service dependencies, data flow contracts, coupling points).

### Dependency
This spec depends on Increment 1 (Extension Pack Framework & LLM File Analysis Pipeline). It assumes:
- The Extension Pack registry and framework exist
- LLM file-level analysis runs first, producing typed candidates for each source file
- Extension packs hook in AFTER LLM analysis to sharpen/enrich results
- The scan plan from 1a identifies which files are architecturally interesting
- techHints in the discovery config indicate Java/Spring Boot for applicable paths

### What the LLM provides (that the pack sharpens)
The universal LLM file-level analysis will identify entities like "this looks like a JPA entity" or "this is a REST controller with endpoints." But the LLM output may:
- Miss exact table names from `@Table(name = "...")` annotations
- Miss column details: type, nullable, length, unique constraints from `@Column`
- Miss FK relationship details from `@ManyToOne`, `@OneToMany`, `@JoinColumn`
- Approximate HTTP paths instead of getting exact `@RequestMapping` + `@GetMapping` composition
- Miss method-level annotations like `@Transactional`, `@Cacheable`
- Miss inter-service HTTP calls buried in service classes

The pack provides 100% accurate metadata from deterministic annotation parsing.

### Architecture meta-model entity types this pack targets
From the existing meta-model schema:
- **Physical Entity** (`physical_data_entities`): Database tables, JPA entities. Fields: name, description, physical_type, database_name, tags
- **Physical Attribute** (`physical_data_attributes`): Table columns, entity fields. Fields: name, description, attribute_type, is_primary_key, is_nullable, tags
- **Interface** (`interfaces`): REST controllers, API contracts. Fields: name, description, interface_type, spec_link, tags
- **Endpoint** (`endpoints`): Individual HTTP endpoints. Fields: name, description, http_method, path, tags
- **Class** (`classes`): Java classes with architectural significance. Fields: name, description, class_type, package_name, tags
- **Method** (`methods`): Significant methods on classes. Fields: name, description, method_type, return_type, tags

### Important: "Service" in the meta-model
"Service" means a deployed runtime unit on a server/port (e.g., architecture-model-service on port 8080), NOT a Spring `@Service` annotated class. The pack must NOT map `@Service` annotations to Service candidates. Spring `@Service` classes are just classes with a DI stereotype -- they become Class candidates.

## Existing State
- `discovery-service/src/types/analyzerPack.ts` -- AnalyzerPack interface with AnalyzerResult
- `discovery-service/src/services/analyzerRegistry.ts` -- analyzer pack registry
- `discovery-service/src/services/phase1aAnalyzerPack.ts` -- existing 1a extraction pack (reference implementation)
- `discovery-service/src/services/extractors/` -- existing extractors (ctags, file structure, string patterns)
- `discovery-service/src/types/candidate.ts` -- CandidateType union (to be extended in Increment 1 with class, method, endpoint, physical_attribute)
- `discovery-service/src/services/gatewayClient.ts` -- gateway HTTP client for LLM calls
- Discovery config `techHints` already captures: `{ path: "model-logic-service", language: "Java", technology: "Spring Boot" }`
- Discovery config `techHints` also captures: `{ path: "model-logic-service", language: "XML/SQL", technology: "Liquibase" }`

## What This Spec Must Deliver

### 1. Java/Spring Boot Extension Pack implementation
- Implements the AnalyzerPack interface (or Extension Pack interface from Increment 1)
- Registered in the pack registry with applicability predicate: `when: { language: "Java", technology: "Spring Boot" }`
- Auto-selected when techHints match
- Runs after LLM file-level analysis on Java source files within applicable paths

### 2. Data Domain extraction (deterministic)
- **@Entity / @Table detection** -> Physical Entity candidates
  - Extract exact table name from `@Table(name = "...")` or default (class name)
  - Extract schema name if specified
  - Capture database_name from datasource configuration metadata
- **Field / @Column detection** -> Physical Attribute candidates
  - Extract column name from `@Column(name = "...")` or default (field name)
  - Extract column type, nullable, length, unique, precision, scale
  - Detect `@Id` and `@GeneratedValue` for primary key identification
  - Detect `@Enumerated`, `@Temporal`, `@Lob` for type specialisation
- **JPA relationship annotations** -> relationship evidence
  - `@ManyToOne`, `@OneToMany`, `@OneToOne`, `@ManyToMany`
  - `@JoinColumn(name = "...")` for FK column identification
  - Mapped-by references for bidirectional relationship detection
  - These produce relationship evidence between Physical Entity candidates
- **Liquibase changelog parsing** (secondary source, if cheap)
  - Parse XML/YAML/SQL changelogs for CREATE TABLE, ADD COLUMN, ADD FOREIGN KEY
  - Cross-reference with JPA entity annotations for validation
  - Capture migration history metadata (when was this table/column added?)

### 3. Application Domain extraction (deterministic)
- **@RestController / @Controller detection** -> Interface candidates
  - Extract base path from class-level `@RequestMapping`
  - Capture controller name and description
- **@GetMapping / @PostMapping / @PutMapping / @DeleteMapping / @PatchMapping / @RequestMapping detection** -> Endpoint candidates
  - Extract exact HTTP method and path (compose class-level + method-level paths)
  - Extract request/response types from method signature (parameter types, return type)
  - Detect `@RequestBody`, `@PathVariable`, `@RequestParam` annotations for parameter metadata
  - **DTO detection**: Request/response parameter types that are DTOs become Class candidates (these are architecturally significant as they define API contracts for migration)
- **Class detection** -> Class candidates (filtered for architectural significance)
  - Classes with Spring annotations: `@Service`, `@Component`, `@Repository`, `@Configuration` -> Class candidates (NOT Service candidates -- see note above)
  - `@RestController` classes (already captured as Interface, but also a Class)
  - `@Entity` classes (already captured as Physical Entity, cross-referenced)
  - DTO/request/response classes referenced by endpoints
  - Significance filter: skip anonymous classes, inner test classes, builders, pure utility classes with only static methods
- **Method detection** -> Method candidates (filtered)
  - Public methods on `@RestController` classes (endpoint handlers -- already captured as Endpoints, cross-referenced)
  - Public methods on `@Service` / `@Component` classes (business logic methods)
  - Significance filter: skip getters, setters, toString, hashCode, equals, builder methods

### 4. Inter-service dependency detection (migration-critical evidence)
- Detect `RestTemplate` usage: `restTemplate.getForObject("http://...")`, `restTemplate.exchange(...)`, etc.
- Detect `WebClient` usage: `webClient.get().uri("http://...")`, etc.
- Detect `@FeignClient(name = "...", url = "...")` interfaces
- Each detected inter-service call produces relationship evidence: "this class/method calls external service X at URL Y"
- This is critical for migration dependency mapping and data movement analysis

### 5. Database connection metadata
- Extract datasource configuration from `application.yml` / `application.properties`
  - Database URL, database name, database type (PostgreSQL, MySQL, Oracle, etc.)
  - Attach as metadata to Physical Entity candidates: "these entities live in database X"

### 6. Sharpening LLM candidates
- For each LLM-identified candidate that the pack can match to a deterministic finding:
  - Update the candidate's data payload with exact annotation-derived metadata
  - Increase confidence score (deterministic = high confidence)
  - Add structured metadata: annotation source, file path, line number
- For entities the pack finds that the LLM missed:
  - Create new candidates with high confidence
  - Link them to parent candidates where applicable
- For LLM candidates that the pack's deterministic analysis contradicts:
  - Flag for review (don't auto-reject -- the LLM may have contextual insight the pack lacks)

## Key Design Decisions
- Pack is ADDITIVE -- sharpens and enriches LLM output, does not replace it
- Spring `@Service`/`@Component` -> Class candidates, NOT Service candidates
- DTOs referenced by endpoints ARE architecturally significant (API contract surface for migration)
- Method filtering: skip getters/setters/toString/hashCode/equals/builders
- Class filtering: skip anonymous classes, inner test classes, pure static utility classes
- Inter-service HTTP calls captured as relationship evidence (not candidates)
- All output uses the same candidate/evidence schema as the universal pipeline
- Liquibase parsing is secondary/optional -- included if implementation cost is low
