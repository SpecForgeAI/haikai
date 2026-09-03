/**
 * Response-semantics classifier (Spec: 2026-06-23 Semantics-aware API Behaviour
 * Baseline coverage, Task Group 1).
 *
 * PURE module. No I/O, no imports from `captureSessionOrchestrator.ts` or any
 * other service -- the orchestrator imports THIS, never the reverse. All new
 * behavioural logic lives here so the big-file edits in later task groups stay
 * thin call-site rewires.
 *
 * The point of the wider spec is to stop discarding a legacy API's real,
 * non-REST-conventional responses (200-for-missing, 500-for-bad-input,
 * 200-for-no-auth). This module answers the narrow, body-aware question: given
 * an observed HTTP status + response body (+ an optional per-API config), what
 * did the API actually DO -- and is that a usable oracle or a crash?
 */

// ===========================================================================
// Default marker vocabularies (EDITABLE, EXPORTED).
//
// Matched CASE-INSENSITIVELY against the STRINGIFIED response body. Each entry
// is a fragment of a regular expression (combined into one alternation at match
// time), so character classes / optional separators like `not[_ ]?found` work.
//
// Exported as the single source of truth so the frontend config step and the
// tests reference the SAME defaults the classifier uses.
// ===========================================================================

/**
 * Body markers that indicate the API is reporting a MISSING resource (even on a
 * 2xx). Case-insensitive regex fragments.
 */
export const DEFAULT_NOT_FOUND_MARKERS: readonly string[] = [
  'not[_ ]?found',
  'no[_ ]?data',
  'does not exist',
  'no records',
];

/**
 * Body markers that indicate the API is reporting a CLIENT / BAD-REQUEST error
 * (bad input, failed validation, a parse/deserialize failure) -- including when
 * the API wraps that in a 5xx. Case-insensitive regex fragments.
 *
 * Named for the bad-request / client-error MARKER SET; the corresponding
 * classifier BUCKET is `client_error` (see `BehaviourBucket`).
 */
export const DEFAULT_BAD_REQUEST_MARKERS: readonly string[] = [
  'invalid',
  'validation',
  'parse',
  'deseriali[sz]e',
  'malformed',
  'bad request',
  'required',
  // 2026-09-03: estate vocabulary for bad-input failures (often wrapped in a 5xx).
  'ILLEGAL_PARAM',
  'FATAL',
  'is not a valid',
  'must be specified',
];

// ===========================================================================
// Buckets + the "(use built-in defaults)" sentinel.
// ===========================================================================

/**
 * The semantic bucket a response is classified into. Deliberately uses
 * `client_error` (NOT `bad_request`) so it aligns with the orchestrator's
 * `ScenarioExpectedStatus`, which Task Group 3 extends with `'auth'`. The
 * bad-request MARKER vocabulary above still keeps its descriptive name; only the
 * bucket LABEL is `client_error`.
 */
export type BehaviourBucket = 'success' | 'not_found' | 'client_error' | 'auth';

/**
 * Explicit sentinel meaning "this API explicitly uses the built-in defaults".
 *
 * Backend + frontend must agree on the difference between:
 *   - UNTOUCHED  -- the config (or a field of it) is absent / `undefined`, which
 *                   the resolver treats as "fall back to built-in defaults"; and
 *   - EXPLICITLY DEFAULT -- the operator opened the config and chose the
 *                   built-in defaults on purpose, recorded as this sentinel.
 *
 * Both resolve to the SAME effective vocabulary; the sentinel exists so the UI
 * can show "(use built-in defaults)" as a deliberate, round-trippable choice
 * distinct from an untouched row.
 */
export const USE_BUILT_IN_DEFAULTS = '(use built-in defaults)' as const;

export type UseBuiltInDefaults = typeof USE_BUILT_IN_DEFAULTS;

/**
 * How a per-API marker override is applied to a default vocabulary:
 *   - `extend`  -- the listed markers are ADDED to the built-in defaults;
 *   - `replace` -- the listed markers REPLACE the built-in defaults entirely.
 * Absent => the built-in defaults are used unchanged.
 */
