# Spring Classic framework guidance

A `spring-classic` static analysis pack has already been run against
this file. Its output is injected into the prompt as a fenced JSON
array. You are here to surface what that pack CANNOT see - not to
restate what it already captured.

## What the adapter already catches (do NOT re-emit these)

- **Controllers** annotated with `@Controller`, `@RestController`.
- **Services** annotated with `@Service`.
- **Repositories** annotated with `@Repository`, including Spring Data
  JPA interfaces extending `JpaRepository`, `CrudRepository`, etc.
- **Components** annotated with `@Component`.
- **Class-level bean annotations** in general - anything Spring
  stereotype-annotated at the class declaration.
- **`@Autowired` / constructor-injected bean dependencies** between
  those stereotype-annotated classes.
- **`@Configuration` (Java-config) classes**, including the
  Spring-Java-Config naming convention (`*SJC` / `*Config` /
  `*Configuration`). The adapter scans them for cross-file references
  (`@Import`, `@ImportResource`, `@ComponentScan`) but does **NOT**
  emit them as `interfaces` or any other meta-model type — they are
  wiring containers, not external contracts. The cross-file wiring
  graph is reviewable on the run page; do not re-emit the class
  itself under any type.
- **`@Bean` factory methods** on `@Configuration` classes are emitted
  as `business_logics` candidates parented to their config class,
  with `data.beanName`, `data.returnType`, and
  `data.beanKind: 'bean-factory'`. The bean's *return type* is the
  hint for what kind of architectural element the bean represents
  (`DataSource`, `RestTemplate`, `JmsTemplate`,
  `EntityManagerFactory`, etc.).
- **Interface-to-logical-entity links** (`interface_logical_entities`) — one candidate per (controller class, DTO type) pair that the controller references via a request body or response body. Per-interface granularity: a controller with 5 endpoints all using `OwnerDto` yields ONE `interface_logical_entities` candidate named `OwnerController → OwnerDto`.

- **Inbound entry-point surfaces NOW covered by the adapter (Spec #4 — do
  NOT re-emit these):**
  - **JAX-RS resources** (`@Path` + `@GET`/`@POST`/`@PUT`/`@DELETE`/`@HEAD`/
    `@OPTIONS` + `@Produces`/`@Consumes` + `@QueryParam`/`@HeaderParam`/
    `@PathParam`), both `javax.ws.rs.*` and `jakarta.ws.rs.*`.
  - **Raw servlets**: `@WebServlet(urlPatterns=…/value=…)` classes,
    `extends HttpServlet` (`doGet`/`doPost`/`doPut`/`doDelete`/`service`), and
    **`web.xml` `<servlet-mapping>`** url-patterns — all emitted as
    `interfaces`/`endpoints` candidates.
  - **WebFlux functional `RouterFunction` routes**
    (`RouterFunctions.route()…GET("/p", handler)` / `RequestPredicates.*`).
  - **Meta-annotated / composed mapping annotations** (`@ApiV2Get`
    meta-annotated with `@GetMapping` ⇒ GET) and **fully-qualified** mapping
    annotation references (`@org.springframework.web.bind.annotation.GetMapping`).
  - **Inherited / abstract base-controller mappings** (a class-level
    `@RequestMapping` base path and non-overridden handler methods walked up the
    `extends` chain).
  - **JAX-WS SEIs declared as a Java `interface`**
    (`@WebService public interface FooService { @WebMethod … }`), not only
    `class`-declared endpoints.
  These were previously MISSES; the adapter now emits them deterministically as
  `endpoints`/`interfaces` candidates. Do NOT re-emit any of them — they are
  presumed ALREADY PRESENT in the pack output (same `(type, name, filePath)`
  HARD-RULE de-dup as everything else in this section).

Anything in that list is presumed ALREADY PRESENT in the pack output.
Emitting duplicates of those is the primary failure mode for this
layer.

## HARD RULE — Spring wiring is NOT an architecture-meta-model interface

The architecture meta-model's `interfaces` type is reserved for classes
that expose an **EXTERNAL contract crossing a process boundary** — HTTP,
RPC, messaging, streaming, or file transfer. Internal Spring wiring and
bare Java `interface`-keyword abstractions are NOT meta-model interfaces.
A downstream filter drops any pack-emitted `interfaces` carrying
`springConfigKind ∈ {configuration, xml-context, xml-bean, service-api,
aop-aspect}` or `interfaceSubtype === 'spring-bean-definition'`; you must
not re-introduce them under any type.

1. **Do not emit `@Configuration` classes** (whether named `*SJC`,
   `*Config`, `*Configuration`, or anything else) as `interfaces`,
   `business_logics`, `ui_components`, or any other type. They are
   wiring containers, not architectural elements. The adapter scans
   them for cross-file references (`@Import`, `@ImportResource`,
   `@ComponentScan`) but the configuration class itself is not a
   meta-model artefact. Restating it under any type is the primary
   failure mode for SJC-style codebases where ~15+ such classes drive
   the entire wiring graph.

2. **Do not emit `@Bean` factory methods.** The bean's *return type*
   may identify an integration boundary (`DataSource`, `RestTemplate`,
   `JmsTemplate`, etc.) — but the factory method itself is wiring,
   not business logic and not an interface. If the *return type* names
   a genuine external integration, emit ONE `interfaces` candidate
   named after the integration (e.g. `ExternalRedisCache`), NOT one
   named after the bean method or after the `@Configuration` class.

