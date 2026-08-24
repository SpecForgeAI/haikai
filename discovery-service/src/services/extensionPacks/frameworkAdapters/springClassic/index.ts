/**
 * Spring Classic (pre-Boot) Framework Adapter
 *
 * Covers the annotation-era of the classic Spring Framework (3.x / 4.x / 5.x
 * without Spring Boot). Targets codebases like OpenMRS, pre-Boot e-commerce
 * apps, and enterprise Java circa 2005-2018.
 *
 * Consumes Java IR (produced by the same java-modern language extractor used
 * by spring-boot). The Java SOURCE-code signals we detect are mostly shared
 * with Spring Boot:
 *
 *   @Controller, @RestController, @RequestMapping           → interface / endpoint
 *   @GetMapping / @PostMapping / @PutMapping / ...          → endpoint
 *   @Entity, @Table, @Column, @Id                           → physical_entity / physical_attribute
 *   @OneToOne / @OneToMany / @ManyToOne / @ManyToMany       → entity_relationship
 *   @Service, @Component, @Repository + service class names → business_logic
 *   @MappedSuperclass field inheritance                     → inherited physical_attribute
 *
 * NOT in scope for this base pack (deferred to a future "spring-classic-xml"
 * pack if/when needed):
 *   - applicationContext.xml <bean> definitions
 *   - Pre-annotation Spring 2.x XML controller wiring
 *   - struts-config.xml, tiles-defs.xml, web.xml servlet mappings
 *   - Hibernate HBM XML mappings (hibernate-mapping / class name="...")
 *
 * The adapter therefore produces the SAME shape of candidates as spring-boot
 * when run on annotation-driven classic Spring code. The practical
 * differences are in what a classic codebase is LIKELY to use:
 *   - More @Controller and @RequestMapping (less @RestController / @*Mapping)
 *   - More XML config that this adapter misses
 *   - No Spring Boot autoconfig markers (@SpringBootApplication etc.)
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FieldIR,
  FunctionIR,
  ParameterIR,
  AnnotationIR,
  AnnotationTypeDeclIR,
} from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';
import type { SpringBeansXmlResult } from '../../languageExtractors/java/springBeansXmlParser';
import { buildEndpointDataEffectCandidates } from './endpointDataEffectCandidates';
// Outbound Integration Graph (Spec #5, Task Group 3): the `data_movements`
// outbound-edge candidate emit. SHARES the new `outboundIntegrationResolver`
// with the finding scanner (which emits the external-dependency Findings over
// the same IR). ADDITIVE; supersedes the legacy orphan-`endpoints` emit in the
// `processOutboundIntegrations` regex path (no edge -> a real `data_movements`
// edge). NEVER mints `*_points`; NEVER an invented external entity.
import { buildOutboundIntegrationCandidates } from './outboundIntegrationCandidates';
import {
  attachWebXmlResponseFacts,
  scanWebXmlResponseFacts,
} from './webXmlResponseFacts';
import {
  applyXmlTransactionalMatchers,
  attachXmlMvcFacts,
  buildXmlMvcEndpointCandidates,
  scanXmlMvc,
} from './xmlMvcScanner';
import {
  attachCodeResponseFacts,
  scanCodeResponseFacts,
} from './codeResponseFactsScanner';
import {
  attachSelfApiCallLinks,
  mintInternalProcessCandidates,
  scanInternalProcessXml,
  xmlEntryTargets,
} from './internalProcessXmlScanner';
import { applyMyBatisXmlQueries, scanMyBatisXmlMappers } from './myBatisXmlMapper';
import { mintJpaCallbackCandidates, scanJpaInternals } from './jpaInternalsScanner';
import { buildDataEffectCandidatesFromResolved } from './endpointDataEffectCandidates';
import { resolveInternalProcessDataEffects } from './endpointDataEffectResolver';
import {
  scanResponseContracts,
  attachResponseContractsToCandidates,
} from './responseContractScanner';
// Per-endpoint REQUEST-contract capture (Spec 2026-06-19, Task Group 5): the
// request-side sibling of the response-contract scanner. Builds the COMPLETE
// `request_contract` blob (content_type/consumes + required_headers + params +
// the NEW request date-formats `param_formats[]` + request_validation[]) and
// rides it on `candidate.data.request_contract`, MIRRORING the response-contract
// attach. ADDITIVE -- does not disturb `response_contract` emission.
import {
  scanRequestContracts,
  attachRequestContractsToCandidates,
} from './requestContractScanner';
// Signal #2 (2026-06-22 Spring Classic code-evidence format extraction, Task
// Group 2): the project-wide GLOBAL date-format resolver. Resolved ONCE per
// scan and stamped as a single top-level `inferred_date_format` on each
// endpoint `request_contract` (never onto per-field `param_formats`).
import { resolveGlobalDateFormat } from './globalDateFormatScanner';
// Spec #4 (Inbound Surface Completeness), Task Groups 2/3/4: JAX-RS, raw
// servlet / web.xml / @WebServlet, and WebFlux RouterFunction detectors. These
// emit the SAME canonical interfaces/endpoints candidate shape this adapter's
// processController path produces (see soapEndpointEmitter precedent) — a
// sibling-module detector, NOT a forked emission or save-back path.
import {
  detectJaxRsResource,
  detectServletClass,
  detectWebFluxRouterFunctions,
  collectWebXmlServletMappings,
} from './inboundSurfaceDetectors';
// Plain-Java `main()` batch-entrypoint emission (D2, Task Group 3). A sibling
// detector (like the inbound-surface ones above) that closes the gap left by
// the `if (!stereotyped && !nameSuggests) return;` gate in
// `processServiceLayerBusinessLogic` for non-Spring batch `main()` classes.
// Gated to runs carrying batch signals; never touches the Spring paths.
import {
  detectBatchSignals,
  detectBatchEntrypoint,
} from './batchEntrypointDetector';

// ---------------------------------------------------------------------------
// Constants (intentionally similar to spring-boot — mostly shared annotations)
// ---------------------------------------------------------------------------

const CONTROLLER_ANNOTATIONS = ['RestController', 'Controller'];

const HTTP_METHOD_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

const ENDPOINT_ANNOTATIONS = [
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'RequestMapping',
];

// The mapping + controller annotation simple-names the generalised matcher
// canonicalises to (Spec #4, Task Group 1). A custom annotation that is
// meta-annotated with one of these resolves to it; a fully-qualified
// reference (`@org.springframework.web.bind.annotation.GetMapping`) resolves
// on its final simple-name segment. Kept as a Set for O(1) membership.
const KNOWN_MAPPING_ANNOTATION_NAMES = new Set<string>([
  ...ENDPOINT_ANNOTATIONS,
  ...CONTROLLER_ANNOTATIONS,
]);

// Bound on how many meta-annotation levels the resolver follows
// (`@A` -> `@B` -> `@GetMapping`). Deterministic + cycle-guarded; the cap is
// a belt-and-braces stop in addition to the visited-set.
const META_ANNOTATION_MAX_DEPTH = 8;

/**
 * The final simple-name segment of an annotation name. A fully-qualified
 * reference (`org.springframework.web.bind.annotation.GetMapping`) yields
 * `GetMapping`; a bare simple name is returned unchanged.
 */
function annotationSimpleName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

const JPA_RELATIONSHIP_ANNOTATIONS = [
  'OneToOne',
  'OneToMany',
  'ManyToOne',
  'ManyToMany',
];

// Classic-Spring stereotype annotations.
//
// `@Service` is the precise service-layer marker; `@Component` is broader
// but legitimately used for service-shaped classes that don't fit the
// `@Service` semantic (rule engines, calculators, helpers in the
// service tier). The deny-list below filters out the non-business
// `@Component` shapes (formatters, converters, handlers, etc.) so the
// `@Component` widening doesn't pull in plumbing.
//
// `@Transactional` (class-level OR any method) is a separate trigger —
// any class wrapping methods in a transaction is doing real domain work
// even when it's not annotated with a stereotype.
const SERVICE_LAYER_ANNOTATIONS = ['Service', 'Component'];
const TRANSACTIONAL_ANNOTATION = 'Transactional';
const NON_BUSINESS_LOGIC_SUFFIXES = /(Formatter|Converter|Handler|Interceptor|Filter|Listener|Adapter|Mapper|Resolver|Dao|Repository)$/;
// Domain-flavoured class-name suffixes. `Builder` / `Factory` / `Helper`
// are deliberately excluded — they're frequently plumbing rather than
// business logic and would noise up the emission.
const SERVICE_NAME_SUFFIX_RE = /(Service|Provider|Manager|Validator|Processor|Calculator|Engine)$/;

// Java-config wiring annotations. Codebases like the Fire UI backend (~15+
// `*SJC` classes) express most of their wiring through these — without
// explicit capture the LLM gap-fill stage has to recognise each one
// per-file and the cross-file `@Import` graph is invisible.
const CONFIGURATION_ANNOTATION = 'Configuration';
const BEAN_ANNOTATION = 'Bean';
const IMPORT_ANNOTATION = 'Import';
const IMPORT_RESOURCE_ANNOTATION = 'ImportResource';
const COMPONENT_SCAN_ANNOTATION = 'ComponentScan';

// AOP — `@Aspect`-marked classes carry advice methods that encode
// cross-cutting domain rules (transactions, security, auditing, logging,
// validation). Architecturally distinct from regular `@Component` classes.
const ASPECT_ANNOTATION = 'Aspect';
const ADVICE_ANNOTATIONS = [
  'Before',
  'After',
  'Around',
  'AfterReturning',
  'AfterThrowing',
];
const POINTCUT_ANNOTATION = 'Pointcut';

// Message-driven + scheduled — inbound async surfaces. Architecturally
// equivalent to HTTP endpoints but currently invisible to the adapter.
// Each annotation maps to an `endpoint_subtype` value.
const MESSAGE_LISTENER_ANNOTATIONS: Record<string, string> = {
  JmsListener: 'jms-listener',
  KafkaListener: 'kafka-listener',
  RabbitListener: 'rabbit-listener',
  SqsListener: 'sqs-listener',
  EventListener: 'event-listener',
  Scheduled: 'scheduled',
};

// Outbound integration — `@FeignClient`-annotated interfaces are
// declarative HTTP clients. Each method on the interface is an
// outbound endpoint.
const FEIGN_CLIENT_ANNOTATION = 'FeignClient';

// ---------------------------------------------------------------------------
// Class index (for @MappedSuperclass walking, same as spring-boot adapter)
// ---------------------------------------------------------------------------

type ClassIndex = Map<string, { cls: ClassIR; file: SourceFileIR }>;

function buildClassIndex(files: SourceFileIR[]): ClassIndex {
  const idx: ClassIndex = new Map();
  for (const f of files) for (const c of f.classes) idx.set(c.name, { cls: c, file: f });
  return idx;
}