export interface MarkerOverride {
  mode: 'extend' | 'replace';
  markers: readonly string[];
}

/**
 * Per-API semantics config. EVERY field is optional: a wholly-absent config (or
 * an absent field) === "use built-in defaults" (the valid empty state). The
 * resolver merges a partial config over the built-in defaults.
 */
export interface ResponseSemanticsConfig {
  /**
   * Explicit per-API status->bucket mapping override. Keys are HTTP status
   * codes (e.g. `404`, `200`); values are the bucket to force, or the
   * `USE_BUILT_IN_DEFAULTS` sentinel to mean "leave this status to the built-in
   * markers + status-class default". This mapping has the HIGHEST precedence.
   */
  statusBucketOverride?: Readonly<Record<number, BehaviourBucket | UseBuiltInDefaults>>;
  /** Override / extend the not_found marker vocabulary; absent => defaults. */
  notFoundMarkers?: MarkerOverride | UseBuiltInDefaults;
  /** Override / extend the bad-request marker vocabulary; absent => defaults. */
  badRequestMarkers?: MarkerOverride | UseBuiltInDefaults;
  /**
   * "This API returns 5xx for bad input." When true, an otherwise-unrecognized
   * 5xx is treated as a deliberate client-error (a usable oracle) rather than a
   * crash. Absent / false => crash is the SAFE DEFAULT.
   */
  fiveXxIsBadInput?: boolean;
}

/**
 * The fully-resolved effective config the classifier actually runs against:
 * concrete marker lists, an optional status->bucket map (sentinel entries
 * stripped), and the resolved boolean flag. Produced by `resolveConfig`.
 */
export interface ResolvedSemanticsConfig {
  notFoundMarkers: readonly string[];
  badRequestMarkers: readonly string[];
  statusBucketOverride: Readonly<Record<number, BehaviourBucket>>;
  fiveXxIsBadInput: boolean;
}

/**
 * The classifier result.
 *   - `bucket`      -- the semantic bucket the RESPONSE falls into.
 *   - `observed`    -- true when the response is a real captured behaviour (NOT
 *                      a crash / transport failure); i.e. a usable oracle.
 *   - `observation` -- a NON-SCORING human-readable deviation note when the API
 *                      departs from REST convention (e.g. "returns 200 for a
 *                      missing resource"); null when it behaves conventionally.
 *   - `anomaly`     -- a human-readable note when the behaviour is NOT a usable
 *                      oracle (e.g. an unrecognized 5xx crash, transport
 *                      failure); null otherwise.
 */
export interface ObservedBehaviour {
  bucket: BehaviourBucket;
  observed: boolean;
  observation: string | null;
  anomaly: string | null;
}

// ===========================================================================
// Config resolution.
// ===========================================================================

function isUseBuiltInDefaults(value: unknown): value is UseBuiltInDefaults {
  return value === USE_BUILT_IN_DEFAULTS;
}

/**
 * Resolve one marker override against a default list. Absent / sentinel =>
 * defaults unchanged; `extend` => defaults + override; `replace` => override.
 */
function resolveMarkers(
  override: MarkerOverride | UseBuiltInDefaults | undefined,
  defaults: readonly string[],
): readonly string[] {
  if (override === undefined || isUseBuiltInDefaults(override)) {
    return defaults;
  }
  if (override.mode === 'replace') {
    return [...override.markers];
  }
  return [...defaults, ...override.markers];
}

/**
 * Merge a (possibly absent / partial) per-API config over the built-in
 * defaults. ABSENT config === built-in defaults (the valid empty state). The
 * `USE_BUILT_IN_DEFAULTS` sentinel is honoured per-field and per status-code
 * entry, resolving to the same effective values as "untouched".
 *
 * PURE. Exported for unit testing + so the plumbing task can resolve once and
 * reuse.
 */
