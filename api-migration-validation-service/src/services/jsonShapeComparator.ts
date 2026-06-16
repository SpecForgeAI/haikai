/**
 * Deterministic JSON shape comparator for the diff engine.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 *   Task Group 3 layers OPTIONAL per-path volatility tolerance on top of the
 *   strict comparison. See the "Volatility tolerance" section below. When NO
 *   volatility context is passed (the default), the comparator behaves
 *   EXACTLY as the original strict v1 -- the backward-compat guard (G1).
 *
 * Compares two JSON trees (a source response body and a target response body)
 * and classifies the result into one of three top-level buckets:
 *
 *   - `body_match`        -- deep equality after the symmetric wrapper unwrap
 *   - `body_shape_drift`  -- one or more keys added / removed OR a leaf type
 *                            change at one or more JSON-pointer paths
 *   - `body_value_drift`  -- same shape (key sets + types) but at least one
 *                            leaf value differs
 *
 * Shape wins over value: if any key/type drift exists, the top-level
 * classification is `body_shape_drift` even when there are also value
 * differences elsewhere. `body_value_drift` is reserved for the
 * exact-shape-with-different-leaves case.
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
 * break -- it only annotates value/order entries it has reclassified.
 *
 * ---------------------------------------------------------------------------
 * Out of scope (deferred to v2 per accepted Q11 of the original Diff Engine
 * spec; partially RESOLVED by the 2026-06-16 spec)
 * ---------------------------------------------------------------------------
 *
 *   - Header drift detection. Response headers legitimately vary across
 *     servers (server identifier, timestamp, request-id echo).
 *
 * Compares RESPONSE bodies only. Request bodies are identical-by-construction
 * (Spec #4 replay carries them verbatim).
 */

export type BodyClassification =
  | 'body_match'
  | 'body_shape_drift'
  | 'body_value_drift';

export type LeafDiffKind =
  | 'key_added'
  | 'key_removed'
  | 'type_changed'
  | 'value_changed';

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
  | 'not_probed';

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
   * The DISTINCT set of `volatility_source` tags that touched a tolerated
   * value/order entry in this comparison, in first-seen order. Empty when
   * nothing was tolerated. The gateway auto-disposition pass reads this (off
   * the persisted `body_diff_json` entries) to classify the break.
   *
   * Spec: 2026-06-16 -- Task Group 3 (metadata the gateway pass acts on).
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
// Step 1 -- symmetric wrapper unwrap
// ---------------------------------------------------------------------------

/**
 * If `json` is an object whose keys are EXACTLY `headers` and `body` (and
 * nothing else), return `json.body`. Otherwise return `json` unchanged.
 *
 * Applied symmetrically to both inputs before any walking. See the file
 * header for why this matters -- without it, every paired item would be
 * flagged `body_shape_drift`.
 */
export function unwrapBodyEnvelope(json: unknown): unknown {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return json;
  }
  const obj = json as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length === 2 &&
    Object.prototype.hasOwnProperty.call(obj, 'headers') &&
    Object.prototype.hasOwnProperty.call(obj, 'body')
  ) {
    return obj.body;
  }
  return json;
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
 * are byte-identical. Do NOT re-author path normalisation; reuse this.
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
 * regardless of order. Used for volatile-flagged arrays.
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
 *                         otherwise walk by position; missing positions are
 *                         key_added / key_removed
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
  // Shape wins over value: any add / remove / type change -> shape drift.
  const hasShape = effective.some(
    (d) =>
      d.kind === 'key_added' ||
      d.kind === 'key_removed' ||
      d.kind === 'type_changed',
  );
  if (hasShape) return 'body_shape_drift';
  return 'body_value_drift';
}

function distinctSourcesTouched(diffs: BodyDiffEntry[]): VolatilitySource[] {
  const seen: VolatilitySource[] = [];
  for (const d of diffs) {
    if (d.volatilitySource && !seen.includes(d.volatilitySource)) {
      seen.push(d.volatilitySource);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Compare two JSON bodies. See file header for the normalisation rule and
 * the classification semantics.
 *
 * @param ctx OPTIONAL per-path volatility context (Spec 2026-06-16, Task
 *   Group 3). When omitted / undefined the comparison is EXACTLY the strict
 *   v1 -- the backward-compat guard (G1). A `null` envelope inside the ctx is
 *   also strict.
 */
export function compareJsonShapes(
  source: unknown,
  target: unknown,
  ctx?: VolatilityContext,
): CompareJsonShapesResult {
  // Step 1 -- symmetric wrapper unwrap. THE critical normalisation; see
  // the file header for the reasoning.
  const sUnwrapped = unwrapBodyEnvelope(source);
  const tUnwrapped = unwrapBodyEnvelope(target);

  // Step 2 -- parallel walk.
  const diffs: BodyDiffEntry[] = [];
  walk(sUnwrapped, tUnwrapped, '', diffs, ctx);

  // Step 3 -- aggregate.
  return {
    bodyClassification: classify(diffs),
    bodyDiffJson: diffs,
    volatilitySourcesTouched: distinctSourcesTouched(diffs),
  };
}
