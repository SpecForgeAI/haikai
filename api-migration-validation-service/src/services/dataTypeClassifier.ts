/**
 * Data-type classifier + Col-4 seed computation for the capture wizard's
 * "Data-type formats" step.
 *
 * Spec: 2026-06-20 Capture data-type format defaults -- Task Group 2.
 *
 * The capture LLM keeps mis-formatting values (especially dates: it guesses ISO
 * when a legacy API really uses e.g. `dd-MMM-yyyy`), burning attempts. This
 * module turns the two evidence sources we already have -- the code-scan
 * `request_contract.param_formats` (`@JsonFormat`/`@DateTimeFormat`-derived) and
 * the contract's OAS `type`/`format`/`pattern` -- into per-DATA-TYPE rows the
 * operator reviews, then seeds a "try-this-first" default format per row.
 *
 * It is colocated with the LLM wiring that consumes it (spec C1/Q1) -- the
 * preview endpoint and the (later) prompt block both classify off this single
 * module so the preview the operator sees and the generation the LLM runs cannot
 * drift.
 *
 * TAXONOMY (Q2/Q4): `date`, `datetime`, `time`, `numeric_id`, `string_id`,
 * `boolean`, `decimal` (covers currency), `enum`, `uuid`; anything else falls to
 * a `string` catch-all. Rows are DERIVED from the categories actually discovered
 * (F3) -- a category with no contributing field is never emitted.
 *
 * CLASSIFICATION SIGNAL PRECEDENCE (Q3 -- the crux): for ONE field we decide its
 * category from the strongest signal available, in order:
 *
 *   1. code-annotation format  (from `param_formats` -- `@JsonFormat`/`@DateTimeFormat`)
 *   2. OAS `type` + `format`   (the contract's declared schema)
 *   3. pattern hints           (a `pattern`/regex shape, e.g. a UUID regex)
 *   4. param-name hints        (id/date/amount/... -- the LAST resort)
 *
 * Param-name hints sit LAST deliberately so a misleading name (`amountText`,
 * `idLabel`) can never override real format evidence. A field with NO usable
 * signal at all is NOT classified (it contributes no row) -- we only surface
 * categories we have positive evidence for.
 *
 * date vs datetime is decided by the presence of a TIME COMPONENT in the
 * format/pattern (an `HH`/`hh`/`mm`/`ss` token, a `time`/`date-time` OAS format,
 * or a `T`-separated ISO shape). numeric_id vs string_id is kept split (Q4):
 * an integer-typed identifier is `numeric_id`, a string/UUID-shaped one is
 * `string_id` (a UUID-shaped identifier classifies as `uuid`, which is more
 * specific and wins).
 *
 * COL-4 SEED PRECEDENCE -- chain (a) (F4a): the pre-filled default per row is
 * `code(field) > contract(field) > standard/LLM guess`. This is DELIBERATELY
 * distinct from the scan-time chain (chain (b), expressed later in the prompt):
 * contract sits at position 2 when SEEDING because no operator default exists
 * yet to seed from. The seed is the union's "most authoritative concrete
 * format" -- a code-evidence format for the category if any field has one, else
 * a contract format, else a per-category standard guess (e.g. ISO 8601 for
 * dates). The operator always has the final say over the seeded value.
 *
 * PURE + TOTAL: no I/O, never throws. The preview endpoint feeds it the already-
 * loaded endpoints (code) + operations (contract); this module only shapes them.
 */

import { readRequestContractFacts, type ParamFormat } from './requestContractEnrichment';

/**
 * The fixed data-type taxonomy (Q2/Q4). `string` is the catch-all but is NOT a
 * classification TARGET here -- we never emit a `string` row from a positive
 * signal because "this field is a string" carries no useful format default. It
 * exists in the union so downstream consumers can name the catch-all.
 */
export type DataTypeCategory =
  | 'date'
  | 'datetime'
  | 'time'
  | 'numeric_id'
  | 'string_id'
  | 'boolean'
  | 'decimal'
  | 'enum'
  | 'uuid'
  | 'string';

