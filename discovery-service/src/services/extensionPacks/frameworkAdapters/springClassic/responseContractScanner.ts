/**
 * Deterministic per-endpoint RESPONSE-CONTRACT scanner (Spring Classic).
 *
 * Spec: 2026-05-30 Per-endpoint response-contract capture for discovery
 * (Java / Spring Classic first) -- Task Group 2.
 *
 * This is the ALWAYS-ON deterministic spine of response-contract capture. It
 * statically reads the layers that DETERMINE an endpoint's response -- the
 * layers Spec 1 (data effects) and Spec 2 (behaviour) deliberately do NOT see:
 *
 *   Group A (outcomes):
 *     - `@ControllerAdvice` / `@ExceptionHandler` / `@ResponseStatus`
 *       -> `error_responses[]`  (exception / status / source)
 *     - `@Valid` / JSR-380 bean-validation constraints
 *       -> `validation[]`       (field / constraint / failure_status)
 *     - method-level `@PreAuthorize` / `@Secured` / `@RolesAllowed`
 *       (class-level inherited down to the method) + a best-effort
 *       security-filter-chain parse (`<http>` XML / `SecurityFilterChain`
 *       / `WebSecurityConfigurerAdapter` bean URL->role rules)
 *       -> `auth`               (required_roles / 401 / 403 / source)
 *
 *   Group B (wire shape):
 *     - Jackson `@JsonInclude` / `@JsonFormat` / `@JsonProperty`
 *       -> `serialization`      (null_handling / date_format / field_naming / headers)
 *     - `ResponseEntity` status + `Location` header usage
 *       -> `status_codes`       (success / location_header)
 *
 *   Config-conditional:
 *     - `@ConditionalOnProperty` / `@Profile` / `@Value` response divergence
 *       -> `conditional_variants[]` (+ a config-dependent Finding)
 *
 * The scanner is PURE (no I/O): it reads the supplied `SourceFileIR[]` only and
 * REUSES Spec 1's controller->method resolution (`endpointNameFor` from
 * `endpointDataEffectResolver` via the shared composition) to attach each
 * contract to the correct endpoint candidate. It NEVER guesses a security role:
 * any rule it cannot statically resolve sets `auth.source = 'unresolved'` and is
 * surfaced as a Finding by `buildResponseContractFindings`.
 *
 * Output shape mirrors AMS Group 1's `response_contract` JSONB exactly
 * (snake_case keys, internal `schema_version`, boxed `confidence`). The OPTIONAL
 * LLM enrichment stage (`responseContractEnrichmentStep.ts`) fills ONLY the
 * prose/semantic sub-fields this pass cannot (`body_shape`, `response_summary`,
 * `message` interpolation, `envelope`).
 */

import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  ParameterIR,
  AnnotationIR,
} from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';
import {
  buildUnresolvedAuthFinding,
  buildConfigDependentEndpointFinding,
} from '../../../findings/emissionSources';

// ---------------------------------------------------------------------------
// Schema version + confidence
// ---------------------------------------------------------------------------

/**
 * Internal schema version embedded INSIDE the `response_contract` JSONB blob
 * (loose JSONB -- no DB migration as the shape evolves; mirrors Spec 1's
 * `path_metadata_json` and Spec 2's `behavior` precedent). Bump when a consumer
 * must branch on a shape change.
 */
export const RESPONSE_CONTRACT_SCHEMA_VERSION = 'response_contract.v1';

/**
 * Deterministic confidence for a statically-derived contract. The static pass
 * reads annotations/config directly -- it is high-trust (adapter tier), but
 * the LLM enrichment of prose sub-fields rides on a lower tag. We stamp a fixed
 * high value here; the enrichment step does NOT lower it (it only fills gaps).
 */
const DETERMINISTIC_CONFIDENCE = 0.9;

// ---------------------------------------------------------------------------
// Annotation constants (shared shape with the adapter; kept local so the
// scanner is self-contained).
// ---------------------------------------------------------------------------

const CONTROLLER_ANNOTATIONS = ['RestController', 'Controller'];
const ENDPOINT_ANNOTATIONS = [
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'RequestMapping',
];
const HTTP_METHOD_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

// Method-level authz annotations (ported from the springBoot adapter's
// `ENDPOINT_SECURITY_ANNOTATIONS`). Class-level instances are inherited down to
// the method when the method carries none.
const ENDPOINT_SECURITY_ANNOTATIONS = [
  'PreAuthorize',
  'PostAuthorize',
  'Secured',
  'RolesAllowed',
  'PreFilter',
  'PostFilter',
];

// JSR-380 / Jakarta-validation constraint annotations we recognise on bean
// fields and on parameters. The list is the common core; unknown `*` constraints
// still surface their annotation name verbatim.
const VALIDATION_CONSTRAINT_ANNOTATIONS = new Set([
  'NotNull',
  'NotEmpty',
  'NotBlank',
  'Size',
  'Min',
  'Max',
  'DecimalMin',
  'DecimalMax',
  'Pattern',
  'Email',
  'Past',
  'PastOrPresent',
  'Future',
  'FutureOrPresent',
  'Positive',
  'PositiveOrZero',
  'Negative',
  'NegativeOrZero',
  'Digits',
  'AssertTrue',
  'AssertFalse',
]);

// Config-conditional annotations whose response divergence we record as a
// `conditional_variants[]` entry.
const CONDITIONAL_ANNOTATIONS = ['ConditionalOnProperty', 'Profile', 'Value'];

