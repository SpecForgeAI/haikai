/**
 * Deterministic per-endpoint REQUEST-CONTRACT scanner (Spring Classic).
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 5
 * (Phase 2: request date-FORMATS + request VALIDATION; with the Phase-1
 * content-type + required-headers facts folded into the SAME blob so the
 * save-back passthrough carries a COMPLETE `request_contract`).
 *
 * This is the request-side sibling of `responseContractScanner.ts`. Where the
 * response scanner reads the layers that DETERMINE an endpoint's RESPONSE, this
 * scanner reads the layers that DETERMINE how a correct REQUEST must be built --
 * the very facts the API-behaviour capture LLM otherwise reverse-engineers at
 * runtime (date format, content-type, required headers, request validation):
 *
 *   - request media type: `consumes` mapping discriminator(s)
 *     -> `content_type` / `consumes[]`
 *   - required request headers: `headers` mapping discriminators + required
 *     `@RequestHeader` params
 *     -> `required_headers[]`  ({ name, source })
 *   - request inputs: `@RequestParam` params
 *     -> `params[]`
 *   - request date FORMAT (the genuinely-new reader; #1 fix): `@JsonFormat
 *     (pattern=)` / `@DateTimeFormat(pattern= | iso=)` on request-body DTO
 *     fields AND on `@RequestParam`/`@PathVariable` params
 *     -> `param_formats[]`     ({ name, location, format, pattern, source })
 *   - request VALIDATION: `@Valid` request beans + JSR-380 parameter constraints
 *     (the SAME shape `responseContractScanner.readValidation` already reads,
 *     reused here verbatim)
 *     -> `request_validation[]` ({ field, constraint, failure_status, message })
 *
 * The reader for request date-formats is NEW: `responseContractScanner`'s
 * `readSerialization` reads `@JsonFormat(pattern=)` only off the RESPONSE DTO,
 * never the request side, and `@DateTimeFormat` is recognised NOWHERE today.
 *
 * The scanner is PURE (no I/O): it reads the supplied `SourceFileIR[]` only and
 * reuses the EXACT controller->method path composition the response scanner /
 * adapter use, so each blob attaches to the correct endpoint candidate by name
 * (`${httpMethod} ${fullPath}` == the candidate `name`).
 *
 * Output shape mirrors AMS Task-Group-1's `request_contract` JSONB exactly
 * (snake_case keys, internal `schema_version`, boxed `confidence`) -- the shape
 * the mcp-server save-back passthrough (TG2) carries verbatim and the amvs
 * capture-time enrichment (TG3/TG6) consumes.
 *
 * Interpretation note (per the discovery / implement-verify conventions): the
 * AST EXTRACTORS never learn framework-specific patterns; this scanner reads the
 * already-extracted IR annotations (`AnnotationIR.args`, `ParameterIR.annotations`,
 * `FieldIR.annotations`), exactly as the response scanner does -- interpretation
 * lives in the scanner layer, above the AST.
 */

import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  ParameterIR,
  FieldIR,
  AnnotationIR,
} from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';

// ---------------------------------------------------------------------------
// Schema version + confidence
// ---------------------------------------------------------------------------

/**
 * Internal schema version embedded INSIDE the `request_contract` JSONB blob
 * (loose JSONB -- no DB migration as the shape evolves; mirrors the
 * `response_contract.v1` precedent). Bump when a consumer must branch on a
 * shape change.
 */
export const REQUEST_CONTRACT_SCHEMA_VERSION = 'request_contract.v1';

/**
 * Deterministic confidence for a statically-derived contract. The static pass
 * reads annotations/config directly -- high-trust (adapter tier). Boxed so a
 * PATCH with no value preserves the column (never 0.0). Matches the response
 * scanner's `DETERMINISTIC_CONFIDENCE`.
 */
const DETERMINISTIC_CONFIDENCE = 0.9;

