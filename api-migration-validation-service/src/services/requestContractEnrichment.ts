/**
 * Capture-time OAS enrichment from AMS `request_contract` code evidence.
 *
 * Spec: 2026-06-19 Request Contract from Code Evidence -- Task Group 3
 * (R1 = iii: OAS enrichment reading AMS endpoints directly; R5: required
 * headers are Phase 1 alongside content-type).
 *
 * The discovery code-scan mines per-endpoint request-construction facts
 * (request content-type, required headers) and AMS persists them as a
 * non-reviewed `request_contract` JSONB on the endpoint row (mirroring
 * `response_contract`). At capture `/start` we read those endpoint rows and
 * MERGE their facts into the matching in-memory `ParsedOasOperation` so all
 * three downstream consumers -- `get_oas_operation_detail`,
 * `defaultScenarioSet.extractOasParams`, and the executor's Content-Type
 * default -- see the code-derived values BEFORE the LLM builds its first
 * request.
 *
 * Precedence (binding, R1 PRECEDENCE): code-evidence > contract > runtime.
 * The merge is an OVERRIDE, not a blind merge: a present code-evidence value
 * REPLACES the contract value for that field; an absent code-evidence value
 * leaves the contract value untouched. Every overridden / added bit is
 * provenance-tagged `x-amvs-source: code-scan` (R3) so the trace and
 * `get_oas_operation_detail` show the value came from the code scan rather
 * than the WADL/XSD/uploaded-OAS contract.
 *
 * This module is a PURE function: inventory + endpoints in, enriched
 * inventory out. The same in-memory inventory object is mutated in place and
 * returned (the orchestrator is handed that object reference), mirroring the
 * `synthesiseOperationFromEndpoint` / `protocol_metadata_json` layering
 * precedent in `captureSessionActions.ts`.
 *
 * FAIL-SOFT: this never throws. A malformed endpoint, an absent
 * `request_contract`, or a method+path that matches no operation simply
 * leaves the contract-derived OAS unchanged -- the caller wraps the invocation
 * the same way the discovery-context fetch is wrapped so `/start` is never
 * blocked.
 */

import type { OpenAPIV3 } from 'openapi-types';
import type { ParsedOasInventory } from '../types/oas';

/** Provenance marker stamped on any OAS bit overridden / added by a scan. */
export const CODE_SCAN_SOURCE = 'code-scan';

/**
 * Phase-1 facts read off one endpoint's `request_contract` blob. Both the
 * snake_case AMS wire keys and the camelCase tolerant fallbacks are accepted;
 * AMS speaks snake_case at the wire (CLAUDE.md), so `content_type` /
 * `required_headers` are the primary keys.
 */
export interface RequestContractFacts {
  /** Request media type, e.g. `application/json` / `application/xml`. */
  contentType: string | null;
  /** Required request headers ({ name } shape on `oasOperation.parameters`). */
  requiredHeaders: string[];
  /**
   * Request param/field date-number FORMAT entries mined from request-side
   * `@JsonFormat`/`@DateTimeFormat` (Phase 2). Each carries the param NAME, its
   * `location` ('body' | 'query' | 'path' | 'header'), the human-readable
   * `format` label, and a concrete `pattern` where the annotation supplied one.
   * These OVERRIDE the matched OAS param's `schema.format`/`schema.pattern` --
   * beating a misleading WADL/XSD `xsd:date` (-> ISO) so the capture LLM sees the
   * real `dd-MMM-yyyy` on its first request.
   */
  paramFormats: ParamFormat[];
}

/**
 * One request param/field FORMAT off the `request_contract.param_formats[]`
 * array (Phase 2). `pattern` is preferred when concrete; `format` carries the
 * human label (e.g. `dd-MMM-yyyy` or `DateTimeFormat.ISO.DATE`). `location` maps
 * to the OAS param `in` for path/query/header, and to a `requestBody` schema
 * PROPERTY for 'body'.
 */