export function resolveConfig(config?: ResponseSemanticsConfig | null): ResolvedSemanticsConfig {
  const cfg = config ?? {};
  const statusBucketOverride: Record<number, BehaviourBucket> = {};
  if (cfg.statusBucketOverride) {
    for (const [key, value] of Object.entries(cfg.statusBucketOverride)) {
      // A sentinel entry means "leave this status to markers + status class",
      // so it is simply NOT added to the resolved map.
      if (isUseBuiltInDefaults(value)) continue;
      const code = Number(key);
      if (Number.isFinite(code)) statusBucketOverride[code] = value;
    }
  }
  return {
    notFoundMarkers: resolveMarkers(cfg.notFoundMarkers, DEFAULT_NOT_FOUND_MARKERS),
    badRequestMarkers: resolveMarkers(cfg.badRequestMarkers, DEFAULT_BAD_REQUEST_MARKERS),
    statusBucketOverride,
    fiveXxIsBadInput: cfg.fiveXxIsBadInput === true,
  };
}

// ===========================================================================
// Body stringification + marker matching.
// ===========================================================================

/**
 * Defensively stringify an arbitrary response body for marker matching. Objects
 * / arrays are JSON-serialized; `null` / `undefined` become the empty string;
 * primitives are coerced to string. A circular / non-serializable object falls
 * back to `String(body)` so matching never throws.
 */
function stringifyBody(body: unknown): string {
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'number' || typeof body === 'boolean') return String(body);
  try {
    return JSON.stringify(body) ?? '';
  } catch {
    return String(body);
  }
}

/**
 * True when the body has NO meaningful content: empty string / whitespace, or a
 * structurally-empty array `[]` / object `{}` / explicit `null`. Used for the
 * "2xx with empty body => not_found" rule.
 */
function isEmptyBody(body: unknown): boolean {
  if (body === null || body === undefined) return true;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed === '' || trimmed === 'null') return true;
    if (trimmed === '[]' || trimmed === '{}') return true;
    return false;
  }
  if (Array.isArray(body)) return body.length === 0;
  if (typeof body === 'object') return Object.keys(body as object).length === 0;
  return false;
}

