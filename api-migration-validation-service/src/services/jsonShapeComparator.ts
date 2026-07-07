/**
 * Deterministic JSON shape comparator for the diff engine.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *   Task Group 3 layers OPTIONAL per-path volatility tolerance on top of the
 *   strict comparison. See the "Volatility tolerance" section below. When NO
 *   volatility context is passed (the default), the comparator behaves
 *   EXACTLY as the original strict v1 for the BODY/VALUE dimensions -- the
 *   backward-compat guard (G1).
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types --
 *   Task Group 2 stops DISCARDING the `{ headers, body }` wrapper's `headers`
 *   key and instead DIFFS response headers (presence + value, with a narrow
 *   volatile-header allowlist), and promotes a NON-volatile array reorder to
 *   its own `body_ordering_drift` dimension. See the "Header comparison" and
 *   "Ordering drift" sections below.
 *
 * Compares two JSON trees (a source response body and a target response body)
 * and classifies the result into one of these top-level buckets:
 *
 *   - `body_match`          -- deep equality after the symmetric wrapper unwrap
 *   - `body_shape_drift`    -- one or more keys added / removed OR a leaf type
 *                              change at one or more JSON-pointer paths
 *   - `body_value_drift`    -- same shape (key sets + types) but at least one
 *                              leaf value differs
 *   - `body_ordering_drift` -- the ONLY drift is a NON-volatile array reorder
 *                              (same elements, different order). Spec 2026-06-17.
 *
 * Shape wins over value wins over ordering: if any key/type drift exists, the
 * top-level classification is `body_shape_drift`; `body_value_drift` is
 * reserved for the exact-shape-with-different-leaves case; `body_ordering_drift`
 * is the weakest -- reported ONLY when nothing stronger drifted.
 *
 * ---------------------------------------------------------------------------
 * CRITICAL -- Step 1 wrapper-unwrap normalisation
 * ---------------------------------------------------------------------------
 *
 * Source baseline items store `response_json` as the RAW response body, e.g.
 * `{ user: { id: 1 } }`. Target baseline items store `response_json` as a
 * `{ headers, body }` wrapper, with the actual body nested under `.body`
 * (per `targetReplayRunner.ts` which writes `{ headers: ..., body: ... }`).
 *
 * Without normalisation EVERY paired item would be flagged `body_shape_drift`
 * because the target side has an extra `headers` key and an indirection
 * through `body`. The fix: BEFORE any walk, both sides are passed through
 * `unwrapBodyEnvelope`. The unwrap fires ONLY when the JSON is an object
 * whose keys are EXACTLY `headers` + `body` (and nothing else). Any other
 * shape -- including a legitimate body that happens to contain
 * `{ headers, body, metadata }` -- is left verbatim.
 *
 * Apply symmetrically to both inputs so a future change that makes the
 * source side also wrap won't break the comparator.
 *
 * Covered by the dedicated unit test
 * `jsonShapeComparator.wrapperUnwrap.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Header comparison (Spec 2026-06-17, Task Group 2) -- the headers key is now
 *   CAPTURED, not discarded
 * ---------------------------------------------------------------------------
 *
 * Before any body walk, the comparator reads the PRE-unwrap `headers` key from
 * BOTH sides (the `{ headers, body }` wrapper written by
 * `targetReplayRunner.ts` on the target side, and -- once the frontend's
 * SaveAsBaselineModal change lands -- the source side). It compares them:
 *
 *   - a header that appears / disappears -> `header_presence_drift` (ALWAYS
 *     breaks; presence is NEVER tolerated, even for an allowlisted name);
 *   - a header VALUE change -> `header_value_drift`. Allowlisted header names
 *     ({@link VOLATILE_HEADER_NAMES}) are tolerated (tagged `declared`); every
 *     other name (incl. `Content-Type`) breaks.
 *
 * GRACEFUL DEGRADE: when EITHER side lacks the `{ headers, body }` wrapper
 * (pre-existing source baselines store the raw body, no headers), the header
 * dimension is SKIPPED ENTIRELY -- `headerClassification` stays `null` and NO
 * header entry is emitted (no false break, no backfill). Spec R5.
 *
 * ---------------------------------------------------------------------------
 * Ordering drift (Spec 2026-06-17, Task Group 2)
 * ---------------------------------------------------------------------------
 *
 * A NON-volatile array whose elements are a reordered multiset of the same
 * values (i.e. `multisetEqual` but not `arraysStrictlyEqual`) is recorded as a
 * single `ordering` marker on the array path INSTEAD of the per-element
 * `value_changed` cascade the strict positional walk would otherwise produce.
 * A volatile-flagged array stays order-INsensitive as today (a pure reorder is
 * fully tolerated). Ordering is the weakest classification: a reorder that
 * co-occurs with a real shape / value drift classifies as that stronger
 * dimension; ordering only "wins" when it is the sole drift.
 *
 * ---------------------------------------------------------------------------
 * Volatility tolerance (Spec 2026-06-16, Task Group 3) -- OPTIONAL
 * ---------------------------------------------------------------------------
 *
 * When a {@link VolatilityContext} is supplied, the walk consults the
 * operation's measured / declared / signalled volatile-path set BEFORE
 * classifying a diff entry:
 *
 *   - a VALUE difference on a volatile leaf path is NOT a `value_changed`
 *     entry (it is suppressed; the path legitimately varies);
 *   - an ARRAY flagged volatile is compared order-insensitively (multiset) --
 *     a pure reordering yields no entries;
 *   - SHAPE differences (key added / removed, type changed) on a volatile
 *     path are STILL reported -- volatility tolerates VALUES and ORDERING
 *     ONLY, never shape.
 *
 * Tolerance is PER-PATH: one volatile timestamp plus a genuine value
 * regression elsewhere still breaks on the regression (the no-override guard,
 * G3). Each suppressed-but-surfaced tolerance reason is recorded on the
 * entry's `volatilitySource` so the downstream gateway auto-disposition pass
 * (Group 4) can decide whether the whole break is `expected_volatile`,
 * down-ranked-to-`info`, or stays `open`. The comparator itself NEVER drops a
 * break -- it only annotates value/order/header entries it has reclassified.
 *
 * ---------------------------------------------------------------------------
 * Out of scope (deferred to v2 per accepted Q11 of the original Diff Engine
 * spec; RESOLVED by the 2026-06-16 + 2026-06-17 specs)
 * ---------------------------------------------------------------------------
 *
 *   - Response timing / latency diff (`duration_ms` stays captured but is not
 *     diffed -- inherently noisy, not a behavioural contract). Spec R7.
 *
 * Compares RESPONSE bodies + RESPONSE headers only. Request bodies are
 * identical-by-construction (Spec #4 replay carries them verbatim).
 */

