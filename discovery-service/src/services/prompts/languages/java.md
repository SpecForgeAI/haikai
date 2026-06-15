# Java language guidance

## Idioms to recognize

- **Annotations carry most of the semantic weight.** Class-level annotations such as `@Service`, `@RestController`, `@Controller`, `@Component`, `@Repository`, `@Configuration`, `@Entity`, `@Aspect`, `@Scheduled`, `@KafkaListener`, `@JmsListener`, `@FeignClient`, `@RabbitListener`, and `@MessageMapping` directly identify architectural roles. Method-level annotations (`@Transactional`, `@Async`, `@EventListener`, `@Scheduled`) often mark behaviour the pack may have missed.
- **Package structure is a hint, not a guarantee.** Packages ending in `.service`, `.controller`, `.repository`, `.domain`, `.dto` are suggestive but always require a concrete marker (annotation, base class, suffix) before emitting.
- **Interface + implementation pairs.** A `FooService` interface with a `FooServiceImpl` class is one logical service. Prefer the interface name as the canonical candidate name; do not double-count both.
- **Inner classes and nested enums** can be first-class architectural elements (request DTOs, state enums, static nested handlers). Emit them separately when they clearly encode a distinct role.
- **Javadoc business hints.** The first paragraph of a class-level Javadoc often states business intent. Capture that into the `description` field when present, trimmed to a sentence.

## Java-specific EXCLUSIONS (do NOT emit these)

- **`@MappedSuperclass` classes** (e.g. `BaseEntity`, `NamedEntity`, `Person`). These have NO table; the pack already inherits their fields into each concrete `@Entity` subclass. They are not `physical_data_entities`s. Emitting them is wrong.
- **`@Embeddable` classes.** Similar — they are column groups, not entities.
- **Methods inside `@Configuration` classes** (including `@Bean` factory methods, `WebMvcConfigurer` overrides like `addInterceptors` / `configurePathMatch`, Spring Boot starter callbacks like `registerHints`, cache / locale / i18n wiring). These are framework wiring, NOT `business_logics`. They do NOT encode domain rules.
- **Spring framework-interface implementations** that carry no domain logic: `Formatter<T>`, `Converter<S, T>`, `WebMvcConfigurer`, `WebApplicationInitializer`, `RuntimeHintsRegistrar`, `ApplicationListener<T>`, `InitializingBean`, `DisposableBean`. Their methods are framework glue. Skip unless the method body clearly contains a business calculation or state transition.
- **Cache declarations.** Caffeine / EhCache / Redis cache instance configuration in `@Configuration` classes is infrastructure, not a `physical_data_entities` (a cache is not a persisted DB table).
- **Application properties / YAML values.** `spring.datasource.url`, `server.port`, `spring.kafka.bootstrap-servers`, etc. are configuration, not `physical_data_attributes`s or `logical_data_attributes`s. The meta-model does not have a slot for config values; do not emit them.
- **Abstract base classes** named `AbstractFooService`, `BaseRepository`, etc. without concrete business methods — framework scaffolding. Skip.
- **Generated code.** Files annotated `@Generated`, or classes ending in `$$EnhancerByCGLIB$$`, MapStruct-generated mappers, QueryDSL `_` suffix classes, JPA metamodel. Skip.
- **Test scaffolding.** Classes inside `src/test/` trees, classes ending in `Test`, `IT`, `Mock`, `Stub`, or annotated `@SpringBootTest` / `@WebMvcTest`. Skip.

## Naming for Java specifically

- `physical_data_attributes` name format is `EntityClass.fieldName` where `fieldName` is the **Java field name** (e.g. `Owner.firstName`), NOT the SQL column name (`owners.first_name`). The pack emits the Java form; LLM output that emits the SQL form is a restatement and will be rejected.
- `business_logics` name is the method name as written in Java (`PetValidator.validate`, `calculateOverdueBalance`). No re-phrasing.
- `logical_data_entity_relationships` always uses `ParentClass → ChildClass` with PascalCase Java entity names (e.g. `Pet → Visit`), NOT table names (`pets → visits`) and NOT natural-language phrasings.

## Confidence calibration for Java

- Class with an explicit Spring / Jakarta annotation and matching package: 0.9+.
- Class whose name suffix and package placement align, but no annotation visible: 0.7-0.85.
- Inference from imports or Javadoc alone: 0.55-0.7.

If you cannot point at a specific annotation, base class, method name, or SQL object that justifies the candidate, do not emit it.