/** Case-insensitive test: does the stringified body match ANY of the markers? */
function matchesAnyMarker(text: string, markers: readonly string[]): boolean {
  if (text === '' || markers.length === 0) return false;
  for (const marker of markers) {
    let re: RegExp;
    try {
      re = new RegExp(marker, 'i');
    } catch {
      // A malformed custom marker is treated as a literal, case-insensitive.
      re = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    if (re.test(text)) return true;
  }
  return false;
}

// ===========================================================================
// Status-class helpers.
// ===========================================================================

const is2xx = (s: number | null): boolean => s !== null && s >= 200 && s < 300;
const is4xx = (s: number | null): boolean => s !== null && s >= 400 && s < 500;
const is404 = (s: number | null): boolean => s === 404;
const is5xx = (s: number | null): boolean => s !== null && s >= 500 && s < 600;
const isAuthStatus = (s: number | null): boolean => s === 401 || s === 403;

// ===========================================================================
// The pure classifier.
// ===========================================================================

/**
 * Classify an OBSERVED response (status + body) into a semantic bucket and say
 * whether it is a usable oracle, plus any non-scoring observation / anomaly.
 *
 * This function is PURELY about the RESPONSE. It does NOT take scenario intent:
 * deciding "no auth enforced" (a 2xx where auth was expected) is the
 * orchestrator's job, comparing intent vs this observed bucket. Here a 2xx is a
 * 2xx -- we only flag REST-convention deviations that are visible from the
 * response alone (e.g. a 200 carrying a not_found marker, an unrecognized 5xx).
 *
 * Precedence:
 *   1. explicit per-API status->bucket mapping (highest);
 *   2. body markers (not_found / bad-request vocabularies);
 *   3. HTTP status-class default
 *        - 2xx -> success, unless the body is empty/null/[]/{} or carries a
 *          not_found marker -> not_found;
 *        - 401/403 -> auth;
 *        - 404 -> not_found; other 4xx -> client_error;
 *        - 5xx / transport failure -> see the 5xx rule below.
 *
 * 5xx / transport failure (status null): a usable oracle (`observed:true`,
 * bucket `client_error`, NO anomaly) ONLY when the body matches the bad-request
 * vocabulary OR `config.fiveXxIsBadInput` is set. OTHERWISE `observed:false`
 * with the crash anomaly -- CRASH IS THE SAFE DEFAULT.
 *
 * PURE: inputs in, result out. No I/O. Never throws on odd bodies.
 */
export function classifyObservedBehaviour(
  status: number | null,
  body: unknown,
  config?: ResponseSemanticsConfig | null,
): ObservedBehaviour {
  const resolved = resolveConfig(config);
  const text = stringifyBody(body);
  const hasNotFoundMarker = matchesAnyMarker(text, resolved.notFoundMarkers);
  const hasBadRequestMarker = matchesAnyMarker(text, resolved.badRequestMarkers);

  // ---- Precedence 1: explicit status->bucket override (highest). ----
  if (status !== null && Object.prototype.hasOwnProperty.call(resolved.statusBucketOverride, status)) {
    const forced = resolved.statusBucketOverride[status];
    const observation =
      is2xx(status) && forced === 'not_found'
        ? 'returns 200 for a missing resource'
        : null;
    return { bucket: forced, observed: true, observation, anomaly: null };
  }

  // ---- 5xx / transport failure: crash is the SAFE DEFAULT. ----
  if (status === null || is5xx(status)) {
    if (hasBadRequestMarker || resolved.fiveXxIsBadInput) {
      // A deliberate validation-reject expressed as a 5xx -- a usable oracle.
      return {
        bucket: 'client_error',
        observed: true,
        observation: status === null ? null : 'returns 500 for bad input',
        anomaly: null,
      };
    }
    // Unrecognized 5xx / no response: NOT a usable oracle.
    return {
      bucket: 'client_error',
      observed: false,
      observation: null,
      anomaly:
        status === null
          ? 'transport failure / no response'
          : `${status} with no recognizable validation body — possible crash`,
    };
  }

  // ---- Precedence 2: body markers. ----
  if (hasNotFoundMarker) {
    const observation = is2xx(status) ? 'returns 200 for a missing resource' : null;
    return { bucket: 'not_found', observed: true, observation, anomaly: null };
  }
  if (hasBadRequestMarker && is2xx(status)) {
    // A 2xx body that nonetheless reports a client error is a deviation.
    return {
      bucket: 'client_error',
      observed: true,
      observation: 'returns 200 for a bad request',
      anomaly: null,
    };
  }

  // ---- Precedence 3: HTTP status-class default. ----
  if (isAuthStatus(status)) {
    return { bucket: 'auth', observed: true, observation: null, anomaly: null };
  }
  if (is404(status)) {
    // 404 is the conventional not_found status, even with an error-shaped body.
    return { bucket: 'not_found', observed: true, observation: null, anomaly: null };
  }
  if (is4xx(status)) {
    return { bucket: 'client_error', observed: true, observation: null, anomaly: null };
  }
  if (is2xx(status)) {
    if (isEmptyBody(body)) {
      // A 2xx with an empty/null/[]/{} body reads as "nothing there".
      return {
        bucket: 'not_found',
        observed: true,
        observation: 'returns 200 with an empty body for a missing resource',
        anomaly: null,
      };
    }
    return { bucket: 'success', observed: true, observation: null, anomaly: null };
  }

  // Any other status (1xx / 3xx / unexpected): observed, but not conventionally
  // bucketable -- treat as client_error with an honest observation so it is
  // still captured rather than dropped.
  return {
    bucket: 'client_error',
    observed: true,
    observation: status === null ? null : `returns an unexpected ${status} status`,
    anomaly: null,
  };
}