const RESPONSE_STATUS_ANNOTATION = 'ResponseStatus';
const VALID_ANNOTATION = 'Valid';
const VALIDATED_ANNOTATION = 'Validated';
const JSON_INCLUDE_ANNOTATION = 'JsonInclude';
const JSON_FORMAT_ANNOTATION = 'JsonFormat';
const JSON_PROPERTY_ANNOTATION = 'JsonProperty';
const CONTROLLER_ADVICE_ANNOTATIONS = ['ControllerAdvice', 'RestControllerAdvice'];
const EXCEPTION_HANDLER_ANNOTATION = 'ExceptionHandler';

// ---------------------------------------------------------------------------
// Public contract shape (mirrors AMS Group 1 `response_contract`, snake_case).
// ---------------------------------------------------------------------------

export interface ErrorResponseEntry {
  exception: string;
  status: number | null;
  body_shape: string | null;
  source: string;
}

export interface AuthContract {
  required_roles: string[];
  expected_unauthenticated_status: number | null;
  expected_forbidden_status: number | null;
  source: string;
}

export interface ValidationEntry {
  field: string;
  constraint: string;
  failure_status: number;
  message: string | null;
}

export interface SerializationHeader {
  name: string;
  value_or_rule: string;
}

export interface SerializationContract {
  null_handling: string | null;
  date_format: string | null;
  field_naming: string | null;
  envelope: string | null;
  headers: SerializationHeader[];
}

export interface StatusCodesContract {
  success: number | null;
  location_header: boolean;
}

export interface ConditionalVariant {
  condition: string;
  response_summary: string | null;
}

export interface ResponseContractProvenance {
  source_files: string[];
  method_id: string | null;
  advice_ids: string[];
}

/** The full per-endpoint response contract -- the `response_contract` JSONB blob. */
export interface ResponseContract {
  schema_version: string;
  error_responses: ErrorResponseEntry[];
  auth: AuthContract;
  validation: ValidationEntry[];
  serialization: SerializationContract;
  status_codes: StatusCodesContract;
  conditional_variants: ConditionalVariant[];
  provenance: ResponseContractProvenance;
  /** Boxed Double inside the blob (null preserves through PATCH; never 0.0). */
  confidence: number | null;
}

/**
 * One unresolved-auth note carried out of the scanner so the caller can emit a
 * Finding (never a guessed role). Mirrors the `UnresolvedDataEffect` -> finding
 * pattern Spec 1 established.
 */
export interface UnresolvedAuthNote {
  endpointName: string;
  controllerClassName: string;
  endpointMethodName: string;
  detail: string;
  sourceFilePath: string;
}

/** One config-dependent endpoint note (its response is not a pure fn of input). */
export interface ConfigDependentNote {
  endpointName: string;
  controllerClassName: string;
  endpointMethodName: string;
  conditions: string[];
  sourceFilePath: string;
}

/** Full deterministic scan output: contracts keyed by endpoint name + notes. */
export interface ResponseContractScanOutput {
  /** Endpoint name (`${httpMethod} ${fullPath}`) -> contract. */
  contractsByEndpointName: Map<string, ResponseContract>;
  unresolvedAuth: UnresolvedAuthNote[];
  configDependent: ConfigDependentNote[];
}

// ---------------------------------------------------------------------------
// Small helpers (path composition mirrors the resolver / adapter exactly).
// ---------------------------------------------------------------------------

function simpleName(t: string): string {
  const s = t.trim();
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1) : s;
}

function stripGenerics(t: string): string {
  const lt = t.indexOf('<');
  return (lt > 0 ? t.slice(0, lt) : t).trim();
}

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

function extractBasePath(cls: ClassIR): string {
  const rm = findAnnotation(cls.annotations, 'RequestMapping');
  if (!rm) return '';
  const val = annotationArg(rm, 'value') || annotationArg(rm, 'path');
  return val ? normalisePath(val) : '';
}

function extractHttpMethod(m: FunctionIR): string {
  for (const [ann, httpMethod] of Object.entries(HTTP_METHOD_ANNOTATIONS)) {
    if (hasAnnotation(m.annotations, ann)) return httpMethod;
  }
  const rm = findAnnotation(m.annotations, 'RequestMapping');
  if (rm) {
    const methodArg = annotationArg(rm, 'method');
    if (methodArg) {
      const parts = methodArg.split('.');
      return parts[parts.length - 1].toUpperCase();
    }
    return 'GET';
  }
  return 'GET';
}

function extractMethodPath(m: FunctionIR): string {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(m.annotations, ann);
    if (!a) continue;
    const val = annotationArg(a, 'value') || annotationArg(a, 'path');
    if (val) return normalisePath(val);
  }
  return '';
}

function endpointNameFor(cls: ClassIR, m: FunctionIR): string {
  return `${extractHttpMethod(m)} ${composeFullPath(extractBasePath(cls), extractMethodPath(m))}`;
}

function isController(cls: ClassIR): boolean {
  return CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations, n));
}

function isMappingMethod(m: FunctionIR): boolean {
  return ENDPOINT_ANNOTATIONS.some((n) => hasAnnotation(m.annotations, n));
}

function fqnOf(file: SourceFileIR, cls: ClassIR): string {
  return file.packageOrNamespace ? `${file.packageOrNamespace}.${cls.name}` : cls.name;
}

function methodIdOf(file: SourceFileIR, cls: ClassIR, m: FunctionIR): string {
  if (m.methodId) return m.methodId;
  const params = m.parameters.map((p) => simpleName(stripGenerics(p.type))).join(',');
  return `${fqnOf(file, cls)}#${m.name}(${params})`;
}