// ---------------------------------------------------------------------------
// Annotation constants (shared shape with the adapter / response scanner; kept
// local so the scanner is self-contained).
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

const VALID_ANNOTATION = 'Valid';
const VALIDATED_ANNOTATION = 'Validated';
const REQUEST_BODY_ANNOTATION = 'RequestBody';
const REQUEST_PARAM_ANNOTATION = 'RequestParam';
const PATH_VARIABLE_ANNOTATION = 'PathVariable';
const REQUEST_HEADER_ANNOTATION = 'RequestHeader';

// Request date-format annotations. `@JsonFormat(pattern=)` is the Jackson
// (de)serialisation format; `@DateTimeFormat(pattern= | iso=)` is the Spring
// MVC binding format applied to `@RequestParam`/`@PathVariable` / request-body
// fields. `@DateTimeFormat` is recognised NOWHERE today -- added here.
const JSON_FORMAT_ANNOTATION = 'JsonFormat';
const DATE_TIME_FORMAT_ANNOTATION = 'DateTimeFormat';

// Custom Jackson (de)serializer annotations (Signal #1 detect-or-flag). A
// `using=SomeSerializer.class` hides the wire format inside a separate class
// the deterministic scanner does NOT crack open -> it FLAGS the field.
const JSON_SERIALIZE_ANNOTATION = 'JsonSerialize';
const JSON_DESERIALIZE_ANNOTATION = 'JsonDeserialize';

// JSR-380 / Jakarta-validation constraint annotations we recognise on bean
// fields and on parameters (the common core; an unknown `*` constraint still
// surfaces its annotation name verbatim). Mirrors the response scanner's set.
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

// ---------------------------------------------------------------------------
// Public contract shape (mirrors AMS Task-Group-1 `request_contract`, snake_case).
// ---------------------------------------------------------------------------

/** One required request header ({ name, source }). */
export interface RequiredHeaderEntry {
  name: string;
  source: string;
}

/** One request input captured from `@RequestParam` (name/type/required/default). */
export interface RequestParamEntry {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

/**
 * One request date/number FORMAT off a request-body DTO field or a
 * path/query parameter binding annotation. `format` carries the human label
 * (the raw annotation arg, e.g. `dd-MMM-yyyy` or `DateTimeFormat.ISO.DATE`);
 * `pattern` carries the concrete `pattern=` value when present (else null).
 */
export interface ParamFormatEntry {
  name: string;
  /** 'body' | 'query' | 'path' | 'header'. */
  location: string;
  /** Concrete format label from an annotation; null on a type-only entry. */
  format: string | null;
  pattern: string | null;
  source: string;
  /**
   * The resolved Java field/param TYPE (Signal #1), e.g. `LocalDate`,
   * `BigDecimal`, `List<LocalDate>`. Carried on EVERY entry so the shape is
   * uniform; on a type-only entry it is the ONLY format signal (format/pattern
   * stay null). NEVER stuffed into format/pattern -- the consumer maps it to a
   * category. Wire key on the emitted blob is the snake-case `java_type`.
   */
  javaType: string | null;
}

/** One request-validation constraint ({ field, constraint, failure_status, message }). */
export interface RequestValidationEntry {
  field: string;
  constraint: string;
  failure_status: number;
  message: string | null;
}

export interface RequestContractProvenance {
  source_files: string[];
  method_id: string | null;
}

/**
 * The ONE project-wide date format resolved by the Signal-#2 global pass
 * (`globalDateFormatScanner.resolveGlobalDateFormat`). Attached ONCE at the
 * TOP LEVEL of each endpoint contract (never stamped onto per-field
 * `param_formats`). Snake-case wire key: `inferred_date_format`.
 */
export interface InferredDateFormat {
  format: string;
  source: string;
  confidence: number;
}

/** The full per-endpoint request contract -- the `request_contract` JSONB blob. */
export interface RequestContract {
  schema_version: string;
  /** Preferred single request media type (first of `consumes`). */
  content_type: string | null;
  /** All request media types (the `consumes` mapping discriminators). */
  consumes: string[];
  required_headers: RequiredHeaderEntry[];
  params: RequestParamEntry[];
  param_formats: ParamFormatEntry[];
  request_validation: RequestValidationEntry[];
  /** Top-level code-scan provenance semantics. */
  provenance: 'code-scan';
  provenance_detail: RequestContractProvenance;
  /** Boxed Double inside the blob (null preserves through PATCH; never 0.0). */
  confidence: number | null;
  /**
   * The single project-wide date format (Signal #2), attached at the top
   * level by the springClassic adapter when the global pass resolves one.
   * Absent (never an empty object) when nothing resolves.
   */
  inferred_date_format?: InferredDateFormat;
}

/** Full deterministic scan output: contracts keyed by endpoint name. */
export interface RequestContractScanOutput {
  /** Endpoint name (`${httpMethod} ${fullPath}`) -> contract. */
  contractsByEndpointName: Map<string, RequestContract>;
}

// ---------------------------------------------------------------------------
// Small helpers (path composition mirrors the resolver / adapter / response
// scanner EXACTLY so endpoint names line up).
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

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, '');
}