/** Categories that actually carry a meaningful format default (emit a row). */
const CLASSIFIABLE_CATEGORIES: ReadonlySet<DataTypeCategory> = new Set<DataTypeCategory>([
  'date',
  'datetime',
  'time',
  'numeric_id',
  'string_id',
  'boolean',
  'decimal',
  'enum',
  'uuid',
]);

/**
 * Per-category "standard" default the seed falls back to when neither code nor
 * contract supplied a concrete format (chain (a) position 3). A null entry means
 * the category has no sensible universal format string (e.g. `enum`/`boolean` --
 * there is no canonical "format" to suggest), so the seed is left empty and the
 * operator decides. ISO 8601 is the date/datetime/time standard.
 */
const STANDARD_FORMAT_GUESS: Readonly<Record<DataTypeCategory, string | null>> = {
  date: 'yyyy-MM-dd',
  datetime: "yyyy-MM-dd'T'HH:mm:ssXXX",
  time: 'HH:mm:ss',
  numeric_id: null,
  string_id: null,
  boolean: null,
  decimal: '0.00',
  enum: null,
  uuid: 'uuid',
  string: null,
};

/** A contract-side OAS param/field projection (the contract evidence source). */
export interface ContractFieldFormat {
  name: string;
  /** 'body' | 'query' | 'path' | 'header' (the OAS `in`, or 'body' for props). */
  location: string | null;
  /** OAS `schema.type`, lower-cased (e.g. `string`/`integer`/`number`/`boolean`). */
  type: string | null;
  /** OAS `schema.format` (e.g. `date`/`date-time`/`uuid`/`int64`). */
  format: string | null;
  /** OAS `schema.pattern` regex when the contract declared one. */
  pattern: string | null;
  /** Whether the schema carried a non-empty `enum`. */
  hasEnum: boolean;
}

/** One contributing field listed under a row for per-row transparency (Q9). */
export interface ContributingField {
  name: string;
  location: string | null;
  /** The raw code-evidence format/pattern, when this field came from code. */
  codeFormat: string | null;
  /** The raw contract-evidence format/pattern, when this field came from the contract. */
  contractFormat: string | null;
}

/** One classified taxonomy row (one per DISCOVERED category). */
export interface DataTypeRow {
  category: DataTypeCategory;
  /** Distinct Col-2 (code) format variations discovered for this category. */
  codeFormats: string[];
  /** Distinct Col-3 (contract) format variations discovered for this category. */
  contractFormats: string[];
  /** Seeded Col-4 value (chain (a): code > contract > standard guess). */
  defaultFormat: string | null;
  /** Contributing fields (name + location + raw code/contract format) -- Q9. */
  contributingFields: ContributingField[];
}

// ---------------------------------------------------------------------------
// Signal helpers
// ---------------------------------------------------------------------------