export type BodyClassification =
  | 'body_match'
  | 'body_shape_drift'
  | 'body_value_drift'
  // The ONLY drift is a NON-volatile array reorder (same elements, different
  // order). Its own dimension -- not a `value_changed` cascade. Spec 2026-06-17.
  | 'body_ordering_drift';

/**
 * Per-dimension RESPONSE-HEADER classification, mirroring the body / status
 * classifications. `null` (absent) when the header dimension is SKIPPED
 * because a side lacked the `{ headers, body }` response wrapper (graceful
 * degrade -- old source baselines store the raw body, so there is no header
 * pair to compare). See {@link compareJsonShapes}.
 *
 *   - `header_match`          -- header sets + values equal (after allowlist)
 *   - `header_value_drift`    -- a header's VALUE changed (allowlisted names
 *                                are tolerated; everything else breaks)
 *   - `header_presence_drift` -- a header appeared / disappeared (ALWAYS
 *                                breaks, even for an allowlisted name)
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types.
 */
export type HeaderClassification =
  | 'header_match'
  | 'header_value_drift'
  | 'header_presence_drift';

export type LeafDiffKind =
  | 'key_added'
  | 'key_removed'
  | 'type_changed'
  | 'value_changed'
  // A NON-volatile array reorder, recorded as a SINGLE marker on the array
  // path (not a per-element value cascade). Classifies as `body_ordering_drift`
  // when it is the sole drift. Spec 2026-06-17, Task Group 2.
  | 'ordering';

/**
 * The taxonomy of WHY a path is treated as volatile. Mirrors the AMS
 * `volatility_source` envelope tag set verbatim. Recorded on a tolerated
 * diff entry (and on the envelope itself) so every allowance is auditable.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling.
 */
export type VolatilitySource =
  | 'probed'
  | 'probed_partial'
  | 'endpoint_signal'
  | 'heuristic'
  | 'declared'
  | 'non_json'
  | 'not_probed'
  // Spec 2026-07-06-j: tolerated by a durable AMS comparison waiver (the
  // waiver id enumeration lives on the diff run; the entry stays VISIBLE).
  | 'waived';

export interface BodyDiffEntry {
  /**
   * JSON pointer to the differing path, e.g. `/user/name`, `/items/0/id`.
   * Root differences use the empty pointer (`''`).
   */
  path: string;
  kind: LeafDiffKind;
  /**
   * Source value at the path. `undefined` when `kind='key_added'` (target
   * has a key the source lacks).
   */
  sourceValue?: unknown;
  /**
   * Target value at the path. `undefined` when `kind='key_removed'` (source
   * has a key the target lacks).
   */
  targetValue?: unknown;
  /**
   * Set ONLY when a VALUE / ORDERING difference on this path was tolerated
   * because the path is volatile. Carries WHY (the source tag) so the
   * gateway auto-disposition pass can act. Absent on strict (intolerant)
   * entries and on every SHAPE diff (shape always breaks).
   *
   * NOTE: a tolerated value diff is reclassified as `value_volatile` (a new,
   * non-strict kind) rather than `value_changed`, so the existing
   * shape-vs-value classifier never counts it as a real `body_value_drift`.
   * See {@link classify}.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * Task Group 3.
   */
  volatilitySource?: VolatilitySource;
}

/**
 * A single response-header divergence. Mirrors {@link BodyDiffEntry} but for
 * the header dimension. Emitted ONLY when both sides carried a `{ headers,
 * body }` wrapper (see the graceful-degrade rule). Reuses {@link buildPointer}
 * (a `/<header-name>` pointer) so the audit path set is normalised the same
 * way the body diff paths are.
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types.
 */
export interface HeaderDiffEntry {
  /** RFC-6901 pointer for the header name, e.g. `/content-type`. */
  path: string;
  /**
   * `presence` -- the header appeared / disappeared (ALWAYS breaks).
   * `value`    -- the header VALUE changed (tolerated only when the name is
   *               allowlisted, in which case `volatilitySource` is set).
   */
  kind: 'presence' | 'value';
  /** The original (un-normalised) header name as seen on one of the sides. */
  headerName: string;
  /** Source value at the path. `undefined` when the source lacked the header. */
  sourceValue?: unknown;
  /** Target value at the path. `undefined` when the target lacked the header. */
  targetValue?: unknown;
  /**
   * Set ONLY when a header VALUE change was TOLERATED because the header name
   * is on the volatile allowlist ({@link VOLATILE_HEADER_NAMES}). Always
   * `declared` for the allowlist. Absent on presence drift (never tolerated)
   * and on a non-allowlisted value change (strict).
   */
  volatilitySource?: VolatilitySource;
}

