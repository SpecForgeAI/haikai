/**
 * Deterministic JSON shape comparator for the diff engine.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
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
 * Out of scope (deferred to v2 per accepted Q11)
 * ---------------------------------------------------------------------------
 *
 *   - Unordered array comparison (match-by-id). v1 compares arrays
 *     positionally; index-based pointers are deterministic.
 *   - Volatile-value allowlist (timestamps, UUIDs). v1 records every leaf
 *     drift; Spec #6 layers user-input "expected drift" overrides on top.
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
}

export interface CompareJsonShapesResult {
  bodyClassification: BodyClassification;
  bodyDiffJson: BodyDiffEntry[];
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

function buildPointer(parent: string, key: string | number): string {
  const token =
    typeof key === 'number' ? String(key) : escapePointerToken(key);
  return `${parent}/${token}`;
}

/**
 * Recursive parallel walk. Mutates `diffs` in place.
 *
 * Behaviour by node-pair type:
 *   - Both objects     -> walk key union; classify per-key as
 *                         key_added / key_removed / recurse
 *   - Both arrays      -> walk by position; missing positions are
 *                         key_added / key_removed
 *   - Same primitive   -> equality check -> match or value_changed
 *   - Differing types  -> type_changed
 *   - One null/other   -> type_changed
 */
function walk(
  source: unknown,
  target: unknown,
  pointer: string,
  diffs: BodyDiffEntry[],
): void {
  const sType = jsonTypeOf(source);
  const tType = jsonTypeOf(target);

  if (sType !== tType) {
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
        diffs.push({
          path: childPointer,
          kind: 'key_removed',
          sourceValue: sObj[k],
        });
        continue;
      }
      walk(sObj[k], tObj[k], childPointer, diffs);
    }
    for (const k of tKeys) {
      if (seen.has(k)) continue;
      const childPointer = buildPointer(pointer, k);
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
    const maxLen = Math.max(sArr.length, tArr.length);
    for (let i = 0; i < maxLen; i += 1) {
      const childPointer = buildPointer(pointer, i);
      const inSource = i < sArr.length;
      const inTarget = i < tArr.length;
      if (inSource && inTarget) {
        walk(sArr[i], tArr[i], childPointer, diffs);
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
    diffs.push({
      path: pointer,
      kind: 'value_changed',
      sourceValue: source,
      targetValue: target,
    });
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function classify(diffs: BodyDiffEntry[]): BodyClassification {
  if (diffs.length === 0) return 'body_match';
  // Shape wins over value: any add / remove / type change -> shape drift.
  const hasShape = diffs.some(
    (d) =>
      d.kind === 'key_added' ||
      d.kind === 'key_removed' ||
      d.kind === 'type_changed',
  );
  if (hasShape) return 'body_shape_drift';
  return 'body_value_drift';
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Compare two JSON bodies. See file header for the normalisation rule and
 * the classification semantics.
 */
export function compareJsonShapes(
  source: unknown,
  target: unknown,
): CompareJsonShapesResult {
  // Step 1 -- symmetric wrapper unwrap. THE critical normalisation; see
  // the file header for the reasoning.
  const sUnwrapped = unwrapBodyEnvelope(source);
  const tUnwrapped = unwrapBodyEnvelope(target);

  // Step 2 -- parallel walk.
  const diffs: BodyDiffEntry[] = [];
  walk(sUnwrapped, tUnwrapped, '', diffs);

  // Step 3 -- aggregate.
  return {
    bodyClassification: classify(diffs),
    bodyDiffJson: diffs,
  };
}