function collectMappedSuperclassFields(
  cls: ClassIR,
  index: ClassIndex,
): Array<{ field: FieldIR; inheritedFrom: string }> {
  const out: Array<{ field: FieldIR; inheritedFrom: string }> = [];
  const seen = new Set(cls.fields.map((f) => f.name));
  const visited = new Set<string>();
  let current = cls.extends;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const parent = index.get(current);
    if (!parent) break;
    if (!hasAnnotation(parent.cls.annotations, 'MappedSuperclass')) break;
    for (const field of parent.cls.fields) {
      if (seen.has(field.name)) continue;
      out.push({ field, inheritedFrom: parent.cls.name });
      seen.add(field.name);
    }
    current = parent.cls.extends;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta-annotation / fully-qualified mapping resolution (Spec #4, Task Group 1)
// ---------------------------------------------------------------------------
//
// A custom annotation meta-annotated with a Spring mapping
// (`@ApiV2Get` meta-annotated with `@GetMapping`) is a valid composed
// mapping that the fixed simple-name match misses. Likewise a fully-qualified
// reference (`@org.springframework.web.bind.annotation.GetMapping`). Rather
// than fork every match site, we CANONICALISE an annotation list once: for
// each annotation we ALSO append a synthetic annotation carrying the resolved
// KNOWN mapping/controller simple-name + merged args, so the existing W1
// `extractHttpMethods` / `extractMethodPaths` / `extractBasePath` /
// `isEndpointMethod` / `CONTROLLER_ANNOTATIONS` checks all keep working
// unchanged. Resolution is bounded + cycle-guarded.

/** Index of custom annotation TYPE declarations by simple name -> the
 *  meta-annotations the type is itself declared with. Built across all files
 *  in the run (a custom mapping annotation is usually declared in its own
 *  file, separate from the controller that uses it). */
type AnnotationDefIndex = Map<string, AnnotationIR[]>;

function buildAnnotationDefIndex(files: SourceFileIR[]): AnnotationDefIndex {
  const idx: AnnotationDefIndex = new Map();
  for (const f of files) {
    if (!f.annotationDeclarations) continue;
    for (const decl of f.annotationDeclarations) {
      // First declaration wins on a name clash (deterministic by file order).
      if (!idx.has(decl.name)) idx.set(decl.name, decl.annotations);
    }
  }
  return idx;
}

/**
 * Resolve a single annotation to a KNOWN mapping/controller simple-name when
 * it is one directly (simple or fully-qualified), or via meta-annotation
 * (following the custom annotation's own declared annotations, bounded +
 * cycle-guarded). Returns the resolved KNOWN simple name plus the args that
 * should carry (the OUTER annotation's args win; otherwise the meta-annotation
 * the resolution landed on). Returns null when nothing resolves.
 */
function resolveKnownMapping(
  ann: AnnotationIR,
  defIndex: AnnotationDefIndex,
): { canonicalName: string; args: Record<string, string> } | null {
  const direct = annotationSimpleName(ann.name);
  // Direct (simple-name or FQN final segment) hit.
  if (KNOWN_MAPPING_ANNOTATION_NAMES.has(direct)) {
    return { canonicalName: direct, args: ann.args };
  }
  // Meta-annotation walk: follow the custom annotation's OWN annotations.
  const visited = new Set<string>();
  // Each frontier entry remembers the args to carry should the walk from it
  // land on a known mapping: start with the OUTER annotation's args.
  let frontier: Array<{ name: string; carryArgs: Record<string, string> }> = [
    { name: direct, carryArgs: ann.args },
  ];
  for (let depth = 0; depth < META_ANNOTATION_MAX_DEPTH && frontier.length > 0; depth++) {
    const next: Array<{ name: string; carryArgs: Record<string, string> }> = [];
    for (const entry of frontier) {
      if (visited.has(entry.name)) continue;
      visited.add(entry.name);
      const metas = defIndex.get(entry.name);
      if (!metas) continue;
      for (const meta of metas) {
        const metaSimple = annotationSimpleName(meta.name);
        if (KNOWN_MAPPING_ANNOTATION_NAMES.has(metaSimple)) {
          // Outer annotation args win; fall back to the meta-annotation's own
          // args (`@ApiV2Get` with no args inheriting `@GetMapping("/d")`).
          const args = { ...meta.args, ...entry.carryArgs };
          return { canonicalName: metaSimple, args };
        }
        // Carry the outer args one level deeper (the meta-annotation here is
        // itself custom), still preferring the outer-most declared args.
        next.push({
          name: metaSimple,
          carryArgs: { ...meta.args, ...entry.carryArgs },
        });
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * Canonicalise an annotation list: return the ORIGINAL annotations plus, for
 * every annotation that resolves (directly / FQN / meta-annotated) to a KNOWN
 * mapping or controller annotation, a SYNTHETIC annotation carrying that
 * canonical simple-name + the resolved args. A synthetic is only appended when
 * the canonical name is not already present among the originals as a bare
 * simple name, so plain mappings are untouched (no duplicate fan-out).
 */
function canonicaliseMappingAnnotations(
  annotations: AnnotationIR[],
  defIndex: AnnotationDefIndex,
): AnnotationIR[] {
  const result = [...annotations];
  const presentSimpleNames = new Set(annotations.map((a) => a.name));
  for (const ann of annotations) {
    // Skip annotations already a bare known simple-name — nothing to add.
    if (KNOWN_MAPPING_ANNOTATION_NAMES.has(ann.name)) continue;
    const resolved = resolveKnownMapping(ann, defIndex);
    if (!resolved) continue;
    // Do not shadow an existing bare canonical annotation of the same name.
    if (presentSimpleNames.has(resolved.canonicalName)) continue;
    result.push({
      name: resolved.canonicalName,
      args: resolved.args,
      line: ann.line,
    });
    presentSimpleNames.add(resolved.canonicalName);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Path helpers (shared with spring-boot)
// ---------------------------------------------------------------------------

function stripArrayBracesAndQuotes(value: string): string {
  let v = value.trim();
  // Only unwrap a Spring multi-value ARRAY LITERAL --
  // `@RequestMapping({"/a","/b"})` -- whose inner content begins with a quote.
  // A path TEMPLATE that merely happens to begin AND end with a path-param
  // segment (`{businessDate}/{orgUnitId}`, or a bare single `{orgUnitId}`) is NOT
  // an array literal: stripping its outer braces would mangle the template into
  // `businessDate}/{orgUnitId` (the malformed twin) or `orgUnitId` (the brace-less
  // twin), giving the same logical endpoint two distinct canonical paths and
  // defeating the Spec-0 identity-keyed merge. The leading-quote guard
  // distinguishes the two: an array literal's first inner char is always a
  // double- or single-quote; a template's never is.
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim();
    if (inner.startsWith('"') || inner.startsWith("'")) {
      v = inner;
      if (v.includes(',')) v = v.split(',')[0].trim();
    }
  }
  return v.replace(/^["']|["']$/g, '');
}

function normalisePath(path: string): string {
  let v = stripArrayBracesAndQuotes(path);
  if (!v.startsWith('/')) v = '/' + v;
  if (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1);
  return v;
}

function composeFullPath(basePath: string, methodPath: string): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const method = methodPath.startsWith('/') ? methodPath : '/' + methodPath;
  if (!base && !methodPath) return '/';
  if (!base) return method;
  if (!methodPath) return base;
  return base + method;
}

/**
 * Unwrap framework and collection wrappers from a return type or parameter
 * type, repeatedly, until a concrete inner type remains. See the
 * corresponding function in the spring-boot adapter for the full list of
 * wrappers handled. `Map<K,V>` is deliberately NOT unwrapped.
 */
const UNWRAPPABLE_SINGLE_GENERIC = new Set([
  'ResponseEntity', 'HttpEntity',
  'List', 'Set', 'Collection', 'Iterable', 'Stream',
  'Optional',
  'Page', 'Slice',
  'Flux', 'Mono',
  'CompletableFuture', 'Future', 'Callable',
]);

function unwrapResponseEntity(returnType: string): string {
  let current = returnType.trim();
  for (let i = 0; i < 8; i++) {
    const next = unwrapOneLayer(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function unwrapOneLayer(t: string): string {
  const arrayMatch = t.match(/^(.+)\[\]$/);
  if (arrayMatch) return arrayMatch[1].trim();
  const genMatch = t.match(/^(\w+)\s*<\s*(.+)\s*>$/);
  if (genMatch) {
    const [, wrapper, inner] = genMatch;
    if (UNWRAPPABLE_SINGLE_GENERIC.has(wrapper)) {
      return inner.trim();
    }
  }
  return t;
}

function extractBasePath(annotations: AnnotationIR[]): string {
  const rm = findAnnotation(annotations, 'RequestMapping');
  if (!rm) return '';
  const val = annotationArg(rm, 'value') || annotationArg(rm, 'path');
  return val ? normalisePath(val) : '';
}

// oracle-W1 CLOSED (Spec #4 Task Group 6): the single-value `extractHttpMethod`
// / `extractMethodPath` helpers that used to live here were retained ONLY
// because the same single-value shape was mirrored in two sibling files. Both
// mirrors are now aligned with the plural fan-out:
//   - `springClassic/endpointDataEffectResolver.ts` (the `FunctionIR`-taking
//     copy) now uses `extractHttpMethods` / `extractMethodPaths` and fans its
//     data-effect edges out across every (verb x path) variant.
//   - `springBoot/index.ts` now uses the plural helpers and fans out its
//     endpoint emission per (verb x path) identically to this adapter.
// With no remaining caller, the retained single-value helpers have been DELETED.
// All candidate-emission AND data-effect paths use the plural
// `extractHttpMethods` / `extractMethodPaths` below.

// ---------------------------------------------------------------------------
// Multi-method / multi-path parsing (Bug W1, 2026-05-30)
//
// `AnnotationIR.args` stores each annotation arg as a single RAW string (the
// Java extractor's `parseAnnotationArguments` does not model brace-lists as
// arrays). So:
//   @RequestMapping(method = {RequestMethod.GET, RequestMethod.POST})
//     -> args.method = "{RequestMethod.GET, RequestMethod.POST}"
//   @GetMapping({"/a","/b"})
//     -> args.value  = "{\"/a\",\"/b\"}"
//
// The pre-W1 single-value helpers (`extractHttpMethod`, `extractMethodPath`)
// treated those whole strings as ONE token, producing a garbled verb
// (`GET, REQUESTMETHOD.POST}`) and silently dropping every path alias past the
// first. The two plural helpers below split a possible brace-list into its
// members so the candidate-emission path can fan out ONE endpoint per
// (HTTP-method x path) combination. A single-method / single-path mapping
// still yields exactly one member each -> exactly one endpoint (no behaviour
// change for the common case).
//
// SCOPE NOTE: `AnnotationIR` is intentionally NOT refactored to array-typed
// args here (out of scope) -- we parse the existing string.
// ---------------------------------------------------------------------------

/**
 * Split a possible `{a, b, c}` brace-list into its trimmed members. A bare
 * (non-brace) string returns a single-member list. Empty / whitespace-only
 * members are dropped. Used by both the HTTP-method and path parsers below.
 */
function splitBraceList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1);
  }
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const HTTP_METHOD_TOKENS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'PATCH',
  'HEAD',
  'OPTIONS',
  'TRACE',
]);

/**
 * Resolve the FULL set of HTTP verbs an endpoint method maps to.
 *
 *  - A `@GetMapping` / `@PostMapping` / ... shortcut yields its single verb.
 *  - `@RequestMapping(method = {RequestMethod.GET, RequestMethod.POST})`
 *    yields one verb per member -- each `RequestMethod.X` (or a bare `X`) is
 *    mapped to `X` (upper-cased) when it is a recognised HTTP verb.
 *  - `@RequestMapping` with NO `method` arg yields `['GET']` (Spring's
 *    "all methods" default is surfaced as GET for candidate identity, matching
 *    the long-standing single-value behaviour).
 *
 * Always returns at least one verb. Order is preserved from the source.
 */
function extractHttpMethods(annotations: AnnotationIR[]): string[] {
  for (const [ann, httpMethod] of Object.entries(HTTP_METHOD_ANNOTATIONS)) {
    if (hasAnnotation(annotations, ann)) return [httpMethod];
  }
  const rm = findAnnotation(annotations, 'RequestMapping');
  if (rm) {
    const m = annotationArg(rm, 'method');
    if (m) {
      const verbs: string[] = [];
      for (const member of splitBraceList(m)) {
        const parts = member.split('.');
        const token = parts[parts.length - 1].toUpperCase();
        if (HTTP_METHOD_TOKENS.has(token) && !verbs.includes(token)) {
          verbs.push(token);
        }
      }
      // If nothing parsed cleanly (e.g. a constant we don't recognise),
      // fall back to GET so the endpoint is still emitted exactly once.
      return verbs.length > 0 ? verbs : ['GET'];
    }
    return ['GET'];
  }
  return ['GET'];
}

/**
 * Resolve the FULL set of method-level paths an endpoint maps to.
 *
 *  - `@GetMapping("/x")` yields `['/x']`.
 *  - `@GetMapping({"/a","/b"})` yields `['/a', '/b']` (one per alias).
 *  - A mapping annotation with NO `value` / `path` arg yields `['']` so the
 *    caller still composes exactly one full path against the base path.
 *
 * Each member is run through `normalisePath` (leading slash, trailing-slash
 * trim, quote/brace strip) so the result matches the single-value path that
 * `extractMethodPath` produced for the common case. Always returns at least
 * one entry.
 */
function extractMethodPaths(annotations: AnnotationIR[]): string[] {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(annotations, ann);
    if (!a) continue;
    const raw = annotationArg(a, 'value') || annotationArg(a, 'path');
    if (!raw) return [''];
    const members = splitBraceList(raw);
    if (members.length === 0) return [''];
    const paths: string[] = [];
    for (const member of members) {
      const p = normalisePath(member);
      if (!paths.includes(p)) paths.push(p);
    }
    return paths.length > 0 ? paths : [''];
  }
  return [''];
}

function isEndpointMethod(fn: FunctionIR): boolean {
  return ENDPOINT_ANNOTATIONS.some((n) => hasAnnotation(fn.annotations, n));
}

function extractRequestBodyType(params: ParameterIR[]): string | undefined {
  for (const p of params) if (hasAnnotation(p.annotations, 'RequestBody')) return p.type;
  return undefined;
}

// ---------------------------------------------------------------------------
// Endpoint discriminators + request-shaping inputs (Spec #4, Task Group 1)
// ---------------------------------------------------------------------------
//
// `consumes` / `produces` / `headers` / `params` on a Spring mapping make two
// handlers on the SAME path+verb DISTINCT endpoints (content-negotiation /
// param-conditional routing). We capture them onto `data` AND fold a stable,
// normalised rendering into the candidate `name` so the (type, name, filePath)
// identity save-back + LLM gap-fill dedup rely on keeps the variants apart.
// `@RequestParam` / `@RequestHeader` inputs are captured so the harness can
// vary request shape. Brace-list args are parsed via the W1 `splitBraceList`
// idiom -- `AnnotationIR` is NOT refactored to array-typed args.

/** The mapping annotation actually present on a (canonicalised) method, if
 *  any. Used to read discriminator args from the most-specific mapping. */
function findMappingAnnotation(annotations: AnnotationIR[]): AnnotationIR | undefined {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(annotations, ann);
    if (a) return a;
  }
  return undefined;
}

/** Parse a (possibly brace-list) mapping arg into normalised members. Quote
 *  stripping per member; empty members dropped. Returns [] when unset. */
function parseDiscriminatorMembers(raw: string | undefined): string[] {
  if (!raw) return [];
  return splitBraceList(raw).map((m) => m.replace(/^["\']|["\']$/g, '').trim()).filter((m) => m.length > 0);
}

/** Extract the `consumes` / `produces` / `headers` / `params` discriminators
 *  from a mapping annotation. Each is an array (possibly empty). */
function extractDiscriminators(mapping: AnnotationIR | undefined): {
  consumes: string[];
  produces: string[];
  headers: string[];
  params: string[];
} {
  return {
    consumes: parseDiscriminatorMembers(annotationArg(mapping, 'consumes')),
    produces: parseDiscriminatorMembers(annotationArg(mapping, 'produces')),
    headers: parseDiscriminatorMembers(annotationArg(mapping, 'headers')),
    params: parseDiscriminatorMembers(annotationArg(mapping, 'params')),
  };
}

/** A stable, normalised suffix folded into the endpoint `name` when ANY
 *  discriminator is present, so same path+verb variants stay DISTINCT. Members
 *  are sorted within each key and keys are emitted in a fixed order. Returns
 *  the empty string when there are no discriminators (plain mappings keep the
 *  exact `${verb} ${path}` name -- regression guard). */
function discriminatorNameSuffix(d: {
  consumes: string[];
  produces: string[];
  headers: string[];
  params: string[];
}): string {
  const parts: string[] = [];
  const render = (key: string, members: string[]) => {
    if (members.length === 0) return;
    parts.push(`${key}=${[...members].sort().join(',')}`);
  };
  render('consumes', d.consumes);
  render('produces', d.produces);
  render('headers', d.headers);
  render('params', d.params);
  return parts.length > 0 ? ` [${parts.join(';')}]` : '';
}

/** Capture `@RequestParam` inputs (name, type, required, default) so the
 *  harness can vary them. Mirrors the spring-boot adapter's extractor shape. */
function extractRequestParams(
  params: ParameterIR[],
): Array<{ name: string; type: string; required: boolean; defaultValue?: string }> {
  const out: Array<{ name: string; type: string; required: boolean; defaultValue?: string }> = [];
  for (const p of params) {
    const a = findAnnotation(p.annotations, 'RequestParam');
    if (!a) continue;
    const name = annotationArg(a, 'name') || annotationArg(a, 'value') || p.name;
    const required = annotationArg(a, 'required') !== 'false';
    const defaultValue = annotationArg(a, 'defaultValue');
    const entry: { name: string; type: string; required: boolean; defaultValue?: string } = {
      name,
      type: p.type,
      required,
    };
    if (defaultValue !== undefined) entry.defaultValue = defaultValue;
    out.push(entry);
  }
  return out;
}

/** Capture `@RequestHeader` inputs (name, type, required, default) in the same
 *  shape as `extractRequestParams` so the harness can vary request headers. */
function extractRequestHeaders(
  params: ParameterIR[],
): Array<{ name: string; type: string; required: boolean; defaultValue?: string }> {
  const out: Array<{ name: string; type: string; required: boolean; defaultValue?: string }> = [];
  for (const p of params) {
    const a = findAnnotation(p.annotations, 'RequestHeader');
    if (!a) continue;
    const name = annotationArg(a, 'name') || annotationArg(a, 'value') || p.name;
    const required = annotationArg(a, 'required') !== 'false';
    const defaultValue = annotationArg(a, 'defaultValue');
    const entry: { name: string; type: string; required: boolean; defaultValue?: string } = {
      name,
      type: p.type,
      required,
    };
    if (defaultValue !== undefined) entry.defaultValue = defaultValue;
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inherited / abstract base-controller mapping walk (Spec #4, Task Group 1)
// ---------------------------------------------------------------------------
//
// MIRRORS `collectMappedSuperclassFields`: walk `cls.extends` (bounded depth,
// `visited` cycle-guard, via the ClassIndex) to (a) pick up a class-level
// `@RequestMapping` base path from an abstract/base controller and (b) collect
// base-class handler methods the concrete controller does NOT override. The
// most-derived class-level base path wins; the inherited one is the fallback.

interface InheritedControllerMappings {
  /** The nearest inherited class-level base path (most-derived ancestor wins),
   *  or '' when no ancestor declares `@RequestMapping`. */
  inheritedBasePath: string;
  /** Base-class handler methods NOT overridden by a more-derived class, in
   *  most-derived-first order, paired with the class they were declared on. */
  inheritedMethods: Array<{ method: FunctionIR; declaredIn: string }>;
}

function collectInheritedControllerMappings(
  cls: ClassIR,
  index: ClassIndex,
  defIndex: AnnotationDefIndex,
): InheritedControllerMappings {
  const inheritedMethods: Array<{ method: FunctionIR; declaredIn: string }> = [];
  // Method names already defined on a more-derived class (the concrete
  // controller wins; a closer ancestor wins over a farther one).
  const seenMethodNames = new Set(cls.methods.map((m) => m.name));
  let inheritedBasePath = '';
  const visited = new Set<string>();
  let current = cls.extends;
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const parent = index.get(current);
    if (!parent) break;
    // (a) nearest ancestor class-level @RequestMapping base path wins.
    if (!inheritedBasePath) {
      const parentBase = extractBasePath(
        canonicaliseMappingAnnotations(parent.cls.annotations, defIndex),
      );
      if (parentBase) inheritedBasePath = parentBase;
    }
    // (b) inherited handler methods not overridden by a more-derived class.
    for (const method of parent.cls.methods) {
      if (seenMethodNames.has(method.name)) continue;
      inheritedMethods.push({ method, declaredIn: parent.cls.name });
      seenMethodNames.add(method.name);
    }
    current = parent.cls.extends;
  }
  return { inheritedBasePath, inheritedMethods };
}

// ---------------------------------------------------------------------------
// Candidate helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId,
    candidateType: type,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'spring-classic-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

// ---------------------------------------------------------------------------
// Per-class processors
// ---------------------------------------------------------------------------

interface AdapterOutput {
  candidates: DiscoveryCandidate[];
  dtoTypeNames: Set<string>;
  /**
   * Per-controller DTO references. Keyed by controller class name, value is a
   * Set of DTO type names referenced in request/response signatures. Used to
   * emit `interface_logical_entities` candidates after `emitLogicalEntities`
   * runs.
   */
  controllerToDtos: Map<string, Set<string>>;
}

/**
 * Shared per-method endpoint emission used for BOTH the controller's own
 * handler methods and base-class handler methods it inherits (Spec #4). Fans
 * out one endpoint per (verb x path) [W1] x discriminator-distinguished name,
 * capturing `consumes`/`produces`/`headers`/`params` + `@RequestParam`/
 * `@RequestHeader` inputs onto `data`.
 */
function emitEndpointsForMethod(
  method: FunctionIR,
  declaredInClassName: string,
  basePath: string,
  controllerClassName: string,
  file: SourceFileIR,
  runId: string,
  interfaceCandidateId: string,
  out: AdapterOutput,
  defIndex: AnnotationDefIndex,
): void {
  const methodAnns = canonicaliseMappingAnnotations(method.annotations, defIndex);
  if (!isEndpointMethod({ ...method, annotations: methodAnns })) return;
  const httpMethods = extractHttpMethods(methodAnns);
  const methodPaths = extractMethodPaths(methodAnns);
  const mapping = findMappingAnnotation(methodAnns);
  const discriminators = extractDiscriminators(mapping);
  const nameSuffix = discriminatorNameSuffix(discriminators);
  const requestParams = extractRequestParams(method.parameters);
  const requestHeaders = extractRequestHeaders(method.parameters);

  const rawReturnType = method.returnType;
  const unwrapped = unwrapResponseEntity(rawReturnType);
  // Bug 5 fix: unwrap generic-wrapper around @RequestBody types too
  // (`@RequestBody List<ClientLogEntry>` → `ClientLogEntry`).
  const rawRequestBodyType = extractRequestBodyType(method.parameters);
  const requestBodyType = rawRequestBodyType
    ? unwrapResponseEntity(rawRequestBodyType)
    : undefined;

  // Resolve the response DTO once (shared across every emitted combination).
  let responseType: string | undefined;
  if (unwrapped !== rawReturnType) {
    responseType = unwrapped;
  } else if (rawReturnType && rawReturnType !== 'void') {
    // Classic Spring @Controller frequently returns String (view name). Only
    // consider non-String return types as DTO candidates.
    if (rawReturnType !== 'String') responseType = rawReturnType;
  }

  // Track DTO types per-controller for `interface_logical_entities` emission.
  let perControllerDtos = out.controllerToDtos.get(controllerClassName);
  if (!perControllerDtos) {
    perControllerDtos = new Set();
    out.controllerToDtos.set(controllerClassName, perControllerDtos);
  }
  if (requestBodyType) {
    out.dtoTypeNames.add(requestBodyType);
    perControllerDtos.add(requestBodyType);
  }
  if (responseType) {
    out.dtoTypeNames.add(responseType);
    perControllerDtos.add(responseType);
  }

  for (const httpMethod of httpMethods) {
    for (const methodPath of methodPaths) {
      const fullPath = composeFullPath(basePath, methodPath);
      const data: Record<string, unknown> = {
        httpMethod,
        fullPath,
        methodName: method.name,
        controllerClassName,
        returnType: rawReturnType,
      };
      if (unwrapped !== rawReturnType) {
        data.unwrappedReturnType = unwrapped;
      }
      if (responseType) data.responseType = responseType;
      if (requestBodyType) data.requestBodyType = requestBodyType;
      // Discriminators on `data` (only when present, to keep the common
      // case's data shape unchanged).
      if (discriminators.consumes.length > 0) data.consumes = discriminators.consumes;
      if (discriminators.produces.length > 0) data.produces = discriminators.produces;
      if (discriminators.headers.length > 0) data.headers = discriminators.headers;
      if (discriminators.params.length > 0) data.params = discriminators.params;
      // Request-shaping inputs (only when present).
      if (requestParams.length > 0) data.requestParams = requestParams;
      if (requestHeaders.length > 0) data.requestHeaders = requestHeaders;
      // Record where an inherited handler was declared so a reviewer can see
      // it came from a base controller (omitted for own methods).
      if (declaredInClassName !== controllerClassName) {
        data.inheritedFrom = declaredInClassName;
      }

      out.candidates.push(
        makeCandidate(
          'endpoints',
          `${httpMethod} ${fullPath}${nameSuffix}`,
          file.filePath,
          data,
          runId,
          interfaceCandidateId,
        ),
      );
    }
  }
}

function processController(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  classIndex: ClassIndex,
  annDefIndex: AnnotationDefIndex,
): void {
  // Canonicalise class annotations so a meta-annotated / fully-qualified
  // @Controller / @RestController / @RequestMapping all resolve (Spec #4).
  const classAnns = canonicaliseMappingAnnotations(cls.annotations, annDefIndex);
  const isController = CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(classAnns, n));
  if (!isController) return;

  // Inherited / abstract base-controller mappings: a class-level base path
  // and handler methods from an abstract base the concrete controller does
  // not override (mirrors the @MappedSuperclass field walk).
  const inherited = collectInheritedControllerMappings(cls, classIndex, annDefIndex);
  // Most-derived class-level base path wins; else the inherited one.
  const ownBasePath = extractBasePath(classAnns);
  const basePath = ownBasePath || inherited.inheritedBasePath;
  const controllerType = hasAnnotation(classAnns, 'RestController') ? 'RestController' : 'Controller';

  const interfaceCandidate = makeCandidate(
    'interfaces',
    cls.name,
    file.filePath,
    {
      basePath,
      controllerType,
      // @RestController IS a REST API (Kiro 2026-08-24, same gap as the JAX-RS
      // detector). A plain @Controller is deliberately left unset: it may serve
      // MVC views rather than a REST contract, and guessing there would put a
      // wrong value in the model instead of an honest QUALITY_GAP prompt.
      ...(controllerType === 'RestController' ? { interface_type: 'REST_API' } : {}),
      className: cls.name,
      packageName: file.packageOrNamespace,
    },
    runId,
  );
  out.candidates.push(interfaceCandidate);

  // Own handler methods.
  for (const method of cls.methods) {
    emitEndpointsForMethod(
      method,
      cls.name,
      basePath,
      cls.name,
      file,
      runId,
      interfaceCandidate.id,
      out,
      annDefIndex,
    );
  }
  // Inherited (non-overridden) base-controller handler methods.
  for (const { method, declaredIn } of inherited.inheritedMethods) {
    emitEndpointsForMethod(
      method,
      declaredIn,
      basePath,
      cls.name,
      file,
      runId,
      interfaceCandidate.id,
      out,
      annDefIndex,
    );
  }
}
function emitPhysicalAttribute(
  field: FieldIR,
  entityCls: ClassIR,
  file: SourceFileIR,
  parentId: string,
  runId: string,
  out: AdapterOutput,
  inheritedFrom?: string,
): void {
  if (JPA_RELATIONSHIP_ANNOTATIONS.some((n) => hasAnnotation(field.annotations, n))) return;
  if (hasAnnotation(field.annotations, 'Transient')) return;
  if (field.modifiers.includes('static')) return;

  const idAnn = findAnnotation(field.annotations, 'Id');
  const colAnn = findAnnotation(field.annotations, 'Column');
  const columnName = annotationArg(colAnn, 'name') || field.name;
  const data: Record<string, unknown> = {
    fieldName: field.name,
    columnName,
    fieldType: field.type,
    isPrimaryKey: !!idAnn,
    isNullable: annotationArg(colAnn, 'nullable') === 'false' ? false : true,
    entityClassName: entityCls.name,
    hasColumnAnnotation: !!colAnn,
    hasIdAnnotation: !!idAnn,
  };
  if (inheritedFrom) data.inheritedFrom = inheritedFrom;
  out.candidates.push(makeCandidate('physical_data_attributes', field.name, file.filePath, data, runId, parentId));
}

function emitEntityRelationship(
  field: FieldIR,
  ownerName: string,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  inheritedFrom?: string,
): void {
  for (const rel of JPA_RELATIONSHIP_ANNOTATIONS) {
    if (!hasAnnotation(field.annotations, rel)) continue;
    let target = field.type;
    const gen = target.match(/<\s*([^<>,\s]+)\s*[,>]/);
    if (gen) target = gen[1];
    const cardinality = rel.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
    const data: Record<string, unknown> = {
      sourceEntity: ownerName,
      targetEntity: target,
      cardinality,
      relationshipType: 'association',
      fieldName: field.name,
    };
    if (inheritedFrom) data.inheritedFrom = inheritedFrom;
    out.candidates.push(
      makeCandidate('logical_data_entity_relationships', `${ownerName} → ${target}`, file.filePath, data, runId),
    );
    return;
  }
}

function processJpaEntity(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  classIndex: ClassIndex,
): void {
  if (!hasAnnotation(cls.annotations, 'Entity')) return;
  const tableAnn = findAnnotation(cls.annotations, 'Table');
  const tableName = annotationArg(tableAnn, 'name') || annotationArg(tableAnn, 'value') || cls.name;

  const entity = makeCandidate(
    'physical_data_entities',
    cls.name,
    file.filePath,
    {
      entityClassName: cls.name,
      tableName,
      schema: annotationArg(tableAnn, 'schema'),
      catalog: annotationArg(tableAnn, 'catalog'),
      packageName: file.packageOrNamespace,
    },
    runId,
  );
  out.candidates.push(entity);

  for (const field of cls.fields) {
    emitPhysicalAttribute(field, cls, file, entity.id, runId, out);
    emitEntityRelationship(field, cls.name, file, runId, out);
  }
  for (const { field, inheritedFrom } of collectMappedSuperclassFields(cls, classIndex)) {
    emitPhysicalAttribute(field, cls, file, entity.id, runId, out, inheritedFrom);
    emitEntityRelationship(field, cls.name, file, runId, out, inheritedFrom);
  }
}

/**
 * Parse a `{A.class, B.class}` (or single `A.class`) annotation arg into a
 * list of class identifiers. Used for `@Import({A.class, B.class})` and
 * `@ComponentScan(basePackageClasses = …)`. Returns `[]` for unset args.
 *
 * The Java extractor stores annotation args as raw text post-stripQuotes,
 * so a brace-wrapped class list arrives here as `"{A.class, B.class}"`.
 */
function parseClassReferenceList(raw: string | undefined): string[] {
  if (!raw) return [];
  const inner = raw
    .trim()
    .replace(/^\{/, '')
    .replace(/\}$/, '');
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/\.class$/, ''));
}

/**
 * Parse a `{"a.b", "c.d"}` (or single `"a.b"`) annotation arg into a list of
 * string values. Used for `@ComponentScan(basePackages = …)` and
 * `@ImportResource("classpath:…")`. The extractor leaves inner quotes intact
 * for brace-wrapped lists; we strip both leading and trailing quote chars.
 */
function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  const inner = raw
    .trim()
    .replace(/^\{/, '')
    .replace(/\}$/, '');
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^["']/, '').replace(/["']$/, ''));
}

/**
 * Detects `@Configuration` classes (Spring Java Config) and their `@Bean`
 * methods. Captures the cross-file wiring edges (`@Import`,
 * `@ImportResource`, `@ComponentScan`) on the configuration class's `data`
 * so reviewers can traverse the config graph without an LLM round-trip.
 *
 * Why this matters for classic Spring: codebases that follow the
 * "Spring Java Config" convention (`SubmissionSJC`, `JobComparisonSJC`,
 * `AutotesterServiceSJC`, etc.) place most of their architectural wiring
 * inside `@Configuration` classes rather than in stereotype-annotated
 * service classes. Without explicit capture, the LLM gap-fill stage has
 * to recognise each `@Configuration` class per-file and cannot see the
 * cross-file `@Import` graph at all (the LLM only sees one file at a
 * time — same blindness pattern as AngularJS `$routeProvider` bindings).
 */
function processConfigurationClass(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!hasAnnotation(cls.annotations, CONFIGURATION_ANNOTATION)) return;

  const importAnn = findAnnotation(cls.annotations, IMPORT_ANNOTATION);
  const importedConfigs = parseClassReferenceList(annotationArg(importAnn, 'value'));

  const importResourceAnn = findAnnotation(cls.annotations, IMPORT_RESOURCE_ANNOTATION);
  const importedXmlResources = parseStringList(annotationArg(importResourceAnn, 'value'));

  const scanAnn = findAnnotation(cls.annotations, COMPONENT_SCAN_ANNOTATION);
  const componentScanPackages: string[] = [];
  if (scanAnn) {
    componentScanPackages.push(...parseStringList(annotationArg(scanAnn, 'basePackages')));
    componentScanPackages.push(...parseStringList(annotationArg(scanAnn, 'value')));
    // basePackageClasses is type-safer in Spring; treat each class ref as a
    // package marker (caller can derive package from the class's location).
    componentScanPackages.push(...parseClassReferenceList(annotationArg(scanAnn, 'basePackageClasses')));
  }

  // Spring's `@Enable*` family of annotations (`@EnableTransactionManagement`,
  // `@EnableCaching`, `@EnableAspectJAutoProxy`, `@EnableScheduling`,
  // `@EnableAsync`, `@EnableWebMvc`, `@EnableConfigurationProperties`,
  // `@EnableJpaRepositories`, `@EnableMongoRepositories`, etc.) are how a
  // codebase imports framework-provided bean wiring without `@Import`. They
  // function as architectural feature flags, so we surface them as
  // `enabledFeatures` on the configuration's data. Each entry preserves
  // the args (`proxyTargetClass=true`, `order=5`) so reviewers can see the
  // exact knob settings without re-reading the source.
  const enabledFeatures: Array<{ name: string; args?: Record<string, string> }> = [];
  for (const ann of cls.annotations) {
    if (!ann.name.startsWith('Enable')) continue;
    const entry: { name: string; args?: Record<string, string> } = { name: ann.name };
    if (ann.args && Object.keys(ann.args).length > 0) entry.args = ann.args;
    enabledFeatures.push(entry);
  }

  const data: Record<string, unknown> = {
    className: cls.name,
    packageName: file.packageOrNamespace,
    springConfigKind: 'configuration',
  };
  if (importedConfigs.length > 0) data.importedConfigs = importedConfigs;
  if (importedXmlResources.length > 0) data.importedXmlResources = importedXmlResources;
  if (componentScanPackages.length > 0) data.componentScanPackages = componentScanPackages;
  if (enabledFeatures.length > 0) data.enabledFeatures = enabledFeatures;

  const configCandidate = makeCandidate('interfaces', cls.name, file.filePath, data, runId);
  out.candidates.push(configCandidate);

  // Each `@Bean` method on a `@Configuration` class is the factory for one
  // architectural element (DataSource, RestTemplate, EntityManagerFactory,
  // service collaborator, …). Emit as business_logics parented to the
  // config class so the candidate tree reflects the wiring relationship.
  for (const method of cls.methods) {
    const beanAnn = findAnnotation(method.annotations, BEAN_ANNOTATION);
    if (!beanAnn) continue;

    // Bean-name resolution: Spring accepts `@Bean(name = "x")`,
    // `@Bean("x")`, `@Bean({"x", "alias"})`, or marker `@Bean` (which
    // takes the method name as the bean name).
    const beanNameArg = annotationArg(beanAnn, 'name') ?? annotationArg(beanAnn, 'value');
    const parsedNames = beanNameArg ? parseStringList(beanNameArg) : [];
    const beanName = parsedNames.length > 0 ? parsedNames[0] : method.name;

    const beanData: Record<string, unknown> = {
      className: cls.name,
      beanName,
      returnType: method.returnType,
      parameterCount: method.parameters.length,
      methodId: method.methodId,
      beanKind: 'bean-factory',
    };
    if (parsedNames.length > 1) {
      beanData.beanAliases = parsedNames.slice(1);
    }
    // (8) 2026-04-25: capture parameter types as wiring dependencies. Spring
    // injects each `@Bean` method param either by name (if `@Qualifier` is
    // present) or by type. Recording the parameter types lets reviewers see
    // which collaborators a config bean wires together — a parallel to
    // XML beans' `dependencyRefs`.
    const paramDependencies = method.parameters
      .map((p) => p.type)
      .filter((t) => typeof t === 'string' && t.length > 0 && t !== 'unknown');
    if (paramDependencies.length > 0) {
      beanData.dependencies = paramDependencies;
    }

    out.candidates.push(
      makeCandidate(
        'business_logics',
        method.name,
        file.filePath,
        beanData,
        runId,
        configCandidate.id,
      ),
    );
  }
}

/**
 * Type guard for the loose `springXmlBeans` field on `SourceFileIR`. The
 * IR type uses `unknown` to avoid a circular import on the parser module;
 * here we narrow at the boundary.
 */
function isSpringBeansXmlResult(value: unknown): value is SpringBeansXmlResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.beans) && Array.isArray(v.componentScans) && Array.isArray(v.imports);
}

/**
 * Spring bean XML processor (2026-04-25).
 *
 * Consumes the structured bean / component-scan / import data extracted
 * by `parseSpringBeansXml` and surfaced on `SourceFileIR.springXmlBeans`.
 * Each `<bean class="...">` becomes an `interfaces` candidate with
 * `springConfigKind: 'xml-bean'`; the bean ID flows through as the
 * candidate's `name`, the simple class name lands on `data.className`,
 * dependency refs land on `data.dependencyRefs`.
 *
 * Why this matters: classic Spring projects (e.g. OpenMRS Core,
 * `applicationContext-service.xml` with 49 `<bean>` declarations) wire
 * the bulk of their architectural surface through bean XML rather than
 * `@Service` / `@Component` annotations. Without this pass, those beans
 * are invisible to the deterministic adapter and the LLM gap-fill stage
 * either misses them entirely or hallucinates them.
 *
 * Cross-XML wiring (`<import resource="…"/>`) is captured on a synthetic
 * `interfaces` candidate per XML file with `springConfigKind: 'xml-context'`
 * so reviewers can navigate the configuration graph from one entry point.
 * `<context:component-scan>` packages and `<context:property-placeholder>`
 * locations attach to that same per-file candidate.
 *
 * Bean → Java-class merge intentionally NOT done here. When a bean's
 * `class="com.foo.PatientService"` resolves to a class the Java pack
 * already emitted (`@Service`-annotated, etc.), the candidate-tree
 * reviewer will see two rows — that's a known follow-up. Per-file dedup
 * doesn't catch them either because the file paths differ. A post-pass
 * collapse keyed on simple class name is left for a future enhancement.
 */
function processSpringXmlFile(
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!isSpringBeansXmlResult(file.springXmlBeans)) return;
  const xml = file.springXmlBeans;

  // (1) Per-file context candidate when the file carries cross-XML wiring
  //     edges or component-scan boundaries. The candidate's name is the
  //     filename stem so it groups visibly in the candidate list.
  const fileBase = file.filePath.replace(/\\/g, '/').split('/').pop() ?? file.filePath;
  const contextName = fileBase.replace(/\.xml$/i, '');
  const hasContextSignals =
    xml.componentScans.length > 0 ||
    xml.imports.length > 0 ||
    xml.propertyPlaceholders.length > 0 ||
    xml.usedNamespaces.length > 0;
  if (hasContextSignals) {
    const data: Record<string, unknown> = {
      springConfigKind: 'xml-context',
      xmlFilePath: file.filePath,
    };
    const componentScanPackages = xml.componentScans.flatMap((s) => s.basePackages);
    if (componentScanPackages.length > 0) data.componentScanPackages = componentScanPackages;
    const importedXmlResources = xml.imports.map((i) => i.resource);
    if (importedXmlResources.length > 0) data.importedXmlResources = importedXmlResources;
    const propertyLocations = xml.propertyPlaceholders.flatMap((p) => p.locations);
    if (propertyLocations.length > 0) data.propertyPlaceholderLocations = propertyLocations;
    if (xml.usedNamespaces.length > 0) data.usedNamespaces = xml.usedNamespaces;
    out.candidates.push(
      makeCandidate('interfaces', contextName, file.filePath, data, runId),
    );
  }

  // (2) One `interfaces` candidate per `<bean>`. Use the bean key (id or
  //     first alias) as the candidate name so the row is stable across
  //     re-runs and unambiguous when multiple beans share the same class.
  for (const bean of xml.beans) {
    const data: Record<string, unknown> = {
      springConfigKind: 'xml-bean',
      beanKey: bean.beanKey,
      xmlFilePath: file.filePath,
    };
    if (bean.id) data.beanId = bean.id;
    if (bean.aliases.length > 0) data.beanAliases = bean.aliases;
    if (bean.fullyQualifiedClass) {
      data.fullyQualifiedClass = bean.fullyQualifiedClass;
    }
    if (bean.simpleClassName) {
      data.className = bean.simpleClassName;
    }
    if (bean.dependencyRefs.length > 0) {
      data.dependencyRefs = bean.dependencyRefs;
    }
    // (7) 2026-04-25: confidence stratification. Beans with an explicit
    // `class="…"` carry stronger signal than alias-only declarations
    // (which could be referencing an externally-defined bean). Bump
    // class-having beans above the default 0.9, drop alias-only below.
    const cand = makeCandidate('interfaces', bean.beanKey, file.filePath, data, runId);
    cand.confidence = bean.fullyQualifiedClass ? 0.9 : 0.7;
    out.candidates.push(cand);
  }
}

/**
 * Service-layer name-suffix matcher for Java interfaces. Matches
 * `*Service`, `*Provider`, `*Manager`, `*DAO`, `*Dao`, `*Repository`.
 * The trailing-`y` form (`Repository`) is intentional — this is the
 * Java-interface-of-a-Spring-data-repository case.
 */
const SERVICE_INTERFACE_NAME_SUFFIX = /(Service|Provider|Manager|DAO|Dao|Repository)$/;

/**
 * Detects Java *interfaces* (declared `interface X { … }`) that represent
 * a Spring-classic service-layer API contract. Emits each as an
 * `interfaces` candidate so the architectural picture includes the
 * service-API surface, not just the method-level `business_logics`.
 *
 * Two recognition signals (either is sufficient):
 *   1. The interface name matches `SERVICE_INTERFACE_NAME_SUFFIX` —
 *      `PatientService`, `OrderProvider`, `EncounterDAO`, etc.
 *   2. A paired implementation class exists in the scan whose name is
 *      `<InterfaceName>Impl` AND that class carries an `@Service` /
 *      `@Component` / `@Repository` stereotype — the Java-pattern for
 *      "interface contract, annotated impl".
 *
 * Bug-context (2026-04-25): the OpenMRS scan emitted 1,737
 * `business_logics` rows from ~50 service interfaces but ZERO
 * `interfaces` candidates for those service APIs. Reviewers could see
 * the methods but had no top-level row representing the contract
 * itself. This pass closes that gap.
 *
 * Excluded by name suffix (already filtered by NON_BUSINESS_LOGIC_SUFFIXES
 * applied to the Impl path): `*Formatter`, `*Converter`, `*Handler`,
 * `*Interceptor`, `*Filter`, `*Listener`, `*Adapter`, `*Mapper`,
 * `*Resolver`. Those are infrastructure utilities, not service APIs.
 */
function processServiceInterface(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  implIndex: Map<string, { cls: ClassIR }>,
): void {
  if (!cls.isInterface) return;
  // Skip interfaces that are already handled by other processors. A class
  // can't be both `isInterface` and `@Configuration`, but defend anyway.
  if (hasAnnotation(cls.annotations, CONFIGURATION_ANNOTATION)) return;

  const nameMatches = SERVICE_INTERFACE_NAME_SUFFIX.test(cls.name);
  const paired = implIndex.get(`${cls.name}Impl`);
  const pairedHasStereotype = paired
    ? SERVICE_LAYER_ANNOTATIONS.some((n) => hasAnnotation(paired.cls.annotations, n)) ||
      hasAnnotation(paired.cls.annotations, 'Component') ||
      hasAnnotation(paired.cls.annotations, 'Repository')
    : false;

  if (!nameMatches && !pairedHasStereotype) return;

  // Filter out infrastructure-named interfaces (e.g. ResourceMapper,
  // ResultsHandler) so they don't pollute the service-API surface. We can't
  // reuse NON_BUSINESS_LOGIC_SUFFIXES here because it excludes `Dao` /
  // `Repository`, which DO belong on the service-API surface — those names
  // matter for the architectural picture even though they're not
  // `business_logics`. So this is a narrower filter, omitting `Dao` and
  // `Repository`.
  const NON_SERVICE_API_SUFFIXES = /(Formatter|Converter|Handler|Interceptor|Filter|Listener|Adapter|Mapper|Resolver)$/;
  if (NON_SERVICE_API_SUFFIXES.test(cls.name)) return;

  const data: Record<string, unknown> = {
    className: cls.name,
    packageName: file.packageOrNamespace,
    springConfigKind: 'service-api',
    serviceInterfaceKind: nameMatches ? 'name-match' : 'paired-impl',
  };
  if (paired) {
    data.implClassName = `${cls.name}Impl`;
  }

  // (7) 2026-04-25: confidence stratification. Paired-impl service interfaces
  // have a stronger signal (we can see the @Service-annotated impl) than
  // name-match-only ones — bump the paired ones above the default 0.9.
  const confidence = paired ? 0.95 : 0.85;

  const cand = makeCandidate('interfaces', cls.name, file.filePath, data, runId);
  cand.confidence = confidence;
  out.candidates.push(cand);

  // (4) 2026-04-25: feed service-interface ↔ DTO links into the same
  // `controllerToDtos` machine that `processController` uses. Walk method
  // parameter types and return types — each non-primitive, non-built-in
  // class name is a candidate logical-data-entity reference. The downstream
  // `emitInterfaceLogicalEntities` will only emit a link when the named
  // class is also surfaced as a `logical_data_entities` candidate, so the
  // gate stays tight.
  const refs = out.controllerToDtos.get(cls.name) ?? new Set<string>();
  for (const method of cls.methods) {
    // Return type unwraps the same way controllers do (ResponseEntity<T>,
    // List<T>, Optional<T>, …) so DTOs nested in collections still surface.
    const ret = unwrapResponseEntity(method.returnType);
    const cleanedRet = stripGenericArgs(ret);
    if (isLikelyDtoTypeName(cleanedRet)) {
      refs.add(cleanedRet);
      out.dtoTypeNames.add(cleanedRet);
    }
    for (const p of method.parameters) {
      const pt = unwrapResponseEntity(p.type);
      const cleanedP = stripGenericArgs(pt);
      if (isLikelyDtoTypeName(cleanedP)) {
        refs.add(cleanedP);
        out.dtoTypeNames.add(cleanedP);
      }
    }
  }
  if (refs.size > 0) out.controllerToDtos.set(cls.name, refs);
}

/**
 * Strip any remaining generic args (`Map<K,V>`, `Pair<A,B>`, etc.) after
 * `unwrapResponseEntity` has done the single-generic unwrap pass. We keep
 * the OUTER name only — the inner types were already unwrapped or are
 * intentionally preserved (e.g. `Map<K,V>`).
 */
function stripGenericArgs(t: string): string {
  const idx = t.indexOf('<');
  return idx > 0 ? t.slice(0, idx).trim() : t.trim();
}

/**
 * Heuristic: a "likely DTO type name" is a PascalCase identifier that is
 * not a Java built-in. Conservative — false negatives are fine; false
 * positives feed the dedup gate which only emits when the type is also
 * surfaced as a `logical_data_entities` candidate.
 */
const JAVA_BUILTIN_TYPES = new Set([
  'void', 'boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char',
  'String', 'Object', 'Boolean', 'Byte', 'Short', 'Integer', 'Long', 'Float',
  'Double', 'Character', 'Number', 'BigDecimal', 'BigInteger',
  'Date', 'LocalDate', 'LocalDateTime', 'LocalTime', 'Instant', 'Duration',
  'OffsetDateTime', 'ZonedDateTime', 'UUID',
  'Collection', 'List', 'Set', 'Map', 'Optional', 'Stream', 'Iterable',
]);
function isLikelyDtoTypeName(t: string): boolean {
  if (!t) return false;
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(t)) return false;
  if (JAVA_BUILTIN_TYPES.has(t)) return false;
  return true;
}

/**
 * AOP capture (2026-04-25). `@Aspect`-annotated classes encode cross-cutting
 * rules (transactions, security, auditing, logging, validation) and carry
 * advice methods (`@Before`, `@After`, `@Around`, `@AfterReturning`,
 * `@AfterThrowing`) plus named `@Pointcut` definitions.
 *
 * Emit the aspect class itself as `interfaces` with `springConfigKind: 'aop-aspect'`,
 * and each advice method as `business_logics` parented to the aspect, with
 * `data.adviceKind` carrying the advice type and `data.pointcutExpression`
 * carrying the parsed expression text. This makes the cross-cutting layer
 * a first-class architectural surface instead of relying on LLM gap-fill.
 */
function processAspectClass(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!hasAnnotation(cls.annotations, ASPECT_ANNOTATION)) return;

  const aspectData: Record<string, unknown> = {
    className: cls.name,
    packageName: file.packageOrNamespace,
    springConfigKind: 'aop-aspect',
  };

  const aspect = makeCandidate('interfaces', cls.name, file.filePath, aspectData, runId);
  out.candidates.push(aspect);

  for (const method of cls.methods) {
    // Advice method — emit with the kind hint and the pointcut expression.
    const matchingAdvice = ADVICE_ANNOTATIONS.find((n) =>
      hasAnnotation(method.annotations, n),
    );
    const isPointcut = hasAnnotation(method.annotations, POINTCUT_ANNOTATION);
    if (!matchingAdvice && !isPointcut) continue;

    const data: Record<string, unknown> = {
      className: cls.name,
      returnType: method.returnType,
      parameterCount: method.parameters.length,
      methodId: method.methodId,
    };
    if (matchingAdvice) {
      const adviceAnn = findAnnotation(method.annotations, matchingAdvice);
      data.adviceKind = matchingAdvice;
      const expr = annotationArg(adviceAnn, 'value') ?? annotationArg(adviceAnn, 'pointcut');
      if (expr) data.pointcutExpression = expr;
    }
    if (isPointcut) {
      const pcAnn = findAnnotation(method.annotations, POINTCUT_ANNOTATION);
      data.adviceKind = 'Pointcut';
      const expr = annotationArg(pcAnn, 'value');
      if (expr) data.pointcutExpression = expr;
    }
    out.candidates.push(
      makeCandidate(
        'business_logics',
        method.name,
        file.filePath,
        data,
        runId,
        aspect.id,
      ),
    );
  }
}

/**
 * Message-driven + scheduled (2026-04-25). Methods annotated `@JmsListener`,
 * `@KafkaListener`, `@RabbitListener`, `@SqsListener`, `@EventListener`,
 * `@Scheduled` are inbound async surfaces — architecturally equivalent to
 * HTTP endpoints. Emit each as `endpoints` with `endpoint_subtype` carrying
 * the listener flavour and `data` capturing destination / cron / event-type.
 *
 * The `name` follows a convention `<SUBTYPE> <DEST>` so the row groups
 * recognisably alongside HTTP endpoints in the candidate list:
 *   `JMS-LISTENER /queue.orders`
 *   `SCHEDULED 0 0 * * * *` (cron)
 *   `EVENT-LISTENER UserCreatedEvent`
 */
function processMessageAndScheduledMethods(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  for (const method of cls.methods) {
    for (const [annotationName, subtype] of Object.entries(MESSAGE_LISTENER_ANNOTATIONS)) {
      const ann = findAnnotation(method.annotations, annotationName);
      if (!ann) continue;
      const data: Record<string, unknown> = {
        className: cls.name,
        methodName: method.name,
        endpoint_subtype: subtype,
        listenerAnnotation: annotationName,
      };
      let identifier: string = method.name;

      if (annotationName === 'JmsListener' || annotationName === 'RabbitListener') {
        const dest =
          annotationArg(ann, 'destination') ??
          annotationArg(ann, 'queues') ??
          annotationArg(ann, 'value');
        if (dest) {
          data.destination = dest;
          identifier = dest;
        }
      } else if (annotationName === 'KafkaListener') {
        const topics = annotationArg(ann, 'topics') ?? annotationArg(ann, 'topicPattern');
        if (topics) {
          data.topics = topics;
          identifier = topics;
        }
      } else if (annotationName === 'SqsListener') {
        const value = annotationArg(ann, 'value');
        if (value) {
          data.queues = value;
          identifier = value;
        }
      } else if (annotationName === 'EventListener') {
        const classes = annotationArg(ann, 'classes') ?? annotationArg(ann, 'value');
        if (classes) {
          data.eventTypes = classes;
          identifier = classes;
        }
      } else if (annotationName === 'Scheduled') {
        const cron = annotationArg(ann, 'cron');
        const fixedRate = annotationArg(ann, 'fixedRate');
        const fixedDelay = annotationArg(ann, 'fixedDelay');
        if (cron) {
          data.cron = cron;
          identifier = cron;
        } else if (fixedRate) {
          data.fixedRate = fixedRate;
          identifier = `fixedRate=${fixedRate}`;
        } else if (fixedDelay) {
          data.fixedDelay = fixedDelay;
          identifier = `fixedDelay=${fixedDelay}`;
        }
      }

      const upperSubtype = subtype.toUpperCase();
      // Kiro 2026-08-24: two @Scheduled methods with the SAME fixedDelay
      // minted identically-named candidates and one was deduped away (the
      // access-info twin asymmetry). The class.method suffix makes every
      // scheduled/listener root unique while keeping the grouping prefix.
      const endpointName = `${upperSubtype} ${identifier} ${cls.name}.${method.name}`;
      data.fullPath = identifier; // satisfies the structured-metadata gate path requirement
      data.httpMethod = upperSubtype.replace(/-/g, '_');
      out.candidates.push(
        makeCandidate('endpoints', endpointName, file.filePath, data, runId),
      );
    }
  }
}

/**
 * Outbound integration capture (2026-04-25), Phase 1.
 *
 * Two paths:
 *  - `@FeignClient`-annotated interfaces: declarative HTTP clients. The
 *    interface itself is the `interfaces` candidate (with `data.feignName`,
 *    `data.feignUrl`); each method on the interface becomes an outbound
 *    `endpoints` candidate with `data.httpMethod`/`fullPath` derived from
 *    the method's mapping annotation (`@GetMapping`, etc.).
 *  - `RestTemplate.<verb>(url)` and `webClient.<verb>(...).uri(url)`
 *    call sites in regular service classes: parsed from `file.rawContent`
 *    (Java IR doesn't model call expressions). Emit as outbound `endpoints`
 *    with `endpoint_subtype: 'outbound-rest'`.
 *
 * The RestTemplate/WebClient regex path is heuristic — it captures URLs
 * from string-literal first arguments only. Variable-bound URLs and
 * complex builders fall through (the LLM gap-fill prompt still asks for
 * those). Designed to over-capture rather than under-capture; review can
 * dismiss false positives.
 */
function processOutboundIntegrations(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  // --- @FeignClient interfaces -------------------------------------------
  if (cls.isInterface && hasAnnotation(cls.annotations, FEIGN_CLIENT_ANNOTATION)) {
    const feignAnn = findAnnotation(cls.annotations, FEIGN_CLIENT_ANNOTATION);
    const feignName = annotationArg(feignAnn, 'name') ?? annotationArg(feignAnn, 'value');
    const feignUrl = annotationArg(feignAnn, 'url');
    const data: Record<string, unknown> = {
      className: cls.name,
      packageName: file.packageOrNamespace,
      springConfigKind: 'feign-client',
      integrationKind: 'outbound-rest',
    };
    if (feignName) data.feignName = feignName;
    if (feignUrl) data.feignUrl = feignUrl;

    const feignIface = makeCandidate('interfaces', cls.name, file.filePath, data, runId);
    out.candidates.push(feignIface);

    // Each method on a Feign client maps to one outbound HTTP call. Bug W1
    // (2026-05-30): honour multi-verb / multi-path mappings here too (a Feign
    // method can carry `@RequestMapping(method = {...})` / `@GetMapping({...})`
    // just like a controller) -- fan out one outbound endpoint per
    // (verb x path) combination.
    for (const method of cls.methods) {
      if (!isEndpointMethod(method)) continue;
      const httpMethods = extractHttpMethods(method.annotations);
      const methodPaths = extractMethodPaths(method.annotations);
      for (const httpMethod of httpMethods) {
        for (const methodPath of methodPaths) {
          const fullPath = methodPath || '/';
          const epData: Record<string, unknown> = {
            httpMethod,
            fullPath,
            methodName: method.name,
            controllerClassName: cls.name,
            endpoint_subtype: 'outbound-rest',
            integrationKind: 'feign',
          };
          if (feignName) epData.feignName = feignName;
          out.candidates.push(
            makeCandidate(
              'endpoints',
              `${httpMethod} ${fullPath}`,
              file.filePath,
              epData,
              runId,
              feignIface.id,
            ),
          );
        }
      }
    }
  }

  // --- RestTemplate / WebClient call-site regex --------------------------
  // Only fires on classes that look like service-layer beans (annotated
  // `@Service` / `@Component` / `@Repository`, or name-suggested) so the
  // regex doesn't run over every Java file in the repo.
  const isStereotyped =
    SERVICE_LAYER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n)) ||
    hasAnnotation(cls.annotations, 'Component') ||
    hasAnnotation(cls.annotations, 'Repository') ||
    /(Service|Provider|Manager|Validator)$/.test(cls.name);
  if (!isStereotyped) return;
  if (!file.rawContent) return;

  // Match `<obj>.<getForObject|postForObject|exchange|...>(<quoted-url>, ...)`
  // for RestTemplate, and the `webClient.<verb>().uri("...")` chain for
  // WebClient. We scan the entire file body — `cls` matters only for the
  // gating decision above.
  const seen = new Set<string>();
  const restTemplateVerbRe =
    /\b(\w+)\.(getForObject|getForEntity|postForObject|postForEntity|postForLocation|put|delete|exchange|execute)\s*\(\s*(['"`])([^'"`]+)\3/g;
  let m: RegExpExecArray | null;
  while ((m = restTemplateVerbRe.exec(file.rawContent)) !== null) {
    const [, varName, verb, , url] = m;
    if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) continue;
    let httpMethod = 'GET';
    if (verb.startsWith('post')) httpMethod = 'POST';
    else if (verb === 'put') httpMethod = 'PUT';
    else if (verb === 'delete') httpMethod = 'DELETE';
    else if (verb === 'exchange' || verb === 'execute') httpMethod = 'METHOD?';
    const key = `${httpMethod} ${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.candidates.push(
      makeCandidate(
        'endpoints',
        key,
        file.filePath,
        {
          httpMethod,
          fullPath: url,
          callSiteVar: varName,
          callSiteVerb: verb,
          endpoint_subtype: 'outbound-rest',
          integrationKind: 'rest-template',
        },
        runId,
      ),
    );
  }

  // WebClient builder chain: `someClient.<verb>().uri("...")` — verb is
  // get/post/put/delete/patch/method.
  const webClientRe =
    /\b\w+\s*\.\s*(get|post|put|delete|patch|method)\s*\(\s*\)\s*\.\s*uri\s*\(\s*(['"`])([^'"`]+)\2/g;
  while ((m = webClientRe.exec(file.rawContent)) !== null) {
    const [, verb, , url] = m;
    if (!url.startsWith('/') && !/^https?:\/\//i.test(url)) continue;
    const httpMethod = verb.toUpperCase();
    const key = `${httpMethod} ${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.candidates.push(
      makeCandidate(
        'endpoints',
        key,
        file.filePath,
        {
          httpMethod,
          fullPath: url,
          callSiteVerb: verb,
          endpoint_subtype: 'outbound-rest',
          integrationKind: 'webclient',
        },
        runId,
      ),
    );
  }
}

function processServiceLayerBusinessLogic(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  interfaceNameSet: Set<string>,
): void {
  if (NON_BUSINESS_LOGIC_SUFFIXES.test(cls.name)) return;
  // `@Configuration` classes are handled by `processConfigurationClass` — its
  // `@Bean` methods are the canonical business_logics surface. Without this
  // guard, name-suggesting configs (`*Manager`, `*Service`) would emit every
  // public method twice (once parented to the config, once not).
  if (hasAnnotation(cls.annotations, CONFIGURATION_ANNOTATION)) return;
  // Same idea: `@Aspect` classes are handled by `processAspectClass` — its
  // advice methods are emitted there with proper kind hints. Don't re-emit.
  if (hasAnnotation(cls.annotations, ASPECT_ANNOTATION)) return;
  // Plumbing classes (formatters, converters, handlers, mappers, dao,
  // repository, …) are not business logic. The deny-list pre-empts the
  // stereotype/name/transactional gates below.
  if (NON_BUSINESS_LOGIC_SUFFIXES.test(cls.name)) return;
  // Three independent triggers: explicit stereotype annotation, domain-
  // flavoured name suffix, or any @Transactional (class- or method-level).
  const stereotyped = SERVICE_LAYER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n))
    || hasAnnotation(cls.annotations, TRANSACTIONAL_ANNOTATION)
    || cls.methods.some((m) => hasAnnotation(m.annotations, TRANSACTIONAL_ANNOTATION));
  const nameSuggests = SERVICE_NAME_SUFFIX_RE.test(cls.name);
  if (!stereotyped && !nameSuggests) return;

  // Bug 16 fix (2026-04-22): `FooService` interface + `FooServiceImpl` class
  // pattern causes every method to be emitted twice because both sides pass
  // the stereotype/name-suggests gate. Java guidance prefers the interface
  // as the canonical candidate carrier, so when this class is `*Impl` AND
  // the matching non-Impl interface exists in the scan, skip this class —
  // the interface will cover all public methods. A service with no paired
  // interface (e.g. `StandaloneUtilService`) still emits from the class.
  if (!cls.isInterface && cls.name.endsWith('Impl')) {
    const base = cls.name.slice(0, -'Impl'.length);
    if (interfaceNameSet.has(base)) {
      return;
    }
  }

  // Bug 2 fix: de-duplicate overloads on (className, methodName) — the
  // meta-model's `business_logics` is signature-less. Bug 1 (anonymous
  // inner-class method leak) is fixed in the Java extractor.
  const seenMethodNames = new Set<string>();
  for (const method of cls.methods) {
    // Bug 16 fix (2026-04-22): Java interface methods are implicitly
    // public but the parser doesn't synthesize the modifier. Accept any
    // method on an interface; for classes require the explicit `public`.
    if (!cls.isInterface && !method.modifiers.includes('public')) continue;
    if (cls.isInterface && (method.modifiers.includes('private') || method.modifiers.includes('default'))) {
      // Skip interface private helpers (Java 9+) and default methods that
      // are implementation detail rather than part of the public contract.
      // Default methods may still be useful domain logic — keep them if you
      // prefer; skipping here keeps the emission to the contract surface.
      continue;
    }
    if (method.name === 'toString' || method.name === 'equals' || method.name === 'hashCode') continue;
    // Bug 3 fix: zero-arg `get*/set*/is*` skip is a safety net for
    // name-suggests classes ONLY. On an explicit @Service / @Component /
    // @Repository, a zero-arg `getFactTypes()` IS the public API.
    if (!stereotyped && method.parameters.length === 0 && /^(get|set|is)[A-Z]/.test(method.name)) continue;
    if (seenMethodNames.has(method.name)) continue;
    seenMethodNames.add(method.name);
    out.candidates.push(
      makeCandidate('business_logics', method.name, file.filePath, {
        className: cls.name,
        returnType: method.returnType,
        parameterCount: method.parameters.length,
      methodId: method.methodId,
      }, runId),
    );
  }
}

/**
 * Suffix patterns that strongly indicate a class is a DTO / domain-model
 * carrier. These are the classes a UI-tier or aggregator service typically
 * defines; without a naming-convention path here, they're invisible to the
 * adapter unless they happen to appear in a controller's request/response
 * signature. Added 2026-04-28 (P2 of the spring-classic improvements).
 *
 * Skipped: classes annotated with `@Entity` (those are persistence-layer,
 * already emitted as `physical_data_entities`); classes already emitted via
 * the controller-reference path (deduped by name).
 */
const DTO_NAME_SUFFIX_RE = /(View|Dto|DTO|Request|Response|Form|Command)$/;

/**
 * Lombok DTO markers (P4). Any class carrying one of these annotations is
 * almost certainly a data-shaped class, regardless of name. The Lombok
 * processor synthesises getters/setters, equals/hashCode, builders etc.
 * at compile time, so the source-class shape is just fields. The IR
 * captures the annotation list verbatim so we read them directly here.
 */
const LOMBOK_DTO_ANNOTATIONS = ['Data', 'Value', 'Builder'];

function emitLogicalEntityFromDtoClass(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  source: string,
): string {
  const logical = makeCandidate(
    'logical_data_entities',
    cls.name,
    file.filePath,
    {
      className: cls.name,
      packageName: file.packageOrNamespace,
      source, // e.g. 'controller-reference', 'name-suffix', 'lombok'
    },
    runId,
  );
  out.candidates.push(logical);
  for (const field of cls.fields) {
    if (field.modifiers.includes('static')) continue;
    out.candidates.push(
      makeCandidate('logical_data_attributes', field.name, file.filePath, {
        fieldName: field.name,
        dataType: field.type,
        logicalEntityName: cls.name,
      }, runId, logical.id),
    );
  }
  return logical.id;
}

function emitLogicalEntities(files: SourceFileIR[], runId: string, out: AdapterOutput): void {
  // Pass 1 — classes already referenced by controller request/response
  // signatures (the original behaviour).
  const emittedNames = new Set<string>();
  if (out.dtoTypeNames.size > 0) {
    const normalized = new Set<string>();
    for (const n of out.dtoTypeNames) normalized.add(n.replace(/\[\]$/, '').trim());

    for (const file of files) {
      for (const cls of file.classes) {
        if (!normalized.has(cls.name)) continue;
        if (hasAnnotation(cls.annotations, 'Entity')) continue;
        if (emittedNames.has(cls.name)) continue;
        emitLogicalEntityFromDtoClass(cls, file, runId, out, 'controller-reference');
        emittedNames.add(cls.name);
      }
    }
  }

  // Pass 2 — classes detected by naming convention (P2) or Lombok
  // annotations (P4). These widen coverage to UI-tier / aggregator
  // codebases where most domain classes never appear in a controller
  // signature. `@Entity` and emission-already-happened both short-circuit.
  for (const file of files) {
    for (const cls of file.classes) {
      if (emittedNames.has(cls.name)) continue;
      if (hasAnnotation(cls.annotations, 'Entity')) continue;
      // Skip controller / config / aspect classes — they're handled by
      // their own emission paths and are not data-carrier shapes.
      if (CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n))) continue;
      if (hasAnnotation(cls.annotations, CONFIGURATION_ANNOTATION)) continue;
      if (hasAnnotation(cls.annotations, ASPECT_ANNOTATION)) continue;
      if (hasAnnotation(cls.annotations, FEIGN_CLIENT_ANNOTATION)) continue;
      // Skip classes that are clearly stereotype service-layer — they're
      // emitted as business_logics, not data.
      if (SERVICE_LAYER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n))) continue;
      if (hasAnnotation(cls.annotations, TRANSACTIONAL_ANNOTATION)) continue;
      // Skip plumbing suffixes (Formatter, Converter, etc.).
      if (NON_BUSINESS_LOGIC_SUFFIXES.test(cls.name)) continue;
      // Skip service-name suffixes — they're business_logics, not data.
      if (SERVICE_NAME_SUFFIX_RE.test(cls.name)) continue;

      const isLombok = LOMBOK_DTO_ANNOTATIONS.some((a) => hasAnnotation(cls.annotations, a));
      const isSuffixDto = DTO_NAME_SUFFIX_RE.test(cls.name);
      if (!isLombok && !isSuffixDto) continue;
      // A DTO without fields is almost certainly not a real DTO — could be
      // a marker interface or a constants-only class. Skip to avoid noise.
      if (cls.fields.length === 0) continue;

      const source = isLombok ? 'lombok' : 'name-suffix';
      emitLogicalEntityFromDtoClass(cls, file, runId, out, source);
      emittedNames.add(cls.name);
    }
  }
}


/**
 * Detect physical entities (tables) from JdbcTemplate-style SQL strings.
 *
 * Many classic Spring services predate JPA and persist via `JdbcTemplate` /
 * `NamedParameterJdbcTemplate`. Without an `@Entity` to scan, the
 * physical-data-entity surface is invisible to the adapter. This pass
 * fills the gap by:
 *
 *   1. Locating classes that hold a `JdbcTemplate*` field or take one as a
 *      method parameter — these are the persistence-touching classes.
 *   2. Scanning the file's `rawContent` for SQL keywords (`FROM`, `JOIN`,
 *      `INTO`, `UPDATE … SET`) followed by a SQL identifier — that
 *      identifier is the table name.
 *   3. Emitting one `physical_data_entities` candidate per distinct table
 *      not already covered by a JPA `@Entity`-derived emission.
 *
 * Admin / diagnostic classes (`*Admin`, `*Diagnostic`, `*Health`,
 * `*Status`, `*Stat`, `*Audit`, `*Cache`-suffixed) are excluded — their
 * SQL is operational, not domain. Reserved-word matches (`SELECT FROM
 * WHERE` etc.) and identifiers shorter than 3 chars are filtered out to
 * suppress false positives.
 *
 * Added 2026-04-28 (P6 of the spring-classic improvements).
 */
const JDBC_TEMPLATE_TYPES = new Set([
  'JdbcTemplate',
  'NamedParameterJdbcTemplate',
  'JdbcOperations',
  'NamedParameterJdbcOperations',
  'SimpleJdbcTemplate', // legacy
]);

const SQL_RESERVED_WORDS = new Set([
  'WHERE', 'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'ON', 'AND', 'OR',
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'JOIN', 'INNER', 'OUTER', 'LEFT', 'RIGHT', 'FULL',
  'UNION', 'INTERSECT', 'EXCEPT', 'WITH', 'VALUES', 'SET', 'TABLE', 'INTO', 'FROM',
  'EXISTS', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'CROSS', 'NATURAL', 'USING', 'DUAL', 'TRUE', 'FALSE',
]);

const OPERATIONAL_CLASS_NAME_RE = /(Admin|Diagnostic|Health|Status|Stat|Audit|Cache|Lock)([A-Z][A-Za-z0-9]*)?$/;

function classUsesJdbcTemplate(cls: ClassIR): boolean {
  const stripGenerics = (t: string) => t.replace(/<.*$/, '').trim();
  for (const f of cls.fields) {
    if (JDBC_TEMPLATE_TYPES.has(stripGenerics(f.type))) return true;
  }
  for (const m of cls.methods) {
    for (const p of m.parameters) {
      if (JDBC_TEMPLATE_TYPES.has(stripGenerics(p.type))) return true;
    }
  }
  return false;
}

function extractSqlTablesFromContent(content: string): string[] {
  // Identifier shape: optional schema prefix, identifier with at least 3
  // chars and no leading digit. Schema-qualified identifiers like
  // `dbo.customers` keep both parts.
  const ID = '[A-Za-z_][A-Za-z0-9_]{2,}';
  const QUALIFIED = `${ID}(?:\\.${ID})?`;
  const patterns: RegExp[] = [
    new RegExp(`\\b(?:FROM|JOIN)\\s+(${QUALIFIED})\\b`, 'gi'),
    new RegExp(`\\bINTO\\s+(${QUALIFIED})\\b`, 'gi'),
    new RegExp(`\\bUPDATE\\s+(${QUALIFIED})\\s+SET\\b`, 'gi'),
  ];
  const tables = new Set<string>();
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const tail = (m[1].split('.').pop() || m[1]).toUpperCase();
      if (SQL_RESERVED_WORDS.has(tail)) continue;
      tables.add(m[1]);
    }
  }
  return [...tables];
}

function emitJdbcDerivedPhysicalEntities(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  // Build the set of physical-entity tables already emitted (e.g. by the
  // JPA pass). JPA wins — JDBC fallback only fills gaps.
  const existingTables = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType !== 'physical_data_entities') continue;
    const d = (c.data as Record<string, unknown> | undefined) ?? {};
    const t = String(d.tableName ?? c.name ?? '').trim();
    if (t.length > 0) existingTables.add(t.toLowerCase());
  }

  for (const file of files) {
    if (!file.rawContent) continue;
    // Find the persistence-touching class(es) in this file.
    const persistenceClasses = file.classes.filter((c) => classUsesJdbcTemplate(c));
    if (persistenceClasses.length === 0) continue;
    // Skip if every persistence class is operational.
    const domainClasses = persistenceClasses.filter((c) => !OPERATIONAL_CLASS_NAME_RE.test(c.name));
    if (domainClasses.length === 0) continue;

    const tables = extractSqlTablesFromContent(file.rawContent);
    if (tables.length === 0) continue;

    for (const raw of tables) {
      const parts = raw.split('.');
      const tableName = parts.length > 1 ? parts[1] : parts[0];
      const schema = parts.length > 1 ? parts[0] : null;
      const lower = tableName.toLowerCase();
      if (existingTables.has(lower)) continue;
      existingTables.add(lower);
      const data: Record<string, unknown> = {
        tableName,
        source: 'jdbc-sql',
        extractorKind: 'jdbc-template',
        detectedInClass: domainClasses[0].name,
      };
      if (schema) data.schema = schema;
      out.candidates.push(
        makeCandidate('physical_data_entities', tableName, file.filePath, data, runId),
      );
    }
  }
}

/**
 * Emit `logical_data_entity_relationships` candidates between any pair of
 * emitted `logical_data_entities` whose typed fields cross-reference.
 *
 * Example: if `TradeView` has a field `private ClientView client` and both
 * are emitted as logical entities, this emits a `TradeView → ClientView`
 * relationship with cardinality `ONE_TO_ONE`. List/Set/Collection/array
 * wrappers map to `ONE_TO_MANY`.
 *
 * Dedupes per `(source, target)` pair so a class with five fields of the
 * same target type doesn't produce five duplicate relationships. Skips
 * primitive-typed and unknown-typed fields. Does not emit JPA-style
 * relationships (those come from the per-field `@OneToMany`/`@ManyToOne`
 * pass via `emitJpaEntityRelationship`).
 *
 * Added 2026-04-28 (P3 of the spring-classic improvements). The same
 * pattern would suit spring-boot — TODO if it shows value here first.
 */
function emitLogicalEntityRelationships(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  // Build the set of emitted logical-entity class names. Only fields whose
  // type matches one of these counts as a relationship target.
  const emittedLogicalEntities = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType === 'logical_data_entities') emittedLogicalEntities.add(c.name);
  }
  if (emittedLogicalEntities.size < 2) return; // need at least two to form a relationship

  // Walk each file's classes and emit relationships when fields cross-ref.
  const seenPairs = new Set<string>();
  for (const file of files) {
    for (const cls of file.classes) {
      if (!emittedLogicalEntities.has(cls.name)) continue;
      for (const field of cls.fields) {
        if (field.modifiers.includes('static')) continue;
        // Skip JPA-relationship fields — those are handled by the
        // physical-entity-relationship path and are physical, not logical.
        if (JPA_RELATIONSHIP_ANNOTATIONS.some((n) => hasAnnotation(field.annotations, n))) continue;

        const rawType = field.type;
        if (!rawType || rawType === 'unknown') continue;
        // Detect collection wrapper for cardinality. Match List<X>, Set<X>,
        // Collection<X>, Iterable<X>, array X[]. Mono/Optional/Future are
        // ONE_TO_ONE (the wrapper is reactive/async, not a multi-valued ref).
        let cardinality: 'ONE_TO_ONE' | 'ONE_TO_MANY' = 'ONE_TO_ONE';
        let inner = rawType.trim();
        const arrayM = inner.match(/^(.+)\[\]$/);
        if (arrayM) {
          cardinality = 'ONE_TO_MANY';
          inner = arrayM[1].trim();
        } else {
          const collM = inner.match(/^(List|Set|Collection|Iterable|Stream)\s*<\s*([^,<>]+)\s*>$/);
          if (collM) {
            cardinality = 'ONE_TO_MANY';
            inner = collM[2].trim();
          } else {
            // Strip Optional / Mono / Future single-generic wrappers without
            // changing cardinality.
            const wrapM = inner.match(/^(Optional|Mono|CompletableFuture|Future|Callable)\s*<\s*([^,<>]+)\s*>$/);
            if (wrapM) inner = wrapM[2].trim();
          }
        }
        // Strip any remaining `<…>` from generic types we don't unwrap.
        inner = inner.replace(/<.*$/, '').trim();

        if (!emittedLogicalEntities.has(inner)) continue;
        if (inner === cls.name) continue; // skip self-references (often parent/child trees)
        const pairKey = `${cls.name}→${inner}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);

        out.candidates.push(
          makeCandidate(
            'logical_data_entity_relationships',
            `${cls.name} → ${inner}`,
            file.filePath,
            {
              sourceEntity: cls.name,
              targetEntity: inner,
              cardinality,
              relationshipType: 'composition',
              fieldName: field.name,
              source: 'logical-field-typing',
            },
            runId,
          ),
        );
      }
    }
  }
}

