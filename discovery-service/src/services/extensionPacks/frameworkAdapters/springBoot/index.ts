/**
 * Spring Boot Framework Adapter
 *
 * Consumes language-agnostic SourceFileIR (produced by the Java language
 * extractor) and emits DiscoveryCandidates for the 8 core architecture-type
 * slots: interface, endpoint, physical_entity, physical_attribute,
 * entity_relationship, logical_entity, logical_data_attribute, business_logic.
 *
 * This adapter has NO Java syntax knowledge. It reads annotations and types
 * from the IR and maps them to architecture candidates based on Spring/JPA
 * semantics.
 *
 * Scope notes for Chunk 1:
 * - Focuses on the core 8 types.
 * - Deferred (still handled by the legacy pack when it's active): Liquibase
 *   XML cross-referencing, inter-service HTTP call detection, database
 *   connection metadata, @PreAuthorize/Security annotations, Lombok
 *   @Data/@Value detection, @MappedSuperclass inheritance traversal.
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
} from '../../languageIR';
import {
  hasAnnotation,
  findAnnotation,
  annotationArg,
} from '../../languageIR';
// Outbound Integration Graph (2026-05-30, Spec #5, Task Group 4): springBoot
// PARITY for the `data_movements` outbound-edge candidate emit. REUSES the SAME
// framework-agnostic `outboundIntegrationResolver` + `buildOutboundIntegrationCandidates`
// helper that Task Group 3 wired into the springClassic adapter -- NO fork, NO
// copy of the legacy literal-only path. The resolver reads the IDENTICAL
// `SourceFileIR[]` this adapter consumes and gates on the same Spring stereotypes
// (@RestController / @GetMapping / @Service), so a Spring Boot service ALSO gets
// outbound `data_movements` edges + (via the finding scanner over the same IR)
// `external_integration_dependency` Findings. The candidate carries the
// source/target NAMES + `movementType` only -- save-back resolves the
// `application_point`s LATE (NEVER a `*_points` ref, NEVER an invented external
// entity, NEVER a 1:1 mapping).
import { buildOutboundIntegrationCandidates } from '../springClassic/outboundIntegrationCandidates';

// ---------------------------------------------------------------------------
// Class index — needed for @MappedSuperclass inheritance traversal so that a
// child @Entity can inherit field definitions from its @MappedSuperclass
// ancestors. Built once per runSpringBootAdapter invocation.
// ---------------------------------------------------------------------------

type ClassIndex = Map<string, { cls: ClassIR; file: SourceFileIR }>;

function buildClassIndex(files: SourceFileIR[]): ClassIndex {
  const idx: ClassIndex = new Map();
  for (const file of files) {
    for (const cls of file.classes) {
      idx.set(cls.name, { cls, file });
    }
  }
  return idx;
}

/**
 * Walks the `extends` chain upwards, collecting fields from each ancestor
 * annotated with `@MappedSuperclass`. Stops at the first non-MappedSuperclass
 * parent or when the parent isn't in the scanned set.
 *
 * Returns pairs of (field, source class name) for downstream provenance.
 */
function collectMappedSuperclassFields(
  cls: ClassIR,
  index: ClassIndex,
): Array<{ field: FieldIR; inheritedFrom: string }> {
  const inherited: Array<{ field: FieldIR; inheritedFrom: string }> = [];
  const seenFieldNames = new Set(cls.fields.map((f) => f.name));
  let current = cls.extends;
  const visited = new Set<string>(); // cycle guard

  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const parent = index.get(current);
    if (!parent) break;
    if (!hasAnnotation(parent.cls.annotations, 'MappedSuperclass')) break;

    for (const field of parent.cls.fields) {
      if (seenFieldNames.has(field.name)) continue; // child override wins
      inherited.push({ field, inheritedFrom: parent.cls.name });
      seenFieldNames.add(field.name);
    }
    current = parent.cls.extends;
  }
  return inherited;
}

// ---------------------------------------------------------------------------
// Constants
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

const JPA_RELATIONSHIP_ANNOTATIONS = [
  'OneToOne',
  'OneToMany',
  'ManyToOne',
  'ManyToMany',
];

// `@Service` is the precise service-layer marker; `@Component` is broader
// but legitimately used for service-shaped classes that don't fit the
// `@Service` semantic (rule engines, calculators, etc.). The deny-list
// below filters out the non-business `@Component` shapes (formatters,
// converters, handlers) so the widening doesn't pull in plumbing.
//
// `@Transactional` (class-level OR any method) is a separate trigger —
// any class wrapping methods in a transaction is doing real domain work
// even when it's not annotated with a stereotype.
const SERVICE_LAYER_ANNOTATIONS = ['Service', 'Component'];
const TRANSACTIONAL_TRIGGER_ANNOTATION = 'Transactional';

// Class name suffixes that indicate a non-business-logic concern even if the
// class is annotated @Component or named *Service. Skip these outright.
const NON_BUSINESS_LOGIC_SUFFIXES = /(Formatter|Converter|Handler|Interceptor|Filter|Listener|Adapter|Mapper|Resolver)$/;
// Domain-flavoured class-name suffixes. `Builder` / `Factory` / `Helper`
// are deliberately excluded — they're frequently plumbing rather than
// business logic.
const SERVICE_NAME_SUFFIX_RE = /(Service|Provider|Manager|Validator|Processor|Calculator|Engine)$/;

