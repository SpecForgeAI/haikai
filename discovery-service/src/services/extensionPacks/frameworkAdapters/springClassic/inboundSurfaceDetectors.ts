/**
 * Inbound-surface completeness detectors (Spec #4 of 6, Phase-2 "oracle
 * perfection") — Task Groups 2, 3, 4.
 *
 * Three NEW deterministic inbound-entry-point detectors that the runtime
 * harness currently cannot see:
 *
 *   - Task Group 2: JAX-RS resources (`@Path` + `@GET`/`@POST`/... + `@Produces`
 *     / `@Consumes` + `@QueryParam`/`@HeaderParam`/`@PathParam`), both
 *     `javax.ws.rs.*` and `jakarta.ws.rs.*`.
 *   - Task Group 3: raw servlets — `@WebServlet(urlPatterns=.../value=...)` and
 *     `extends HttpServlet` with `doGet`/`doPost`/... handlers — plus
 *     `web.xml` `<servlet-mapping>` URL extraction.
 *   - Task Group 4: WebFlux functional `RouterFunction` routes
 *     (`RouterFunctions.route()…GET("/p", handler)` / `route(GET("/p"), h)`).
 *
 * Each detector emits the EXACT canonical `interfaces` / `endpoints` candidate
 * shape the Spring-MVC `processController` path produces — so save-back
 * resolves them UNCHANGED (no AMS / save-back change). This module is the
 * SOAP-emitter precedent applied to inbound REST-flavour surfaces: a
 * non-`processController` detector building the identical save-back-compatible
 * candidate shape (`candidateType:'interfaces'|'endpoints'`, `confidence: 0.9`,
 * `status:'proposed'`, endpoint `data` carrying `httpMethod`/`fullPath`/
 * `methodName`/`controllerClassName`/`returnType`, `data._addedBy` a
 * detector-specific tag).
 *
 * The small pure helpers (`composeFullPath`, `normalisePath`, `splitBraceList`,
 * the discriminator + param extractors) are intentionally REPLICATED here from
 * `springClassic/index.ts` rather than imported, to keep these new detectors a
 * self-contained sibling module (the SOAP emitter likewise builds
 * `DiscoveryCandidate`s with its own local helpers). They are byte-equivalent
 * to the adapter's helpers; `AnnotationIR` is NOT refactored to array-typed
 * args (W1 scope note) — brace-lists are parsed from the existing raw string.
 *
 * Deterministic; bounded; soft-fails per-class so a malformed IR cannot poison
 * the run. No LLM. ADD/EXTEND only.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  ParameterIR,
  AnnotationIR,
} from '../../languageIR';
import { annotationArg } from '../../languageIR';
import { parseWebXmlServletMappings } from '../../../findings/packFindingScanners/webXmlServletParser';

// ---------------------------------------------------------------------------
// Detector tags (the `data._addedBy` value each detector stamps). Kept
// detector-specific so a reviewer / downstream consumer can tell which
// inbound-surface detector produced a candidate, while still being part of
// the spring-classic adapter family.
// ---------------------------------------------------------------------------
const ADDED_BY_JAXRS = 'spring-classic-jaxrs';
const ADDED_BY_SERVLET = 'spring-classic-servlet';
const ADDED_BY_WEBFLUX = 'spring-classic-webflux-fn';

// ---------------------------------------------------------------------------
// Shared pure helpers (replicated from `springClassic/index.ts`; pure +
// trivially equivalent). See the module header for why these are local.
// ---------------------------------------------------------------------------

/** The final simple-name segment of an annotation name. A fully-qualified
 *  reference (`javax.ws.rs.GET`) yields `GET`; a bare simple name is
 *  unchanged. */
function annotationSimpleName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

/** True when ANY annotation in the list resolves (by simple-name OR
 *  fully-qualified final segment) to one of `names`. */
function hasAnnotationSimple(annotations: AnnotationIR[], names: Set<string>): boolean {
  return annotations.some((a) => names.has(annotationSimpleName(a.name)));
}

