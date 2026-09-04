/**
 * SCL modernization pair ruleset (SCL pipeline spec 5 of 10, 2026-08-18
 * design: agent-os/planning/2026-08-18-scl-pipeline-design.md, "Intermediate
 * modernization decisions").
 *
 * The code-plane analog of the DB pair ruleset: a SEEDED, DATA-ONLY,
 * DETERMINISTIC mapping keyed (source stack -> target stack). Every rule pairs
 * an idiom MATCHER (evaluated deterministically against corpus contracts by
 * services/sclModernizationInventory.ts) with a default old->new mapping the
 * review UI presents for confirmation. The corpus drives the question set:
 * a rule only materializes as a decision row when its idiom is OBSERVED
 * (usage count > 0).
 *
 * Rule codes follow `modernize.<family>.<slug>` and become captured-decision
 * codes verbatim on confirm (services/sclModernizationReview.ts), persisted
 * through the EXISTING decisions store write path
 * (services/architectConversation/targetStateCapturedDecisionsWriter.ts).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Deterministic idiom matcher — a discriminated union evaluated against the
 * SCL corpus contracts (no LLM anywhere in matching):
 *
 * - `sourceCarrier`   — a shape field's `sourceCarrier` evidence string (the
 *                       third-party value-carrier type, e.g. Joda types).
 * - `annotationPrefix`— any table/class annotation starting with one of the
 *                       given prefixes (e.g. the JAX-RS HTTP set).
 * - `representation`  — a shape contract's non-normative representation
 *                       ('pojo' — the getter/setter POJO idiom).
 * - `boundaryClass`   — Q- boundary contracts (DAO / repository classes).
 * - `flag`            — a deterministic slicer flag on a shape (e.g.
 *                       'sealed_variant_candidate').
 * - `typeReference`   — a verbatim type text occurrence anywhere in a table's
 *                       signatureInputs / rows or a shape field's kinds
 *                       ('opaque:java.util.Vector' etc.).
 */
export type IdiomMatcher =
  | { kind: 'sourceCarrier'; value: string }
  | { kind: 'annotationPrefix'; anyOf: string[] }
  | { kind: 'representation'; value: 'pojo' }
  | { kind: 'boundaryClass' }
  | { kind: 'flag'; value: string }
  | { kind: 'typeReference'; value: string };

export interface ModernizationRule {
  /** Decision family (design doc list — collections, dates, http, ...). */
  family: string;
  /** `modernize.<family>.<slug>` — becomes the captured-decision code. */
  code: string;
  matcher: IdiomMatcher;
  /** The legacy idiom, human-readable (shown in the old column). */
  from: string;
  /** The default target idiom (shown in the new column; editable in the UI). */
  to: string;
  /** Mapping tables / caveats / policy notes surfaced alongside the row. */
  notes?: string;
}

export interface ModernizationRuleset {
  id: string;
  sourceStack: { language: string; frameworks: string[] };
  targetStack: { language: string; framework: string };
  rules: ModernizationRule[];
}

// ---------------------------------------------------------------------------
// Seeded rulesets
// ---------------------------------------------------------------------------