// Annotations that classify a service method into a non-default business_logic
// subtype. Order matters — earlier entries win when a method carries several.
const BUSINESS_LOGIC_SUBTYPE_ANNOTATIONS: Array<{ ann: string; subtype: string }> = [
  { ann: 'EventListener', subtype: 'event-handler' },
  { ann: 'TransactionalEventListener', subtype: 'event-handler' },
  { ann: 'Scheduled', subtype: 'scheduled-task' },
  { ann: 'Async', subtype: 'async-job' },
  { ann: 'PostConstruct', subtype: 'lifecycle' },
  { ann: 'PreDestroy', subtype: 'lifecycle' },
];

// Spring Security annotations carried by endpoint methods (or their declaring
// controller). Emitted into endpoint metadata so reviewers can see the
// authorisation contract without re-parsing the source.
const ENDPOINT_SECURITY_ANNOTATIONS = [
  'PreAuthorize',
  'PostAuthorize',
  'Secured',
  'RolesAllowed',
  'PreFilter',
  'PostFilter',
];

// Annotations that indicate a method is a Spring lifecycle hook rather than
// public business surface. Used to drop these from `business_logics` emission.
const LIFECYCLE_HOOK_ANNOTATIONS = ['PostConstruct', 'PreDestroy'];

// Cache-related annotations. Their args (cache name, key, condition) are
// surfaced into business_logic metadata so the rubric can see caching context.
const CACHE_ANNOTATIONS = ['Cacheable', 'CacheEvict', 'CachePut', 'Caching'];

// @Transactional argument keys we surface into metadata. Order is preserved
// in the emitted object for human readability.
const TRANSACTIONAL_KEYS = [
  'propagation',
  'isolation',
  'readOnly',
  'timeout',
  'rollbackFor',
  'noRollbackFor',
];