3. **Do not emit `@Aspect` classes or AOP advice as `interfaces`.**
   AOP advice that encodes a real business rule (validation,
   calculation, policy decision) may be emitted as `business_logics`.
   The aspect class itself is cross-cutting plumbing, never an
   `interfaces` candidate.

4. **Do not emit bare Java `interface`-keyword types as `interfaces`.**
   An internal service API (`interface OrderService { ... }` paired
   with `class OrderServiceImpl implements OrderService`) is NOT a
   meta-model interface — it's an internal abstraction. Only Java
   interfaces that expose an EXTERNAL contract qualify (e.g.
   `@FeignClient`-annotated declarative HTTP clients, gRPC service
   stubs). When emitting the canonical name for an interface +
   implementation pair, use the implementation's `business_logics`
   row, not a new `interfaces` row.

5. **Do not emit XML `<bean>` definitions or `*-context.xml` wiring
   files as `interfaces`.** XML bean wiring is internal Spring
   configuration. Domain entities or external integrations that
   happen to be declared in XML should be emitted under their
   appropriate type (`physical_data_entities`, `business_logics`,
   etc.), not as `interfaces`.

## What the adapter MISSES (your target surface area)

Surface candidates the pack does not see. Typical gaps:

> NOTE (Spec #4): JAX-RS, raw servlets / `web.xml` servlet-mappings /
> `@WebServlet`, WebFlux `RouterFunction` routes, meta-annotated &
> fully-qualified mapping annotations, inherited / abstract base-controller
> mappings, and JAX-WS interface-declared SEIs are **now covered by the
> adapter** (see the "now covered by the adapter" note above). They are NO
> LONGER your target — do NOT re-emit them. The genuine remaining gaps are
> below.

> NOTE (Spec 2026-07-06-l, Response Fidelity): the adapter now ALSO covers —
> do NOT re-emit any of these:
> full `web.xml` response facts (filter chains + order, error-pages,
> encoding-filter charset, session-config); XML-defined MVC handler mappings
> (`SimpleUrlHandlerMapping` / `BeanNameUrlHandlerMapping` → `endpoints` with
> `endpoint_subtype: 'xml-mvc'`); `mvc:interceptors` mapped onto endpoints;
> `security:http` `intercept-url` rules (literal roles resolved, everything
> else attached `source: 'unresolved'`); `tx:advice` / `aop:config`
> transactional pointcuts (flipped onto the data-effect edges); code-set
> response headers / status / redirects / cookies from handler bodies;
> `@CookieValue` / `@MatrixVariable` / `@RequestPart` bindings; and the
> `response_kind` view-vs-API classification (`view-html` endpoints are
> marked out of parity scope).

- **XML bean configuration.** Classes referenced only from
  `applicationContext.xml`, `*-context.xml`, `beans.xml`, or Spring
  namespace XML (`<bean id="..." class="..."/>`, `<context:component-scan/>`)
  are invisible to annotation-driven extraction. If the file under
  review is such an XML file, or if the surrounding imports and
  comments hint at XML-wired collaborators, emit those collaborators.
- **Hibernate HBM XML (`*.hbm.xml`).** Entity and mapping declarations
  expressed as XML rather than as `@Entity` annotations are not
  picked up. Extract domain entities and relationships from HBM XML.
- **AOP cross-cuts.** `@Aspect`-annotated classes, advice methods
  (`@Before`, `@After`, `@Around`, `@AfterReturning`,
  `@AfterThrowing`), and pointcut declarations express cross-cutting
  behaviour — logging, auditing, transaction management, security —
  that the stereotype-focused pack ignores. Where the advice or
  pointcut clearly encodes a business rule (validation, calculation,
  policy decision), emit it as `business_logics`. **Never emit an
  `@Aspect` class as `interfaces`** — AOP is plumbing, not an
  external contract.
- **Inter-service HTTP calls via `RestTemplate`, `WebClient`, or
  Feign.** A `RestTemplate`, `WebClient`, or `@FeignClient` import /
  field / call inside a service body identifies an outbound HTTP
  integration crossing a process boundary. Emit ONE `interfaces`
  candidate per distinct outbound target (the integration boundary
  is the external contract). `@FeignClient`-annotated Java
  interfaces themselves qualify as `interfaces` — the `@FeignClient`
  annotation is the external-contract signal that distinguishes them
  from internal service-API Java interfaces.
- **Message-driven components.** `@JmsListener`, `@KafkaListener`,
  `@RabbitListener`, `@SqsListener`, `@EventListener` often slip
  past stereotype-only scanners.
- **Scheduled jobs.** `@Scheduled`-annotated methods inside plain
  classes, or classes implementing `Job` / `QuartzJobBean`, indicate
  runtime schedulers worth surfacing.
- **Semantic labels on bean factories the pack already extracted.**
  When the pack emits `business_logics` with `beanKind: 'bean-factory'`
  whose `returnType` is a known integration type (`DataSource`,
  `JmsTemplate`, `RestTemplate`, `WebClient`, `KafkaTemplate`,
  `RedisTemplate`, `JedisConnectionFactory`, `MongoTemplate`,
  `Cluster`/`Session` for Cassandra, etc.), surface a SECOND
  candidate that names the integration boundary itself (e.g.
  `interfaces: ExternalRedisCache` parented to the bean factory).
  This labels the architectural seam, it does not duplicate the
  bean-factory row — type and name both differ.

## Instruction

Read the pack-output JSON block injected into this prompt carefully.
For each candidate you consider emitting, check that the
`(type, name, filePath)` tuple is NOT already represented in the pack
output (after case-insensitive, whitespace-collapsed name comparison).
If it is, drop it. Emit ONLY the genuine misses.