/**
 * The volatility envelope persisted on the source baseline item's
 * `volatile_paths_json` column. An OBJECT (despite the `_paths_` name).
 *
 * `null` / absent envelope => no volatility recorded => strict comparison
 * (today's behaviour; the backward-compat default).
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 1 (AMS wire contract) + Task Group 2 (probe write).
 */
export interface VolatilityEnvelope {
  /** Normalised JSON-Pointer strings that legitimately vary. */
  paths: string[];
  /** WHY -- the trust tag. */
  volatility_source: VolatilitySource;
  /** Completed-repeat count (`k`). For `probed_partial`, < the configured k. */
  k: number;
  /**
   * JSON-Pointer strings whose ARRAY at that path is order-insensitive
   * (a differing-order array surfaced across repeats). Subset of `paths`.
   * Optional for forward compat; absent => no arrays flagged.
   */
  array_paths?: string[];
}

export interface CompareJsonShapesResult {
  bodyClassification: BodyClassification;
  bodyDiffJson: BodyDiffEntry[];
  /**
   * Strict-profile byte verdict (Spec 2026-07-06-j): 'byte_match' |
   * 'byte_drift' | 'raw_unavailable'. ALWAYS null on the standard profile
   * (legacy callers unchanged).
   */
  byteClassification?: 'byte_match' | 'byte_drift' | 'raw_unavailable' | null;
  /**
   * Response-header classification, or `null` when the header dimension was
   * SKIPPED (either side lacked the `{ headers, body }` wrapper). When set,
   * one of {@link HeaderClassification}. The diff runner threads this into
   * the AMS diff_item's `header_classification` column.
   *
   * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types.
   */
  headerClassification: HeaderClassification | null;
  /**
   * The per-header divergences underpinning {@link headerClassification}.
   * Empty when the headers matched OR when the dimension was skipped. Carried
   * for audit + so the gateway / frontend can list the affected header names
   * (incl. which were tolerated as volatile).
   */
  headerDiffJson: HeaderDiffEntry[];
  /**
   * The DISTINCT set of `volatility_source` tags that touched a tolerated
   * value/order/header entry in this comparison, in first-seen order. Empty
   * when nothing was tolerated. The gateway auto-disposition pass reads this
   * (off the persisted diff json entries) to classify the break.
   *
   * Spec: 2026-06-16 -- Task Group 3 (metadata the gateway pass acts on);
   *   extended 2026-06-17 to include allowlisted header-value tolerance.
   */
  volatilitySourcesTouched: VolatilitySource[];
}

/**
 * Per-operation volatility context threaded into the comparator by the diff
 * runner. Built from the source baseline item's `volatile_paths_json`
 * envelope, the operation's `non_deterministic_endpoint` discovery signal,
 * and the conservative unprobed-path heuristic.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 3.
 */
export interface VolatilityContext {
  /**
   * The persisted envelope (or null). When the envelope's
   * `volatility_source` is `non_json` / `not_probed`, the `paths` set is
   * IGNORED for value tolerance -- those states are strict (the gateway pass
   * does no auto-disposition for them), but the envelope is still threaded so
   * the source tag is visible. `null` => strict.
   */
  envelope?: VolatilityEnvelope | null;
  /**
   * True when the operation carries a `non_deterministic_endpoint` discovery
   * finding. Treats the WHOLE response as VALUE-tolerant (presence / shape
   * still compared), even when the probe recorded nothing. Tags such
   * tolerated entries `endpoint_signal`.
   */
  endpointSignal?: boolean;
  /**
   * Enable the conservative pattern-heuristic fallback (ISO-8601 timestamp /
   * RFC-4122 UUID / epoch-millis in a time-named field) on UNPROBED paths.
   * Heuristic-tolerated entries are tagged `heuristic` (the gateway pass
   * NEVER auto-terminates on heuristic-only -- it only down-ranks). Defaults
   * off; the diff runner enables it whenever no full probe covered the path.
   */
  applyHeuristics?: boolean;
}

// ---------------------------------------------------------------------------
// Volatile-header allowlist (Spec 2026-06-17, Task Group 2 / R4)
// ---------------------------------------------------------------------------

/**
 * THE central, narrow, case-INSENSITIVE allowlist of response-header NAMES
 * whose VALUE changes are TOLERATED (tagged `declared`). It is the single
 * source of truth -- every consumer (the comparator here, the gateway
 * auto-disposition pass) keys off this exact set. Stored lower-cased; lookups
 * lower-case the candidate name.
 *
 * Tolerance applies to allowlisted header VALUE changes ONLY -- a header
 * appearing / disappearing (`presence`) ALWAYS breaks, even for an allowlisted
 * name. `Content-Type` is deliberately NOT here (a media-type flip is a real
 * behavioural divergence and must break); likewise `Cache-Control`,
 * `Location`, `Vary`, `Content-Encoding`, `Content-Disposition`,
 * `WWW-Authenticate`, `Allow` break on value change.
 *
 * Narrow + extensible: in-UI declaration of additional volatile header names
 * (mirroring the body-path `declareVolatilePaths` idiom) is an explicit FUTURE
 * follow-on, deliberately NOT built this iteration. Spec R3 / R4.
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types.
 */
export const VOLATILE_HEADER_NAMES: ReadonlySet<string> = new Set(
  [
    'Date',
    'Age',
    'Expires',
    'Last-Modified',
    'ETag',
    'Set-Cookie',
    'X-Request-Id',
    'X-Correlation-Id',
    'X-Trace-Id',
    'Request-Id',
    'Trace-Id',
    'X-Runtime',
    'X-Response-Time',
    'Server-Timing',
    'Keep-Alive',
    // `Content-Length` is body-derived; tolerating its value avoids
    // double-counting volatile-body noise as a separate header break.
    'Content-Length',
  ].map((h) => h.toLowerCase()),
);

/** Whether a header NAME is on the volatile allowlist (case-insensitive). */
export function isVolatileHeaderName(name: string): boolean {
  return VOLATILE_HEADER_NAMES.has(name.toLowerCase());
}