// ---------------------------------------------------------------------------
// Class index (simple-name -> { cls, file }) so `@Valid` bean types and
// request-body DTO types can be resolved across files.
// ---------------------------------------------------------------------------

interface ClassEntry {
  cls: ClassIR;
  file: SourceFileIR;
}

function buildClassIndex(files: SourceFileIR[]): Map<string, ClassEntry> {
  const byName = new Map<string, ClassEntry>();
  for (const file of files) {
    for (const cls of file.classes) {
      byName.set(cls.name, { cls, file });
    }
  }
  return byName;
}

// ---------------------------------------------------------------------------
// Signal #1: Java field/param TYPE -> data-type category (deterministic, pure).
//
// The category is used ONLY to decide WHETHER a type-only `param_formats`
// entry is worth emitting (anything that maps to a non-skip category). The
// emitted entry carries the RAW Java type string; the amvs classifier maps the
// type to its own vocabulary. `String`/`Object`/unknowns map to null (SKIP).
// ---------------------------------------------------------------------------

/** A type-only category, or null when the type must NOT emit an entry. */
export type JavaTypeCategory =
  | 'date'
  | 'datetime'
  | 'time'
  | 'decimal'
  | 'numeric_id'
  | 'boolean'
  | 'uuid'
  | 'enum';

// Simple-name -> category for the non-enum buckets (per the spec table).
const JAVA_TYPE_CATEGORY: Record<string, JavaTypeCategory> = {
  LocalDate: 'date',
  LocalDateTime: 'datetime',
  Instant: 'datetime',
  OffsetDateTime: 'datetime',
  ZonedDateTime: 'datetime',
  Date: 'datetime',
  Timestamp: 'datetime',
  Calendar: 'datetime',
  LocalTime: 'time',
  BigDecimal: 'decimal',
  double: 'decimal',
  Double: 'decimal',
  float: 'decimal',
  Float: 'decimal',
  long: 'numeric_id',
  Long: 'numeric_id',
  int: 'numeric_id',
  Integer: 'numeric_id',
  short: 'numeric_id',
  Short: 'numeric_id',
  BigInteger: 'numeric_id',
  boolean: 'boolean',
  Boolean: 'boolean',
  UUID: 'uuid',
};

/**
 * Unwrap ONE level of `List<X>` / `Collection<X>` / `Set<X>` / `X[]` and
 * reduce to the inner element type. Returns the original (sans package +
 * generics) when it is not a single-level container.
 */
