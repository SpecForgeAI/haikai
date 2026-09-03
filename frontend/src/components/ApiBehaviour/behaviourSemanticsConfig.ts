/**
 * behaviourSemanticsConfig
 *
 * Spec: 2026-06-23 Semantics-aware API Behaviour Baseline coverage -- Task
 * Group 5 (frontend config step + tests).
 *
 * HAND-MIRROR of the config TYPE + default marker vocabulary that lives in the
 * validation service at
 *   `api-migration-validation-service/src/services/responseSemantics.ts`.
 *
 * The frontend MUST NOT import from amvs (separate package, no cross-import), so
 * this file is the SINGLE frontend source of truth for the
 * `BehaviourSemanticsConfigStep` config step and its tests. When the amvs source
 * changes shape, update this mirror to match -- the wire field
 * (`behaviour_semantics_config_json`) is what actually couples the two layers,
 * and that is snake_case-tolerant on the amvs side because every field is
 * optional (absent / empty === built-in defaults).
 *
 * Only the small subset the config step needs is mirrored here: the config
 * shape, the bucket union, the "(use built-in defaults)" sentinel, and the two
 * default marker arrays (copied VERBATIM from responseSemantics.ts so the step's
 * visible defaults are exactly the ones the classifier ships).
 */

// ===========================================================================
// Default marker vocabularies -- copied VERBATIM from
// responseSemantics.ts (DEFAULT_NOT_FOUND_MARKERS / DEFAULT_BAD_REQUEST_MARKERS).
//
// Matched case-insensitively against the stringified response body amvs-side;
// here they are only the VISIBLE seed defaults the operator can edit. Each entry
// is a regex fragment (e.g. `not[_ ]?found`).
// ===========================================================================

/**
 * Body markers indicating a MISSING resource (even on a 2xx). Mirror of
 * `DEFAULT_NOT_FOUND_MARKERS` in responseSemantics.ts.
 */
export const DEFAULT_NOT_FOUND_MARKERS: readonly string[] = [
  'not[_ ]?found',
  'no[_ ]?data',
  'does not exist',
  'no records',
];

/**
 * Body markers indicating a CLIENT / BAD-REQUEST error (bad input, failed
 * validation, parse/deserialize failure) -- including when wrapped in a 5xx.
 * Mirror of `DEFAULT_BAD_REQUEST_MARKERS` in responseSemantics.ts.
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
 * The semantic bucket a response is classified into. Mirror of
 * `BehaviourBucket` in responseSemantics.ts -- uses `client_error` (not
 * `bad_request`) so it aligns with the orchestrator's `ScenarioExpectedStatus`.
 */
export type BehaviourBucket = 'success' | 'not_found' | 'client_error' | 'auth';

/**
 * Explicit sentinel meaning "this API explicitly uses the built-in defaults".
 *
 * Distinguishes:
 *   - UNTOUCHED -- the config (or a field) is absent / `undefined`, treated as
 *     "fall back to built-in defaults"; and
 *   - EXPLICITLY DEFAULT -- the operator opened the config and CHOSE the
 *     built-in defaults on purpose, recorded as this sentinel.
 *
 * Both resolve to the SAME effective vocabulary amvs-side; the sentinel exists
 * so the UI can offer "(use built-in defaults)" as a deliberate, round-trippable
 * choice distinct from an untouched config. Mirror of `USE_BUILT_IN_DEFAULTS`.
 */
export const USE_BUILT_IN_DEFAULTS = '(use built-in defaults)' as const;

export type UseBuiltInDefaults = typeof USE_BUILT_IN_DEFAULTS;

/**
 * How a per-API marker override is applied to a default vocabulary:
 *   - `extend`  -- the listed markers are ADDED to the built-in defaults;
 *   - `replace` -- the listed markers REPLACE the built-in defaults entirely.
 * Mirror of `MarkerOverride` in responseSemantics.ts.
 */
export interface MarkerOverride {
  mode: 'extend' | 'replace';
  markers: readonly string[];
}

/**
 * Per-API semantics config. EVERY field is optional: a wholly-absent config (or
 * an absent field) === "use built-in defaults" (the valid empty state). Mirror
 * of `ResponseSemanticsConfig` in responseSemantics.ts.
 */
export interface ResponseSemanticsConfig {
  /**
   * Explicit per-API status->bucket mapping override. Keys are HTTP status
   * codes; values are the bucket to force, or the `USE_BUILT_IN_DEFAULTS`
   * sentinel ("leave this status to the built-in markers + status-class
   * default"). Highest precedence amvs-side.
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