/**
 * Emit logical↔physical mapping relationships for JPA / HBM-XML entities.
 *
 * In JPA (and Hibernate HBM XML, which is merged into the JPA path by
 * `hbmXmlMerge.ts`), a single Java class plays two architectural roles:
 *   - The in-memory class shape is the *logical* data entity (the
 *     conceptual object travelling through the codebase).
 *   - The `@Table` (or HBM `<class table>`) declaration is the *physical*
 *     data entity (the persisted storage row).
 *
 * Today the adapter emits the JPA class only as `physical_data_entities`
 * (and skips it in `emitLogicalEntities`). This pass:
 *   1. Finds every `physical_data_entities` carrying `data.entityClassName`
 *      (JPA-derived; JDBC-template-derived rows have no class behind them
 *      and are skipped).
 *   2. Emits a paired `logical_data_entities` for the class (unless one
 *      already exists — e.g., a class matched both `@Entity` and a DTO
 *      suffix, in which case we just link to the existing one).
 *   3. Emits a `logical_data_entity_physical_data_entities` link.
 *   4. For each `physical_data_attributes` parented to the physical entity,
 *      emits a paired `logical_data_attributes` parented to the new
 *      logical entity, and a
 *      `logical_data_attribute_physical_data_attributes` link.
 *
 * Net effect: one JPA `@Entity Customer { id; name; }` produces, in
 * addition to its existing `physical_data_entities` + 2 ×
 * `physical_data_attributes`, ALSO 1 × `logical_data_entities` + 2 ×
 * `logical_data_attributes` + 1 entity-link + 2 attribute-links.
 *
 * Cardinality is bounded 1:1 by what the adapter already extracts; no
 * count explosion. JDBC-derived physical entities (no Java class) are
 * intentionally skipped — there is no logical class to link to.
 */