function unwrapContainerType(rawType: string): string {
  const t = rawType.trim();
  // Array form `X[]` -> X.
  if (t.endsWith('[]')) return simpleName(t.slice(0, -2).trim());
  // Generic container `List<X>` / `java.util.List<X>` -> X (ONE level).
  const lt = t.indexOf('<');
  if (lt > 0 && t.endsWith('>')) {
    const outer = simpleName(t.slice(0, lt).trim());
    if (outer === 'List' || outer === 'Collection' || outer === 'Set' || outer === 'Iterable') {
      const inner = t.slice(lt + 1, -1).trim();
      // The inner type may itself be packaged/generic; take its simple name
      // (we only unwrap ONE level, so a nested generic collapses to its head).
      return simpleName(stripGenerics(inner));
    }
  }
  return simpleName(stripGenerics(t));
}

/**
 * Map a Java field/param type string to a data-type category, or null to
 * SKIP (emit nothing). `List<X>`/`X[]` unwrap ONE level. Matching is by simple
 * name after stripping generics + package, so a fully-qualified `java.time.*`
 * is tolerated. `enums` is the set of simple names whose declaration is a Java
 * `enum` (a non-enum unknown stays a SKIP). Exported for focused testing.
 */
export function javaTypeCategory(
  rawType: string | undefined | null,
  enums: Set<string>,
): JavaTypeCategory | null {
  if (!rawType) return null;
  const name = unwrapContainerType(rawType);
  if (!name) return null;
  const mapped = JAVA_TYPE_CATEGORY[name];
  if (mapped) return mapped;
  if (enums.has(name)) return 'enum';
  return null;
}

/**
 * The wire `javaType` for a type-only entry: the unwrapped simple name, with an
 * `<enum>` marker appended for a Java enum so the amvs classifier (which has no
 * class index of its own) can route it via the enum signal. `unwrapContainerType`
 * strips the `<enum>` back off, so `javaTypeCategory(wireJavaType(t, enums), enums)`
 * still round-trips to 'enum'. Pure.
 */
function wireJavaType(rawType: string, enums: Set<string>): string {
  const name = unwrapContainerType(rawType);
  return enums.has(name) ? `${name}<enum>` : name;
}

/**
 * Build the set of simple names that are declared as Java `enum`s anywhere in
 * the scanned IR. The Java extractor does NOT surface enum declarations in
 * `file.classes` (only class/interface/record), so resolve them from the
 * verbatim `rawContent` already attached to every Java `SourceFileIR`. Pure;
 * matches `enum <Name>` (optionally preceded by modifiers).
 */
function buildEnumIndex(files: SourceFileIR[]): Set<string> {
  const enums = new Set<string>();
  const re = /\benum\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const file of files) {
    const raw = typeof file.rawContent === 'string' ? file.rawContent : '';
    if (!raw) continue;
    let m;
    while ((m = re.exec(raw)) !== null) enums.add(m[1]);
  }
  return enums;
}

// ---------------------------------------------------------------------------
// Phase-1 facts: consumes / required headers / request params (reshaped off
// the SAME mapping/param annotations the adapter's extractors read, so the
// blob is COMPLETE and the save-back passthrough carries everything).
// ---------------------------------------------------------------------------