export interface ParamFormat {
  name: string;
  /** 'body' | 'query' | 'path' | 'header' (matches discovery `locationForParam`). */
  location: string | null;
  format: string | null;
  pattern: string | null;
  /**
   * The resolved Java field/param TYPE (e.g. `LocalDate`/`BigDecimal`/`UUID`),
   * mined by the Spring-Classic pack for an UN-annotated field (`source:
   * 'java-type'`). Carried so the classifier code-evidence path can bucket the
   * field from the type. A type-only entry leaves `format`/`pattern` null -- the
   * type is NEVER stuffed into `format`/`pattern` (that keeps the seed path and the
   * OAS-override path separable; see `applyFormatToSchema`).
   */
  javaType: string | null;
}

/**
 * Read a non-empty string off a loose record under any of the supplied keys
 * (snake/camel-tolerant). Returns null when none match a non-empty string.
 */
function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/**
 * Extract the Phase-1 `request_contract` facts off one endpoint row. The blob
 * arrives under the snake_case `request_contract` key per the AMS
 * `EndpointDto` `@JsonProperty` mapping; we also tolerate `requestContract`
 * defensively. Returns null when the row carries no usable blob.
 *
 *   content_type  : string (preferred) | first entry of consumes[]
 *   required_headers[] : { name, source } -- we project the `name`s
 */
export function readRequestContractFacts(
  endpoint: Record<string, unknown>,
): RequestContractFacts | null {
  const blobRaw = endpoint.request_contract ?? endpoint.requestContract;
  if (!blobRaw || typeof blobRaw !== 'object') return null;
  const blob = blobRaw as Record<string, unknown>;

  // content_type, or the first request media type off consumes[].
  let contentType = readString(blob, 'content_type', 'contentType');
  if (!contentType) {
    const consumes = blob.consumes;
    if (Array.isArray(consumes)) {
      for (const c of consumes) {
        if (typeof c === 'string' && c.trim().length > 0) {
          contentType = c;
          break;
        }
      }
    }
  }

  // required_headers[] -> the header names (each entry is { name, source }).
  const requiredHeaders: string[] = [];
  const rawHeaders = blob.required_headers ?? blob.requiredHeaders;
  if (Array.isArray(rawHeaders)) {
    for (const h of rawHeaders) {
      if (typeof h === 'string' && h.trim().length > 0) {
        requiredHeaders.push(h);
      } else if (h && typeof h === 'object') {
        const name = readString(h as Record<string, unknown>, 'name', 'header');
        if (name) requiredHeaders.push(name);
      }
    }
  }

  // param_formats[] -> request date/number FORMAT overrides (Phase 2) PLUS
  // Spring-Classic type-only entries (2026-06-22). Each entry is
  // { name, location, format, pattern, source, java_type? }; we project the bits
  // the OAS param schema + the classifier need. An entry survives ONLY when it
  // carries a format, a pattern, OR a javaType -- an entry with NONE of the
  // three is useless (nothing to override, nothing to classify) so it is dropped.
  // A type-only entry passes here PURELY by virtue of javaType; its
  // format/pattern stay null (the type is NEVER stuffed into them) so the
  // OAS-override path (applyFormatToSchema) stays a no-op for it.
  const paramFormats: ParamFormat[] = [];
  const rawFormats = blob.param_formats ?? blob.paramFormats;
  if (Array.isArray(rawFormats)) {
    for (const f of rawFormats) {
      if (!f || typeof f !== 'object') continue;
      const entry = f as Record<string, unknown>;
      const name = readString(entry, 'name', 'field');
      if (!name) continue;
      const location = readString(entry, 'location', 'in');
      const format = readString(entry, 'format');
      const pattern = readString(entry, 'pattern');
      const javaType = readString(entry, 'java_type', 'javaType');
      if (!format && !pattern && !javaType) continue;
      paramFormats.push({ name, location, format, pattern, javaType });
    }
  }

  if (!contentType && requiredHeaders.length === 0 && paramFormats.length === 0) {
    return null;
  }
  return { contentType, requiredHeaders, paramFormats };
}

/** Normalise an HTTP method to lower-case for matching. */
function normaliseMethod(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase().trim() : '';
}