/** Lower-case + trim a loose value to a comparable token, or '' when absent. */
function token(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Does the supplied format/pattern carry a TIME component? Used to split date vs
 * datetime and to recognise a bare time. Matches the common time tokens
 * an hour token (`HH`/`hh`) or a colon-separated time (`mm`/`ss` count only
 * alongside a `:`), the OAS `time`/`date-time` semantic formats, and a
 * `T`-separated ISO datetime shape.
 */
function hasTimeComponent(...fragments: Array<string | null | undefined>): boolean {
  for (const f of fragments) {
    if (typeof f !== 'string' || f.trim().length === 0) continue;
    const raw = f.trim();
    const t = raw.toLowerCase();
    if (t === 'time' || t === 'date-time' || t === 'datetime') return true;
    // CASE-SENSITIVE hour token: `HH` (24h) or `hh` (12h). We must check the
    // ORIGINAL case -- lowercasing collapses the month placeholder `MM` onto the
    // minutes token `mm`, so a bare `mm`/`ss` is NOT a reliable time signal on
    // its own (it would mis-flag a pure date pattern like `dd/MM/yyyy`). A
    // genuine hour token, OR a colon-separated time, is required.
    if (/HH|hh/.test(raw)) return true;
    if (/[0-9]{1,2}:[0-9]{2}/.test(raw)) return true; // a literal 12:30 sample
    // A `mm`/`ss` token only counts as time when paired with a `:` separator
    // (e.g. `mm:ss`), which a date pattern never has.
    if (/:/.test(raw) && /(mm|ss)/.test(t)) return true;
    // ISO `yyyy-MM-ddTHH...` -- a `t` between a date and a time chunk with a colon.
    if (/\d.*t.*\d/.test(t) && /:/.test(raw)) return true;
  }
  return false;
}

/** Does the format/pattern look like a DATE (year/month/day tokens)? */
function hasDateComponent(...fragments: Array<string | null | undefined>): boolean {
  for (const f of fragments) {
    const t = token(f);
    if (!t) continue;
    if (t === 'date' || t === 'date-time' || t === 'datetime') return true;
    if (/yyyy|yy|\bmm\b|\bdd\b|mmm/.test(t)) return true;
    if (/\d{4}-\d{2}-\d{2}/.test(t)) return true; // a literal yyyy-MM-dd sample
  }
  return false;
}

/** Does this format/pattern look like a UUID? */
function looksLikeUuid(...fragments: Array<string | null | undefined>): boolean {
  for (const f of fragments) {
    const t = token(f);
    if (!t) continue;
    if (t === 'uuid' || t === 'guid') return true;
    // The canonical 8-4-4-4-12 hex regex shape (as a declared pattern).
    if (/\[0-9a-f.*\]\{8\}.*\{4\}.*\{4\}.*\{4\}.*\{12\}/.test(t)) return true;
    if (/8.*4.*4.*4.*12/.test(t) && /a-f/.test(t)) return true;
  }
  return false;
}

/**
 * Param-name hint -> category. The LAST-resort signal (Q3), only consulted when
 * no format/type/pattern evidence resolved a category. Conservative: only the
 * unambiguous name shapes map; a vague name yields null (no row).
 */
function categoryFromName(name: string): DataTypeCategory | null {
  const n = token(name);
  if (!n) return null;
  if (/(^|_|-)(uuid|guid)($|_|-)/.test(n) || n === 'uuid' || n === 'guid') return 'uuid';
  // identifiers: `*id`, `*_id`, `*Id`, `*Key`, `*Ref` -> string_id by name alone
  // (name evidence cannot tell numeric from string; default to string_id, the
  // safer identifier bucket -- a numeric id is pinned by type evidence earlier).
  if (/(^|_)id$|_id$|^id$|(id|ref|key)$/.test(n)) return 'string_id';
  if (/(date|day)/.test(n) && /(time|timestamp|datetime)/.test(n)) return 'datetime';
  if (/(timestamp|datetime)/.test(n)) return 'datetime';
  if (/(^|_)(date|day)($|_)|date$/.test(n)) return 'date';
  if (/(^|_)time($|_)|time$/.test(n)) return 'time';
  if (/(amount|price|cost|total|fee|balance|rate|qty|quantity|decimal|currency|money)/.test(n)) {
    return 'decimal';
  }
  if (/(is|has|can|should|enabled|active|flag)([A-Z_]|$)/.test(name) || /^(is|has)_/.test(n)) {
    return 'boolean';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-field classification -- the precedence ladder
// ---------------------------------------------------------------------------

/** A normalised view of one field's evidence, regardless of which source it came from. */
interface FieldEvidence {
  name: string;
  location: string | null;
  /** code-annotation format/pattern (signal 1) -- present only for code fields. */
  codeFormat: string | null;
  /** OAS schema type (signal 2). */
  oasType: string | null;
  /** OAS schema format (signal 2). */
  oasFormat: string | null;
  /** OAS / code pattern (signal 3). */
  pattern: string | null;
  /** Whether the contract schema carried an enum (a strong `enum` signal). */
  hasEnum: boolean;
}

/**
 * Classify ONE field by the signal-precedence ladder. Returns null when no
 * signal resolves a (meaningful) category -- such a field contributes no row.
 *
 * Precedence (Q3): code-annotation format > OAS type+format > pattern > name.
 */
function classifyField(ev: FieldEvidence): DataTypeCategory | null {
  // An explicit enum is a strong, source-independent signal.
  if (ev.hasEnum) return 'enum';

  // ---- Signal 1: code-annotation format (@JsonFormat/@DateTimeFormat) -------
  // The strongest signal -- a date/number annotation the developer wrote. Only
  // resolves the temporal categories + uuid; a code format never demotes to a
  // weaker bucket, it just falls through to the next signal when inconclusive.
  if (ev.codeFormat) {
    if (looksLikeUuid(ev.codeFormat)) return 'uuid';
    const codeTime = hasTimeComponent(ev.codeFormat);
    const codeDate = hasDateComponent(ev.codeFormat);
    if (codeDate && codeTime) return 'datetime';
    if (codeDate) return 'date';
    if (codeTime) return 'time';
    // A code format that is neither date nor time (rare) falls through.
  }

  // ---- Signal 2: OAS type + format -----------------------------------------
  const type = token(ev.oasType);
  const fmt = token(ev.oasFormat);
  if (fmt) {
    if (fmt === 'uuid' || fmt === 'guid') return 'uuid';
    if (fmt === 'date-time') return 'datetime';
    if (fmt === 'date') return 'date';
    if (fmt === 'time') return 'time';
    // `int64`/`int32`/`integer` formatted identifiers -> numeric_id; decimals
    // (`double`/`float`/`decimal`) -> decimal.
    if (/int/.test(fmt)) {
      return 'numeric_id';
    }
    if (/(double|float|decimal|number)/.test(fmt)) return 'decimal';
  }
  // Type alone (no format): integers default to numeric_id, numbers to decimal,
  // booleans to boolean. A bare `string` type is NOT enough on its own -- it
  // falls through to pattern/name (a plain string carries no format default).
  if (type) {
    if (type === 'boolean') return 'boolean';
    if (type === 'integer') return 'numeric_id';
    if (type === 'number') return 'decimal';
  }

  // ---- Signal 3: pattern hints ---------------------------------------------
  if (ev.pattern) {
    if (looksLikeUuid(ev.pattern)) return 'uuid';
    const pTime = hasTimeComponent(ev.pattern);
    const pDate = hasDateComponent(ev.pattern);
    if (pDate && pTime) return 'datetime';
    if (pDate) return 'date';
    if (pTime) return 'time';
    // A purely-numeric pattern on a string-typed field is a string identifier.
    if (/^\^?\[?\\?d|^\^?\[0-9/.test(token(ev.pattern)) && type === 'string') {
      return 'string_id';
    }
  }

  // ---- Signal 4: param-name hint (LAST resort) -----------------------------
  const byName = categoryFromName(ev.name);
  if (byName) {
    // A name says "id" but the contract typed it integer -> numeric_id already
    // returned above. Here name is the only signal: a `*Id` on a string-typed
    // (or untyped) field is a string identifier; everything else as named.
    if (byName === 'string_id' && type === 'integer') return 'numeric_id';
    return byName;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Evidence projection
// ---------------------------------------------------------------------------

/**
 * The signal slots a Java TYPE projects onto so `classifyField` buckets a
 * type-only code entry (2026-06-22). Temporal/uuid/enum MUST route through
 * `oasFormat`/`hasEnum` (the signal-2 format branch + the enum signal), NOT
 * `oasType` -- the bare-`oasType` branch only buckets boolean/integer/number, so
 * a numeric/string token there would mis-bucket a date. numeric/decimal/boolean
 * route through `oasType` (integer/number/boolean).
 */
interface TypeEvidenceSlots {
  oasType: string | null;
  oasFormat: string | null;
  hasEnum: boolean;
}

const NO_TYPE_SLOTS: TypeEvidenceSlots = { oasType: null, oasFormat: null, hasEnum: false };

/**
 * Map a resolved Java field/param TYPE to the classifier evidence slots
 * `classifyField` reads. Deterministic + pure. Mirrors the discovery
 * type->category table (spec 2026-06-22). Matches by SIMPLE name after
 * stripping generics + package (tolerates fully-qualified `java.time.*`). A
 * type marked `<enum>` (the producer's enum marker) routes via `hasEnum`. An
 * unrecognised type (incl. `String`/`Object`) yields no signal.
 *
 *   LocalDate -> date; LocalDateTime/Instant/OffsetDateTime/ZonedDateTime/Date/
 *     Timestamp/Calendar -> date-time; LocalTime -> time.
 *   BigDecimal/double/Double/float/Float -> number (decimal);
 *   long/Long/int/Integer/short/Short/BigInteger -> integer (numeric_id);
 *   boolean/Boolean -> boolean; UUID -> uuid; Java enum -> hasEnum.
 */
function typeEvidenceSlots(javaType: string | null): TypeEvidenceSlots {
  if (!javaType || javaType.trim().length === 0) return NO_TYPE_SLOTS;
  let t = javaType.trim();
  // Enum marker (e.g. `OrderStatus<enum>`) -> the enum signal, before generics
  // are stripped (the marker rides in the generic-bracket position).
  if (/<\s*enum\s*>/i.test(t)) return { oasType: null, oasFormat: null, hasEnum: true };
  // Strip generics (`List<LocalDate>` -> `List`); the producer already unwrapped
  // one collection level, so the OUTER name is the element type here.
  const lt = t.indexOf('<');
  if (lt >= 0) t = t.slice(0, lt);
  // Strip an array suffix and any package qualifier -> the SIMPLE name.
  t = t.replace(/\[\]/g, '').trim();
  const dot = t.lastIndexOf('.');
  if (dot >= 0) t = t.slice(dot + 1);
  const simple = t.trim();
  switch (simple) {
    // -- temporal (route via oasFormat, never oasType) --
    case 'LocalDate':
      return { oasType: null, oasFormat: 'date', hasEnum: false };
    case 'LocalDateTime':
    case 'Instant':
    case 'OffsetDateTime':
    case 'ZonedDateTime':
    case 'Date':
    case 'Timestamp':
    case 'Calendar':
      return { oasType: null, oasFormat: 'date-time', hasEnum: false };
    case 'LocalTime':
      return { oasType: null, oasFormat: 'time', hasEnum: false };
    // -- uuid (route via oasFormat) --
    case 'UUID':
      return { oasType: null, oasFormat: 'uuid', hasEnum: false };
    // -- decimal (route via oasType: number) --
    case 'BigDecimal':
    case 'double':
    case 'Double':
    case 'float':
    case 'Float':
      return { oasType: 'number', oasFormat: null, hasEnum: false };
    // -- numeric_id (route via oasType: integer) --
    case 'long':
    case 'Long':
    case 'int':
    case 'Integer':
    case 'short':
    case 'Short':
    case 'BigInteger':
      return { oasType: 'integer', oasFormat: null, hasEnum: false };
    // -- boolean (route via oasType: boolean) --
    case 'boolean':
    case 'Boolean':
      return { oasType: 'boolean', oasFormat: null, hasEnum: false };
    default:
      return NO_TYPE_SLOTS;
  }
}

/**
 * Project a code-scan `ParamFormat` (from `readRequestContractFacts`, C3) onto
 * the shared `FieldEvidence` shape. The code format/pattern is the signal-1
 * source (an ANNOTATION format -- it resolves BEFORE the bare-type signal-2
 * branch, so "annotation beats type"); `pattern` (when concrete) doubles as a
 * signal-3 hint. When the entry is TYPE-ONLY (no `format`/`pattern`), the
 * resolved Java type is projected onto the signal-2 slots so `classifyField`
 * buckets it from CODE (2026-06-22).
 */
function evidenceFromCode(p: ParamFormat): FieldEvidence {
  // Prefer the concrete pattern as the code format label when present (it is the
  // real `dd-MMM-yyyy`/regex), else the human format label. An ANNOTATION format
  // here wins classification over the bare type (signal 1 before signal 2).
  const codeFormat = p.pattern ?? p.format ?? null;
  // Project the Java type onto the signal-2 slots (temporal/uuid via oasFormat,
  // enum via hasEnum, numeric/decimal/boolean via oasType). A type-only entry
  // thus classifies from CODE; a concrete `codeFormat` still outranks it.
  const slots = typeEvidenceSlots(p.javaType);
  return {
    name: p.name,
    location: p.location,
    codeFormat,
    oasType: slots.oasType,
    oasFormat: slots.oasFormat,
    pattern: p.pattern,
    hasEnum: slots.hasEnum,
  };
}

/** Project a contract OAS field onto the shared `FieldEvidence` shape. */
function evidenceFromContract(c: ContractFieldFormat): FieldEvidence {
  return {
    name: c.name,
    location: c.location,
    codeFormat: null,
    oasType: c.type,
    oasFormat: c.format,
    pattern: c.pattern,
    hasEnum: c.hasEnum,
  };
}

/**
 * The concrete CODE format string we display / collect for a code field (Col-2).
 * Prefer the concrete pattern, else the human format label.
 */
function codeFormatLabel(p: ParamFormat): string | null {
  const v = p.pattern ?? p.format ?? null;
  return v && v.trim().length > 0 ? v.trim() : null;
}

/**
 * The concrete CONTRACT format string we DISPLAY / collect for a contract field
 * (Col-3). Prefer the declared `format`, else the `pattern` regex; when the
 * contract carried neither but DID declare a shape, fall back to an `enum`
 * marker, else the declared `type` (lower-cased). This is the DISPLAY label
 * only -- the Col-4 SEED never uses the type fallback (a bare `type:string`
 * must not seed Col-4 with "string"); see the contract loop in
 * `classifyDataTypes`, which keeps `seedFromContract` to a real format/pattern.
 */
function contractFormatLabel(c: ContractFieldFormat): string | null {
  const v =
    c.format ?? c.pattern ?? (c.hasEnum ? 'enum' : null) ?? (c.type ? c.type.toLowerCase() : null);
  return v && v.trim().length > 0 ? v.trim() : null;
}

/** Push a value onto an array iff non-empty and not already present (distinct). */
function pushDistinct(arr: string[], v: string | null | undefined): void {
  if (typeof v === 'string' && v.trim().length > 0 && !arr.includes(v.trim())) {
    arr.push(v.trim());
  }
}

// ---------------------------------------------------------------------------
// OAS extraction (contract evidence) -- params + requestBody properties
// ---------------------------------------------------------------------------

/** Read a string off a loose record (lower-cased optional). */
function readStr(o: Record<string, unknown> | undefined, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

/** Read a concrete (non-$ref) object schema off a value. */
function concreteSchema(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || '$ref' in (v as object)) return null;
  return v as Record<string, unknown>;
}

/**
 * Project ONE OAS operation (the contract-derived `oas_operation_json`) into the
 * contract-field evidence list. Covers `parameters[]` (path/query/header) and
 * the `requestBody` schema PROPERTIES (location `body`). FAIL-SOFT: an absent /
 * `$ref` / malformed schema simply contributes nothing.
 *
 * Exported so the preview endpoint and tests share the exact projection.
 */
export function extractContractFieldFormats(oasOperation: unknown): ContractFieldFormat[] {
  const out: ContractFieldFormat[] = [];
  if (!oasOperation || typeof oasOperation !== 'object') return out;
  const op = oasOperation as Record<string, unknown>;

  // --- parameters[] : path / query / header ---------------------------------
  const params = op.parameters;
  if (Array.isArray(params)) {
    for (const p of params) {
      const param = concreteSchema(p);
      if (!param) continue;
      const name = readStr(param, 'name');
      const location = readStr(param, 'in');
      if (!name) continue;
      const schema = concreteSchema(param.schema) ?? {};
      const enumVal = schema.enum;
      out.push({
        name,
        location,
        type: readStr(schema, 'type'),
        format: readStr(schema, 'format'),
        pattern: readStr(schema, 'pattern'),
        hasEnum: Array.isArray(enumVal) && enumVal.length > 0,
      });
    }
  }

  // --- requestBody.content[*].schema.properties[*] : body fields ------------
  const reqBody = concreteSchema(op.requestBody);
  const content = reqBody ? concreteSchema(reqBody.content) : null;
  if (content) {
    for (const media of Object.values(content)) {
      const mediaObj = concreteSchema(media);
      const schema = mediaObj ? concreteSchema(mediaObj.schema) : null;
      const props = schema ? concreteSchema(schema.properties) : null;
      if (!props) continue;
      for (const [propName, propSchemaRaw] of Object.entries(props)) {
        const propSchema = concreteSchema(propSchemaRaw);
        if (!propSchema) continue;
        const enumVal = propSchema.enum;
        out.push({
          name: propName,
          location: 'body',
          type: readStr(propSchema, 'type'),
          format: readStr(propSchema, 'format'),
          pattern: readStr(propSchema, 'pattern'),
          hasEnum: Array.isArray(enumVal) && enumVal.length > 0,
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Top-level: classify the whole session into taxonomy rows
// ---------------------------------------------------------------------------

/** Per-category accumulator while we fold fields in. */
interface RowAccumulator {
  codeFormats: string[];
  contractFormats: string[];
  contributingFields: ContributingField[];
  /** The most authoritative CODE format seen (for seed chain (a) position 1). */
  seedFromCode: string | null;
  /** The most authoritative CONTRACT format seen (for seed chain (a) position 2). */
  seedFromContract: string | null;
}

function newAccumulator(): RowAccumulator {
  return {
    codeFormats: [],
    contractFormats: [],
    contributingFields: [],
    seedFromCode: null,
    seedFromContract: null,
  };
}

/**
 * Read the ONE project-wide `inferred_date_format` off an endpoint's
 * `request_contract` (2026-06-22). The Spring-Classic pack stamps a single
 * top-level `{ format, source, confidence }` per endpoint contract (NOT onto
 * per-field `param_formats`); we project its concrete `format` string
 * (snake/camel-tolerant) so the code-evidence loop can apply it to a type-only
 * date/datetime entry. Returns null when the contract carried none.
 */
function readInferredDateFormat(endpoint: Record<string, unknown>): string | null {
  const blobRaw = endpoint.request_contract ?? endpoint.requestContract;
  if (!blobRaw || typeof blobRaw !== 'object') return null;
  const blob = blobRaw as Record<string, unknown>;
  const idfRaw = blob.inferred_date_format ?? blob.inferredDateFormat;
  if (!idfRaw || typeof idfRaw !== 'object') return null;
  const fmt = (idfRaw as Record<string, unknown>).format;
  return typeof fmt === 'string' && fmt.trim().length > 0 ? fmt.trim() : null;
}

/**
 * Inputs for {@link classifyDataTypes}. `endpoints` are the AMS endpoint rows
 * (each carrying a `request_contract` blob -> code evidence via
 * `readRequestContractFacts`, C3). `oasOperations` are the session's contract-
 * derived OAS operations (the `oas_operation_json` payloads -> contract
 * evidence). Either may be empty.
 */
export interface ClassifyInput {
  endpoints: ReadonlyArray<Record<string, unknown>>;
  oasOperations: ReadonlyArray<unknown>;
}

/**
 * Classify all discovered fields into taxonomy rows and seed each row's Col-4.
 *
 * Returns ONE row per DISCOVERED category (F3) -- a category with no
 * contributing field is never emitted, so the no-data-types case yields `[]`.
 * Within a row:
 *   - `codeFormats` / `contractFormats` are the DISTINCT format variations seen.
 *   - `defaultFormat` is the chain-(a) seed: code > contract > standard guess.
 *   - `contributingFields` lists every field that fed the row (Q9 transparency).
 *
 * PURE + TOTAL: no I/O, never throws.
 */
export function classifyDataTypes(input: ClassifyInput): DataTypeRow[] {
  const acc = new Map<DataTypeCategory, RowAccumulator>();

  const ensure = (cat: DataTypeCategory): RowAccumulator => {
    let a = acc.get(cat);
    if (!a) {
      a = newAccumulator();
      acc.set(cat, a);
    }
    return a;
  };

  // ---- Code evidence (signal 1; chain-(a) position 1) ----------------------
  // TYPE-ONLY entries (2026-06-22): a Spring-Classic `source: 'java-type'` entry
  // carries a `javaType` and NO concrete `format`/`pattern`, so `codeFormatLabel`
  // returns null. For a type-only DATE/DATETIME entry we apply the ONE project-
  // wide `inferred_date_format` (read off the same contract): Col-2 DISPLAYS the
  // global format when present (else the bare TYPE TOKEN, display-only), while the
  // Col-4 SEED uses ONLY the CONCRETE global format -- a bare type token NEVER
  // seeds (it falls through `seedColumnFour` to the per-category standard guess).
  // This mirrors the contract-side seed/display split. Non-date categories
  // (numeric_id/decimal/boolean/uuid/enum) classify purely from the type and are
  // UNAFFECTED by `inferred_date_format`.
  for (const endpoint of input.endpoints ?? []) {
    if (!endpoint || typeof endpoint !== 'object') continue;
    const facts = readRequestContractFacts(endpoint);
    if (!facts) continue;
    const globalDateFormat = readInferredDateFormat(endpoint);
    for (const pf of facts.paramFormats) {
      const cat = classifyField(evidenceFromCode(pf));
      if (!cat || !CLASSIFIABLE_CATEGORIES.has(cat)) continue;
      const a = ensure(cat);
      // The concrete code-format label (pattern ?? format); null for type-only.
      const label = codeFormatLabel(pf);
      // Type-only date/datetime: DISPLAY the global format when present, else the
      // bare type token. The SEED only ever takes the concrete global format.
      const isTypeOnlyTemporal = !label && (cat === 'date' || cat === 'datetime');
      const displayLabel = label ?? (isTypeOnlyTemporal ? globalDateFormat ?? pf.javaType : null);
      const seedLabel = label ?? (isTypeOnlyTemporal ? globalDateFormat : null);
      pushDistinct(a.codeFormats, displayLabel);
      if (seedLabel && !a.seedFromCode) a.seedFromCode = seedLabel;
      a.contributingFields.push({
        name: pf.name,
        location: pf.location,
        codeFormat: displayLabel,
        contractFormat: null,
      });
    }
  }

  // ---- Contract evidence (signals 2-4; chain-(a) position 2) ---------------
  // SEED/DISPLAY SPLIT: the Col-3 DISPLAY label falls back format > pattern >
  // enum > type so a typed-but-format-less field (e.g. an integer `customerId`,
  // or a date whose contract is merely `type:string`) still shows its declared
  // shape in the column instead of a bare em-dash. The Col-4 SEED, however, uses
  // ONLY a real format/pattern -- never the type fallback -- so a date field
  // whose contract is just `type:string` does NOT seed Col-4 with "string"; it
  // falls through to the per-category standard guess (e.g. `yyyy-MM-dd`).
  for (const oasOp of input.oasOperations ?? []) {
    for (const cf of extractContractFieldFormats(oasOp)) {
      const cat = classifyField(evidenceFromContract(cf));
      if (!cat || !CLASSIFIABLE_CATEGORIES.has(cat)) continue;
      const a = ensure(cat);
      const displayLabel = contractFormatLabel(cf); // format > pattern > enum > type
      pushDistinct(a.contractFormats, displayLabel);
      // Seed only off a CONCRETE format/pattern -- the type fallback is display-only.
      const seedLabel = cf.format ?? cf.pattern ?? null;
      if (seedLabel && seedLabel.trim().length > 0 && !a.seedFromContract) {
        a.seedFromContract = seedLabel.trim();
      }
      a.contributingFields.push({
        name: cf.name,
        location: cf.location,
        codeFormat: null,
        contractFormat: displayLabel,
      });
    }
  }

  // ---- Materialise rows + seed Col-4 (chain (a): code > contract > guess) ---
  const rows: DataTypeRow[] = [];
  for (const [category, a] of acc) {
    const defaultFormat = seedColumnFour(category, a);
    rows.push({
      category,
      codeFormats: a.codeFormats,
      contractFormats: a.contractFormats,
      defaultFormat,
      contributingFields: a.contributingFields,
    });
  }

  // Stable ordering for a deterministic preview (taxonomy declaration order).
  const order: DataTypeCategory[] = [
    'date',
    'datetime',
    'time',
    'numeric_id',
    'string_id',
    'decimal',
    'boolean',
    'enum',
    'uuid',
    'string',
  ];
  rows.sort((x, y) => order.indexOf(x.category) - order.indexOf(y.category));
  return rows;
}

/**
 * Compute the seeded Col-4 default for ONE category -- chain (a) (F4a):
 * `code(field) > contract(field) > standard/LLM guess`.
 *
 * Exported so a focused test can exercise the seed precedence in isolation.
 */
export function seedColumnFour(category: DataTypeCategory, a: RowAccumulator): string | null {
  if (a.seedFromCode) return a.seedFromCode; // position 1: code wins
  if (a.seedFromContract) return a.seedFromContract; // position 2: contract
  return STANDARD_FORMAT_GUESS[category] ?? null; // position 3: standard guess
}

/** Re-exported for callers/tests that want the standards map. */
export { STANDARD_FORMAT_GUESS };
