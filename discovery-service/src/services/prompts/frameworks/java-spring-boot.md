# Spring Boot framework guidance

A `java-spring-boot` static-analysis pack has already run against this
file. Its output is injected into the prompt as a fenced JSON array.
You are here to surface what that pack CANNOT see — strictly within
the V3 meta-model enum defined in the base prompt.

## What the adapter already catches (do NOT re-emit)

- **Controllers**: `@Controller`, `@RestController` classes (as `interfaces`).
- **Endpoints**: `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`, `@PatchMapping` methods, including composed paths, `@PathVariable` / `@RequestParam` / `@RequestBody` parameter shapes, and `ResponseEntity<T>` unwrapping.
- **Services** annotated `@Service` and their non-CRUD methods (as `business_logics`).
- **Repositories**: `@Repository` classes and Spring Data interfaces extending `JpaRepository`, `CrudRepository`, `PagingAndSortingRepository`, `ReactiveCrudRepository`.
- **JPA entities**: classes annotated `@Entity`, including their `@Table` / `@Column` / `@Id` metadata (as `physical_data_entities` + `physical_data_attributes`) and fields inherited from `@MappedSuperclass` ancestors (promoted into each child).
- **Entity relationships**: `@OneToOne`, `@OneToMany`, `@ManyToOne`, `@ManyToMany` associations.
- **Validators**: classes matching `*Validator` suffix with `validate(...)` / `supports(...)` methods.
- **DTO logical entities** referenced by endpoint signatures, plus their public fields as `logical_data_attributes`s.
- **Interface-to-logical-entity links** (`interface_logical_entities`) — one candidate per (controller class, DTO type) pair that the controller references via a request body or response body. Per-interface granularity: a controller with 5 endpoints all using `OwnerDto` yields ONE `interface_logical_entities` candidate named `OwnerController → OwnerDto`.

Anything above is presumed present in the pack output. Emitting duplicates is the primary failure mode.

## Legitimate V3 gap-fill targets (for this framework)

Emit ONLY if the candidate maps to one of the 10 canonical V3 types AND
represents a concrete code artefact the pack didn't catch:

### `interfaces` candidates the pack misses
- **`@FeignClient`-annotated interfaces.** These declare an outbound HTTP client as a Java interface. Emit the interface's class name.
- **Custom Actuator endpoint classes.** `@Endpoint` / `@RestControllerEndpoint`-annotated classes expose an operational HTTP surface via concrete controller-like classes. Emit the class.
- **Spring Messaging controllers** annotated `@MessageMapping` / `@SubscribeMapping` (WebSocket / STOMP).
- **`@RepositoryRestResource`-annotated repositories** that autogenerate a REST surface.

Do NOT emit capability-level "interfaces" like "Web MVC interface",
"Spring Boot Actuator operational interface", "JPA persistence interface",
"caching interface". These are not classes — they are architectural
abstractions and do not fit the enum.

### `endpoints` candidates the pack misses
- **`@KafkaListener` / `@JmsListener` / `@RabbitListener` / `@SqsListener` / `@StreamListener` methods** — inbound message handlers. Name as `METHOD topic-or-queue-name` (e.g. `KAFKA orders.created`).
- **`@EventListener` methods** for Spring application events when they encode cross-component integration (not trivial lifecycle hooks).
- **Handlers inside custom Actuator endpoint classes** (`@ReadOperation`, `@WriteOperation`).

### `physical_data_entities` / `physical_data_attributes` / `logical_data_entity_relationships` candidates the pack misses

When you encounter `schema.sql`, `data.sql`, Flyway `db/migration/V*__*.sql`, or Liquibase `db/changelog/*.xml|.yaml` files, follow this decision procedure STRICTLY:

1. **First, inspect the pack output for matching `@Entity` classes.** Pack candidates of type `physical_data_entities` now carry a `tableName` field; pack `physical_data_attributes` candidates carry `columnName` and `entityClassName`.
2. **If a pack `physical_data_entities` has `tableName` equal to the SQL table you are reading, the table is ALREADY CAPTURED at the Java level.** Emit `[]` for that table. Do not emit `physical_data_entities: <table-name>`. Do not emit its columns as `physical_data_attributes`s — the pack already emitted the Java fields. Do not emit its FKs as `logical_data_entity_relationships`s — the pack already emitted the `@OneToMany`/`@ManyToOne` pairs.
3. **Only emit SQL-level candidates for tables with NO matching pack `tableName`.** Typical examples:
   - **Pure SQL join tables** (many-to-many) that have no `@Entity` class (e.g. `vet_specialties` where `Vet` has `@ManyToMany Set<Specialty>` but no join-row entity exists). Emit the join table as `physical_data_entities`, its two FK columns as `physical_data_attributes`s, and the two FK relationships as `logical_data_entity_relationships`s.
   - **Migration-only tables** for modules the Java layer has not yet annotated (audit tables, outbox tables, projection tables).