// ---------------------------------------------------------------------------
// Step 1 -- symmetric wrapper unwrap
// ---------------------------------------------------------------------------

/**
 * If `json` is an object whose keys are EXACTLY `headers` and `body` (and
 * nothing else), this is the `{ headers, body }` response wrapper. Otherwise
 * it is a raw body (no header pair available).
 */
function isResponseEnvelope(
  json: unknown,
): json is { headers: unknown; body: unknown } {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return false;
  }
  const obj = json as Record<string, unknown>;
  const keys = Object.keys(obj);
  return (
    keys.length === 2 &&
    Object.prototype.hasOwnProperty.call(obj, 'headers') &&
    Object.prototype.hasOwnProperty.call(obj, 'body')
  );
}

/**
 * If `json` is an object whose keys are EXACTLY `headers` and `body` (and
 * nothing else), return `json.body`. Otherwise return `json` unchanged.
 *
 * Applied symmetrically to both inputs before any walking. See the file
 * header for why this matters -- without it, every paired item would be
 * flagged `body_shape_drift`.
 *
 * NOTE: the comparator now also reads the `headers` key (see
 * {@link extractHeaders}); the body unwrap stays symmetric so body comparison
 * is unchanged once both sides wrap.
 */
export function unwrapBodyEnvelope(json: unknown): unknown {
  if (isResponseEnvelope(json)) {
    return json.body;
  }
  return json;
}

/**
 * Extract the response-header map from a `{ headers, body }` wrapper, or
 * `undefined` when `json` is NOT a wrapper (a raw body has no header pair).
 * `undefined` is the graceful-degrade signal -- the header dimension is
 * skipped entirely when EITHER side returns `undefined` here. A wrapper with
 * `headers: null` returns `{}` (an empty header map: the wrapper IS present,
 * it just carried no headers) so two present-but-empty header maps still
 * compare as `header_match` rather than skipping.
 *
 * Spec: 2026-06-17 Reconcile Full-Response Fidelity & Distinct Break Types.
 */
function extractHeaders(json: unknown): Record<string, unknown> | undefined {
  if (!isResponseEnvelope(json)) return undefined;
  const headers = json.headers;
  if (headers === null || headers === undefined) return {};
  if (typeof headers !== 'object' || Array.isArray(headers)) return {};
  return headers as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

function jsonTypeOf(
  v: unknown,
): 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'undefined' {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'object') return 'object';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  // Functions, symbols, bigints: shouldn't appear in JSON. Treat as
  // their typeof string so type comparison treats them as their own
  // class; we won't normally see them.
  return t as never;
}

/**
 * Escape a JSON pointer reference token per RFC 6901: `~` -> `~0`, `/` ->
 * `~1`. Required to make pointers unambiguous for keys containing slashes.
 */
function escapePointerToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Build an RFC-6901 JSON pointer child token under `parent`. THE path
 * normalisation primitive -- reused by the capture-time volatility probe
 * (`volatilityProbe.ts`) so the envelope path set and the diff-time path set
 * are byte-identical, and by the header walk (Spec 2026-06-17) so header
 * pointer keys are normalised the same way. Do NOT re-author path
 * normalisation; reuse this.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling.
 */
export function buildPointer(parent: string, key: string | number): string {
  const token =
    typeof key === 'number' ? String(key) : escapePointerToken(key);
  return `${parent}/${token}`;
}

// ---------------------------------------------------------------------------
// Volatility tolerance helpers (Spec 2026-06-16, Task Group 3)
// ---------------------------------------------------------------------------

/**
 * Resolve the volatility source that applies to a VALUE / ORDERING diff at
 * `pointer`, or `null` when the path is NOT value-tolerant (strict).
 *
 * Precedence (highest-trust first; the gateway pass treats them differently,
 * but for the comparator any non-null tag means "tolerate the value"):
 *   1. Envelope path hit (`probed` / `probed_partial` / `declared`) -- the
 *      measured / operator-declared set. `non_json` / `not_probed` envelopes
 *      do NOT contribute value tolerance (strict).
 *   2. `endpoint_signal` -- whole-response value tolerance when the operation
 *      carries the `non_deterministic_endpoint` discovery signal.
 *   3. `heuristic` -- conservative pattern match on an UNPROBED path.
 *
 * Shape diffs never reach this helper -- they are reported before tolerance
 * is consulted.
 */
function resolveValueTolerance(
  pointer: string,
  sourceValue: unknown,
  targetValue: unknown,
  ctx: VolatilityContext | undefined,
): VolatilitySource | null {
  if (!ctx) return null;

  const env = ctx.envelope ?? null;
  // `non_json` / `not_probed` are explicitly strict (no path tolerance).
  const envContributes =
    !!env &&
    env.volatility_source !== 'non_json' &&
    env.volatility_source !== 'not_probed';

  if (envContributes && env!.paths.includes(pointer)) {
    return env!.volatility_source;
  }

  if (ctx.endpointSignal) {
    return 'endpoint_signal';
  }

  if (ctx.applyHeuristics && looksVolatileByHeuristic(pointer, sourceValue, targetValue)) {
    return 'heuristic';
  }

  return null;
}

/**
 * Whether an ARRAY at `pointer` should be compared order-insensitively.
 * Driven by the envelope's `array_paths` (a probed array whose ORDER varied
 * across repeats) OR the whole-response `endpoint_signal`. `non_json` /
 * `not_probed` envelopes never flag arrays.
 */