const JAVA8_TO_JAVA21_SPRING_BOOT_RULES: ModernizationRule[] = [
  // -- collections ----------------------------------------------------------
  {
    family: 'collections',
    code: 'modernize.collections.vector',
    matcher: { kind: 'typeReference', value: 'java.util.Vector' },
    from: 'java.util.Vector',
    to: 'java.util.ArrayList',
    notes:
      'Vector is synchronized; if any observed use relies on that, prefer the ' +
      'concurrency-family mapping (java.util.concurrent) instead.',
  },
  {
    family: 'collections',
    code: 'modernize.collections.hashtable',
    matcher: { kind: 'typeReference', value: 'java.util.Hashtable' },
    from: 'java.util.Hashtable',
    to: 'java.util.HashMap',
    notes:
      'Hashtable is synchronized and rejects null keys/values; HashMap allows ' +
      'them — confirm no observed null-rejection behaviour is load-bearing.',
  },
  {
    family: 'collections',
    code: 'modernize.collections.stringbuffer',
    matcher: { kind: 'typeReference', value: 'java.lang.StringBuffer' },
    from: 'java.lang.StringBuffer',
    to: 'java.lang.StringBuilder',
  },
  {
    family: 'collections',
    code: 'modernize.collections.enumeration',
    matcher: { kind: 'typeReference', value: 'java.util.Enumeration' },
    from: 'java.util.Enumeration',
    to: 'java.util.Iterator',
  },

  // -- dates ----------------------------------------------------------------
  {
    family: 'dates',
    code: 'modernize.dates.joda-localdate',
    matcher: { kind: 'sourceCarrier', value: 'org.joda.time.LocalDate' },
    from: 'org.joda.time.LocalDate',
    to: 'java.time.LocalDate',
  },
  {
    family: 'dates',
    code: 'modernize.dates.joda-datetime',
    matcher: { kind: 'sourceCarrier', value: 'org.joda.time.DateTime' },
    from: 'org.joda.time.DateTime',
    to: 'java.time.ZonedDateTime',
  },
  {
    family: 'dates',
    code: 'modernize.dates.util-date',
    matcher: { kind: 'sourceCarrier', value: 'java.util.Date' },
    from: 'java.util.Date',
    to: 'java.time (LocalDate or Instant per usage)',
    notes:
      'Date-only usages become java.time.LocalDate; timestamp usages become ' +
      'java.time.Instant. Decide per shape from the observed usage facts.',
  },
  {
    family: 'dates',
    code: 'modernize.dates.util-calendar',
    matcher: { kind: 'sourceCarrier', value: 'java.util.Calendar' },
    from: 'java.util.Calendar',
    to: 'java.time.ZonedDateTime',
  },
  {
    family: 'dates',
    code: 'modernize.dates.xml-gregorian-calendar',
    matcher: { kind: 'sourceCarrier', value: 'javax.xml.datatype.XMLGregorianCalendar' },
    from: 'javax.xml.datatype.XMLGregorianCalendar',
    to: 'java.time.OffsetDateTime',
    notes: 'Wire rendering (xsd:dateTime lexical form) must be preserved verbatim.',
  },

  // -- http -----------------------------------------------------------------
  {
    family: 'http',
    code: 'modernize.http.jaxrs-annotations',
    matcher: {
      kind: 'annotationPrefix',
      anyOf: [
        '@Path',
        '@GET',
        '@POST',
        '@PUT',
        '@DELETE',
        '@HeaderParam',
        '@PathParam',
        '@QueryParam',
        '@Produces',
        '@Consumes',
      ],
    },
    from: 'JAX-RS resource annotations (javax.ws.rs)',
    to: 'Spring MVC annotations',
    notes:
      'Mapping table: @Path -> @RequestMapping; @GET -> @GetMapping; ' +
      '@POST -> @PostMapping; @PUT -> @PutMapping; @DELETE -> @DeleteMapping; ' +
      '@HeaderParam -> @RequestHeader; @PathParam -> @PathVariable; ' +
      '@QueryParam -> @RequestParam; @Produces -> produces= attribute; ' +
      '@Consumes -> consumes= attribute. Paths and parameter names are ' +
      'behaviour — carried verbatim.',
  },
  {
    family: 'http',
    code: 'modernize.http.jaxrs-response',
    matcher: { kind: 'typeReference', value: 'javax.ws.rs.core.Response' },
    from: 'javax.ws.rs.core.Response',
    to: 'org.springframework.http.ResponseEntity',
    notes: 'Status codes and headers set on Response are behaviour — carried verbatim.',
  },
  {
    family: 'http',
    code: 'modernize.http.context-injection',
    matcher: { kind: 'annotationPrefix', anyOf: ['@Context'] },
    from: '@Context HttpServletRequest',
    to: 'method-injected HttpServletRequest parameter',
    notes:
      'Spring MVC resolves HttpServletRequest declared directly as a handler ' +
      'method parameter — no field/annotation injection needed.',
  },

  // -- dto ------------------------------------------------------------------
  {
    family: 'dto',
    code: 'modernize.dto.pojo-record',
    matcher: { kind: 'representation', value: 'pojo' },
    from: 'getter/setter POJO',
    to: 'Java record',
    notes:
      'Representation policy (shape representation is non-normative). CAVEAT: ' +
      'shapes flagged mutated-in-flight (setter after construction) are record-' +
      'conversion hazards — those shapes keep a mutable class or get a builder; ' +
      'the review UI surfaces the collision per shape.',
  },
  {
    family: 'dto',
    code: 'modernize.dto.sealed-hierarchy',
    matcher: { kind: 'flag', value: 'sealed_variant_candidate' },
    from: 'DTO inheritance hierarchy',
    to: 'sealed interface + records',
    notes: 'Discriminators are normative — wire discriminator values carried verbatim.',
  },
  {
    // 2026-09-04: the slicer's `mutated_in_flight` flag (a setter called after
    // construction) previously reached the review as an un-ruled flag with no
    // default at all. It is the explicit exception to modernize.dto.pojo-record:
    // such shapes are record-conversion hazards and keep a mutable class (or a
    // record + builder) instead.
    family: 'dto',
    code: 'modernize.dto.mutated-in-flight',
    matcher: { kind: 'flag', value: 'mutated_in_flight' },
    from: 'DTO mutated after construction (setter in flight)',
    to: 'keep mutable class (or record + builder) — excluded from record conversion',
    notes:
      'Explicit exception to modernize.dto.pojo-record: a shape whose state is ' +
      'changed after construction cannot become a plain record without changing ' +
      'behaviour. Keep it mutable, or introduce a builder and construct once.',
  },

  // -- dataaccess -----------------------------------------------------------
  {
    family: 'dataaccess',
    code: 'modernize.dataaccess.dao-jparepository',
    matcher: { kind: 'boundaryClass' },
    from: '*Dao classes with raw SQL',
    to: 'Spring Data JpaRepository interfaces',
    notes:
      'Verbatim SQL is carried via @Query where derived query-method names ' +
      'cannot express it — never paraphrased into a lossy derived name.',
  },

  // -- serialization --------------------------------------------------------
  {
    family: 'serialization',
    code: 'modernize.serialization.jaxb-jackson',
    matcher: {
      kind: 'annotationPrefix',
      anyOf: ['@XmlRootElement', '@XmlElement', '@XmlAttribute', '@XmlType', '@XmlAccessorType'],
    },
    from: 'JAXB annotations (@XmlRootElement/@XmlElement)',
    to: 'Jackson (jackson-dataformat-xml)',
    notes: 'Wire names are ALWAYS preserved — element/attribute names carried verbatim.',
  },

  // -- exceptions -----------------------------------------------------------
  {
    family: 'exceptions',
    code: 'modernize.exceptions.checked-custom',
    matcher: { kind: 'flag', value: 'checked_exception' },
    from: 'checked custom exceptions',
    to: 'carried as-is (checked)',
    notes:
      'Policy row: custom checked exceptions are carried, not runtime-wrapped, ' +
      'because throws: outcomes in behaviour tables reference them by name. ' +
      'Runtime wrapping is an explicit opt-in edit here.',
  },

  // -- crosscutting ---------------------------------------------------------
  {
    family: 'crosscutting',
    code: 'modernize.crosscutting.custom-aspects',
    matcher: { kind: 'flag', value: 'custom_aspect' },
    from: 'custom @interface aspects',
    to: 'Spring AOP @Aspect',
    notes:
      'The slicer resolves aspect effects into per-contract effect facts; the ' +
      'target re-expresses each resolved aspect as a Spring AOP @Aspect with ' +
      'the same pointcut coverage.',
  },

  // -- concurrency ----------------------------------------------------------
  {
    family: 'concurrency',
    code: 'modernize.concurrency.synchronized-collections',
    matcher: { kind: 'flag', value: 'synchronized_collection' },
    from: 'synchronized collections / synchronized wrappers',
    to: 'java.util.concurrent equivalents (ConcurrentHashMap, CopyOnWriteArrayList)',
  },

  // -- caching --------------------------------------------------------------
  {
    family: 'caching',
    code: 'modernize.caching.handrolled-map-cache',
    matcher: { kind: 'flag', value: 'handrolled_cache' },
    from: 'hand-rolled Map caches',
    to: 'Spring Cache abstraction (@Cacheable)',
    notes:
      'Provider choice (Caffeine default vs Redis for shared state) is a ' +
      'follow-on decision — the abstraction is the committed part.',
  },

  // -- config ---------------------------------------------------------------
  {
    family: 'config',
    code: 'modernize.config.legacy-properties',
    matcher: { kind: 'typeReference', value: 'java.util.Properties' },
    from: 'legacy config classes / .properties access',
    to: '@ConfigurationProperties',
    notes: 'Config KEYS are behaviour — preserved verbatim, only the access idiom changes.',
  },

  // -- utility --------------------------------------------------------------
  {
    family: 'utility',
    code: 'modernize.utility.commons-lang3-stringutils',
    matcher: { kind: 'typeReference', value: 'org.apache.commons.lang3.StringUtils' },
    from: 'org.apache.commons.lang3.StringUtils',
    to: 'JDK equivalents where exact (String::isBlank, String::strip); else keep dependency',
    notes:
      'Only swap calls with EXACT JDK semantic equivalents; semantics-shifting ' +
      'swaps (null-tolerance differs) keep commons-lang3.',
  },
];

/**
 * The seeded pair rulesets. v1 ships the one live migration pair
 * (Java 8 + JAX-RS + Joda -> Java 21 + Spring Boot); the array shape is the
 * extension seam for future pairs.
 */
export const MODERNIZATION_RULESETS: ModernizationRuleset[] = [
  {
    id: 'java8-jaxrs-joda__java21-springboot',
    sourceStack: { language: 'java', frameworks: ['jaxrs', 'joda', 'jaxb', 'commons-lang3'] },
    targetStack: { language: 'java21', framework: 'spring-boot' },
    rules: JAVA8_TO_JAVA21_SPRING_BOOT_RULES,
  },
];

/** The default ruleset for the one live pair (inventory + review default). */
export function defaultModernizationRuleset(): ModernizationRuleset {
  return MODERNIZATION_RULESETS[0];
}