4. **Naming when no Java entity exists**: use the SQL table name as-written (e.g. `physical_data_entities: vet_specialties`). Use `TableName.column_name` for attributes (e.g. `physical_data_attributes: vet_specialties.vet_id`). Use `ParentTable → ChildTable` for FK relationships (e.g. `logical_data_entity_relationships: vet_specialties → vets`).

**The Java class abstraction always wins when both exist.** Reading `schema.sql` and emitting `physical_data_entities: owners` when the pack already has `physical_data_entities: Owner (tableName=owners)` is the single worst failure mode for this framework layer and will be rejected wholesale.

- **`@Embeddable` field expansions.** An `@Embeddable` class's fields get inlined into the embedding entity's columns. If the pack emitted the embedding entity but not the inlined fields, emit the fields as `physical_data_attributes`s on the parent (`Address.street` → `Owner.address_street`).

### `business_logics` candidates the pack misses
- **`@Aspect` class advice methods** (`@Before`/`@After`/`@Around`) — cross-cutting business rules like audit logging, rate limiting, authorization checks.
- **`@Scheduled` methods on business-layer classes** that encode domain logic (NOT framework housekeeping like health-check tickers).
- **`@Transactional` service methods the pack skipped due to CRUD-naming filter** but that actually encode domain workflows (e.g. `transferFunds`, `approveOrder`).
- **Validator classes not matching the `*Validator` suffix** (e.g. custom `ConstraintValidator<A,T>` implementations) — emit `validate()`/`isValid()` as `business_logics`.
- **Spring Security `AccessDecisionVoter`, `PermissionEvaluator`, `@PreAuthorize` SpEL expressions** — domain policy decisions.

### `logical_data_entities` / `logical_data_attributes` candidates the pack misses
- **Lombok-generated DTOs.** `@Data` / `@Value` / `@Builder` classes whose fields exist only at compile time. The source-reading pack doesn't see them. Emit the class as `logical_data_entities` and each Lombok-generated field as `logical_data_attributes`.
- **MapStruct mapper input/output types** referenced only from the mapper interface.

## What is OUT OF SCOPE for this framework

These are facts about the service but do NOT fit the V3 meta-model — do
NOT emit them, do NOT attempt to squat them into an ill-fitting type:

- **`application.yml` / `application.properties` configuration values.** Datasource URLs, Kafka brokers, Redis hosts, server ports, OAuth2 client IDs, feature-flag names. These are runtime config, not `physical_data_attributes`s and not `logical_data_attributes`s. The meta-model does not capture config values. Emit `[]` for a config-only file.
- **Auto-configured starter infrastructure** (spring-boot-starter-data-jpa, -actuator, -security, -redis, -amqp, -mail, -quartz, -cache, -batch). Knowing a starter is on the classpath tells you a capability exists but does not give you a concrete class/method to emit. Skip.
- **`@ConditionalOnProperty` / `@ConditionalOnClass` / `@Profile` branches that do NOT change an endpoint's RESPONSE** (e.g. wiring a different bean implementation, a metrics exporter, a cache backend). Do not speculate one `business_logics` candidate per branch — emit the underlying class/method once, annotated with the source file location. **EXCEPTION — response-shaping divergence:** when a `@ConditionalOnProperty` / `@Profile` / `@Value` branch changes the RESPONSE an endpoint returns (its status, body shape, fields, or headers differ by configuration), do NOT collapse it. The endpoint's response is then not a pure function of its input; the deterministic response-contract scanner records each such branch as a `conditional_variants[]` entry on the endpoint's `response_contract` and flags the endpoint as config-dependent. (This exception is narrowed to response-shaping config only; it does NOT mandate one `business_logics` candidate per branch for non-response config above.)
- **Kubernetes manifests, Helm charts, Dockerfiles, `.github/workflows/**`, CI scripts.** Out of scope (see `base.md` — Scope of analysis).
- **Cache manager beans, connection pool beans, `TaskScheduler` beans, `RestTemplate`/`WebClient` instance beans declared in `@Configuration`** — framework wiring. The pack already captures `@Configuration` classes themselves as beans via `@Component`. Their internal wiring methods are not `business_logics`.

## Hard check before emitting

For each candidate you consider emitting, verify ALL of:

1. It maps to one of the 10 canonical V3 types (not `Integration`, not `config`, not `infrastructure`).
2. It corresponds to a specific class / method / field / annotation / SQL object in the source — not an abstract capability.
3. Its name follows the naming conventions in `base.md`.
4. The same concept is NOT already in the pack output, either at the Java level or the SQL level (the Java level always wins — see `base.md` Abstraction-layer rule).
5. It is not a Java-specific excluded item (`@MappedSuperclass`, `@Configuration` method, framework-interface implementation — see `languages/java.md` Exclusions).

If any of those fail, drop the candidate. Emitting `[]` is preferable to emitting a wrong candidate.