function emitLogicalPhysicalMappings(out: AdapterOutput, runId: string): void {
  // Snapshot the current candidate set — we'll push to `out.candidates`
  // while iterating, so reading the snapshot keeps the loop bounded.
  const snapshot = [...out.candidates];

  // Index existing logical_data_entities by name so we can skip duplicate
  // emission and reuse the existing logical for the link.
  const logicalByName = new Map<string, DiscoveryCandidate>();
  for (const c of snapshot) {
    if (c.candidateType === 'logical_data_entities') {
      logicalByName.set(c.name, c);
    }
  }

  // For each JPA-derived physical entity, ensure a paired logical entity
  // exists, then emit the entity-level link. Track the physical→logical
  // mapping so the attribute pass can find the right logical parent.
  const logicalByPhysicalId = new Map<string, DiscoveryCandidate>();
  for (const c of snapshot) {
    if (c.candidateType !== 'physical_data_entities') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    const className = data.entityClassName as string | undefined;
    if (!className) continue; // JDBC-derived: skip
    const filePath = c.sourceClusterIds[0] ?? '';

    let logical = logicalByName.get(className);
    if (!logical) {
      logical = makeCandidate(
        'logical_data_entities',
        className,
        filePath,
        {
          className,
          packageName: data.packageName,
          source: 'jpa-entity',
        },
        runId,
      );
      out.candidates.push(logical);
      logicalByName.set(className, logical);
    }
    logicalByPhysicalId.set(c.id, logical);

    const tableName = (data.tableName as string | undefined) ?? c.name;
    out.candidates.push(
      makeCandidate(
        'logical_data_entity_physical_data_entities',
        `${className} ⇆ ${tableName}`,
        filePath,
        {
          logicalEntityName: className,
          physicalEntityName: c.name,
          physicalTableName: tableName,
          source: 'jpa-entity',
        },
        runId,
      ),
    );
  }

  // Attribute pass — for each physical attribute whose parent we mapped
  // above, emit the paired logical attribute and the attribute-level link.
  for (const c of snapshot) {
    if (c.candidateType !== 'physical_data_attributes') continue;
    if (!c.parentCandidateId) continue;
    const parentLogical = logicalByPhysicalId.get(c.parentCandidateId);
    if (!parentLogical) continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    const fieldName = (data.fieldName as string | undefined) ?? c.name;
    const columnName = (data.columnName as string | undefined) ?? fieldName;
    const filePath = c.sourceClusterIds[0] ?? '';

    const logicalAttr = makeCandidate(
      'logical_data_attributes',
      fieldName,
      filePath,
      {
        fieldName,
        dataType: data.fieldType,
        logicalEntityName: parentLogical.name,
        isPrimaryKey: data.isPrimaryKey,
        source: 'jpa-entity',
      },
      runId,
      parentLogical.id,
    );
    out.candidates.push(logicalAttr);

    out.candidates.push(
      makeCandidate(
        'logical_data_attribute_physical_data_attributes',
        `${fieldName} ⇆ ${columnName}`,
        filePath,
        {
          logicalAttributeName: fieldName,
          physicalAttributeName: c.name,
          physicalColumnName: columnName,
          logicalEntityName: parentLogical.name,
          source: 'jpa-entity',
        },
        runId,
      ),
    );
  }
}