/**
 * Override the operation's request media type with the code-scanned
 * content-type. The OAS shape is `requestBody.content['<media-type>'].schema`;
 * we re-key the single existing media-type entry's schema under the new media
 * type (preserving the schema), or create a minimal `requestBody.content`
 * block when the contract carried none. Only the media-TYPE is overridden --
 * the schema body is left as the contract supplied it. Stamps
 * `x-amvs-source: code-scan` on the operation so the override is visible.
 *
 * @returns true when an override was actually applied.
 */
function applyContentTypeOverride(
  oasOperation: Record<string, unknown>,
  contentType: string,
): boolean {
  const existing = oasOperation.requestBody;
  const reqBody: Record<string, unknown> =
    existing && typeof existing === 'object'
      ? (existing as Record<string, unknown>)
      : {};
  const existingContent =
    reqBody.content && typeof reqBody.content === 'object'
      ? (reqBody.content as Record<string, unknown>)
      : {};

  const mediaKeys = Object.keys(existingContent);
  // Already the same single media type -> nothing to override.
  if (mediaKeys.length === 1 && mediaKeys[0] === contentType) return false;

  // Carry forward the schema/media object from the contract's first media
  // type if present, so the request body shape survives the re-key. If the
  // contract had several media types we collapse to the code-scanned one
  // (code-evidence is authoritative for the request media type).
  const carried =
    mediaKeys.length > 0
      ? (existingContent[mediaKeys[0]] as unknown)
      : {};

  reqBody.content = { [contentType]: carried };
  oasOperation.requestBody = reqBody;
  return true;
}

/**
 * Add `in: header, required: true` parameters for each code-scanned required
 * header that is not already present on the operation (case-insensitive on the
 * header name). Stamps `x-amvs-source: code-scan` on each ADDED param so the
 * provenance is visible at the param level. Existing contract params are left
 * untouched.
 *
 * @returns true when at least one header param was added.
 */
function applyRequiredHeaders(
  oasOperation: Record<string, unknown>,
  requiredHeaders: string[],
): boolean {
  if (requiredHeaders.length === 0) return false;
  const params = Array.isArray(oasOperation.parameters)
    ? (oasOperation.parameters as Array<Record<string, unknown>>)
    : [];

  const existingHeaderNames = new Set<string>();
  for (const p of params) {
    if (p && typeof p === 'object' && p.in === 'header' && typeof p.name === 'string') {
      existingHeaderNames.add(p.name.toLowerCase());
    }
  }

  let added = false;
  for (const name of requiredHeaders) {
    if (existingHeaderNames.has(name.toLowerCase())) continue;
    params.push({
      name,
      in: 'header',
      required: true,
      schema: { type: 'string' },
      'x-amvs-source': CODE_SCAN_SOURCE,
    });
    existingHeaderNames.add(name.toLowerCase());
    added = true;
  }
  if (added) oasOperation.parameters = params;
  return added;
}

/** Read a plain object schema off a param/property, never a `$ref`. */
function asConcreteSchema(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || '$ref' in (v as object)) return null;
  return v as Record<string, unknown>;
}

/**
 * Apply one code-scanned FORMAT to a concrete schema object as an OVERRIDE.
 * `pattern` is preferred when present (it is the concrete regex/Joda pattern,
 * e.g. `dd-MMM-yyyy`); `format` is set when supplied. Code-evidence REPLACES the
 * misleading contract value (an `xsd:date` -> `format: 'date'` -> ISO); where the
 * code is silent on a field the contract value stands. Stamps
 * `x-amvs-source: code-scan` on the schema so the override is visible to
 * `get_oas_operation_detail` and the trace.
 *
 * REGRESSION GUARD (2026-06-22): a TYPE-ONLY entry (a Spring-Classic
 * `source: 'java-type'` entry carrying only a `javaType`, no concrete
 * `format`/`pattern`) must NEVER override an existing OAS `format`/`pattern`
 * with a bare type token. We early-return a no-op unless a concrete
 * `format`/`pattern` is present, so a type-only entry that now flows through
 * `readRequestContractFacts` (it survives the line-154 drop via `javaType`)
 * cannot mutate `schema.format`/`schema.pattern` or stamp `x-amvs-source`.
 * Concrete-format entries keep overriding exactly as before.
 *
 * @returns true when something was actually overridden.
 */