// OpenAPI / springdoc-openapi annotations whose argument values enrich
// endpoint metadata. Picked up wherever they appear (controller class or
// endpoint method).
const OPENAPI_OPERATION_ANNOTATION = 'Operation';
const OPENAPI_TAG_ANNOTATION = 'Tag';
const OPENAPI_API_RESPONSE_ANNOTATION = 'ApiResponse';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function stripArrayBracesAndQuotes(value: string): string {
  let v = value.trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim();
    if (v.includes(',')) v = v.split(',')[0].trim();
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
 * type, repeatedly, until a concrete inner type remains.
 *
 * Handles:
 *  - `ResponseEntity<T>` (Spring MVC)
 *  - Collections: `List<T>`, `Set<T>`, `Collection<T>`, `Iterable<T>`, `Stream<T>`
 *  - `Optional<T>`
 *  - Spring Data page/slice: `Page<T>`, `Slice<T>`
 *  - WebFlux reactive: `Flux<T>`, `Mono<T>`
 *  - Async: `CompletableFuture<T>`, `Future<T>`, `Callable<T>`
 *  - Array suffixes: `T[]` -> `T`
 *
 * Nested wrappers unwrap recursively until fixed-point, so
 * `ResponseEntity<List<OwnerDto>>` -> `OwnerDto`.
 *
 * `Map<K,V>` is NOT unwrapped — the value type is the only interesting one,
 * but we can't tell which of the two generic parameters is the DTO without
 * parsing the map's own shape, so the full Map<..> string is returned and
 * downstream emission treats it as a non-match (no DTO class named
 * "Map<...>" will be found).
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
  // Iterate so nested wrappers peel off one layer at a time until stable.
  // Guard against pathological inputs with a small max-depth.
  for (let i = 0; i < 8; i++) {
    const next = unwrapOneLayer(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function unwrapOneLayer(t: string): string {
  // Array suffix: OwnerDto[] -> OwnerDto
  const arrayMatch = t.match(/^(.+)\[\]$/);
  if (arrayMatch) return arrayMatch[1].trim();
  // Single-generic wrappers: Wrapper<Inner> -> Inner
  const genMatch = t.match(/^(\w+)\s*<\s*(.+)\s*>$/);
  if (genMatch) {
    const [, wrapper, inner] = genMatch;
    if (UNWRAPPABLE_SINGLE_GENERIC.has(wrapper)) {
      return inner.trim();
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Annotation→candidate mappers
// ---------------------------------------------------------------------------

function extractBasePath(annotations: AnnotationIR[]): string {
  const rm = findAnnotation(annotations, 'RequestMapping');
  if (!rm) return '';
  const val = annotationArg(rm, 'value') || annotationArg(rm, 'path');
  return val ? normalisePath(val) : '';
}

// ---------------------------------------------------------------------------
// Multi-method / multi-path parsing (Spec #4 Task Group 6 -- closing
// `TODO(oracle-W1)`).
//
// `AnnotationIR.args` stores each annotation arg as a single RAW string (the
// Java extractor does not model brace-lists as arrays). The pre-W1 single-value
// `extractHttpMethod` / `extractMethodPath` treated those whole strings as ONE
// token, producing a garbled verb (`GET, REQUESTMETHOD.POST}`) and silently
// dropping every path alias past the first. These plural helpers mirror the
// spring-classic adapter's W1 helpers exactly so the Spring-Boot adapter fans
// out ONE endpoint per (HTTP-method x path) combination IDENTICALLY to
// spring-classic. A single-method / single-path mapping still yields exactly one
// member each -> exactly one endpoint (no behaviour change for the common case).
// `AnnotationIR` is intentionally NOT refactored to array-typed args -- we parse
// the existing string (W1 scope note).
// ---------------------------------------------------------------------------

/**
 * Split a possible `{a, b, c}` brace-list into its trimmed members. A bare
 * (non-brace) string returns a single-member list. Empty / whitespace-only
 * members are dropped.
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
 * Resolve the FULL set of HTTP verbs an endpoint method maps to. A
 * `@GetMapping` / `@PostMapping` / ... shortcut yields its single verb;
 * `@RequestMapping(method = {GET, POST})` yields one verb per member; bare
 * `@RequestMapping` yields `['GET']`. Always returns at least one verb; order
 * preserved from source.
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
      return verbs.length > 0 ? verbs : ['GET'];
    }
    return ['GET'];
  }
  return ['GET'];
}

/**
 * Resolve the FULL set of method-level paths an endpoint maps to.
 * `@GetMapping("/x")` -> `['/x']`; `@GetMapping({"/a","/b"})` -> `['/a','/b']`;
 * no `value`/`path` -> `['']` so the caller still composes exactly one full path
 * against the base path. Each member is normalised. Always returns at least one
 * entry.
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
  for (const p of params) {
    if (hasAnnotation(p.annotations, 'RequestBody')) return p.type;
  }
  return undefined;
}

function extractPathVariables(params: ParameterIR[]): Array<{ name: string; type: string }> {
  const out: Array<{ name: string; type: string }> = [];
  for (const p of params) {
    const a = findAnnotation(p.annotations, 'PathVariable');
    if (!a) continue;
    const name = annotationArg(a, 'value') || annotationArg(a, 'name') || p.name;
    out.push({ name, type: p.type });
  }
  return out;
}

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

// ---------------------------------------------------------------------------
// Tier 1 + Tier 2 metadata extractors (added 2026-04-26 to push the
// java-spring-boot pack toward the Excellent band — see the discussion in
// `discovery-service/perf/scoresheet.md`).
//
// Each helper returns `null` / `undefined` when the relevant annotation is
// absent so the caller can simply spread the result into an existing data
// object without polluting it with empty values.
// ---------------------------------------------------------------------------

/** Extract `@Transactional(...)` configuration from method-level annotations,
 *  falling back to the class-level annotation when present. Returns `null` if
 *  neither method nor class is `@Transactional`. */
function extractTransactionalMeta(
  methodAnnotations: AnnotationIR[],
  classAnnotations: AnnotationIR[],
): Record<string, string> | null {
  const ann =
    findAnnotation(methodAnnotations, 'Transactional') ||
    findAnnotation(classAnnotations, 'Transactional');
  if (!ann) return null;
  const meta: Record<string, string> = {};
  for (const key of TRANSACTIONAL_KEYS) {
    const v = annotationArg(ann, key);
    if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
  }
  // Mark presence even if no args supplied so reviewers can see "method runs
  // in a default transactional context" rather than nothing at all.
  if (Object.keys(meta).length === 0) meta.declared = 'true';
  // Inherited-from-class flag is useful when the class-level annotation is
  // applied to many methods.
  if (!findAnnotation(methodAnnotations, 'Transactional')) {
    meta.inheritedFromClass = 'true';
  }
  return meta;
}

/** Capture security expressions from method-level annotations, falling back
 *  to the class-level annotation when present. Returns the first matching
 *  annotation's expression / role list. */
function extractEndpointSecurityMeta(
  methodAnnotations: AnnotationIR[],
  classAnnotations: AnnotationIR[],
): { annotation: string; expression?: string; roles?: string; inheritedFromClass: boolean } | null {
  for (const name of ENDPOINT_SECURITY_ANNOTATIONS) {
    const m = findAnnotation(methodAnnotations, name);
    if (m) {
      const expr =
        annotationArg(m, 'value') ||
        annotationArg(m, 'expression') ||
        annotationArg(m, 'rolesAllowed');
      const out: { annotation: string; expression?: string; roles?: string; inheritedFromClass: boolean } = {
        annotation: name,
        inheritedFromClass: false,
      };
      if (expr) {
        if (name === 'Secured' || name === 'RolesAllowed') out.roles = expr;
        else out.expression = expr;
      }
      return out;
    }
    const c = findAnnotation(classAnnotations, name);
    if (c) {
      const expr =
        annotationArg(c, 'value') ||
        annotationArg(c, 'expression') ||
        annotationArg(c, 'rolesAllowed');
      const out: { annotation: string; expression?: string; roles?: string; inheritedFromClass: boolean } = {
        annotation: name,
        inheritedFromClass: true,
      };
      if (expr) {
        if (name === 'Secured' || name === 'RolesAllowed') out.roles = expr;
        else out.expression = expr;
      }
      return out;
    }
  }
  return null;
}

/** Capture `@Scheduled(...)` cron / fixedRate / fixedDelay from a method. */
function extractScheduledMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  const ann = findAnnotation(annotations, 'Scheduled');
  if (!ann) return null;
  const meta: Record<string, string> = {};
  for (const key of ['cron', 'fixedRate', 'fixedDelay', 'fixedRateString', 'fixedDelayString', 'initialDelay', 'zone']) {
    const v = annotationArg(ann, key);
    if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
  }
  return Object.keys(meta).length > 0 ? meta : { declared: 'true' };
}

/** Capture `@Async(...)` executor name (if any). */
function extractAsyncMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  const ann = findAnnotation(annotations, 'Async');
  if (!ann) return null;
  const executor = annotationArg(ann, 'value');
  return executor ? { executor } : { declared: 'true' };
}

/** Capture `@EventListener(...)` / `@TransactionalEventListener(...)` config —
 *  `classes` argument (event types) and `condition` SpEL. */
function extractEventListenerMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  const a =
    findAnnotation(annotations, 'EventListener') ||
    findAnnotation(annotations, 'TransactionalEventListener');
  if (!a) return null;
  const meta: Record<string, string> = { listenerKind: a.name };
  for (const key of ['classes', 'value', 'condition', 'phase']) {
    const v = annotationArg(a, key);
    if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
  }
  return meta;
}

/** Capture `@Cacheable` / `@CacheEvict` / `@CachePut` config (cache name, key,
 *  condition, allEntries). Returns the merged metadata for the first matching
 *  cache annotation. */
function extractCacheMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  for (const name of CACHE_ANNOTATIONS) {
    const a = findAnnotation(annotations, name);
    if (!a) continue;
    const meta: Record<string, string> = { cacheKind: name };
    for (const key of ['value', 'cacheNames', 'key', 'condition', 'unless', 'allEntries', 'beforeInvocation']) {
      const v = annotationArg(a, key);
      if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
    }
    return meta;
  }
  return null;
}

/** Pick a single business-logic subtype based on annotations, in priority
 *  order from `BUSINESS_LOGIC_SUBTYPE_ANNOTATIONS`. Returns `null` if none
 *  apply (the candidate then keeps the default unset subtype). */
function classifyBusinessLogicSubtype(annotations: AnnotationIR[]): string | null {
  for (const { ann, subtype } of BUSINESS_LOGIC_SUBTYPE_ANNOTATIONS) {
    if (hasAnnotation(annotations, ann)) return subtype;
  }
  return null;
}

/** Capture springdoc / OpenAPI `@Operation(summary=, description=, ...)` from
 *  method annotations. */
function extractOperationMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  const a = findAnnotation(annotations, OPENAPI_OPERATION_ANNOTATION);
  if (!a) return null;
  const meta: Record<string, string> = {};
  for (const key of ['summary', 'description', 'operationId', 'tags']) {
    const v = annotationArg(a, key);
    if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/** Capture `@Tag(name=, description=)` (typically class-level) for a
 *  controller. */
function extractTagMeta(annotations: AnnotationIR[]): Record<string, string> | null {
  const a = findAnnotation(annotations, OPENAPI_TAG_ANNOTATION);
  if (!a) return null;
  const meta: Record<string, string> = {};
  for (const key of ['name', 'description']) {
    const v = annotationArg(a, key);
    if (v !== undefined && v !== null && String(v).length > 0) meta[key] = v;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

/** Capture all `@ApiResponse(responseCode=, description=)` annotations on a
 *  method as a flat array. */
function extractApiResponses(
  annotations: AnnotationIR[],
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const a of annotations) {
    if (a.name !== OPENAPI_API_RESPONSE_ANNOTATION) continue;
    const entry: Record<string, string> = {};
    for (const key of ['responseCode', 'description', 'content']) {
      const v = annotationArg(a, key);
      if (v !== undefined && v !== null && String(v).length > 0) entry[key] = v;
    }
    if (Object.keys(entry).length > 0) out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate shape helpers
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
    confidence: 0.95,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'spring-boot-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

// ---------------------------------------------------------------------------
// Per-class extraction
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

function processController(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  const isController = CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n));
  if (!isController) return;

  const basePath = extractBasePath(cls.annotations);
  const controllerType = hasAnnotation(cls.annotations, 'RestController')
    ? 'RestController'
    : 'Controller';

  const interfaceData: Record<string, unknown> = {
    basePath,
    controllerType,
    className: cls.name,
    packageName: file.packageOrNamespace,
  };
  // OpenAPI / springdoc-openapi: surface @Tag(name=, description=) so the
  // grouping reviewers see in the rubric matches what's published in the API
  // docs. Class-level @PreAuthorize / security info also gets surfaced here
  // so each endpoint doesn't need to duplicate it.
  const tagMeta = extractTagMeta(cls.annotations);
  if (tagMeta) interfaceData.openApiTag = tagMeta;
  const classSecurity = extractEndpointSecurityMeta([], cls.annotations);
  if (classSecurity) interfaceData.security = classSecurity;

  const interfaceCandidate = makeCandidate(
    'interfaces',
    cls.name,
    file.filePath,
    interfaceData,
    runId,
  );
  out.candidates.push(interfaceCandidate);

  // Endpoints. Spec #4 Task Group 6: fan out one endpoint per (verb x path)
  // via the W1 plural helpers so a `@RequestMapping(method={GET,POST})` /
  // `@GetMapping({"/a","/b"})` emits every combination (identically to the
  // spring-classic adapter) instead of a single garbled verb / a dropped path.
  for (const method of cls.methods) {
    if (!isEndpointMethod(method)) continue;

    const httpMethods = extractHttpMethods(method.annotations);
    const methodPaths = extractMethodPaths(method.annotations);
    const rawReturnType = method.returnType;
    const unwrappedReturnType = unwrapResponseEntity(rawReturnType);
    // Bug 5 fix: apply the same generic-wrapper unwrap as return types so
    // `@RequestBody List<ClientLogEntry>` or `@RequestBody Optional<Foo>`
    // register the INNER type as the DTO, not the wrapper.
    const rawRequestBodyType = extractRequestBodyType(method.parameters);
    const requestBodyType = rawRequestBodyType
      ? unwrapResponseEntity(rawRequestBodyType)
      : undefined;
    const pathVariables = extractPathVariables(method.parameters);
    const requestParams = extractRequestParams(method.parameters);

    // Resolve the response DTO once (shared across every emitted combination).
    let responseType: string | undefined;
    if (unwrappedReturnType !== rawReturnType) {
      responseType = unwrappedReturnType; // aligns with save-back resolver field name
    } else if (rawReturnType && rawReturnType !== 'void') {
      responseType = rawReturnType;
    }

    // Track DTO types per-controller for `interface_logical_entities` emission.
    let perControllerDtos = out.controllerToDtos.get(cls.name);
    if (!perControllerDtos) {
      perControllerDtos = new Set();
      out.controllerToDtos.set(cls.name, perControllerDtos);
    }
    if (requestBodyType) {
      out.dtoTypeNames.add(requestBodyType);
      perControllerDtos.add(requestBodyType);
    }
    if (responseType) {
      out.dtoTypeNames.add(responseType);
      perControllerDtos.add(responseType);
    }

    // Method-level enrichments resolved once and shared across combinations.
    const security = extractEndpointSecurityMeta(method.annotations, cls.annotations);
    const op = extractOperationMeta(method.annotations);
    const responses = extractApiResponses(method.annotations);
    const tx = extractTransactionalMeta(method.annotations, cls.annotations);

    for (const httpMethod of httpMethods) {
      for (const methodPath of methodPaths) {
        const fullPath = composeFullPath(basePath, methodPath);
        const data: Record<string, unknown> = {
          httpMethod,
          fullPath,
          methodName: method.name,
          controllerClassName: cls.name,
          returnType: rawReturnType,
        };
        if (unwrappedReturnType !== rawReturnType) {
          data.unwrappedReturnType = unwrappedReturnType;
        }
        if (responseType) data.responseType = responseType;
        if (requestBodyType) data.requestBodyType = requestBodyType;
        if (pathVariables.length > 0) data.pathVariables = pathVariables;
        if (requestParams.length > 0) data.requestParams = requestParams;
        // Tier 1 / Tier 2 enrichments: security expression, OpenAPI Operation +
        // ApiResponse metadata. Method-level wins; class-level is the fallback
        // for security so per-method overrides aren't accidentally hidden.
        if (security) data.security = security;
        if (op) data.openApiOperation = op;
        if (responses.length > 0) data.openApiResponses = responses;
        // Endpoint methods can also carry @Transactional (read-only query
        // endpoints, etc.). Surface it so the rubric / reviewers see the txn
        // contract.
        if (tx) data.transactional = tx;

        out.candidates.push(
          makeCandidate(
            'endpoints',
            `${httpMethod} ${fullPath}`,
            file.filePath,
            data,
            runId,
            interfaceCandidate.id,
          ),
        );
      }
    }
  }
}

function emitPhysicalAttribute(
  field: FieldIR,
  entityCls: ClassIR,
  file: SourceFileIR,
  parentEntityCandidateId: string,
  runId: string,
  out: AdapterOutput,
  inheritedFrom?: string,
): void {
  // Skip JPA relationships (handled separately), @Transient fields, and static fields.
  const isRelationship = JPA_RELATIONSHIP_ANNOTATIONS.some((n) =>
    hasAnnotation(field.annotations, n),
  );
  if (isRelationship) return;
  if (hasAnnotation(field.annotations, 'Transient')) return;
  if (field.modifiers.includes('static')) return;

  const idAnn = findAnnotation(field.annotations, 'Id');
  const colAnn = findAnnotation(field.annotations, 'Column');

  // In modern Spring Boot / JPA, fields on @Entity classes are persisted by
  // default unless explicitly @Transient. @Column and @Id are optional — their
  // absence just means "use defaults" (column name = field name, nullable = true).
  // Previously we required @Column or @Id; that missed idiomatic fields like
  // Owner.address which carry only validation annotations. Emit any
  // non-relationship, non-transient, non-static field instance.

  const columnName = annotationArg(colAnn, 'name') || field.name;
  const isPrimaryKey = !!idAnn;
  const isNullable = annotationArg(colAnn, 'nullable') === 'false' ? false : true;

  const data: Record<string, unknown> = {
    fieldName: field.name,
    columnName,
    fieldType: field.type,
    isPrimaryKey,
    isNullable,
    entityClassName: entityCls.name,
    hasColumnAnnotation: !!colAnn,
    hasIdAnnotation: !!idAnn,
  };
  if (inheritedFrom) data.inheritedFrom = inheritedFrom;

  out.candidates.push(
    makeCandidate('physical_data_attributes', field.name, file.filePath, data, runId, parentEntityCandidateId),
  );
}

function emitEntityRelationship(
  field: FieldIR,
  ownerEntityName: string,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  inheritedFrom?: string,
): void {
  for (const rel of JPA_RELATIONSHIP_ANNOTATIONS) {
    if (!hasAnnotation(field.annotations, rel)) continue;

    let targetEntity = field.type;
    const generic = targetEntity.match(/<\s*([^<>,\s]+)\s*[,>]/);
    if (generic) targetEntity = generic[1];

    const cardinality = rel.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');

    const data: Record<string, unknown> = {
      sourceEntity: ownerEntityName,
      targetEntity,
      cardinality,
      relationshipType: 'association',
      fieldName: field.name,
      joinColumnName: annotationArg(findAnnotation(field.annotations, 'JoinColumn'), 'name'),
      mappedBy: annotationArg(findAnnotation(field.annotations, rel), 'mappedBy'),
    };
    if (inheritedFrom) data.inheritedFrom = inheritedFrom;

    out.candidates.push(
      makeCandidate(
        'logical_data_entity_relationships',
        `${ownerEntityName} → ${targetEntity}`,
        file.filePath,
        data,
        runId,
      ),
    );
    return; // one relationship per field
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

  const tableAnnotation = findAnnotation(cls.annotations, 'Table');
  const tableName =
    annotationArg(tableAnnotation, 'name') || annotationArg(tableAnnotation, 'value') || cls.name;
  const schema = annotationArg(tableAnnotation, 'schema');
  const catalog = annotationArg(tableAnnotation, 'catalog');

  const entityCandidate = makeCandidate(
    'physical_data_entities',
    cls.name,
    file.filePath,
    {
      entityClassName: cls.name,
      tableName,
      schema,
      catalog,
      packageName: file.packageOrNamespace,
      hasTableAnnotation: !!tableAnnotation,
    },
    runId,
  );
  out.candidates.push(entityCandidate);

  // 1. Directly declared fields on this @Entity
  for (const field of cls.fields) {
    emitPhysicalAttribute(field, cls, file, entityCandidate.id, runId, out);
    emitEntityRelationship(field, cls.name, file, runId, out);
  }

  // 2. Inherited fields from @MappedSuperclass ancestors
  const inherited = collectMappedSuperclassFields(cls, classIndex);
  for (const { field, inheritedFrom } of inherited) {
    emitPhysicalAttribute(field, cls, file, entityCandidate.id, runId, out, inheritedFrom);
    emitEntityRelationship(field, cls.name, file, runId, out, inheritedFrom);
  }
}

function processServiceLayerBusinessLogic(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
  interfaceNameSet: Set<string>,
): void {
  // Skip classes that are clearly framework-plumbing by naming convention,
  // even if they carry an @Component or service-like annotation.
  if (NON_BUSINESS_LOGIC_SUFFIXES.test(cls.name)) return;

  // Three independent triggers: explicit stereotype annotation
  // (`@Service` or `@Component`, the `NON_BUSINESS_LOGIC_SUFFIXES` deny-list
  // above filters out the non-business `@Component` shapes), domain-
  // flavoured name suffix, or any `@Transactional` (class- or method-level).
  const isStereotyped = SERVICE_LAYER_ANNOTATIONS.some((n) =>
    hasAnnotation(cls.annotations, n),
  )
    || hasAnnotation(cls.annotations, TRANSACTIONAL_TRIGGER_ANNOTATION)
    || cls.methods.some((m) => hasAnnotation(m.annotations, TRANSACTIONAL_TRIGGER_ANNOTATION));
  const nameSuggests = SERVICE_NAME_SUFFIX_RE.test(cls.name);
  if (!isStereotyped && !nameSuggests) return;

  // Bug 16 fix (2026-04-22): skip `*Impl` classes whose interface is in
  // the scan. Interface is the canonical candidate carrier. See the
  // matching fix in `frameworkAdapters/springClassic/index.ts`.
  if (!cls.isInterface && cls.name.endsWith('Impl')) {
    const base = cls.name.slice(0, -'Impl'.length);
    if (interfaceNameSet.has(base)) {
      return;
    }
  }

  // Bug 2 fix: de-duplicate overloads on (className, methodName). The
  // meta-model's `business_logics` has no signature, so two overloads of
  // `generatePreview(...)` collapse to one candidate. (Bug 1 — anonymous
  // inner-class methods leaking — is fixed in the Java extractor itself, so
  // cls.methods already contains only outer-class methods.)
  const seenMethodNames = new Set<string>();

  for (const method of cls.methods) {
    // Bug 16 fix (2026-04-22): Java interface methods are implicitly
    // public but the parser doesn't synthesize the modifier.
    if (!cls.isInterface && !method.modifiers.includes('public')) continue;
    if (cls.isInterface && (method.modifiers.includes('private') || method.modifiers.includes('default'))) {
      continue;
    }
    // Always skip Object methods regardless of class.
    if (method.name === 'toString' || method.name === 'equals' || method.name === 'hashCode') {
      continue;
    }
    // Bug 3 fix: the zero-arg `get*/set*/is*` accessor skip is ONLY a safety
    // net for classes reached via the name-suggests heuristic (no explicit
    // annotation). When the class carries an explicit @Service / @Component /
    // @Repository stereotype, trust the author — a zero-arg `getFactTypes()`
    // on a @Service IS the public API of that service (e.g. catalog / lookup
    // services), not a POJO field exposure.
    if (
      !isStereotyped &&
      method.parameters.length === 0 &&
      /^(get|set|is)[A-Z]/.test(method.name)
    ) {
      continue;
    }
    // Drop Spring lifecycle hooks (@PostConstruct / @PreDestroy) — they are
    // infrastructure plumbing, not business logic. Tier-1 filter.
    if (LIFECYCLE_HOOK_ANNOTATIONS.some((n) => hasAnnotation(method.annotations, n))) {
      continue;
    }
    if (seenMethodNames.has(method.name)) continue;
    seenMethodNames.add(method.name);

    const data: Record<string, unknown> = {
      className: cls.name,
      returnType: method.returnType,
      parameterCount: method.parameters.length,
    };

    // Tier 1: @Transactional metadata (method-level, falling back to
    // class-level when the class is itself @Transactional).
    const tx = extractTransactionalMeta(method.annotations, cls.annotations);
    if (tx) data.transactional = tx;

    // Tier 2: subtype classification + per-subtype config.
    const subtype = classifyBusinessLogicSubtype(method.annotations);
    if (subtype) data.businessLogicSubtype = subtype;
    const scheduled = extractScheduledMeta(method.annotations);
    if (scheduled) data.scheduled = scheduled;
    const asyncMeta = extractAsyncMeta(method.annotations);
    if (asyncMeta) data.async = asyncMeta;
    const eventListener = extractEventListenerMeta(method.annotations);
    if (eventListener) data.eventListener = eventListener;
    const cache = extractCacheMeta(method.annotations);
    if (cache) data.cache = cache;

    out.candidates.push(
      makeCandidate('business_logics', method.name, file.filePath, data, runId),
    );
  }
}

/**
 * Process a `@Configuration` class, emitting one `interfaces` candidate per
 * `@Bean` method. The emitted candidate represents the bean contract — its
 * return type identifies the bean's class, the bean name (from `@Bean(name=)`
 * or the method name) identifies the wiring key, and the carrying
 * `@Configuration` is captured so reviewers can trace where each bean is
 * registered.
 *
 * Tier 2 addition (2026-04-26). Java-Spring-Boot codebases often hand-wire a
 * substantial part of the architecture through @Configuration; without this
 * processor, those beans were visible only via @Service classes (if any) and
 * the rubric counted them as gaps in the interface surface.
 */
function processConfigurationClass(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  out: AdapterOutput,
): void {
  if (!hasAnnotation(cls.annotations, 'Configuration')) return;
  for (const method of cls.methods) {
    if (!hasAnnotation(method.annotations, 'Bean')) continue;
    const beanAnn = findAnnotation(method.annotations, 'Bean');
    const beanName = annotationArg(beanAnn, 'name') || annotationArg(beanAnn, 'value') || method.name;
    const scopeAnn = findAnnotation(method.annotations, 'Scope');
    const scope = annotationArg(scopeAnn, 'value') || annotationArg(scopeAnn, 'scopeName');
    const data: Record<string, unknown> = {
      interfaceSubtype: 'spring-bean-definition',
      beanName,
      beanReturnType: method.returnType,
      configurationClassName: cls.name,
      packageName: file.packageOrNamespace,
      isPrimary: hasAnnotation(method.annotations, 'Primary'),
      isLazy: hasAnnotation(method.annotations, 'Lazy'),
    };
    if (scope) data.scope = scope;
    out.candidates.push(
      makeCandidate('interfaces', `${cls.name}#${beanName}`, file.filePath, data, runId),
    );
  }
}

// ---------------------------------------------------------------------------
// Post-pass: outbound integration graph (`data_movements` candidates)
// Spec: 2026-05-30 Outbound Integration Graph for Discovery, Task Group 4.
// ---------------------------------------------------------------------------

/**
 * Emit `data_movements` outbound-edge candidates for the scanned IR, giving the
 * springBoot adapter PARITY with the springClassic adapter (which gained this in
 * Task Group 3). What a service CALLS OUT TO -- outbound HTTP / published
 * messages / secondary stores / files-objects / email-sms / third-party SDKs --
 * becomes a first-class `data_movements` edge attributed to the calling endpoint
 * or owning service.
 *
 * This DELEGATES wholesale to the SHARED, framework-agnostic
 * {@link buildOutboundIntegrationCandidates} (Task Group 3), which internally
 * runs the SHARED {@link resolveOutboundIntegrations} resolver (Task Group 2)
 * over the SAME `SourceFileIR[]`. There is NO springBoot-specific detection
 * logic here and NO fork of the resolver -- the resolver gates on the standard
 * Spring stereotypes (@RestController / @GetMapping / @Service) that springBoot
 * controllers and services use IDENTICALLY to springClassic, and it reads the
 * now-populated `CallIR.args` (Task Group 1) so non-literal-URL cases resolve
 * where possible.
 *
 * Mirrors the springClassic dispatch (`springClassic/index.ts`, where
 * `out.candidates.push(...buildOutboundIntegrationCandidates(files, runId))`
 * sits alongside `buildEndpointDataEffectCandidates`) and this adapter's own
 * whole-IR post-passes (`emitLogicalEntities` / `emitInterfaceLogicalEntities`):
 * the resolver is whole-IR (it walks the full call graph across every file), so
 * it runs ONCE over `files`, NOT per class. Purely-external targets ALSO surface
 * as `external_integration_dependency` Findings (emitted separately by the
 * finding scanner over the same resolver output) -- never an invented external
 * entity. The candidate carries source/target NAMES + `movementType` only;
 * save-back resolves the `application_point`s LATE (NEVER a `*_points` ref,
 * NEVER a 1:1 mapping). Soft-fails (the shared resolver never throws).
 */
function processOutboundIntegrations(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  out.candidates.push(...buildOutboundIntegrationCandidates(files, runId));
}

// ---------------------------------------------------------------------------
// Post-pass: emit logical_entity + logical_data_attribute for any DTO types
// referenced by endpoints that are also defined in the scanned files.
// ---------------------------------------------------------------------------

function emitLogicalEntities(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  if (out.dtoTypeNames.size === 0) return;

  // Strip array brackets from any referenced DTO types
  const normalized = new Set<string>();
  for (const n of out.dtoTypeNames) normalized.add(n.replace(/\[\]$/, '').trim());

  for (const file of files) {
    for (const cls of file.classes) {
      if (!normalized.has(cls.name)) continue;

      // Skip classes that are already emitted as physical_entity (JPA @Entity)
      if (hasAnnotation(cls.annotations, 'Entity')) continue;

      const logical = makeCandidate(
        'logical_data_entities',
        cls.name,
        file.filePath,
        {
          className: cls.name,
          packageName: file.packageOrNamespace,
        },
        runId,
      );
      out.candidates.push(logical);

      // Emit each public field as a logical_data_attribute
      for (const field of cls.fields) {
        if (field.modifiers.includes('static')) continue;
        out.candidates.push(
          makeCandidate(
            'logical_data_attributes',
            field.name,
            file.filePath,
            {
              fieldName: field.name,
              dataType: field.type,
              logicalEntityName: cls.name,
            },
            runId,
            logical.id,
          ),
        );
      }
    }
  }
}


/**
 * Emit `interface_logical_entities` candidates for (controller, DTO) pairs.
 *
 * Per-interface granularity: if `OwnerController` has 5 endpoints all using
 * `OwnerDto`, this emits exactly ONE `interface_logical_entities` candidate
 * named `OwnerController -> OwnerDto` (ASCII arrow, single spaces).
 *
 * Undirected: a single entry per (controller, DTO) pair regardless of whether
 * the DTO appears as a request body, response body, or both.
 *
 * Only emits when the DTO was also emitted as a `logical_data_entities`
 * candidate (i.e. the DTO class is defined in the scanned codebase). This
 * mirrors the `emitLogicalEntities` scope — the adapter has no useful entry
 * to link a controller to a DTO the project does not define.
 */
function emitInterfaceLogicalEntities(
  files: SourceFileIR[],
  runId: string,
  out: AdapterOutput,
): void {
  if (out.controllerToDtos.size === 0) return;

  // Build the set of DTO class names the adapter actually emitted as
  // `logical_data_entities` candidates (these are the linkable targets).
  const emittedLogicalEntities = new Set<string>();
  for (const c of out.candidates) {
    if (c.candidateType === 'logical_data_entities') {
      emittedLogicalEntities.add(c.name);
    }
  }
  if (emittedLogicalEntities.size === 0) return;

  // Build file-path lookup for controllers so we can attach the emitted
  // candidate to the right source file.
  const controllerFilePath = new Map<string, string>();
  for (const file of files) {
    for (const cls of file.classes) {
      controllerFilePath.set(cls.name, file.filePath);
    }
  }

  for (const [controllerName, dtos] of out.controllerToDtos.entries()) {
    const filePath = controllerFilePath.get(controllerName) ?? '';
    for (const rawDto of dtos) {
      // Strip array brackets (e.g. OwnerDto[] -> OwnerDto).
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

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runSpringBootAdapter(
  files: SourceFileIR[],
  runId: string,
): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [], dtoTypeNames: new Set(), controllerToDtos: new Map() };
  const classIndex = buildClassIndex(files);
  // Bug 16 fix (2026-04-22): pre-compute interface name set for
  // business_logic interface/impl dedup.
  const interfaceNameSet = new Set<string>();
  for (const file of files) {
    for (const cls of file.classes) {
      if (cls.isInterface) interfaceNameSet.add(cls.name);
    }
  }

  for (const file of files) {
    for (const cls of file.classes) {
      processController(cls, file, runId, out);
      processJpaEntity(cls, file, runId, out, classIndex);
      processServiceLayerBusinessLogic(cls, file, runId, out, interfaceNameSet);
      processConfigurationClass(cls, file, runId, out);
    }
  }

  // Outbound Integration Graph (2026-05-30, Spec #5, Task Group 4): springBoot
  // PARITY post-pass. The shared `outboundIntegrationResolver` walks the WHOLE
  // controller->service call graph across every file, so the outbound-edge emit
  // runs ONCE over `files` here -- alongside the sibling per-class dispatch above
  // and this adapter's other whole-IR post-passes (logical/interface entities) --
  // NOT inside the per-class loop. REUSES the Task Group 3 emit helper that the
  // springClassic adapter also uses (no fork). Emits one `data_movements`
  // candidate per (source owner, resolved target) pair; purely-external targets
  // also surface as `external_integration_dependency` Findings via the finding
  // scanner over the same IR. NEVER mints `*_points`; NEVER a 1:1 mapping.
  processOutboundIntegrations(files, runId, out);

  // Second pass: once all files are processed and we know the full DTO name
  // set, emit logical_entity candidates for DTOs defined in the scanned codebase.
  emitLogicalEntities(files, runId, out);

  // Third pass: for each (controller, DTO) pair collected during endpoint
  // processing, emit an `interface_logical_entities` candidate linking the
  // controller to the DTO (once per pair, regardless of how many endpoints
  // reference it).
  emitInterfaceLogicalEntities(files, runId, out);

  return out.candidates;
}