/**
 * Emit `interface_logical_entities` candidates for (controller, DTO) pairs.
 *
 * Per-interface granularity: if `OwnerController` has 5 endpoints all using
 * `OwnerDto`, this emits exactly ONE `interface_logical_entities` candidate
 * named `OwnerController -> OwnerDto` (ASCII arrow, single spaces).
 *
 * Only emits when the DTO was also emitted as a `logical_data_entities`
 * candidate (i.e. the DTO class is defined in the scanned codebase).
 */
function emitInterfaceLogicalEntities(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  if (out.controllerToDtos.size === 0) return;

  const emittedLogicalEntities = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType === 'logical_data_entities') {
      emittedLogicalEntities.add(c.name);
    }
  }
  if (emittedLogicalEntities.size === 0) return;

  const controllerFilePath = new Map<string, string>();
  for (const file of files) {
    for (const cls of file.classes) {
      controllerFilePath.set(cls.name, file.filePath);
    }
  }

  for (const [controllerName, dtos] of out.controllerToDtos.entries()) {
    const filePath = controllerFilePath.get(controllerName) ?? '';
    for (const rawDto of dtos) {
      const dtoName = rawDto.replace(/\[\]$/, '').trim();
      if (!emittedLogicalEntities.has(dtoName)) continue;
      out.candidates.push(
        makeCandidate(
          'interface_logical_entities',
          `${controllerName} → ${dtoName}`,
          filePath,
          {
            interfaceClassName: controllerName,
            logicalEntityName: dtoName,
          },
          runId,
        ),
      );
    }
  }
}