function isArrayVolatile(
  pointer: string,
  ctx: VolatilityContext | undefined,
): VolatilitySource | null {
  if (!ctx) return null;
  const env = ctx.envelope ?? null;
  const envContributes =
    !!env &&
    env.volatility_source !== 'non_json' &&
    env.volatility_source !== 'not_probed';
  if (envContributes && env!.array_paths && env!.array_paths.includes(pointer)) {
    return env!.volatility_source;
  }
  if (ctx.endpointSignal) {
    return 'endpoint_signal';
  }
  return null;
}

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;
const RFC_4122_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
const TIME_NAMED_KEY_RE =
  /(?:^|[/_.-])(?:time|timestamp|date|datetime|epoch|millis|ms|at|created|updated|modified|expires?|expiry)(?:[/_.-]|$|[A-Z0-9])/i;

/**
 * The LAST pointer token (the leaf key) of an RFC-6901 pointer, un-escaped.
 * Used to test whether a field is "obviously time-named" for the epoch-millis
 * heuristic.
 */
function leafKeyOf(pointer: string): string {
  const idx = pointer.lastIndexOf('/');
  const token = idx >= 0 ? pointer.slice(idx + 1) : pointer;
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Conservative value-shape heuristic for an UNPROBED path. Deliberately
 * NARROW per the spec -- a guess must never silently absorb a real break, so
 * it only fires on:
 *   - ISO-8601 timestamps on BOTH sides;
 *   - RFC-4122 UUIDs on BOTH sides;
 *   - epoch-millis integers (>= ~year 2001 in ms) on BOTH sides AND the leaf
 *     key is obviously time-named.
 *
 * Requiring BOTH sides to match the pattern keeps a string→number regression
 * (which is a TYPE change / shape diff anyway) out of scope and prevents a
 * "1" → "broken" value masquerading as a tolerated timestamp.
 */
function looksVolatileByHeuristic(
  pointer: string,
  sourceValue: unknown,
  targetValue: unknown,
): boolean {
  if (typeof sourceValue === 'string' && typeof targetValue === 'string') {
    if (ISO_8601_RE.test(sourceValue) && ISO_8601_RE.test(targetValue)) {
      return true;
    }
    if (RFC_4122_UUID_RE.test(sourceValue) && RFC_4122_UUID_RE.test(targetValue)) {
      return true;
    }
    return false;
  }
  if (typeof sourceValue === 'number' && typeof targetValue === 'number') {
    const EPOCH_MILLIS_FLOOR = 1_000_000_000_000; // ~2001-09-09 in ms.
    if (
      Number.isInteger(sourceValue) &&
      Number.isInteger(targetValue) &&
      sourceValue >= EPOCH_MILLIS_FLOOR &&
      targetValue >= EPOCH_MILLIS_FLOOR &&
      TIME_NAMED_KEY_RE.test(leafKeyOf(pointer))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Stable canonical string for a JSON value, used to build the multiset key
 * for order-insensitive array comparison. Object keys are sorted so two
 * key-equal objects with different declaration order hash identically.
 */
function canonicalKey(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    return `[${v.map(canonicalKey).join(',')}]`;
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalKey(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Multiset (order-insensitive) equality for two arrays. Returns true when the
 * two arrays contain the same elements with the same multiplicities,
 * regardless of order. Used for volatile-flagged arrays AND for detecting a
 * NON-volatile pure reorder (the `body_ordering_drift` dimension).
 */
function multisetEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const el of a) {
    const k = canonicalKey(el);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const el of b) {
    const k = canonicalKey(el);
    const c = counts.get(k);
    if (c === undefined || c === 0) return false;
    counts.set(k, c - 1);
  }
  for (const c of counts.values()) {
    if (c !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Walk
// ---------------------------------------------------------------------------

/**
 * Recursive parallel walk. Mutates `diffs` in place.
 *
 * Behaviour by node-pair type:
 *   - Both objects     -> walk key union; classify per-key as
 *                         key_added / key_removed / recurse
 *   - Both arrays      -> volatile-flagged: multiset compare (order tolerated);
 *                         NON-volatile reorder (same multiset, different order):
 *                         a single `ordering` marker instead of a per-element
 *                         value cascade; otherwise walk by position; missing
 *                         positions are key_added / key_removed
 *   - Same primitive   -> equality check -> match / value_changed / tolerated
 *   - Differing types  -> type_changed (ALWAYS reported -- shape)
 *   - One null/other   -> type_changed (ALWAYS reported -- shape)
 *
 * When `ctx` is supplied, value / ordering diffs on volatile paths are
 * reclassified (suppressed-as-value-volatile) rather than reported as
 * `value_changed`. SHAPE diffs (add / remove / type) are reported regardless.
 */
function walk(
  source: unknown,
  target: unknown,
  pointer: string,
  diffs: BodyDiffEntry[],
  ctx: VolatilityContext | undefined,
): void {
  const sType = jsonTypeOf(source);
  const tType = jsonTypeOf(target);

  if (sType !== tType) {
    // TYPE change -- a SHAPE diff. ALWAYS reported, never tolerated.
    diffs.push({
      path: pointer,
      kind: 'type_changed',
      sourceValue: source,
      targetValue: target,
    });
    return;
  }

  if (sType === 'object') {
    const sObj = source as Record<string, unknown>;
    const tObj = target as Record<string, unknown>;
    const sKeys = Object.keys(sObj);
    const tKeys = Object.keys(tObj);
    // Walk a stable union order: source keys first (in their declaration
    // order), then any target-only keys.
    const seen = new Set<string>();
    for (const k of sKeys) {
      seen.add(k);
      const childPointer = buildPointer(pointer, k);
      if (!Object.prototype.hasOwnProperty.call(tObj, k)) {
        // key_removed -- SHAPE diff, always reported.
        diffs.push({
          path: childPointer,
          kind: 'key_removed',
          sourceValue: sObj[k],
        });
        continue;
      }
      walk(sObj[k], tObj[k], childPointer, diffs, ctx);
    }
    for (const k of tKeys) {
      if (seen.has(k)) continue;
      const childPointer = buildPointer(pointer, k);
      // key_added -- SHAPE diff, always reported.
      diffs.push({
        path: childPointer,
        kind: 'key_added',
        targetValue: tObj[k],
      });
    }
    return;
  }

  if (sType === 'array') {
    const sArr = source as unknown[];
    const tArr = target as unknown[];

    // Volatile-flagged array: order-insensitive multiset compare. A pure
    // reordering yields NO entries. A genuine content / length change still
    // surfaces -- we fall through to the positional walk so the real
    // difference is reported (NOT tolerated). We only swallow the case where
    // the two arrays are multiset-equal (same elements, different order).
    const arrayTolerance = isArrayVolatile(pointer, ctx);
    if (arrayTolerance) {
      if (multisetEqual(sArr, tArr)) {
        // Same elements, possibly reordered -> tolerated. Record a single
        // value-volatile marker on the array path so the gateway pass can see
        // the ordering allowance; emit NO per-element entries.
        if (sArr.length > 0 && !arraysStrictlyEqual(sArr, tArr)) {
          diffs.push({
            path: pointer,
            kind: 'value_changed',
            sourceValue: source,
            targetValue: target,
            volatilitySource: arrayTolerance,
          });
        }
        return;
      }
      // Not multiset-equal -> a real difference. Fall through to positional
      // walk WITHOUT array tolerance for the element diffs (the per-element
      // value tolerance still applies via leaf-level checks below).
    } else if (
      // NON-volatile array reorder (Spec 2026-06-17, Task Group 2): the two
      // arrays are the same multiset but in a different order. Record a SINGLE
      // `ordering` marker on the array path INSTEAD of the per-element
      // `value_changed` cascade the positional walk would otherwise produce.
      // A volatile-flagged array took the order-insensitive branch above; a
      // genuine content/length change falls through to the positional walk.
      sArr.length > 0 &&
      multisetEqual(sArr, tArr) &&
      !arraysStrictlyEqual(sArr, tArr)
    ) {
      diffs.push({
        path: pointer,
        kind: 'ordering',
        sourceValue: source,
        targetValue: target,
      });
      return;
    }

    const maxLen = Math.max(sArr.length, tArr.length);
    for (let i = 0; i < maxLen; i += 1) {
      const childPointer = buildPointer(pointer, i);
      const inSource = i < sArr.length;
      const inTarget = i < tArr.length;
      if (inSource && inTarget) {
        walk(sArr[i], tArr[i], childPointer, diffs, ctx);
      } else if (inSource) {
        diffs.push({
          path: childPointer,
          kind: 'key_removed',
          sourceValue: sArr[i],
        });
      } else {
        diffs.push({
          path: childPointer,
          kind: 'key_added',
          targetValue: tArr[i],
        });
      }
    }
    return;
  }

  // Primitives + null + undefined.
  if (source !== target) {
    // VALUE change. Consult per-path tolerance: a volatile leaf is recorded
    // with a `volatilitySource` tag rather than a strict `value_changed`.
    const tolerance = resolveValueTolerance(pointer, source, target, ctx);
    diffs.push({
      path: pointer,
      kind: 'value_changed',
      sourceValue: source,
      targetValue: target,
      ...(tolerance ? { volatilitySource: tolerance } : {}),
    });
  }
}

/** Strict positional equality of two arrays via canonical keys. */
function arraysStrictlyEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (canonicalKey(a[i]) !== canonicalKey(b[i])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Header walk (Spec 2026-06-17, Task Group 2)
// ---------------------------------------------------------------------------

/**
 * Compare two response-header maps, both already KNOWN to be present (the
 * graceful-degrade skip is decided by the caller before this runs).
 *
 * Header names are matched CASE-INSENSITIVELY (HTTP header names are
 * case-insensitive); the first-seen original casing is preserved on the entry
 * for display. Outcomes:
 *
 *   - a name present on exactly one side -> `presence` entry (ALWAYS breaks);
 *   - a name on both sides with a differing value -> `value` entry. When the
 *     name is on {@link VOLATILE_HEADER_NAMES} the entry is tagged `declared`
 *     (tolerated); otherwise it is a strict break.
 *
 * Values are compared by canonical-key equality so structurally-equal values
 * (e.g. arrays of cookies) don't false-positive on declaration order.
 */
function walkHeaders(
  sourceHeaders: Record<string, unknown>,
  targetHeaders: Record<string, unknown>,
  // Spec 2026-07-06-j: waiver-driven allowlist predicate. Defaults to the
  // legacy in-code VOLATILE_HEADER_NAMES so every existing caller is
  // byte-identical; the diff runner passes the AMS waiver set instead.
  isAllowlisted: (name: string) => boolean = isVolatileHeaderName,
): HeaderDiffEntry[] {
  const entries: HeaderDiffEntry[] = [];

  // Build lower-cased lookup maps preserving the original key + value.
  const sLower = new Map<string, { name: string; value: unknown }>();
  for (const k of Object.keys(sourceHeaders)) {
    sLower.set(k.toLowerCase(), { name: k, value: sourceHeaders[k] });
  }
  const tLower = new Map<string, { name: string; value: unknown }>();
  for (const k of Object.keys(targetHeaders)) {
    tLower.set(k.toLowerCase(), { name: k, value: targetHeaders[k] });
  }

  // Union of header names (lower-cased), source-first for stable ordering.
  const seen = new Set<string>();
  const order: string[] = [];
  for (const k of sLower.keys()) {
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  }
  for (const k of tLower.keys()) {
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  }

  for (const lower of order) {
    const s = sLower.get(lower);
    const t = tLower.get(lower);
    const name = (s ?? t)!.name;
    const headerPointer = buildPointer('', name);

    if (s && !t) {
      // Present on source, absent on target -- presence drift, ALWAYS breaks.
      entries.push({
        path: headerPointer,
        kind: 'presence',
        headerName: name,
        sourceValue: s.value,
      });
      continue;
    }
    if (!s && t) {
      // Absent on source, present on target -- presence drift, ALWAYS breaks.
      entries.push({
        path: headerPointer,
        kind: 'presence',
        headerName: name,
        targetValue: t.value,
      });
      continue;
    }
    // Present on both -- compare values.
    if (canonicalKey(s!.value) !== canonicalKey(t!.value)) {
      const tolerated = isAllowlisted(name);
      entries.push({
        path: headerPointer,
        kind: 'value',
        headerName: name,
        sourceValue: s!.value,
        targetValue: t!.value,
        // Allowlisted header VALUE change -> tolerated, tagged `declared`.
        ...(tolerated ? { volatilitySource: 'declared' as VolatilitySource } : {}),
      });
    }
  }

  return entries;
}

/**
 * Classify a set of header diff entries. Mirrors {@link classify} for the
 * body dimension:
 *   - any `presence` entry -> `header_presence_drift` (presence wins; ALWAYS
 *     a break, never tolerated);
 *   - else any `value` entry (tolerated OR not) -> `header_value_drift`. The
 *     dimension stays VISIBLE even for allowlisted-only value changes
 *     (create-then-auto-dispose): the gateway pass reads the `declared`
 *     volatility tag off the entries and disposes the break to
 *     `expected_volatile`. The comparator NEVER silently drops it.
 *   - else `header_match` (no entries).
 */
function classifyHeaders(entries: HeaderDiffEntry[]): HeaderClassification {
  if (entries.some((e) => e.kind === 'presence')) return 'header_presence_drift';
  if (entries.some((e) => e.kind === 'value')) return 'header_value_drift';
  return 'header_match';
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Whether a `value_changed` entry was TOLERATED (carries a volatilitySource).
 * Tolerated value entries do NOT count toward `body_value_drift`.
 */
function isToleratedValue(d: BodyDiffEntry): boolean {
  return d.kind === 'value_changed' && d.volatilitySource !== undefined;
}

function classify(diffs: BodyDiffEntry[]): BodyClassification {
  // Tolerated value entries are not real drift -- exclude them from
  // classification entirely. They remain in `bodyDiffJson` for audit.
  const effective = diffs.filter((d) => !isToleratedValue(d));
  if (effective.length === 0) return 'body_match';
  // Shape wins over value wins over ordering.
  const hasShape = effective.some(
    (d) =>
      d.kind === 'key_added' ||
      d.kind === 'key_removed' ||
      d.kind === 'type_changed',
  );
  if (hasShape) return 'body_shape_drift';
  const hasValue = effective.some((d) => d.kind === 'value_changed');
  if (hasValue) return 'body_value_drift';
  // Only ordering markers remain -> ordering drift (Spec 2026-06-17).
  const hasOrdering = effective.some((d) => d.kind === 'ordering');
  if (hasOrdering) return 'body_ordering_drift';
  return 'body_match';
}

function distinctSourcesTouched(
  diffs: BodyDiffEntry[],
  headerDiffs: HeaderDiffEntry[],
): VolatilitySource[] {
  const seen: VolatilitySource[] = [];
  for (const d of diffs) {
    if (d.volatilitySource && !seen.includes(d.volatilitySource)) {
      seen.push(d.volatilitySource);
    }
  }
  for (const h of headerDiffs) {
    if (h.volatilitySource && !seen.includes(h.volatilitySource)) {
      seen.push(h.volatilitySource);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Comparison options (Spec 2026-07-06-j — Parity Exactness & First-Class SOAP)
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/no-cycle -- xmlComparator has no imports back
import { compareXmlBytes } from './xmlComparator';

export type ComparisonProfile = 'standard' | 'strict';

/** The AMS waiver rows folded into fast lookup sets (comparisonWaivers.ts). */
export interface WaiverSet {
  headerNames: Set<string>;
  bodyPaths: Set<string>;
  xmlXPaths: Set<string>;
  orderingPaths: Set<string>;
}

export interface CompareOptions {
  /** Defaults to 'standard' — today's semantics, byte-identical. */
  profile?: ComparisonProfile;
  /**
   * When present, REPLACES the legacy in-code header allowlist and supplies
   * the body/XML/ordering waivers. Absent => legacy allowlist (back-compat).
   */
  waivers?: WaiverSet | null;
  /** RAW wire bodies for the strict byte verdict; null = raw unavailable. */
  sourceRaw?: string | null;
  targetRaw?: string | null;
}

/** Strict-profile byte verdict (null on the standard profile). */
export type ByteClassification = 'byte_match' | 'byte_drift' | 'raw_unavailable' | null;

/**
 * Compare two JSON bodies. See file header for the normalisation rule and
 * the classification semantics.
 *
 * @param ctx OPTIONAL per-path volatility context (Spec 2026-06-16, Task
 *   Group 3). When omitted / undefined the comparison is EXACTLY the strict
 *   v1 for the BODY/VALUE dimensions -- the backward-compat guard (G1). A
 *   `null` envelope inside the ctx is also strict. NOTE: the HEADER + ORDERING
 *   dimensions (Spec 2026-06-17) are always computed regardless of `ctx`;
 *   they are pure functions of the wrapper shape, and they degrade gracefully
 *   (header dimension skipped when a side lacks the wrapper) so inputs that
 *   exercised only body/status are unaffected.
 * @param options OPTIONAL Spec 2026-07-06-j extension: comparison profile,
 *   the AMS waiver set (replacing the in-code header allowlist), and the raw
 *   wire bodies for the strict byte verdict. Omitted => byte-identical
 *   legacy behaviour with `byteClassification: null`.
 */
export function compareJsonShapes(
  source: unknown,
  target: unknown,
  ctx?: VolatilityContext,
  options?: CompareOptions,
): CompareJsonShapesResult {
  // Header dimension (Spec 2026-06-17). Read the PRE-unwrap `headers` key from
  // BOTH sides. GRACEFUL DEGRADE: when EITHER side lacks the `{ headers, body }`
  // wrapper (old source baselines store the raw body), the header dimension is
  // SKIPPED entirely -- `headerClassification` stays null, NO header entry is
  // emitted (no false break, no backfill). Spec R5.
  const sHeaders = extractHeaders(source);
  const tHeaders = extractHeaders(target);
  // Spec 2026-07-06-j: a passed waiver set REPLACES the legacy in-code
  // header allowlist; absent => legacy behaviour, byte-identical.
  const isAllowlisted = options?.waivers
    ? (name: string) => options.waivers!.headerNames.has(name.toLowerCase())
    : isVolatileHeaderName;
  let headerClassification: HeaderClassification | null = null;
  let headerDiffJson: HeaderDiffEntry[] = [];
  if (sHeaders !== undefined && tHeaders !== undefined) {
    headerDiffJson = walkHeaders(sHeaders, tHeaders, isAllowlisted);
    headerClassification = classifyHeaders(headerDiffJson);
  }

  // Step 1 -- symmetric wrapper unwrap. THE critical normalisation; see
  // the file header for the reasoning.
  const sUnwrapped = unwrapBodyEnvelope(source);
  const tUnwrapped = unwrapBodyEnvelope(target);

  // Step 2 -- parallel walk.
  const diffs: BodyDiffEntry[] = [];
  walk(sUnwrapped, tUnwrapped, '', diffs, ctx);

  // Step 2b (Spec 2026-07-06-j) -- body-path waivers tolerate VALUE and
  // ORDERING drift at the waived path exactly like probed volatility (shape
  // still breaks; a waiver is a tolerance, never a blindfold on structure).
  if (options?.waivers && options.waivers.bodyPaths.size > 0) {
    for (const d of diffs) {
      if (d.volatilitySource !== undefined) continue;
      if (
        (d.kind === 'value_changed' || d.kind === 'ordering') &&
        options.waivers.bodyPaths.has(d.path)
      ) {
        d.volatilitySource = 'waived';
      }
    }
  }

  // Step 3 -- aggregate (+ the strict-profile byte verdict).
  return {
    bodyClassification: classify(diffs),
    bodyDiffJson: diffs,
    headerClassification,
    headerDiffJson,
    volatilitySourcesTouched: distinctSourcesTouched(diffs, headerDiffJson),
    byteClassification:
      options?.profile === 'strict'
        ? computeByteClassification(options, ctx, diffs)
        : null,
  };
}

/**
 * Strict-profile byte verdict (Spec 2026-07-06-j).
 *
 *   - Either raw missing            -> 'raw_unavailable' (VISIBLE degrade;
 *     never a false exact — pre-raw baselines and redaction-touched bodies).
 *   - No tolerated paths in play    -> direct RAW BYTE equality.
 *   - Tolerated paths (probed volatility + body-path waivers) -> both raws
 *     are parsed, the tolerated paths are MASKED, and the masked trees are
 *     compared via stable canonical serialisation (a masked compare cannot
 *     be byte-faithful by definition; the mask set is enumerated in the
 *     verdict's meaning). XML raws route through the namespace-aware
 *     canonical XML comparer with XPath masks.
 */
function computeByteClassification(
  options: CompareOptions,
  ctx: VolatilityContext | undefined,
  diffs: BodyDiffEntry[],
): ByteClassification {
  const sourceRaw = options.sourceRaw ?? null;
  const targetRaw = options.targetRaw ?? null;
  if (sourceRaw === null || targetRaw === null) return 'raw_unavailable';

  const maskPaths = new Set<string>();
  for (const d of diffs) {
    if (d.volatilitySource !== undefined) maskPaths.add(d.path);
  }
  for (const waived of options.waivers?.bodyPaths ?? []) maskPaths.add(waived);

  const looksXml = /^\s*</.test(sourceRaw) || /^\s*</.test(targetRaw);
  if (looksXml) {
    return compareXmlBytes(
      sourceRaw,
      targetRaw,
      options.waivers?.xmlXPaths ?? new Set<string>(),
    );
  }

  if (maskPaths.size === 0) {
    return sourceRaw === targetRaw ? 'byte_match' : 'byte_drift';
  }
  try {
    const maskedSource = maskJsonPaths(JSON.parse(sourceRaw), maskPaths);
    const maskedTarget = maskJsonPaths(JSON.parse(targetRaw), maskPaths);
    return canonicalStringify(maskedSource) === canonicalStringify(maskedTarget)
      ? 'byte_match'
      : 'byte_drift';
  } catch {
    // Unparseable raw with masks in play: fall back to direct byte equality
    // (still honest — a match is a match; a mismatch may be volatile noise,
    // which the body dimension already tolerated and the verdict reports).
    return sourceRaw === targetRaw ? 'byte_match' : 'byte_drift';
  }
}

/** Replace the node at each JSON-pointer-ish diff path with a mask marker. */
function maskJsonPaths(value: unknown, paths: Set<string>): unknown {
  const MASK = '«masked»';
  const apply = (node: unknown, currentPath: string): unknown => {
    if (paths.has(currentPath)) return MASK;
    if (Array.isArray(node)) {
      return node.map((child, i) => apply(child, `${currentPath}/${i}`));
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = apply(v, `${currentPath}/${k}`);
      }
      return out;
    }
    return node;
  };
  return apply(value, '');
}

/** Stable canonical serialisation (sorted keys) for masked comparisons. */
function canonicalStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = sort((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