function applyFormatToSchema(
  schema: Record<string, unknown>,
  fmt: ParamFormat,
): boolean {
  // No concrete format/pattern -> nothing to override (a javaType-only entry
  // is a no-op here; the type token never becomes a wire format).
  if (!fmt.pattern && !fmt.format) return false;
  let changed = false;
  if (fmt.pattern) {
    if (schema.pattern !== fmt.pattern) changed = true;
    schema.pattern = fmt.pattern;
  }
  if (fmt.format) {
    if (schema.format !== fmt.format) changed = true;
    schema.format = fmt.format;
  }
  if (changed) schema['x-amvs-source'] = CODE_SCAN_SOURCE;
  return changed;
}

/**
 * Resolve the request-body schema PROPERTY for a body-field format and apply the
 * override. The OAS shape is `requestBody.content['<media>'].schema.properties['<name>']`.
 * We scan every media type's dereferenced object schema for a matching property
 * (case-insensitive on the property key). FAIL-SOFT: if the requestBody / schema
 * / property is absent or a `$ref` (unresolvable), this is a silent no-op -- no
 * throw -- and the contract value stands.
 *
 * @returns true when a body property's format was overridden.
 */
function applyBodyFieldFormat(
  oasOperation: Record<string, unknown>,
  fmt: ParamFormat,
): boolean {
  const reqBody = oasOperation.requestBody;
  if (!reqBody || typeof reqBody !== 'object') return false;
  const content = (reqBody as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return false;

  let changed = false;
  for (const media of Object.values(content as Record<string, unknown>)) {
    if (!media || typeof media !== 'object') continue;
    const schema = asConcreteSchema((media as Record<string, unknown>).schema);
    if (!schema) continue;
    const props = schema.properties;
    if (!props || typeof props !== 'object') continue;
    // Exact key first, then a case-insensitive fallback match.
    const propsRec = props as Record<string, unknown>;
    let target = asConcreteSchema(propsRec[fmt.name]);
    if (!target) {
      const lower = fmt.name.toLowerCase();
      for (const [k, v] of Object.entries(propsRec)) {
        if (k.toLowerCase() === lower) {
          target = asConcreteSchema(v);
          if (target) break;
        }
      }
    }
    if (!target) continue;
    changed = applyFormatToSchema(target, fmt) || changed;
  }
  return changed;
}

/**
 * Apply each code-scanned `param_formats[]` entry onto the operation's
 * parameters / request body as an OVERRIDE of `schema.format`/`schema.pattern`.
 *
 * Matching:
 *   - location 'path' | 'query' | 'header' -> match `parameters[]` by NAME
 *     (case-insensitive) AND `in` (when the entry carries a location); when the
 *     entry's location is null we fall back to a name-only match.
 *   - location 'body' -> the corresponding `requestBody` schema property
 *     (`applyBodyFieldFormat`); unresolvable -> graceful no-op.
 *
 * Where `param_formats` is silent for a param, the contract value is left
 * untouched (precedence: code > contract). The override stamps
 * `x-amvs-source: code-scan` on the overridden param's SCHEMA.
 *
 * @returns true when at least one param/property schema was overridden.
 */
function applyParamFormatOverrides(
  oasOperation: Record<string, unknown>,
  paramFormats: ParamFormat[],
): boolean {
  if (paramFormats.length === 0) return false;
  const params = Array.isArray(oasOperation.parameters)
    ? (oasOperation.parameters as Array<Record<string, unknown>>)
    : [];

  let overrode = false;
  for (const fmt of paramFormats) {
    if (fmt.location === 'body') {
      overrode = applyBodyFieldFormat(oasOperation, fmt) || overrode;
      continue;
    }
    const lowerName = fmt.name.toLowerCase();
    for (const p of params) {
      if (!p || typeof p !== 'object' || '$ref' in (p as object)) continue;
      const pName = typeof p.name === 'string' ? p.name.toLowerCase() : '';
      if (pName !== lowerName) continue;
      // Honour the location -> OAS `in` match when the entry carries a
      // concrete location; a null location is a name-only match.
      if (fmt.location && typeof p.in === 'string' && p.in !== fmt.location) {
        continue;
      }
      let schema = asConcreteSchema(p.schema);
      if (!schema) {
        // No usable schema on the contract param -> synthesise a minimal one so
        // the code-evidence format still reaches the LLM-facing detail.
        schema = { type: 'string' };
        p.schema = schema;
      }
      overrode = applyFormatToSchema(schema, fmt) || overrode;
    }
  }
  return overrode;
}

/**
 * Merge the Phase-1 `request_contract` facts (content-type + required headers)
 * from the AMS endpoint rows into the matching in-memory OAS operations.
 *
 * Match key: HTTP METHOD + PATH (case-insensitive method; exact path). The
 * endpoint row carries `operation_verb` + `path_or_address` (the
 * `synthesiseOperationFromEndpoint` field names); a `ParsedOasOperation`
 * carries `method` + `path`.
 *
 * Mutates `inventory.operations[*].oasOperation` IN PLACE and returns the same
 * inventory object so the orchestrator's reference sees the enriched values.
 * Pure + total: never throws; an unmatched endpoint or an absent blob is a
 * no-op for that endpoint.
 */
export function enrichInventoryWithRequestContracts(
  inventory: ParsedOasInventory,
  endpoints: ReadonlyArray<Record<string, unknown>>,
): ParsedOasInventory {
  try {
    if (!inventory || !Array.isArray(inventory.operations)) return inventory;
    if (!Array.isArray(endpoints) || endpoints.length === 0) return inventory;

    // Index the in-memory operations by `${method}|${path}` for O(1)
    // lookup as we walk the (typically smaller) endpoint set.
    const opIndex = new Map<string, ParsedOasInventory['operations'][number]>();
    for (const op of inventory.operations) {
      const key = `${normaliseMethod(op.method)}|${op.path}`;
      if (!opIndex.has(key)) opIndex.set(key, op);
    }

    for (const endpoint of endpoints) {
      if (!endpoint || typeof endpoint !== 'object') continue;
      const facts = readRequestContractFacts(endpoint);
      if (!facts) continue;

      const method = normaliseMethod(endpoint.operation_verb ?? endpoint.method);
      const path =
        readString(endpoint, 'path_or_address', 'path') ?? '';
      if (!method || !path) continue;

      const op = opIndex.get(`${method}|${path}`);
      if (!op || !op.oasOperation || typeof op.oasOperation !== 'object') continue;

      const oasOp = op.oasOperation as unknown as Record<string, unknown>;
      let overrode = false;
      if (facts.contentType) {
        overrode = applyContentTypeOverride(oasOp, facts.contentType) || overrode;
      }
      overrode = applyRequiredHeaders(oasOp, facts.requiredHeaders) || overrode;
      // Phase 2: param/field date-number FORMAT overrides. These beat a
      // misleading WADL/XSD `xsd:date` (-> ISO) so the LLM sees the real
      // `dd-MMM-yyyy` on its first request. The param-level stamp lives on the
      // overridden param's schema (`applyFormatToSchema`); we OR into `overrode`
      // so the operation also carries the op-level provenance marker.
      overrode = applyParamFormatOverrides(oasOp, facts.paramFormats) || overrode;

      // Operation-level provenance stamp -- only when code-evidence actually
      // overrode / added a value. Contract-sourced operations stay unmarked.
      if (overrode) {
        oasOp['x-amvs-source'] = CODE_SCAN_SOURCE;
      }
    }
  } catch {
    // Fail-soft: any unexpected shape leaves the inventory unchanged. The
    // capture proceeds on the contract-derived OAS (mirrors the
    // discovery-context fetch fail-soft at /start).
    return inventory;
  }
  return inventory;
}

/** The OAS operation type re-exported for the test's convenience. */
export type { OpenAPIV3 };