function splitBraceList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((m) => m.replace(/^["']|["']$/g, '').trim())
    .filter((m) => m.length > 0);
}

function findMappingAnnotation(m: FunctionIR): AnnotationIR | undefined {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(m.annotations, ann);
    if (a) return a;
  }
  return undefined;
}

/** `consumes` request media types off the mapping annotation. */
function readConsumes(m: FunctionIR): string[] {
  const mapping = findMappingAnnotation(m);
  const raw = annotationArg(mapping, 'consumes');
  return raw ? splitBraceList(raw) : [];
}

/**
 * Required request headers: the `headers` mapping discriminators (always
 * required to match the route) + required `@RequestHeader` params. Mirrors the
 * shape the mcp-server save-back fallback assembles ({ name, source }).
 */
function readRequiredHeaders(m: FunctionIR): RequiredHeaderEntry[] {
  const out: RequiredHeaderEntry[] = [];
  const mapping = findMappingAnnotation(m);
  const rawHeaders = annotationArg(mapping, 'headers');
  if (rawHeaders) {
    for (const h of splitBraceList(rawHeaders)) {
      out.push({ name: h, source: 'mapping-header' });
    }
  }
  for (const p of m.parameters) {
    const a = findAnnotation(p.annotations, REQUEST_HEADER_ANNOTATION);
    if (!a) continue;
    const required = annotationArg(a, 'required') !== 'false';
    if (!required) continue;
    const name = annotationArg(a, 'name') || annotationArg(a, 'value') || p.name;
    out.push({ name, source: '@RequestHeader' });
  }
  return out;
}

/** `@RequestParam` inputs (name/type/required/default), mirroring the adapter. */
function readRequestParams(m: FunctionIR): RequestParamEntry[] {
  const out: RequestParamEntry[] = [];
  for (const p of m.parameters) {
    const a = findAnnotation(p.annotations, REQUEST_PARAM_ANNOTATION);
    if (!a) continue;
    const name = annotationArg(a, 'name') || annotationArg(a, 'value') || p.name;
    const required = annotationArg(a, 'required') !== 'false';
    const defaultValue = annotationArg(a, 'defaultValue');
    const entry: RequestParamEntry = { name, type: p.type, required };
    if (defaultValue !== undefined) entry.defaultValue = defaultValue;
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Phase-2 reader (NEW): request date FORMAT off `@JsonFormat`/`@DateTimeFormat`.
// ---------------------------------------------------------------------------

/**
 * Pull a request format off ONE annotation list (a field's or a parameter's).
 * Recognises `@JsonFormat(pattern=)` and `@DateTimeFormat(pattern= | iso=)`.
 * Returns `{ format, pattern, source }` for the first format annotation found,
 * or null when neither is present. `pattern` is the concrete `pattern=` value
 * (when present); `format` is the human label (the pattern, else the `iso=`
 * enum tail like `DateTimeFormat.ISO.DATE`).
 */
function readFormatAnnotation(
  annotations: AnnotationIR[],
): { format: string; pattern: string | null; source: string } | null {
  const json = findAnnotation(annotations, JSON_FORMAT_ANNOTATION);
  if (json) {
    const pattern = annotationArg(json, 'pattern');
    if (pattern) {
      const p = stripQuotes(pattern);
      return { format: p, pattern: p, source: `@${JSON_FORMAT_ANNOTATION}` };
    }
    // `@JsonFormat(shape=...)` with no pattern still records the shape as the
    // format label (no concrete pattern).
    const shape = annotationArg(json, 'shape');
    if (shape) {
      return { format: stripQuotes(shape), pattern: null, source: `@${JSON_FORMAT_ANNOTATION}` };
    }
  }
  const dtf = findAnnotation(annotations, DATE_TIME_FORMAT_ANNOTATION);
  if (dtf) {
    const pattern = annotationArg(dtf, 'pattern');
    if (pattern) {
      const p = stripQuotes(pattern);
      return { format: p, pattern: p, source: `@${DATE_TIME_FORMAT_ANNOTATION}` };
    }
    // `@DateTimeFormat(iso = DateTimeFormat.ISO.DATE)`: no concrete pattern,
    // but the ISO enum is the format label (so the consumer can map ISO ->
    // a concrete format). A bare positional `value` is also tolerated.
    const iso = annotationArg(dtf, 'iso') || annotationArg(dtf, 'value');
    if (iso) {
      return { format: stripQuotes(iso), pattern: null, source: `@${DATE_TIME_FORMAT_ANNOTATION}` };
    }
  }
  return null;
}

/** Map a parameter's binding annotations to its OAS-style `location`. */
function locationForParam(p: ParameterIR): string {
  if (hasAnnotation(p.annotations, PATH_VARIABLE_ANNOTATION)) return 'path';
  if (hasAnnotation(p.annotations, REQUEST_PARAM_ANNOTATION)) return 'query';
  if (hasAnnotation(p.annotations, REQUEST_HEADER_ANNOTATION)) return 'header';
  if (hasAnnotation(p.annotations, REQUEST_BODY_ANNOTATION)) return 'body';
  return 'query';
}

/** The bound name of a path/query/header param (annotation name= overrides). */
function boundParamName(p: ParameterIR): string {
  for (const ann of [PATH_VARIABLE_ANNOTATION, REQUEST_PARAM_ANNOTATION, REQUEST_HEADER_ANNOTATION]) {
    const a = findAnnotation(p.annotations, ann);
    if (a) return annotationArg(a, 'name') || annotationArg(a, 'value') || p.name;
  }
  return p.name;
}

/**
 * Read request date-FORMAT entries: from each `@PathVariable`/`@RequestParam`
 * parameter's own binding annotations, AND from every field of the resolved
 * `@RequestBody` DTO (walked across files via the class index). The reader is
 * genuinely NEW (the response scanner reads `@JsonFormat` only off the RESPONSE
 * DTO and recognises `@DateTimeFormat` nowhere).
 */
function readParamFormats(
  m: FunctionIR,
  index: Map<string, ClassEntry>,
  enums: Set<string>,
): ParamFormatEntry[] {
  const out: ParamFormatEntry[] = [];

  for (const p of m.parameters) {
    const isBody = hasAnnotation(p.annotations, REQUEST_BODY_ANNOTATION);
    // (1) Format directly on a path/query/header parameter.
    const direct = readFormatAnnotation(p.annotations);
    if (direct) {
      // Annotation path UNCHANGED (format/pattern/source win downstream); the
      // javaType is set for a uniform shape only.
      out.push({
        name: boundParamName(p),
        location: locationForParam(p),
        format: direct.format,
        pattern: direct.pattern,
        source: direct.source,
        javaType: simpleName(stripGenerics(p.type)),
      });
    } else if (!isBody && javaTypeCategory(p.type, enums) !== null) {
      // Type-only path: no format annotation, but the param Java type maps to
      // a category -> emit a type-only entry carrying the resolved type. NEVER
      // populate format/pattern from a type.
      out.push({
        name: boundParamName(p),
        location: locationForParam(p),
        format: null,
        pattern: null,
        source: 'java-type',
        javaType: wireJavaType(p.type, enums),
      });
    }
    // (2) `@RequestBody SomeRequest body` -> walk the bean's fields for formats.
    if (!isBody) continue;
    const beanType = stripGenerics(simpleName(p.type));
    const entry = index.get(beanType);
    if (!entry) continue;
    for (const f of entry.cls.fields as FieldIR[]) {
      const fmt = readFormatAnnotation(f.annotations);
      if (fmt) {
        // Annotation field path UNCHANGED (still carries format/pattern/source).
        out.push({
          name: jsonFieldName(f),
          location: 'body',
          format: fmt.format,
          pattern: fmt.pattern,
          source: fmt.source,
          javaType: simpleName(stripGenerics(f.type)),
        });
        continue;
      }
      // Type-only DTO field: no format annotation, but the field Java type
      // maps to a category -> emit a body-located type-only entry.
      if (javaTypeCategory(f.type, enums) === null) continue;
      out.push({
        name: jsonFieldName(f),
        location: 'body',
        format: null,
        pattern: null,
        source: 'java-type',
        javaType: wireJavaType(f.type, enums),
      });
    }
  }
  return out;
}

/** The wire name of a DTO field (a `@JsonProperty("x")` rename overrides). */
function jsonFieldName(f: FieldIR): string {
  const prop = findAnnotation(f.annotations, 'JsonProperty');
  const renamed = prop ? annotationArg(prop, 'value') : undefined;
  return renamed ? stripQuotes(renamed) : f.name;
}

// ---------------------------------------------------------------------------
// Phase-2 reader: request VALIDATION. REUSED verbatim (in shape) from
// `responseContractScanner.readValidation` -- it is already request-side
// (it walks `@Valid` request beans + parameter-level constraints).
// ---------------------------------------------------------------------------

function constraintEntry(field: string, a: AnnotationIR): RequestValidationEntry {
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

function readValidation(
  m: FunctionIR,
  index: Map<string, ClassEntry>,
): RequestValidationEntry[] {
  const out: RequestValidationEntry[] = [];
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
    const entry = index.get(beanType);
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

/** Resolve the request-body DTO entry for a mapping method (for provenance). */
function resolveRequestBodyDto(
  m: FunctionIR,
  index: Map<string, ClassEntry>,
): ClassEntry | null {
  for (const p of m.parameters) {
    if (!hasAnnotation(p.annotations, REQUEST_BODY_ANNOTATION)) continue;
    const beanType = stripGenerics(simpleName(p.type));
    const entry = index.get(beanType);
    if (entry) return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Scan the whole IR set and produce ONE `request_contract` per inbound HTTP
 * controller mapping method, keyed by its endpoint name. Pure: reads the
 * supplied IR only. Mirrors `scanResponseContracts`. An endpoint with NO
 * request facts at all (no consumes, headers, params, formats, or validation)
 * is OMITTED so an empty scan never wipes / writes a hollow blob.
 */
export function scanRequestContracts(
  files: SourceFileIR[],
): RequestContractScanOutput {
  const index = buildClassIndex(files);
  // Signal #1: simple names declared as Java enums (resolved off rawContent;
  // the extractor does not surface enum declarations in `file.classes`).
  const enums = buildEnumIndex(files);
  const contractsByEndpointName = new Map<string, RequestContract>();

  for (const file of files) {
    // Cheap early skip: a file with no controller class contributes no endpoints.
    if (!file.classes.some((c) => isController(c))) continue;
    for (const cls of file.classes) {
      if (!isController(cls)) continue;
      for (const m of cls.methods) {
        if (!isMappingMethod(m)) continue;
        const endpointName = endpointNameFor(cls, m);

        const consumes = readConsumes(m);
        const requiredHeaders = readRequiredHeaders(m);
        const params = readRequestParams(m);
        const paramFormats = readParamFormats(m, index, enums);
        const requestValidation = readValidation(m, index);

        // Omit endpoints with no request facts at all (additive + nullable:
        // an empty scan never writes a hollow blob that could wipe a value).
        if (
          consumes.length === 0 &&
          requiredHeaders.length === 0 &&
          params.length === 0 &&
          paramFormats.length === 0 &&
          requestValidation.length === 0
        ) {
          continue;
        }

        // Provenance: this controller file + the request-body DTO file (if any).
        const sourceFiles = new Set<string>([file.filePath]);
        const bodyDto = resolveRequestBodyDto(m, index);
        if (bodyDto) sourceFiles.add(bodyDto.file.filePath);

        const contract: RequestContract = {
          schema_version: REQUEST_CONTRACT_SCHEMA_VERSION,
          content_type: consumes.length > 0 ? consumes[0] : null,
          consumes,
          required_headers: requiredHeaders,
          params,
          param_formats: paramFormats,
          request_validation: requestValidation,
          provenance: 'code-scan',
          provenance_detail: {
            source_files: Array.from(sourceFiles),
            method_id: methodIdOf(file, cls, m),
          },
          confidence: DETERMINISTIC_CONFIDENCE,
        };
        contractsByEndpointName.set(endpointName, contract);
      }
    }
  }

  return { contractsByEndpointName };
}

/**
 * Attach each scanned `request_contract` to the matching `endpoints` candidate
 * by endpoint name (`${httpMethod} ${fullPath}` == the candidate `name`). The
 * contract rides on `candidate.data.request_contract` so it auto-persists into
 * `discovery_candidates.data` and maps (via the mcp-server save-back
 * passthrough) to AMS `endpoints.request_contract`. Mirrors
 * `attachResponseContractsToCandidates` EXACTLY. Mutates the candidates in
 * place (additive -- it does NOT disturb `response_contract`/`consumes`/
 * `headers`/`params`); returns the number attached.
 */
export function attachRequestContractsToCandidates(
  candidates: DiscoveryCandidate[],
  output: RequestContractScanOutput,
): number {
  let attached = 0;
  for (const c of candidates) {
    if (c.candidateType !== 'endpoints') continue;
    const contract = output.contractsByEndpointName.get(c.name);
    if (!contract) continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    data.request_contract = contract;
    c.data = data;
    attached += 1;
  }
  return attached;
}

// ---------------------------------------------------------------------------
// Signal #1 detect-or-flag: custom (de)serializer fields.
// ---------------------------------------------------------------------------

/** One request-body field whose format is hidden in a custom (de)serializer. */
export interface CustomSerializerFieldHit {
  /** The DTO field (wire name; a `@JsonProperty` rename is honoured). */
  field: string;
  /** Endpoint identity (`${httpMethod} ${fullPath}`). */
  endpoint: string;
  /** The referenced serializer/deserializer class simple name. */
  serializerClass: string;
}

/** Pull the `using=` serializer class simple name off a (de)serialize annotation. */
function usingSerializerClass(a: AnnotationIR | undefined): string | null {
  if (!a) return null;
  const using = annotationArg(a, 'using');
  if (!using) return null;
  // e.g. `MoneySerializer.class` / `com.foo.MoneySerializer.class` -> MoneySerializer.
  const cleaned = stripQuotes(using).replace(/\.class$/, '');
  const name = simpleName(stripGenerics(cleaned));
  return name || null;
}

/**
 * Detect request-body DTO fields annotated with a CUSTOM Jackson
 * `@JsonSerialize` / `@JsonDeserialize(using=SomeSerializer.class)`. The wire
 * format lives in the referenced serializer class, which the deterministic
 * scanner does NOT crack open -- so it FLAGS the field (never guesses a
 * format). Returns one hit per (field, endpoint) carrying the referenced
 * serializer class. Pure; walks the SAME controller -> @RequestBody DTO path as
 * `readParamFormats` so the endpoint identity lines up. The caller feeds each
 * hit to `emissionSources.buildRequestFormatUnresolvedFinding`.
 */
export function detectCustomSerializerFields(
  files: SourceFileIR[],
): CustomSerializerFieldHit[] {
  const index = buildClassIndex(files);
  const hits: CustomSerializerFieldHit[] = [];
  for (const file of files) {
    if (!file.classes.some((c) => isController(c))) continue;
    for (const cls of file.classes) {
      if (!isController(cls)) continue;
      for (const m of cls.methods) {
        if (!isMappingMethod(m)) continue;
        const endpoint = endpointNameFor(cls, m);
        for (const p of m.parameters) {
          if (!hasAnnotation(p.annotations, REQUEST_BODY_ANNOTATION)) continue;
          const beanType = stripGenerics(simpleName(p.type));
          const entry = index.get(beanType);
          if (!entry) continue;
          for (const f of entry.cls.fields as FieldIR[]) {
            const ser =
              usingSerializerClass(findAnnotation(f.annotations, JSON_SERIALIZE_ANNOTATION)) ??
              usingSerializerClass(findAnnotation(f.annotations, JSON_DESERIALIZE_ANNOTATION));
            if (!ser) continue;
            hits.push({ field: jsonFieldName(f), endpoint, serializerClass: ser });
          }
        }
      }
    }
  }
  return hits;
}