export function runSpringClassicAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [], dtoTypeNames: new Set(), controllerToDtos: new Map() };
  const classIndex = buildClassIndex(files);
  // Index of custom annotation TYPE declarations for meta-annotation /
  // fully-qualified mapping resolution (Spec #4, Task Group 1).
  const annDefIndex = buildAnnotationDefIndex(files);
  // web.xml <servlet-mapping> URLs by servlet-class simple name (Spec #4,
  // Task Group 3). Parsed ONCE via the shared pure parser the finding scanner
  // also calls; fed into the per-class servlet detector so an XML-declared
  // servlet also produces endpoints. Empty map when there is no web.xml.
  const webXmlServletUrlPatterns = collectWebXmlServletMappings(files);
  // Plain-Java `main()` batch-entrypoint emission (D2, Task Group 3). Scan the
  // whole IR file set ONCE for batch signals (a `.jil`/`.sh` orchestration file
  // OR a `main()` with a batch package/name signal). The result gates the
  // per-class `detectBatchEntrypoint` call below so a normal web run with an
  // incidental CLI `main()` is never affected.
  const batchScan = detectBatchSignals(files);
  // Bug 16 fix (2026-04-22): pre-compute the set of interface names so
  // business_logic emission can skip `*Impl` classes whose interface is
  // in the scan (interface/impl double-counting).
  const interfaceNameSet = new Set<string>();
  // 2026-04-25: also index implementation classes by their `*Impl` name
  // so processServiceInterface can detect "interface + annotated impl"
  // pairs without an O(n²) scan.
  const implIndex = new Map<string, { cls: ClassIR }>();
  for (const file of files) {
    for (const cls of file.classes) {
      if (cls.isInterface) {
        interfaceNameSet.add(cls.name);
      } else if (cls.name.endsWith('Impl')) {
        implIndex.set(cls.name, { cls });
      }
    }
  }
  for (const file of files) {
    // XML-only files (Spring bean XML carriers — language: 'spring-xml')
    // have no classes; route them through the dedicated processor.
    if (file.classes.length === 0 && file.springXmlBeans !== undefined) {
      processSpringXmlFile(file, runId, out);
      continue;
    }
    for (const cls of file.classes) {
      processController(cls, file, runId, out, classIndex, annDefIndex);
      processJpaEntity(cls, file, runId, out, classIndex);
      processConfigurationClass(cls, file, runId, out);
      processAspectClass(cls, file, runId, out);
      processServiceInterface(cls, file, runId, out, implIndex);
      processOutboundIntegrations(cls, file, runId, out);
      processMessageAndScheduledMethods(cls, file, runId, out);
      processServiceLayerBusinessLogic(cls, file, runId, out, interfaceNameSet);
      // Batch-entrypoint emission (D2, Task Group 3): a plain-Java
      // `public static void main(String[])` class with a batch signal becomes a
      // `class` candidate (+ child `method` candidates) carrying a
      // `batch_entrypoint` marker and the captured `-o` operation flags. No-op
      // unless the run carries batch signals (the gate inside detectBatchEntrypoint).
      out.candidates.push(...detectBatchEntrypoint(cls, file, runId, batchScan));
      // Inbound-surface completeness (Spec #4, Task Groups 2 + 3). JAX-RS
      // resources and raw servlets emit the canonical interfaces/endpoints
      // shape. JAX-RS is guarded against a class that is ALSO a Spring
      // @Controller (the Spring path owns it) to avoid double emission.
      const isSpringController = CONTROLLER_ANNOTATIONS.some((n) =>
        hasAnnotation(canonicaliseMappingAnnotations(cls.annotations, annDefIndex), n),
      );
      out.candidates.push(
        ...detectJaxRsResource(cls, file, runId, isSpringController),
      );
      out.candidates.push(
        ...detectServletClass(
          cls,
          file,
          runId,
          webXmlServletUrlPatterns.get(cls.name) ?? [],
        ),
      );
    }
    // WebFlux functional RouterFunction routes (Spec #4, Task Group 4) — a
    // per-FILE pass (the DSL is parsed from raw source, like the outbound
    // RestTemplate / WebClient path), alongside processOutboundIntegrations.
    out.candidates.push(...detectWebFluxRouterFunctions(file, runId));
  }
  emitLogicalEntities(files, runId, out);
  // P3 (2026-04-28): infer relationships between emitted logical entities
  // from typed-field references. Must run AFTER emitLogicalEntities so the
  // emitted-set is complete.
  emitLogicalEntityRelationships(files, runId, out);
  // P6 (2026-04-28): JdbcTemplate / SQL-based physical-entity detection
  // for non-JPA classic Spring services. Must run AFTER any JPA pass that
  // emitted physical_data_entities (JPA wins; JDBC only fills gaps).
  emitJdbcDerivedPhysicalEntities(files, runId, out);
  // Logical↔physical mapping pass — emits paired logical entities/attrs
  // and link relationships for JPA / HBM-XML rows. Must run AFTER all
  // physical_data_entities/attributes emissions (JPA + JDBC) and BEFORE
  // emitInterfaceLogicalEntities so that controller-→-JPA-class links can
  // find a logical entity to point at.
  emitLogicalPhysicalMappings(out, runId);
  emitInterfaceLogicalEntities(files, runId, out);

  // Endpoint->Data-Effect Call Graph (2026-05-29, Task Group 3.4):
  // hang the controller->service->repository->entity resolver off the same
  // controller traversal that emits interfaces / endpoints /
  // interface_logical_entities. ONE `endpoint_data_effects` candidate per
  // (endpoint, data-entity) pair; unresolved chains become findings
  // (emitted separately by springClassicFindingScanner, deferred path).
  out.candidates.push(...buildEndpointDataEffectCandidates(files, runId));

  // Outbound Integration Graph (2026-05-30, Spec #5, Task Group 3): walk the
  // SAME controller->service call graph to attribute every OUTBOUND call site
  // (outbound HTTP / published message / secondary store / file-object /
  // email-sms / third-party SDK) to its calling endpoint or owning service, and
  // emit ONE `data_movements` candidate per (source owner, resolved target)
  // pair. The candidate carries the source/target NAMES + `movementType` only --
  // save-back resolves the `application_point`s LATE (NEVER a `*_points` ref).
  // Purely-external targets ALSO surface as `external_integration_dependency`
  // Findings (emitted separately by springClassicFindingScanner over the same
  // resolver output) -- never an invented external entity. This SUPERSEDES the
  // legacy orphan-`endpoints` emit in `processOutboundIntegrations`'s regex path.
  out.candidates.push(...buildOutboundIntegrationCandidates(files, runId));

  // Per-endpoint RESPONSE-CONTRACT capture (2026-05-30, Spec 1, Task Group 2):
  // the deterministic spine. Always-on -- it statically reads the response-
  // shaping layers (error advice / validation / auth / serialization / status /
  // config-conditional) the data-effect + behaviour passes do not see, and
  // attaches ONE `response_contract` blob onto each matching `endpoints`
  // candidate's `data` (keyed by endpoint name, reusing Spec 1's controller->
  // method path composition). The blob auto-persists on `discovery_candidates
  // .data` and maps to AMS `endpoints.response_contract` at save-back. Unresolved
  // auth + config-dependent endpoints are surfaced as Findings separately (by
  // the springClassicFindingScanner), never guessed here. Soft-fails as a whole
  // so a malformed IR cannot poison the run.
  try {
    const contractScan = scanResponseContracts(files);
    const attached = attachResponseContractsToCandidates(out.candidates, contractScan);
    if (attached > 0) {
      console.log(
        `[spring-classic] response_contract: attached ${attached} endpoint contract(s).`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] response-contract scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Per-endpoint REQUEST-CONTRACT capture (2026-06-19, Task Group 5): the
  // request-side sibling, run right after the response-contract scan. It
  // statically reads the request-shaping layers the data-effect + behaviour
  // passes do not see -- request media type (`consumes`), required headers,
  // `@RequestParam` inputs, the NEW request date-FORMAT reader (`@JsonFormat`/
  // `@DateTimeFormat` on request-body DTO fields AND path/query params), and
  // request VALIDATION -- and attaches ONE COMPLETE `request_contract` blob
  // onto each matching `endpoints` candidate's `data` (keyed by endpoint name,
  // reusing the SAME controller->method path composition). The blob
  // auto-persists on `discovery_candidates.data` and maps to AMS
  // `endpoints.request_contract` at save-back. ADDITIVE -- leaves the existing
  // `response_contract`/`consumes`/`headers`/`params` emission untouched. Soft-
  // fails as a whole so a malformed IR cannot poison the run.
  try {
    const requestContractScan = scanRequestContracts(files);
    // Signal #2: resolve the ONE project-wide date format and stamp it at the
    // top level of every scanned request_contract (absent when none resolves).
    const inferredDateFormat = resolveGlobalDateFormat(files);
    if (inferredDateFormat) {
      for (const contract of requestContractScan.contractsByEndpointName.values()) {
        contract.inferred_date_format = inferredDateFormat;
      }
    }
    const requestAttached = attachRequestContractsToCandidates(
      out.candidates,
      requestContractScan,
    );
    if (requestAttached > 0) {
      console.log(
        `[spring-classic] request_contract: attached ${requestAttached} endpoint contract(s).`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] request-contract scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Spec 2026-07-06-l (Response Fidelity, Code-Tier Oracle Program): three
  // deterministic passes over the SAME files, each additive onto the
  // endpoint candidates' `response_contract` and each soft-failing alone.

  // (l-1) Full web.xml response facts: ordered filter chain (matched by
  // servlet url-pattern), app-global error-pages merged into
  // `error_responses[]`, encoding-filter charset. Listeners/session-config/
  // context-params ride the parse result (Spec -m consumes listeners).
  try {
    const webXmlFacts = scanWebXmlResponseFacts(files);
    const webXmlTouched = attachWebXmlResponseFacts(out.candidates, webXmlFacts);
    if (webXmlTouched > 0) {
      console.log(
        `[spring-classic] web-xml response facts: ${webXmlFacts.filters.length} filter(s), ` +
          `${webXmlFacts.errorPages.length} error-page(s), charset=${webXmlFacts.charset ?? 'n/a'} ` +
          `attached onto ${webXmlTouched} endpoint(s).`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] web-xml response-facts scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (l-2) XML-defined MVC: SimpleUrl/BeanName handler mappings -> `endpoints`
  // candidates (subtype xml-mvc, default-GET marked); mvc:interceptors +
  // security intercept-url attached onto matching endpoints; tx:advice/aop
  // pointcuts flip `transactional` on the ALREADY-EMITTED data-effect edges
  // (the resolver reads annotations only). Unresolved pointcuts/rules surface
  // as Findings via springClassicFindingScanner (run-it-twice pattern).
  try {
    const xmlMvc = scanXmlMvc(files);
    const minted = buildXmlMvcEndpointCandidates(xmlMvc, runId);
    out.candidates.push(...minted);
    const xmlTouched = attachXmlMvcFacts(out.candidates, xmlMvc);
    const flipped = applyXmlTransactionalMatchers(out.candidates, xmlMvc.txMatchers);
    if (minted.length > 0 || xmlTouched > 0 || flipped > 0) {
      console.log(
        `[spring-classic] xml-mvc: ${minted.length} mapped endpoint(s) minted, ` +
          `${xmlTouched} endpoint(s) enriched (interceptors/security), ` +
          `${flipped} data-effect edge(s) flipped transactional by XML pointcuts.`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] xml-mvc scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (l-3) Code-set response facts: headers/status/redirects/cookies set IN
  // CODE (from the per-method call IR) + the view-kind classification
  // (`response_kind` / `parity_scope` — parity is API-only by user decision;
  // view endpoints are MARKED out of scope, never silently included).
  try {
    const codeFacts = scanCodeResponseFacts(files);
    const codeTouched = attachCodeResponseFacts(out.candidates, codeFacts);
    if (codeTouched > 0) {
      console.log(
        `[spring-classic] code response facts: attached onto ${codeTouched} endpoint(s).`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] code response-facts scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // Spec 2026-07-06-m (Internal Functionality, Code-Tier Oracle Program):
  // criterion B — internal (non-HTTP) work gets the SAME first-class
  // treatment as endpoints. Four additive, individually soft-failing passes.

  // (m-1) XML-wired internal processes: Quartz / task: / Spring Batch / JMS
  // XML minted as `endpoints` candidates with VERBATIM schedule/graph
  // metadata, and their entry targets fed into the REUSED data-effect walk so
  // XML-scheduled code gets edges (and thereby behaviour blocks) exactly like
  // HTTP endpoints. Annotation-driven internal entry points (@Scheduled /
  // listeners / Quartz Job classes) ride the same resolver call.
  try {
    const internalXml = scanInternalProcessXml(files);
    const mintedInternal = mintInternalProcessCandidates(internalXml, runId);
    out.candidates.push(...mintedInternal);
    const internalEffects = resolveInternalProcessDataEffects(
      files,
      xmlEntryTargets(internalXml),
    );
    const internalEdges = buildDataEffectCandidatesFromResolved(
      internalEffects.resolved,
      runId,
    );
    out.candidates.push(...internalEdges);
    if (mintedInternal.length > 0 || internalEdges.length > 0) {
      console.log(
        `[spring-classic] internal processes: ${mintedInternal.length} XML-wired process(es) ` +
          `minted, ${internalEdges.length} internal data-effect edge(s) emitted.`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] internal-process scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (m-2) MyBatis / iBatis mapper XML: verbatim SQL onto edges that carry no
  // captured query yet (`query_kind: 'mybatis_xml'`; dynamic tags flagged,
  // never composed).
  try {
    const myBatis = scanMyBatisXmlMappers(files);
    const enriched = applyMyBatisXmlQueries(out.candidates, myBatis);
    if (enriched > 0) {
      console.log(
        `[spring-classic] mybatis-xml: ${enriched} data-effect edge(s) enriched with verbatim mapper SQL.`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] mybatis-xml scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (m-3) JPA lifecycle callbacks -> `business_logics` candidates (so
  // behaviour capture can read them; the matching Findings ride the finding
  // scanner's run-it-twice pass).
  try {
    const jpa = scanJpaInternals(files);
    const callbacks = mintJpaCallbackCandidates(jpa, runId);
    out.candidates.push(...callbacks);
    if (callbacks.length > 0) {
      console.log(
        `[spring-classic] jpa internals: ${callbacks.length} entity lifecycle callback(s) surfaced.`,
      );
    }
  } catch (err) {
    console.warn(
      `[spring-classic] jpa-internals scan failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (m-4) Self-API-call linkage (v1): an internal process whose owning class
  // also makes an outbound HTTP call targeting one of the app's OWN endpoints
  // gets `calls_own_endpoint` stamped — endpoint parity evidence then
  // partially covers the batch path (user estate fact, gap analysis §7.3).
  try {
    const stamped = attachSelfApiCallLinks(out.candidates);
    if (stamped > 0) {
      console.log(`[spring-classic] self-api-call linkage stamped on ${stamped} internal process(es).`);
    }
  } catch (err) {
    console.warn(
      `[spring-classic] self-api-call linkage failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // (5) 2026-04-25: bean-class collapse post-pass.
  //
  // When an XML bean and a Java-side candidate (service-api interface,
  // @Configuration class, JPA @Entity, @Aspect, @FeignClient interface)
  // share a `simpleClassName`, we have multiple rows for the same
  // architectural element. Reviewers see duplicates: e.g. for
  // `<bean id="patientService" class="…PatientServiceImpl"/>` plus a
  // Java `PatientService` interface, run #2 produced THREE rows in the
  // OpenMRS scan. Collapse by promoting the Java-side row as the canonical
  // carrier and folding the XML bean's id/aliases into it.
  collapseXmlBeansAgainstJavaCandidates(out);

  return out.candidates;
}

/**
 * Collapse `xml-bean` candidates whose `data.className` matches a
 * Java-side candidate (service-api / configuration / @Entity / aop-aspect
 * / feign-client). The Java-side row stays as the canonical carrier;
 * the XML bean's `beanKey` / `beanId` / `aliases` / `xmlFilePath` /
 * `dependencyRefs` are folded onto its `data` under namespaced fields.
 *
 * Only collapses ONE-TO-ONE matches. If the same Java class is bound by
 * multiple XML beans (bean factory pattern, alias overrides), all are
 * folded but the Java row's own `xmlBeanIds` array tracks them. If the
 * same XML simpleClassName matches multiple Java rows (e.g. one impl
 * implements two service interfaces of the same name across packages —
 * very unlikely), the collapse is skipped to avoid losing data.
 */
function collapseXmlBeansAgainstJavaCandidates(out: AdapterOutput): void {
  // Build an index of Java-side candidates by simple class name.
  const JAVA_SIDE_KINDS = new Set([
    'service-api',
    'configuration',
    'aop-aspect',
    'feign-client',
  ]);
  const javaByClassName = new Map<string, DiscoveryCandidate[]>();
  for (const c of out.candidates) {
    if (c.candidateType === 'interfaces') {
      const data = (c.data ?? {}) as Record<string, unknown>;
      const kind = data.springConfigKind as string | undefined;
      if (kind && JAVA_SIDE_KINDS.has(kind)) {
        const arr = javaByClassName.get(c.name) ?? [];
        arr.push(c);
        javaByClassName.set(c.name, arr);
      }
    } else if (c.candidateType === 'physical_data_entities') {
      const arr = javaByClassName.get(c.name) ?? [];
      arr.push(c);
      javaByClassName.set(c.name, arr);
    }
  }

  let collapsed = 0;
  const toRemove = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType !== 'interfaces') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    if (data.springConfigKind !== 'xml-bean') continue;
    const className = data.className as string | undefined;
    if (!className) continue;
    // Try the exact class name first; if no match and the name ends `Impl`,
    // also try the unsuffixed form so `<bean class="PatientServiceImpl"/>`
    // folds onto the `PatientService` service-api row.
    let matches = javaByClassName.get(className);
    if (!matches || matches.length !== 1) {
      if (className.endsWith('Impl')) {
        const base = className.slice(0, -'Impl'.length);
        matches = javaByClassName.get(base);
      }
    }
    if (!matches || matches.length !== 1) continue;
    // Fold this XML bean onto the single Java-side match.
    const survivor = matches[0];
    const sData = (survivor.data ?? {}) as Record<string, unknown>;
    const xmlBeanIds = (sData.xmlBeanIds as string[]) ?? [];
    const beanKey = data.beanKey as string | undefined;
    if (beanKey && !xmlBeanIds.includes(beanKey)) {
      xmlBeanIds.push(beanKey);
    }
    sData.xmlBeanIds = xmlBeanIds;
    if (Array.isArray(data.beanAliases) && (data.beanAliases as string[]).length > 0) {
      const allAliases = (sData.xmlBeanAliases as string[]) ?? [];
      for (const a of data.beanAliases as string[]) {
        if (!allAliases.includes(a)) allAliases.push(a);
      }
      sData.xmlBeanAliases = allAliases;
    }
    if (Array.isArray(data.dependencyRefs) && (data.dependencyRefs as string[]).length > 0) {
      const deps = (sData.xmlDependencyRefs as string[]) ?? [];
      for (const d of data.dependencyRefs as string[]) {
        if (!deps.includes(d)) deps.push(d);
      }
      sData.xmlDependencyRefs = deps;
    }
    if (data.xmlFilePath && !sData.xmlFilePath) {
      sData.xmlFilePath = data.xmlFilePath;
    }
    survivor.data = sData;
    // Track that the survivor is also bound from XML.
    if (Array.isArray(survivor.sourceClusterIds)) {
      const xmlPath = data.xmlFilePath as string | undefined;
      if (xmlPath && !survivor.sourceClusterIds.includes(xmlPath)) {
        survivor.sourceClusterIds.push(xmlPath);
      }
    }
    toRemove.add(c.id);
    collapsed++;
  }
  if (collapsed > 0) {
    out.candidates = out.candidates.filter((c) => !toRemove.has(c.id));
    console.log(
      `[spring-classic] collapseXmlBeansAgainstJavaCandidates: folded ${collapsed} xml-bean rows into Java-side carriers`,
    );
  }
}