/** Map a common HTTP status enum tail (`NOT_FOUND`, `BAD_REQUEST`, ...) to its code. */
const HTTP_STATUS_BY_NAME: Record<string, number> = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  NOT_MODIFIED: 304,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  CONFLICT: 409,
  GONE: 410,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
};

/**
 * Resolve a `@ResponseStatus(...)` / `status =` argument to a numeric code.
 * Accepts `HttpStatus.NOT_FOUND`, `NOT_FOUND`, a bare `404`, or `value="404"`.
 * Returns null when it cannot be statically resolved.
 */
function resolveHttpStatus(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^["']|["']$/g, '');
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const tail = simpleName(v).toUpperCase();
  if (tail in HTTP_STATUS_BY_NAME) return HTTP_STATUS_BY_NAME[tail];
  return null;
}

function statusFromResponseStatusAnnotation(ann: AnnotationIR | undefined): number | null {
  if (!ann) return null;
  const raw =
    annotationArg(ann, 'value') ||
    annotationArg(ann, 'code') ||
    annotationArg(ann, 'reason'); // reason never numeric, but keep as fallback no-op
  return resolveHttpStatus(raw);
}

// ---------------------------------------------------------------------------
// Index: classes, advice, DTO fields, security config.
// ---------------------------------------------------------------------------

interface ClassEntry {
  cls: ClassIR;
  file: SourceFileIR;
  fqn: string;
}

interface ScanIndex {
  /** All classes by simple name (last writer wins). */
  byName: Map<string, ClassEntry>;
  /** Global `@ControllerAdvice` error responses (apply to every endpoint). */
  globalErrorResponses: ErrorResponseEntry[];
  /** FQN#method ids of the advice handlers (for provenance.advice_ids). */
  adviceIds: string[];
  /** Files contributing advice (for provenance.source_files). */
  adviceFiles: Set<string>;
  /** Parsed filter-chain rules (path-pattern -> roles / 401-403). */
  filterChainRules: FilterChainRule[];
  /** True when ANY security-config source existed but could not be parsed. */
  hasUnparseableSecurityConfig: boolean;
}

interface FilterChainRule {
  /** Ant-style pattern (`/admin/**`). */
  pattern: string;
  /** Roles (without the `ROLE_` prefix where present). Empty for permitAll/denyAll. */
  roles: string[];
  /** `permitAll` / `denyAll` / `authenticated` / `hasRole` etc. */
  access: string;
  /** Whether this rule needs auth at all (drives 401). */
  requiresAuth: boolean;
  source: string;
}

function buildScanIndex(files: SourceFileIR[]): ScanIndex {
  const byName = new Map<string, ClassEntry>();
  const globalErrorResponses: ErrorResponseEntry[] = [];
  const adviceIds: string[] = [];
  const adviceFiles = new Set<string>();
  const filterChainRules: FilterChainRule[] = [];
  let hasUnparseableSecurityConfig = false;

  for (const file of files) {
    for (const cls of file.classes) {
      byName.set(cls.name, { cls, file, fqn: fqnOf(file, cls) });
    }
  }

  // (1) Global `@ControllerAdvice` error responses.
  for (const file of files) {
    for (const cls of file.classes) {
      const isAdvice = CONTROLLER_ADVICE_ANNOTATIONS.some((n) =>
        hasAnnotation(cls.annotations, n),
      );
      if (!isAdvice) continue;
      adviceFiles.add(file.filePath);
      for (const m of cls.methods) {
        const handler = findAnnotation(m.annotations, EXCEPTION_HANDLER_ANNOTATION);
        if (!handler) continue;
        const methodId = methodIdOf(file, cls, m);
        adviceIds.push(methodId);
        const status = statusFromResponseStatusAnnotation(
          findAnnotation(m.annotations, RESPONSE_STATUS_ANNOTATION),
        );
        // Exception type(s): the @ExceptionHandler argument, falling back to the
        // first parameter's type (the caught exception).
        const handledRaw =
          annotationArg(handler, 'value') || annotationArg(handler, 'exception');
        const exceptions = handledRaw
          ? splitClassList(handledRaw)
          : exceptionParamTypes(m.parameters);
        const sourceLabel = `@ControllerAdvice ${cls.name}#${m.name}`;
        if (exceptions.length === 0) {
          globalErrorResponses.push({
            exception: '(unspecified)',
            status,
            body_shape: null,
            source: sourceLabel,
          });
        }
        for (const ex of exceptions) {
          globalErrorResponses.push({
            exception: ex,
            status,
            body_shape: null,
            source: sourceLabel,
          });
        }
      }
    }
  }

  // (2) Best-effort security-filter-chain parse (XML + Java config beans).
  for (const file of files) {
    const raw = typeof file.rawContent === 'string' ? file.rawContent : '';
    if (!raw) continue;
    const lower = file.filePath.toLowerCase();
    // (a) Spring Security `<http>` XML: `<intercept-url pattern=".." access=".."/>`.
    if (lower.endsWith('.xml') && /<\s*(security:)?http[\s>]/.test(raw)) {
      const found = parseSecurityXml(raw, file.filePath);
      filterChainRules.push(...found.rules);
      if (found.unparseable) hasUnparseableSecurityConfig = true;
    }
    // (b) Java config: `SecurityFilterChain` bean / `WebSecurityConfigurerAdapter`.
    if (
      lower.endsWith('.java') &&
      (raw.includes('SecurityFilterChain') ||
        raw.includes('WebSecurityConfigurerAdapter'))
    ) {
      const found = parseSecurityJavaConfig(raw, file.filePath);
      filterChainRules.push(...found.rules);
      if (found.unparseable) hasUnparseableSecurityConfig = true;
    }
  }

  return {
    byName,
    globalErrorResponses,
    adviceIds,
    adviceFiles,
    filterChainRules,
    hasUnparseableSecurityConfig,
  };
}

/** Split `{A.class, B.class}` / `A.class` / `A` into simple exception names. */
function splitClassList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((p) => simpleName(p.trim().replace(/\.class$/, '').replace(/^["']|["']$/g, '')))
    .filter((p) => p.length > 0);
}

/** Parameter types that look like exceptions (`*Exception` / `*Error` / `Throwable`). */
function exceptionParamTypes(params: ParameterIR[]): string[] {
  return params
    .map((p) => simpleName(stripGenerics(p.type)))
    .filter((t) => /(Exception|Error|Throwable)$/.test(t));
}

// ---------------------------------------------------------------------------
// Security-filter-chain parsing (best effort, never guesses).
// ---------------------------------------------------------------------------

/** Strip a leading `ROLE_` so `ROLE_ADMIN` and `hasRole('ADMIN')` agree. */
function normaliseRole(r: string): string {
  return r.trim().replace(/^["']|["']$/g, '').replace(/^ROLE_/, '');
}

/**
 * Parse Spring Security `<http>` XML `<intercept-url pattern access>` rules.
 * Recognises `hasRole(...)` / `hasAnyRole(...)` / `ROLE_X` / `permitAll` /
 * `denyAll` / `isAuthenticated()`. Anything else (a SpEL bean reference, a
 * custom voter, an `el` access string we cannot parse) flips `unparseable`.
 */
function parseSecurityXml(
  raw: string,
  filePath: string,
): { rules: FilterChainRule[]; unparseable: boolean } {
  const rules: FilterChainRule[] = [];
  let unparseable = false;
  const re = /<\s*(?:security:)?intercept-url\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const attrs = m[1];
    const pattern = attrAfter(attrs, 'pattern');
    const access = attrAfter(attrs, 'access');
    if (!pattern) continue;
    const parsed = interpretAccessExpression(access ?? '');
    if (parsed === null) {
      unparseable = true;
      continue;
    }
    rules.push({
      pattern: normalisePattern(pattern),
      roles: parsed.roles,
      access: parsed.access,
      requiresAuth: parsed.requiresAuth,
      source: `<http> XML ${filePath}`,
    });
  }
  return { rules, unparseable };
}

/**
 * Parse a Java `SecurityFilterChain` / `WebSecurityConfigurerAdapter` bean for
 * `requestMatchers("/x/**").hasRole("ADMIN")` / `.permitAll()` /
 * `.authenticated()` style rules (also the legacy `antMatchers(...)`). Best
 * effort: a chain whose authorize clause we cannot pair to a pattern flips
 * `unparseable` so the caller emits a Finding instead of guessing.
 */
function parseSecurityJavaConfig(
  raw: string,
  filePath: string,
): { rules: FilterChainRule[]; unparseable: boolean } {
  const rules: FilterChainRule[] = [];
  let unparseable = false;
  // `requestMatchers("/admin/**").hasRole("ADMIN")` and aliases.
  const re =
    /(?:antMatchers|requestMatchers|mvcMatchers)\s*\(\s*([^)]*?)\)\s*\.\s*(hasRole|hasAnyRole|hasAuthority|hasAnyAuthority|permitAll|denyAll|authenticated)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let matchedAny = false;
  while ((m = re.exec(raw)) !== null) {
    matchedAny = true;
    const patternsRaw = m[1];
    const verb = m[2];
    const argsRaw = m[3];
    const patterns = patternsRaw
      .split(',')
      .map((p) => p.trim().replace(/^["']|["']$/g, ''))
      .filter((p) => p.length > 0 && p.startsWith('/'));
    if (patterns.length === 0) {
      // First arg may be an HttpMethod (`HttpMethod.POST, "/x"`); take string args.
      continue;
    }
    let roles: string[] = [];
    let access = verb;
    let requiresAuth = true;
    if (verb === 'permitAll') {
      requiresAuth = false;
      access = 'permitAll';
    } else if (verb === 'denyAll') {
      access = 'denyAll';
    } else if (verb === 'authenticated') {
      access = 'authenticated';
    } else {
      roles = argsRaw
        .split(',')
        .map((a) => normaliseRole(a))
        .filter((a) => a.length > 0);
    }
    for (const pattern of patterns) {
      rules.push({
        pattern: normalisePattern(pattern),
        roles,
        access,
        requiresAuth,
        source: `SecurityFilterChain bean ${filePath}`,
      });
    }
  }
  // The bean clearly configures authorization (it references the chain types)
  // but we matched ZERO pattern->rule pairs: a dynamic matcher / custom
  // expression the static parser cannot follow. Flag it (never guess).
  if (!matchedAny) unparseable = true;
  return { rules, unparseable };
}

function attrAfter(attrs: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(attrs);
  return m ? m[1] : null;
}

function normalisePattern(p: string): string {
  let v = p.trim();
  if (!v.startsWith('/')) v = '/' + v;
  return v;
}

/**
 * Interpret a Spring Security access expression into roles + auth requirement.
 * Returns null when the expression cannot be statically resolved (a bean
 * reference, an unknown SpEL function, a custom voter) so the caller emits a
 * Finding rather than guessing a role.
 */
function interpretAccessExpression(
  expr: string,
): { roles: string[]; access: string; requiresAuth: boolean } | null {
  const e = expr.trim();
  if (e.length === 0) return null;
  if (/^permitAll(\(\))?$/i.test(e)) return { roles: [], access: 'permitAll', requiresAuth: false };
  if (/^denyAll(\(\))?$/i.test(e)) return { roles: [], access: 'denyAll', requiresAuth: true };
  if (/^isAuthenticated\(\)$/i.test(e) || /^authenticated$/i.test(e)) {
    return { roles: [], access: 'authenticated', requiresAuth: true };
  }
  // `hasRole('ADMIN')` / `hasAnyRole('A','B')` / `hasAuthority('X')`.
  const fn = /^has(Any)?(Role|Authority)\s*\(([^)]*)\)$/i.exec(e);
  if (fn) {
    const roles = fn[3].split(',').map((r) => normaliseRole(r)).filter((r) => r.length > 0);
    if (roles.length === 0) return null;
    return { roles, access: 'hasRole', requiresAuth: true };
  }
  // Comma-separated `ROLE_X, ROLE_Y` legacy access list.
  if (/^(ROLE_[A-Z0-9_]+\s*,?\s*)+$/i.test(e)) {
    const roles = e.split(',').map((r) => normaliseRole(r)).filter((r) => r.length > 0);
    return { roles, access: 'hasRole', requiresAuth: true };
  }
  // Anything else -- a bean ref (`@authChecker.check(...)`), a complex SpEL
  // expression, a custom matcher -- is NOT statically resolvable.
  return null;
}

/** Ant-style pattern match (`/**` and `*` wildcards) against a concrete path. */
function antMatch(pattern: string, path: string): boolean {
  // Convert Ant glob to a regexp. `/**` matches any depth (incl. zero); `*`
  // matches a single path segment; `{x}` path-vars match a single segment.
  let re = '^';
  const tokens = pattern.replace(/\{[^}]+\}/g, '*');
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === '*' && tokens[i + 1] === '*') {
      re += '.*';
      i += 1;
      // swallow a trailing slash after `**` so `/admin/**` matches `/admin`.
      if (tokens[i + 1] === '/') i += 1;
    } else if (tokens[i] === '*') {
      re += '[^/]*';
    } else {
      re += tokens[i].replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  re += '$';
  try {
    return new RegExp(re).test(path);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-endpoint detection.
// ---------------------------------------------------------------------------

/** Method-level (or class-inherited) authz annotation -> roles + source. */
function readMethodSecurity(
  cls: ClassIR,
  m: FunctionIR,
): {
  roles: string[];
  source: string;
  resolvable: boolean;
  detail?: string;
} | null {
  for (const name of ENDPOINT_SECURITY_ANNOTATIONS) {
    const onMethod = findAnnotation(m.annotations, name);
    const onClass = findAnnotation(cls.annotations, name);
    const ann = onMethod ?? onClass;
    if (!ann) continue;
    const inherited = !onMethod;
    const sourceLabel = `@${name}${inherited ? ' (class-level, inherited)' : ''}`;
    if (name === 'Secured' || name === 'RolesAllowed') {
      // `@Secured("ROLE_ADMIN")` / `@RolesAllowed({"ADMIN","USER"})` -- direct roles.
      const raw =
        annotationArg(ann, 'value') || annotationArg(ann, 'rolesAllowed') || '';
      const roles = splitRoleList(raw);
      if (roles.length === 0) {
        return { roles: [], source: sourceLabel, resolvable: false, detail: `${sourceLabel} had no statically-readable role list.` };
      }
      return { roles, source: sourceLabel, resolvable: true };
    }
    // `@PreAuthorize("hasRole('ADMIN')")` / `@PostAuthorize` / filters: a SpEL
    // expression. We resolve ONLY the simple `hasRole`/`hasAnyRole`/`hasAuthority`
    // forms; anything richer is unresolved (never guessed).
    const expr = annotationArg(ann, 'value') || annotationArg(ann, 'expression') || '';
    const parsed = interpretAccessExpression(stripQuotes(expr));
    if (parsed === null || parsed.roles.length === 0) {
      return {
        roles: [],
        source: sourceLabel,
        resolvable: false,
        detail: `${sourceLabel} carries a SpEL expression ('${stripQuotes(expr)}') beyond a simple role check; not statically resolvable.`,
      };
    }
    return { roles: parsed.roles, source: sourceLabel, resolvable: true };
  }
  return null;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '');
}

function splitRoleList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((r) => normaliseRole(r))
    .filter((r) => r.length > 0);
}

/**
 * Read per-endpoint validation entries from `@Valid` / `@Validated` request-body
 * parameters: resolve the bean type in the scan and emit one `validation[]`
 * entry per JSR-380 constraint on its fields. Also reads parameter-level
 * constraints directly on the mapping method's parameters.
 */
function readValidation(
  cls: ClassIR,
  m: FunctionIR,
  index: ScanIndex,
): ValidationEntry[] {
  const out: ValidationEntry[] = [];
  for (const p of m.parameters) {
    // Direct parameter-level constraints (`@RequestParam @Min(1) int page`).
    for (const a of p.annotations) {
      if (VALIDATION_CONSTRAINT_ANNOTATIONS.has(a.name)) {
        out.push(constraintEntry(p.name, a));
      }
    }
    // `@Valid SomeRequest body` -> walk the bean's fields.
    const isValidated =
      hasAnnotation(p.annotations, VALID_ANNOTATION) ||
      hasAnnotation(p.annotations, VALIDATED_ANNOTATION);
    if (!isValidated) continue;
    const beanType = stripGenerics(simpleName(p.type));
    const entry = index.byName.get(beanType);
    if (!entry) continue;
    for (const f of entry.cls.fields) {
      for (const a of f.annotations) {
        if (VALIDATION_CONSTRAINT_ANNOTATIONS.has(a.name)) {
          out.push(constraintEntry(f.name, a));
        }
      }
    }
  }
  return out;
}

function constraintEntry(field: string, a: AnnotationIR): ValidationEntry {
  const argEntries = Object.entries(a.args).filter(([k]) => k !== 'message');
  const argStr = argEntries.length
    ? `(${argEntries.map(([k, v]) => `${k}=${v}`).join(', ')})`
    : '';
  const message = a.args.message ? stripQuotes(a.args.message) : null;
  return {
    field,
    constraint: `@${a.name}${argStr}`,
    failure_status: 400,
    message,
  };
}

/**
 * Read serialization shape from the response-body DTO's Jackson annotations.
 * `@JsonInclude` -> null_handling; `@JsonFormat(pattern=)` -> date_format;
 * `@JsonProperty("snake")` overrides -> field_naming hint.
 */
function readSerialization(responseDto: ClassEntry | null): SerializationContract {
  const contract: SerializationContract = {
    null_handling: null,
    date_format: null,
    field_naming: null,
    headers: [],
    envelope: null,
  };
  if (!responseDto) return contract;
  const cls = responseDto.cls;

  // Class-level @JsonInclude.
  const classInclude = findAnnotation(cls.annotations, JSON_INCLUDE_ANNOTATION);
  if (classInclude) {
    const v = annotationArg(classInclude, 'value') || annotationArg(classInclude, 'include');
    contract.null_handling = describeJsonInclude(v);
  }

  let sawFieldInclude = false;
  let sawPropertyOverride = false;
  for (const f of cls.fields) {
    const fmt = findAnnotation(f.annotations, JSON_FORMAT_ANNOTATION);
    if (fmt) {
      const pattern = annotationArg(fmt, 'pattern') || annotationArg(fmt, 'shape');
      if (pattern) contract.date_format = stripQuotes(pattern);
    }
    const inc = findAnnotation(f.annotations, JSON_INCLUDE_ANNOTATION);
    if (inc && contract.null_handling === null) {
      const v = annotationArg(inc, 'value') || annotationArg(inc, 'include');
      contract.null_handling = describeJsonInclude(v);
      sawFieldInclude = true;
    }
    const prop = findAnnotation(f.annotations, JSON_PROPERTY_ANNOTATION);
    if (prop) {
      const renamed = annotationArg(prop, 'value');
      if (renamed) sawPropertyOverride = true;
    }
  }
  void sawFieldInclude;
  if (sawPropertyOverride) {
    contract.field_naming = 'per-field overrides (@JsonProperty)';
  }
  return contract;
}

function describeJsonInclude(v: string | undefined): string {
  const tail = v ? simpleName(stripQuotes(v)).toUpperCase() : '';
  switch (tail) {
    case 'NON_NULL':
      return 'NON_NULL omits null fields';
    case 'NON_EMPTY':
      return 'NON_EMPTY omits null/empty fields';
    case 'NON_ABSENT':
      return 'NON_ABSENT omits absent fields';
    case 'NON_DEFAULT':
      return 'NON_DEFAULT omits default-valued fields';
    case 'ALWAYS':
    case '':
      return 'includes null fields';
    default:
      return v ? `@JsonInclude(${stripQuotes(v)})` : 'includes null fields';
  }
}

/**
 * Read `status_codes` from `@ResponseStatus` on the method, the
 * `ResponseEntity` status calls in the body, and `Location` header usage.
 */
function readStatusCodes(
  m: FunctionIR,
  methodBody: string,
): StatusCodesContract {
  let success: number | null = null;
  // (1) `@ResponseStatus(HttpStatus.CREATED)` on the handler.
  const rs = findAnnotation(m.annotations, RESPONSE_STATUS_ANNOTATION);
  if (rs) success = statusFromResponseStatusAnnotation(rs);

  // (2) `ResponseEntity` status in the body: `.status(HttpStatus.CREATED)`,
  // `ResponseEntity.created(...)`, `.ok(...)`, `new ResponseEntity<>(..., CREATED)`.
  if (success === null && methodBody) {
    if (/ResponseEntity\s*\.\s*created\s*\(/.test(methodBody)) success = 201;
    else if (/ResponseEntity\s*\.\s*noContent\s*\(/.test(methodBody)) success = 204;
    else if (/ResponseEntity\s*\.\s*accepted\s*\(/.test(methodBody)) success = 202;
    else if (/ResponseEntity\s*\.\s*ok\s*\(/.test(methodBody)) success = 200;
    else {
      const statusCall = /(?:ResponseEntity\s*\.\s*status|HttpStatus)\s*[(.]\s*([A-Z_]+|\d{3})/.exec(
        methodBody,
      );
      if (statusCall) success = resolveHttpStatus(statusCall[1]);
    }
  }

  // (3) Location header: `.created(URI)`, `.location(...)`, or a `Location` header set.
  const locationHeader =
    /ResponseEntity\s*\.\s*created\s*\(/.test(methodBody) ||
    /\.\s*location\s*\(/.test(methodBody) ||
    /HttpHeaders\.LOCATION/.test(methodBody) ||
    /"Location"/.test(methodBody);

  return { success, location_header: locationHeader };
}

/** Slice a method body from raw source by balancing braces (best effort). */
function sliceBody(raw: string, startLine: number): string {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  if (startLine < 0 || startLine >= lines.length) return '';
  let openIdx = -1;
  for (let i = startLine; i < lines.length && i < startLine + 50; i += 1) {
    if (lines[i].includes('{')) {
      openIdx = i;
      break;
    }
    if (/;\s*$/.test(lines[i])) return lines.slice(startLine, i + 1).join('\n');
  }
  if (openIdx < 0) return lines.slice(startLine, Math.min(lines.length, startLine + 5)).join('\n');
  let depth = 0;
  for (let i = openIdx; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return lines.slice(startLine, i + 1).join('\n');
      }
    }
  }
  return lines.slice(startLine, Math.min(lines.length, startLine + 200)).join('\n');
}

/** Resolve the response DTO class for a mapping method (unwrap ResponseEntity / generics). */
function resolveResponseDto(m: FunctionIR, index: ScanIndex): ClassEntry | null {
  let t = stripGenerics(simpleName(m.returnType));
  if (t === 'ResponseEntity' || t === 'HttpEntity' || t === 'Optional' || t === 'Callable') {
    // Unwrap the first generic arg.
    const gen = /<\s*([^,<>]+)/.exec(m.returnType);
    if (gen) t = stripGenerics(simpleName(gen[1].trim()));
  }
  if (!t || t === 'void' || t === 'String') return null;
  return index.byName.get(t) ?? null;
}

/** Read config-conditional annotations on the method or its controller class. */
function readConditionalVariants(
  cls: ClassIR,
  m: FunctionIR,
): ConditionalVariant[] {
  const out: ConditionalVariant[] = [];
  const sources: AnnotationIR[] = [...m.annotations, ...cls.annotations];
  for (const a of sources) {
    if (!CONDITIONAL_ANNOTATIONS.includes(a.name)) continue;
    const args = Object.entries(a.args)
      .map(([k, v]) => (k === 'value' ? stripQuotes(v) : `${k}=${stripQuotes(v)}`))
      .join(', ');
    out.push({
      condition: `@${a.name}${args ? `(${args})` : ''}`,
      response_summary: null, // LLM enrichment fills how the response differs.
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth resolution combining method annotations + filter-chain rules.
// ---------------------------------------------------------------------------

function resolveAuth(
  cls: ClassIR,
  m: FunctionIR,
  endpointPath: string,
  index: ScanIndex,
): {
  auth: AuthContract;
  unresolvedDetail: string | null;
} {
  // (1) Method-level / class-inherited authz annotation wins (most specific).
  const methodSec = readMethodSecurity(cls, m);
  if (methodSec) {
    if (methodSec.resolvable) {
      return {
        auth: {
          required_roles: methodSec.roles,
          expected_unauthenticated_status: 401,
          expected_forbidden_status: 403,
          source: methodSec.source,
        },
        unresolvedDetail: null,
      };
    }
    // The annotation exists but is not statically resolvable -> unresolved,
    // never guess a role.
    return {
      auth: {
        required_roles: [],
        expected_unauthenticated_status: 401,
        expected_forbidden_status: null,
        source: 'unresolved',
      },
      unresolvedDetail: methodSec.detail ?? `${methodSec.source} could not be statically resolved.`,
    };
  }

  // (2) Filter-chain rules matched against the endpoint path.
  const matched = index.filterChainRules.filter((r) => antMatch(r.pattern, endpointPath));
  if (matched.length > 0) {
    // Most-specific (longest literal prefix) wins.
    matched.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
    const rule = matched[0];
    if (rule.access === 'permitAll') {
      return {
        auth: {
          required_roles: [],
          expected_unauthenticated_status: null,
          expected_forbidden_status: null,
          source: rule.source,
        },
        unresolvedDetail: null,
      };
    }
    return {
      auth: {
        required_roles: rule.roles,
        expected_unauthenticated_status: 401,
        expected_forbidden_status: rule.roles.length > 0 ? 403 : null,
        source: rule.source,
      },
      unresolvedDetail: null,
    };
  }

  // (3) No method annotation, no matching filter rule, but a security config
  // existed that we could not parse -> unresolved (Finding), never guessed.
  if (index.hasUnparseableSecurityConfig) {
    return {
      auth: {
        required_roles: [],
        expected_unauthenticated_status: null,
        expected_forbidden_status: null,
        source: 'unresolved',
      },
      unresolvedDetail:
        'A security filter chain exists but could not be statically resolved to a URL->role rule for this endpoint path.',
    };
  }

  // (4) No security signal at all -> empty auth (no roles, no 401/403).
  return {
    auth: {
      required_roles: [],
      expected_unauthenticated_status: null,
      expected_forbidden_status: null,
      source: 'none',
    },
    unresolvedDetail: null,
  };
}

function specificity(pattern: string): number {
  // Literal (non-wildcard) char count -- a crude "more specific" measure.
  return pattern.replace(/[*]/g, '').length;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Scan the whole IR set and produce ONE `response_contract` per inbound HTTP
 * controller mapping method, keyed by its endpoint name. Pure: reads the
 * supplied IR only. Returns the contracts plus unresolved-auth /
 * config-dependent notes so the caller can emit Findings.
 */
export function scanResponseContracts(
  files: SourceFileIR[],
): ResponseContractScanOutput {
  const index = buildScanIndex(files);
  const contractsByEndpointName = new Map<string, ResponseContract>();
  const unresolvedAuth: UnresolvedAuthNote[] = [];
  const configDependent: ConfigDependentNote[] = [];

  for (const file of files) {
    // Cheap early skip: a file with no controller class contributes no endpoints.
    if (!file.classes.some((c) => isController(c))) continue;
    const raw = typeof file.rawContent === 'string' ? file.rawContent : '';
    for (const cls of file.classes) {
      if (!isController(cls)) continue;
      for (const m of cls.methods) {
        if (!isMappingMethod(m)) continue;
        const endpointName = endpointNameFor(cls, m);
        const endpointPath = composeFullPath(extractBasePath(cls), extractMethodPath(m));
        const methodBody = sliceBody(raw, m.line);

        // Group A: errors (global advice + method-level @ResponseStatus).
        const errorResponses: ErrorResponseEntry[] = [...index.globalErrorResponses];
        const methodResponseStatus = findAnnotation(m.annotations, RESPONSE_STATUS_ANNOTATION);
        // (Method @ResponseStatus that is a 4xx/5xx is an error mapping; a 2xx
        // is the success status and is read by readStatusCodes instead.)
        const mrsStatus = statusFromResponseStatusAnnotation(methodResponseStatus);
        if (mrsStatus !== null && mrsStatus >= 400) {
          errorResponses.push({
            exception: '(handler @ResponseStatus)',
            status: mrsStatus,
            body_shape: null,
            source: `@ResponseStatus on ${cls.name}#${m.name}`,
          });
        }

        // Group A: validation.
        const validation = readValidation(cls, m, index);

        // Group A: auth.
        const { auth, unresolvedDetail } = resolveAuth(cls, m, endpointPath, index);
        if (unresolvedDetail) {
          unresolvedAuth.push({
            endpointName,
            controllerClassName: cls.name,
            endpointMethodName: m.name,
            detail: unresolvedDetail,
            sourceFilePath: file.filePath,
          });
        }

        // Group B: serialization + status codes.
        const responseDto = resolveResponseDto(m, index);
        const serialization = readSerialization(responseDto);
        const statusCodes = readStatusCodes(m, methodBody);

        // Config-conditional variants.
        const conditionalVariants = readConditionalVariants(cls, m);
        if (conditionalVariants.length > 0) {
          configDependent.push({
            endpointName,
            controllerClassName: cls.name,
            endpointMethodName: m.name,
            conditions: conditionalVariants.map((v) => v.condition),
            sourceFilePath: file.filePath,
          });
        }

        // Provenance.
        const sourceFiles = new Set<string>([file.filePath]);
        for (const f of index.adviceFiles) sourceFiles.add(f);
        if (responseDto) sourceFiles.add(responseDto.file.filePath);

        const contract: ResponseContract = {
          schema_version: RESPONSE_CONTRACT_SCHEMA_VERSION,
          error_responses: errorResponses,
          auth,
          validation,
          serialization,
          status_codes: statusCodes,
          conditional_variants: conditionalVariants,
          provenance: {
            source_files: Array.from(sourceFiles),
            method_id: methodIdOf(file, cls, m),
            advice_ids: index.adviceIds.slice(),
          },
          confidence: DETERMINISTIC_CONFIDENCE,
        };
        contractsByEndpointName.set(endpointName, contract);
      }
    }
  }

  return { contractsByEndpointName, unresolvedAuth, configDependent };
}

/**
 * Attach each scanned `response_contract` to the matching `endpoints` candidate
 * by endpoint name (`${httpMethod} ${fullPath}` == the candidate `name`). The
 * contract rides on `candidate.data.response_contract` so it auto-persists into
 * `discovery_candidates.data` and maps to AMS `endpoints.response_contract` at
 * save-back (mirrors how Spec 2's `behavior` rides on `data`). Mutates the
 * candidates in place; returns the number attached.
 */
export function attachResponseContractsToCandidates(
  candidates: DiscoveryCandidate[],
  output: ResponseContractScanOutput,
): number {
  let attached = 0;
  for (const c of candidates) {
    if (c.candidateType !== 'endpoints') continue;
    const contract = output.contractsByEndpointName.get(c.name);
    if (!contract) continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    data.response_contract = contract;
    c.data = data;
    attached += 1;
  }
  return attached;
}

/**
 * Turn the scanner's unresolved-auth + config-dependent notes into
 * `FindingEmitInput[]` via the registered emission sources. Pure: the caller
 * passes the result to `findingEmitter.emitFindings`. Mirrors the
 * `buildEndpointDataEffectUnresolvedFinding` pattern in the spring-classic
 * finding scanner.
 */
export function buildResponseContractFindings(
  output: ResponseContractScanOutput,
): FindingEmitInput[] {
  const findings: FindingEmitInput[] = [];
  for (const u of output.unresolvedAuth) {
    findings.push(
      buildUnresolvedAuthFinding({
        endpointName: u.endpointName,
        controllerClass: u.controllerClassName,
        methodName: u.endpointMethodName,
        detail: u.detail,
        sourceFilePath: u.sourceFilePath,
      }),
    );
  }
  for (const c of output.configDependent) {
    findings.push(
      buildConfigDependentEndpointFinding({
        endpointName: c.endpointName,
        controllerClass: c.controllerClassName,
        methodName: c.endpointMethodName,
        conditions: c.conditions,
        sourceFilePath: c.sourceFilePath,
      }),
    );
  }
  return findings;
}