/** First annotation whose simple name is `name` (FQN-tolerant). */
function findAnnotationSimple(
  annotations: AnnotationIR[],
  name: string,
): AnnotationIR | undefined {
  return annotations.find((a) => annotationSimpleName(a.name) === name);
}

function stripArrayBracesAndQuotes(value: string): string {
  let v = value.trim();
  // Only unwrap a Spring multi-value ARRAY LITERAL — `@RequestMapping({"/a","/b"})`
  // — whose inner content begins with a quote. A path TEMPLATE that merely happens
  // to begin AND end with a path-param segment (`{businessDate}/{orgUnitId}`, or a
  // bare single `{orgUnitId}`) is NOT an array literal: stripping its outer braces
  // would mangle the template into `businessDate}/{orgUnitId` (the malformed twin)
  // or `orgUnitId` (the brace-less twin), giving the same logical endpoint two
  // distinct canonical paths and defeating the Spec-0 identity-keyed merge. The
  // leading-quote guard distinguishes the two: an array literal's first inner char
  // is always `"` or `'`; a template's never is.
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

/** Split a possible `{a, b, c}` brace-list into trimmed members. A bare
 *  (non-brace) string returns a single-member list. (W1 `splitBraceList`.) */
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

/** Parse a (possibly brace-list) arg into normalised members, quote-stripped,
 *  empties dropped. Returns [] when unset. */
function parseStringMembers(raw: string | undefined): string[] {
  if (!raw) return [];
  return splitBraceList(raw)
    .map((m) => m.replace(/^["']|["']$/g, '').trim())
    .filter((m) => m.length > 0);
}

// ---------------------------------------------------------------------------
// Canonical candidate factory — byte-identical shape to the adapter's
// `makeCandidate` (`confidence: 0.9`, `status: 'proposed'`,
// `sourceClusterIds: [filePath]`, `data._addedBy`). Save-back resolves this
// unchanged.
// ---------------------------------------------------------------------------
function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  addedBy: string,
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
    data: { ...data, _addedBy: addedBy },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

// ---------------------------------------------------------------------------
// Discriminator + request-shaping input capture (anti-collapse) — mirrors the
// TG1 fields so same path+verb variants stay DISTINCT and the harness can vary
// inputs. JAX-RS `@Produces`/`@Consumes` map onto the SAME discriminator
// fields; `@QueryParam`/`@HeaderParam`/`@PathParam` onto the SAME input fields.
// ---------------------------------------------------------------------------
interface Discriminators {
  consumes: string[];
  produces: string[];
  headers: string[];
  params: string[];
}

interface RequestInput {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

/** A stable, normalised suffix folded into the endpoint `name` when ANY
 *  discriminator is present, so same path+verb variants stay DISTINCT. Members
 *  sorted within each key; keys emitted in a fixed order. Empty string when
 *  there are no discriminators (plain endpoints keep the exact
 *  `${verb} ${path}` name — regression guard). Byte-identical to the adapter's
 *  `discriminatorNameSuffix`. */
function discriminatorNameSuffix(d: Discriminators): string {
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

/** Fold the captured discriminators + inputs onto an endpoint `data` blob
 *  (only when present, to keep the common-case data shape unchanged). */
function applyDiscriminatorsAndInputs(
  data: Record<string, unknown>,
  d: Discriminators,
  requestParams: RequestInput[],
  requestHeaders: RequestInput[],
): void {
  if (d.consumes.length > 0) data.consumes = d.consumes;
  if (d.produces.length > 0) data.produces = d.produces;
  if (d.headers.length > 0) data.headers = d.headers;
  if (d.params.length > 0) data.params = d.params;
  if (requestParams.length > 0) data.requestParams = requestParams;
  if (requestHeaders.length > 0) data.requestHeaders = requestHeaders;
}

// ===========================================================================
// TASK GROUP 2 — JAX-RS resource detector
// ===========================================================================

const JAXRS_HTTP_METHOD_ANNOTATIONS = new Set([
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'PATCH', // jakarta.ws.rs.PATCH (JAX-RS 3.1) — defensive.
]);
const JAXRS_PATH_ANNOTATION = 'Path';
const JAXRS_PRODUCES_ANNOTATION = 'Produces';
const JAXRS_CONSUMES_ANNOTATION = 'Consumes';
const JAXRS_QUERY_PARAM_ANNOTATION = 'QueryParam';
const JAXRS_HEADER_PARAM_ANNOTATION = 'HeaderParam';
const JAXRS_PATH_PARAM_ANNOTATION = 'PathParam';
const JAXRS_DEFAULT_VALUE_ANNOTATION = 'DefaultValue';

/** The HTTP verbs a JAX-RS method declares (`@GET`/`@POST`/...). A resource
 *  method usually carries exactly one; multiple is unusual but supported so
 *  the (verb x path) fan-out matches the W1 shape. Order preserved. */
function jaxRsMethodVerbs(method: FunctionIR): string[] {
  const verbs: string[] = [];
  for (const ann of method.annotations) {
    const simple = annotationSimpleName(ann.name);
    if (JAXRS_HTTP_METHOD_ANNOTATIONS.has(simple) && !verbs.includes(simple)) {
      verbs.push(simple);
    }
  }
  return verbs;
}

/** The method-level `@Path` value (normalised), or '' when absent (the method
 *  inherits the class path only). */
function jaxRsMethodPath(method: FunctionIR): string {
  const a = findAnnotationSimple(method.annotations, JAXRS_PATH_ANNOTATION);
  if (!a) return '';
  const val = annotationArg(a, 'value') || annotationArg(a, 'path');
  return val ? normalisePath(val) : '';
}

/** JAX-RS `@Produces`/`@Consumes` → discriminator fields (TG1 fields).
 *  `headers`/`params` have no JAX-RS analogue, so stay empty. */
function jaxRsDiscriminators(method: FunctionIR, cls: ClassIR): Discriminators {
  // Method-level annotation wins; fall back to the class-level default
  // (JAX-RS resolves @Produces/@Consumes that way).
  const producesAnn =
    findAnnotationSimple(method.annotations, JAXRS_PRODUCES_ANNOTATION) ??
    findAnnotationSimple(cls.annotations, JAXRS_PRODUCES_ANNOTATION);
  const consumesAnn =
    findAnnotationSimple(method.annotations, JAXRS_CONSUMES_ANNOTATION) ??
    findAnnotationSimple(cls.annotations, JAXRS_CONSUMES_ANNOTATION);
  return {
    produces: parseStringMembers(annotationArg(producesAnn, 'value')),
    consumes: parseStringMembers(annotationArg(consumesAnn, 'value')),
    headers: [],
    params: [],
  };
}

/** Capture a JAX-RS param annotation (`@QueryParam`/`@HeaderParam`) onto the
 *  SAME `requestParams`/`requestHeaders` input shape as the Spring path.
 *  `@DefaultValue` on the same parameter supplies `defaultValue`; presence of
 *  `@DefaultValue` makes the input optional (`required: false`). */
function jaxRsInputs(params: ParameterIR[], annName: string): RequestInput[] {
  const out: RequestInput[] = [];
  for (const p of params) {
    const a = findAnnotationSimple(p.annotations, annName);
    if (!a) continue;
    const name = annotationArg(a, 'value') || p.name;
    const dv = findAnnotationSimple(p.annotations, JAXRS_DEFAULT_VALUE_ANNOTATION);
    const defaultValue = dv ? annotationArg(dv, 'value') : undefined;
    const entry: RequestInput = {
      name,
      type: p.type,
      // JAX-RS params are optional by default; a @DefaultValue underlines that.
      required: defaultValue === undefined,
    };
    if (defaultValue !== undefined) entry.defaultValue = defaultValue;
    out.push(entry);
  }
  return out;
}

/**
 * Detect a JAX-RS resource: a class and/or its methods carrying `@Path`, with
 * method-level HTTP-verb annotations. Emits ONE `interfaces` candidate per
 * resource + one `endpoints` candidate per (verb x method-path), parented to
 * the interface.
 *
 * Guard: a class that is ALSO a Spring `@Controller`/`@RestController` is NOT
 * emitted here (the Spring path owns it) — the caller passes `isSpringController`.
 * Soft-fails per-class.
 */
export function detectJaxRsResource(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  isSpringController: boolean,
): DiscoveryCandidate[] {
  try {
    if (isSpringController) return [];
    // A JAX-RS resource is a class with a class-level @Path AND/OR methods
    // carrying a JAX-RS verb annotation. Require at least one verb-annotated
    // method to emit endpoints — a bare @Path class with no verbs is not an
    // endpoint container we can model.
    const classPathAnn = findAnnotationSimple(cls.annotations, JAXRS_PATH_ANNOTATION);
    const verbMethods = cls.methods.filter((m) => jaxRsMethodVerbs(m).length > 0);
    if (!classPathAnn && verbMethods.length === 0) return [];
    if (verbMethods.length === 0) return [];

    const classPathVal = classPathAnn
      ? annotationArg(classPathAnn, 'value') || annotationArg(classPathAnn, 'path')
      : undefined;
    const basePath = classPathVal ? normalisePath(classPathVal) : '';

    const out: DiscoveryCandidate[] = [];
    const interfaceCandidate = makeCandidate(
      'interfaces',
      cls.name,
      file.filePath,
      {
        basePath,
        // `controllerType` = the JAX-RS resource flavour, so the downstream
        // `interfaces` drop-list filter does NOT mistake it for config.
        controllerType: 'JaxRsResource',
        interfaceSubtype: 'jaxrs-resource',
        // A JAX-RS resource IS a REST API (Kiro 2026-08-24). Only the SOAP
        // emitter ever set `interface_type`, so every JAX-RS resource class
        // committed with the field null and surfaced as a save-back
        // QUALITY_GAP the operator had to fill in by hand.
        interface_type: 'REST_API',
        className: cls.name,
        packageName: file.packageOrNamespace,
      },
      runId,
      ADDED_BY_JAXRS,
    );
    out.push(interfaceCandidate);

    for (const method of verbMethods) {
      const verbs = jaxRsMethodVerbs(method);
      const methodPath = jaxRsMethodPath(method);
      const fullPath = composeFullPath(basePath, methodPath);
      const discriminators = jaxRsDiscriminators(method, cls);
      const nameSuffix = discriminatorNameSuffix(discriminators);
      const requestParams = jaxRsInputs(method.parameters, JAXRS_QUERY_PARAM_ANNOTATION);
      const requestHeaders = jaxRsInputs(method.parameters, JAXRS_HEADER_PARAM_ANNOTATION);
      const pathParams = jaxRsInputs(method.parameters, JAXRS_PATH_PARAM_ANNOTATION);
      const rawReturnType = method.returnType;

      for (const httpMethod of verbs) {
        const data: Record<string, unknown> = {
          httpMethod,
          fullPath,
          methodName: method.name,
          controllerClassName: cls.name,
          returnType: rawReturnType,
        };
        applyDiscriminatorsAndInputs(data, discriminators, requestParams, requestHeaders);
        if (pathParams.length > 0) data.pathParams = pathParams;
        out.push(
          makeCandidate(
            'endpoints',
            `${httpMethod} ${fullPath}${nameSuffix}`,
            file.filePath,
            data,
            runId,
            ADDED_BY_JAXRS,
            interfaceCandidate.id,
          ),
        );
      }
    }
    return out;
  } catch (err) {
    console.warn(
      `[spring-classic] JAX-RS detector failed on '${cls.name}'; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

// ===========================================================================
// TASK GROUP 3 — Servlet / web.xml / @WebServlet detector
// ===========================================================================

const WEB_SERVLET_ANNOTATION = 'WebServlet';
const HTTP_SERVLET_SUPERCLASS_NAMES = new Set(['HttpServlet', 'GenericServlet']);
const SERVLET_DO_METHOD_VERBS: Record<string, string> = {
  doGet: 'GET',
  doPost: 'POST',
  doPut: 'PUT',
  doDelete: 'DELETE',
  doHead: 'HEAD',
  doOptions: 'OPTIONS',
  doTrace: 'TRACE',
};
const SERVLET_ALL_VERB_METHODS = new Set(['service', 'processRequest']);
const SERVLET_ALL_VERBS = ['GET', 'POST', 'PUT', 'DELETE'];

/** The HTTP verbs a servlet handles, inferred from its `doXxx` / `service`
 *  handler methods. `service(...)` (or `processRequest(...)`) means all verbs.
 *  When the class declares no recognised handler, default to GET so the URL is
 *  still surfaced (the existing default-verb convention). */
function servletVerbs(cls: ClassIR): string[] {
  const verbs: string[] = [];
  let allVerbs = false;
  for (const m of cls.methods) {
    if (SERVLET_ALL_VERB_METHODS.has(m.name)) {
      allVerbs = true;
      continue;
    }
    const v = SERVLET_DO_METHOD_VERBS[m.name];
    if (v && !verbs.includes(v)) verbs.push(v);
  }
  if (allVerbs) {
    // Union of the all-verb set with any explicitly-declared doXxx verbs.
    for (const v of SERVLET_ALL_VERBS) if (!verbs.includes(v)) verbs.push(v);
  }
  return verbs.length > 0 ? verbs : ['GET'];
}

/** True when `cls extends HttpServlet` (directly, via the recognised servlet
 *  base classes). Single-inheritance check is shallow by design — a servlet is
 *  almost always a DIRECT `extends HttpServlet`. */
function extendsHttpServlet(cls: ClassIR): boolean {
  return cls.extends != null && HTTP_SERVLET_SUPERCLASS_NAMES.has(cls.extends);
}

/** The url-patterns declared on a `@WebServlet` annotation
 *  (`urlPatterns={...}` or the `value` shorthand), normalised. */
function webServletUrlPatterns(cls: ClassIR): string[] {
  const a = findAnnotationSimple(cls.annotations, WEB_SERVLET_ANNOTATION);
  if (!a) return [];
  const raw = annotationArg(a, 'urlPatterns') ?? annotationArg(a, 'value');
  return parseStringMembers(raw).map((p) => normalisePath(p));
}

/** The servlet handler method name backing a given verb (`GET` -> `doGet`),
 *  falling back to the all-verb handler (`service`) when the class only
 *  declares that, else the conventional `doXxx` name. */
function servletHandlerForVerb(cls: ClassIR, verb: string): string {
  const expected = `do${verb.charAt(0)}${verb.slice(1).toLowerCase()}`;
  if (cls.methods.some((m) => m.name === expected)) return expected;
  for (const m of cls.methods) if (SERVLET_ALL_VERB_METHODS.has(m.name)) return m.name;
  return expected;
}

/**
 * Emit servlet interface + endpoint candidates for a single class when it is a
 * `@WebServlet`-annotated class and/or an `extends HttpServlet` class.
 * `extraUrlPatterns` carries any `web.xml`-declared `<servlet-mapping>`
 * url-patterns for this servlet class, merged with the annotation's own
 * patterns. Soft-fails per-class.
 */
export function detectServletClass(
  cls: ClassIR,
  file: SourceFileIR,
  runId: string,
  extraUrlPatterns: string[],
): DiscoveryCandidate[] {
  try {
    const isWebServlet = hasAnnotationSimple(cls.annotations, new Set([WEB_SERVLET_ANNOTATION]));
    const isHttpServlet = extendsHttpServlet(cls);
    if (!isWebServlet && !isHttpServlet && extraUrlPatterns.length === 0) return [];

    // Merge url-patterns from the annotation and web.xml (deduped, ordered).
    const patterns: string[] = [];
    for (const p of webServletUrlPatterns(cls)) if (!patterns.includes(p)) patterns.push(p);
    for (const p of extraUrlPatterns) {
      const np = normalisePath(p);
      if (!patterns.includes(np)) patterns.push(np);
    }
    // A servlet with NO url-pattern (neither annotation nor web.xml) cannot be
    // addressed; surface it with a single '/' placeholder so it is still
    // visible as an endpoint container rather than a silent drop.
    if (patterns.length === 0) patterns.push('/');

    const verbs = servletVerbs(cls);

    const out: DiscoveryCandidate[] = [];
    const interfaceCandidate = makeCandidate(
      'interfaces',
      cls.name,
      file.filePath,
      {
        // First url-pattern as the interface base path for context.
        basePath: patterns[0],
        controllerType: 'Servlet',
        interfaceSubtype: 'servlet',
        className: cls.name,
        packageName: file.packageOrNamespace,
        urlPatterns: patterns,
      },
      runId,
      ADDED_BY_SERVLET,
    );
    out.push(interfaceCandidate);

    for (const urlPattern of patterns) {
      const fullPath = normalisePath(urlPattern);
      for (const httpMethod of verbs) {
        const data: Record<string, unknown> = {
          httpMethod,
          fullPath,
          methodName: servletHandlerForVerb(cls, httpMethod),
          controllerClassName: cls.name,
          returnType: 'void',
          endpoint_subtype: 'servlet',
        };
        out.push(
          makeCandidate(
            'endpoints',
            `${httpMethod} ${fullPath}`,
            file.filePath,
            data,
            runId,
            ADDED_BY_SERVLET,
            interfaceCandidate.id,
          ),
        );
      }
    }
    return out;
  } catch (err) {
    console.warn(
      `[spring-classic] servlet detector failed on '${cls.name}'; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** Collect web.xml servlet-mappings across all IR files, returning the
 *  (servlet-class -> url-pattern[]) map keyed by SIMPLE class name (so it
 *  matches a `ClassIR.name`). FQN keys are reduced to their simple segment;
 *  a duplicate simple-name across packages merges patterns (rare, acceptable
 *  for the visibility goal). Pure; soft-fails a malformed web.xml. */
export function collectWebXmlServletMappings(
  files: SourceFileIR[],
): Map<string, string[]> {
  const bySimpleName = new Map<string, string[]>();
  for (const file of files) {
    if (!file.rawContent) continue;
    const lc = file.filePath.toLowerCase();
    const isWebXml =
      lc.endsWith('/web.xml') || lc.endsWith('\\web.xml') || lc === 'web.xml';
    if (!isWebXml) continue;
    let mappings: Array<{ servletClass: string; urlPatterns: string[] }>;
    try {
      mappings = parseWebXmlServletMappings(file.rawContent);
    } catch {
      continue; // soft-fail a malformed web.xml
    }
    for (const m of mappings) {
      const simple = m.servletClass.includes('.')
        ? m.servletClass.slice(m.servletClass.lastIndexOf('.') + 1)
        : m.servletClass;
      const existing = bySimpleName.get(simple) ?? [];
      for (const p of m.urlPatterns) {
        const np = normalisePath(p);
        if (!existing.includes(np)) existing.push(np);
      }
      bySimpleName.set(simple, existing);
    }
  }
  return bySimpleName;
}

// ===========================================================================
// TASK GROUP 4 — WebFlux functional RouterFunction detector
// ===========================================================================
//
// The functional routing DSL is a CALL chain (`RouterFunctions.route()…GET(
// "/p", handler)` / `route(GET("/p"), handler)`). The Java IR does not model
// these call expressions for this purpose, so — exactly as the existing
// outbound `RestTemplate` / `WebClient` path does — we parse them from
// `file.rawContent` heuristically. A class whose method returns a
// `RouterFunction<…>` (or whose body references the routing DSL) is the entry
// point.

const ROUTER_FUNCTION_RETURN_RE = /RouterFunction\s*</;
// Predicate-style: `.GET("/path"`, `.POST("/path"`, ... (builder chain).
const ROUTER_BUILDER_VERB_RE =
  /\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*(["'`])([^"'`]+)\2/g;
// Predicate-arg style: `route(GET("/path")` / `RequestPredicates.GET("/path")` /
// `.andRoute(POST("/path")` -> the verb is a bare predicate function call whose
// FIRST string arg is the path.
const ROUTER_PREDICATE_VERB_RE =
  /(?:\bRequestPredicates\s*\.\s*)?\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*(["'`])([^"'`]+)\2/g;

/**
 * Detect WebFlux functional routes in a file. Returns one `interfaces`
 * candidate (the router configuration) + one `endpoints` candidate per
 * (verb x route-path) discovered in the routing DSL. Heuristic, raw-source
 * based; deduped on (verb, path). Soft-fails.
 *
 * Only fires on files that actually reference `RouterFunction<…>` so the
 * regex does not run over every Java file.
 */
export function detectWebFluxRouterFunctions(
  file: SourceFileIR,
  runId: string,
): DiscoveryCandidate[] {
  try {
    const raw = file.rawContent;
    if (!raw) return [];
    if (!ROUTER_FUNCTION_RETURN_RE.test(raw)) return [];

    // Collect (verb -> path) pairs from both DSL shapes, deduped.
    const seen = new Set<string>();
    const routes: Array<{ verb: string; path: string }> = [];
    const collect = (verb: string, rawPath: string): void => {
      // Only keep server-route paths (leading slash). The predicate regex can
      // also match unrelated `GET(...)` call shapes; the leading-slash gate +
      // the RouterFunction file guard keep false positives low.
      if (!rawPath.startsWith('/')) return;
      const path = normalisePath(rawPath);
      const key = `${verb} ${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      routes.push({ verb, path });
    };

    let m: RegExpExecArray | null;
    ROUTER_BUILDER_VERB_RE.lastIndex = 0;
    while ((m = ROUTER_BUILDER_VERB_RE.exec(raw)) !== null) {
      collect(m[1], m[3]);
    }
    ROUTER_PREDICATE_VERB_RE.lastIndex = 0;
    while ((m = ROUTER_PREDICATE_VERB_RE.exec(raw)) !== null) {
      collect(m[1], m[3]);
    }

    if (routes.length === 0) return [];

    // Name the router interface after the declaring class when there is
    // exactly one, else the file stem.
    const fileStem =
      file.filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.java$/i, '') ??
      file.filePath;
    const interfaceName = file.classes.length === 1 ? file.classes[0].name : fileStem;
    const packageName = file.packageOrNamespace;

    const out: DiscoveryCandidate[] = [];
    const interfaceCandidate = makeCandidate(
      'interfaces',
      interfaceName,
      file.filePath,
      {
        basePath: '',
        controllerType: 'WebFluxFunctional',
        interfaceSubtype: 'webflux-router-function',
        className: interfaceName,
        packageName,
      },
      runId,
      ADDED_BY_WEBFLUX,
    );
    out.push(interfaceCandidate);

    for (const { verb, path } of routes) {
      const data: Record<string, unknown> = {
        httpMethod: verb,
        fullPath: path,
        methodName: 'route',
        controllerClassName: interfaceName,
        returnType: 'ServerResponse',
        endpoint_subtype: 'webflux-functional',
      };
      out.push(
        makeCandidate(
          'endpoints',
          `${verb} ${path}`,
          file.filePath,
          data,
          runId,
          ADDED_BY_WEBFLUX,
          interfaceCandidate.id,
        ),
      );
    }
    return out;
  } catch (err) {
    console.warn(
      `[spring-classic] WebFlux RouterFunction detector failed on '${file.filePath}'; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
