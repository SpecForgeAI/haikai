/**
 * jsonShapeComparator volatility-tolerance unit tests.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 3 sub-task 3.1.
 *
 * Test inventory (focused; includes the cross-cutting guards G1 + G3):
 *   1. value diff on a volatile leaf -> NO `value_changed` drift entry
 *      (tolerated, tagged `probed`); volatile array -> multiset (order-
 *      insensitive) compare yields `body_match`.
 *   2. SHAPE diff (key added / removed, type changed) on a volatile path ->
 *      STILL reported (volatility tolerates VALUES + ORDERING only).
 *   3. `non_deterministic_endpoint` signal present (probe recorded nothing)
 *      -> whole-response value tolerance; presence / shape still compared;
 *      tagged `endpoint_signal`.
 *   4. heuristic match (ISO-8601 / RFC-4122 UUID / time-named epoch-millis)
 *      on an UNPROBED path -> tagged `heuristic`.
 *   G1 (backward-compat): no ctx (and a `null` envelope ctx) -> EXACTLY the
 *      strict comparison; no behavioural change.
 *   G3 (no-override): a deliberately-changed NON-volatile leaf still produces
 *      a real `value_changed` drift entry even when the same response carries
 *      volatile paths.
 */

import {
  compareJsonShapes,
  type VolatilityContext,
  type VolatilityEnvelope,
} from '../services/jsonShapeComparator';

function probedEnvelope(
  paths: string[],
  arrayPaths?: string[],
): VolatilityEnvelope {
  return {
    paths,
    volatility_source: 'probed',
    k: 3,
    ...(arrayPaths ? { array_paths: arrayPaths } : {}),
  };
}

describe('compareJsonShapes -- volatility tolerance (Spec 2026-06-16)', () => {
  // -------------------------------------------------------------------------
  // 1. value diff on a volatile leaf is tolerated; volatile array is multiset
  // -------------------------------------------------------------------------
  test('1a. value diff on a volatile leaf -> no value_changed drift, tagged probed', () => {
    const source = { id: 1, updatedAt: '2026-06-16T10:00:00Z', name: 'alice' };
    const target = { id: 1, updatedAt: '2026-06-16T11:30:00Z', name: 'alice' };
    const ctx: VolatilityContext = { envelope: probedEnvelope(['/updatedAt']) };

    const result = compareJsonShapes(source, target, ctx);

    // Tolerated -> not counted as drift.
    expect(result.bodyClassification).toBe('body_match');
    // The entry is still recorded (audit) but tagged volatile, not strict.
    const entry = result.bodyDiffJson.find((d) => d.path === '/updatedAt');
    expect(entry).toBeDefined();
    expect(entry?.volatilitySource).toBe('probed');
    expect(result.volatilitySourcesTouched).toEqual(['probed']);
  });

  test('1b. volatile array -> order-insensitive (multiset) compare -> body_match', () => {
    const source = { items: [{ v: 1 }, { v: 2 }, { v: 3 }] };
    const target = { items: [{ v: 3 }, { v: 1 }, { v: 2 }] };
    const ctx: VolatilityContext = {
      envelope: probedEnvelope([], ['/items']),
    };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_match');
    expect(result.volatilitySourcesTouched).toEqual(['probed']);
  });

  test('1c. volatile array with a GENUINE content change still breaks', () => {
    // Order tolerated, but a value that is not present in the source at all
    // (4 replaces 3) is a real content change -> surfaces.
    const source = { items: [1, 2, 3] };
    const target = { items: [2, 4, 1] };
    const ctx: VolatilityContext = {
      envelope: probedEnvelope([], ['/items']),
    };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).not.toBe('body_match');
  });

  // -------------------------------------------------------------------------
  // 2. SHAPE diff on a volatile path is STILL reported
  // -------------------------------------------------------------------------
  test('2a. key_removed on a volatile path STILL breaks (shape, never tolerated)', () => {
    const source = { id: 1, token: 'abc' };
    const target = { id: 1 };
    const ctx: VolatilityContext = { envelope: probedEnvelope(['/token']) };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_shape_drift');
    const entry = result.bodyDiffJson.find((d) => d.path === '/token');
    expect(entry?.kind).toBe('key_removed');
    expect(entry?.volatilitySource).toBeUndefined();
  });

  test('2b. type_changed on a volatile path STILL breaks', () => {
    const source = { count: 5 };
    const target = { count: '5' };
    const ctx: VolatilityContext = { envelope: probedEnvelope(['/count']) };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_shape_drift');
    const entry = result.bodyDiffJson.find((d) => d.path === '/count');
    expect(entry?.kind).toBe('type_changed');
    expect(entry?.volatilitySource).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. non_deterministic_endpoint signal -> whole-response value tolerance
  // -------------------------------------------------------------------------
  test('3. endpoint signal (no probe paths) -> value tolerance, tagged endpoint_signal', () => {
    const source = { id: 1, a: 'x', b: 'y' };
    const target = { id: 2, a: 'z', b: 'w' };
    // No envelope paths -- the probe recorded nothing; only the signal.
    const ctx: VolatilityContext = { envelope: null, endpointSignal: true };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_match');
    expect(result.volatilitySourcesTouched).toEqual(['endpoint_signal']);
    // Presence / shape still compared under the signal.
    const shapeChange = compareJsonShapes(
      { id: 1, a: 'x' },
      { id: 1, a: 'x', extra: true },
      ctx,
    );
    expect(shapeChange.bodyClassification).toBe('body_shape_drift');
  });

  // -------------------------------------------------------------------------
  // 4. conservative heuristic on an UNPROBED path
  // -------------------------------------------------------------------------
  test('4a. ISO-8601 timestamp on an unprobed path -> tagged heuristic', () => {
    const source = { createdAt: '2026-06-16T10:00:00Z', name: 'alice' };
    const target = { createdAt: '2026-06-16T12:45:01Z', name: 'alice' };
    // No envelope at all -> heuristics enabled by the caller for unprobed ops.
    const ctx: VolatilityContext = { envelope: null, applyHeuristics: true };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_match');
    const entry = result.bodyDiffJson.find((d) => d.path === '/createdAt');
    expect(entry?.volatilitySource).toBe('heuristic');
  });

  test('4b. RFC-4122 UUID heuristic and time-named epoch-millis heuristic', () => {
    const ctx: VolatilityContext = { envelope: null, applyHeuristics: true };

    const uuid = compareJsonShapes(
      { ref: '5f9b8a2e-1c3d-4b6a-9e7f-2a1b0c3d4e5f' },
      { ref: 'a1b2c3d4-e5f6-4789-abcd-1234567890ab' },
      ctx,
    );
    expect(uuid.bodyClassification).toBe('body_match');
    expect(uuid.bodyDiffJson[0]?.volatilitySource).toBe('heuristic');

    const epoch = compareJsonShapes(
      { updatedAtMillis: 1_750_000_000_000 },
      { updatedAtMillis: 1_750_000_005_000 },
      ctx,
    );
    expect(epoch.bodyClassification).toBe('body_match');
    expect(epoch.bodyDiffJson[0]?.volatilitySource).toBe('heuristic');

    // A non-time-named integer is NOT tolerated by the epoch heuristic.
    const plain = compareJsonShapes(
      { quantity: 1_750_000_000_000 },
      { quantity: 9 },
      ctx,
    );
    expect(plain.bodyClassification).toBe('body_value_drift');
  });

  // -------------------------------------------------------------------------
  // G1 -- backward-compat guard
  // -------------------------------------------------------------------------
  test('G1a. no ctx -> EXACTLY strict comparison (no behavioural change)', () => {
    const source = { id: 1, updatedAt: '2026-06-16T10:00:00Z' };
    const target = { id: 1, updatedAt: '2026-06-16T11:30:00Z' };

    const result = compareJsonShapes(source, target);

    expect(result.bodyClassification).toBe('body_value_drift');
    expect(result.bodyDiffJson).toEqual([
      {
        path: '/updatedAt',
        kind: 'value_changed',
        sourceValue: '2026-06-16T10:00:00Z',
        targetValue: '2026-06-16T11:30:00Z',
      },
    ]);
    expect(result.volatilitySourcesTouched).toEqual([]);
  });

  test('G1b. null envelope + no signal -> strict (same as no ctx)', () => {
    const source = { id: 1, updatedAt: '2026-06-16T10:00:00Z' };
    const target = { id: 1, updatedAt: '2026-06-16T11:30:00Z' };
    const ctx: VolatilityContext = { envelope: null };

    const result = compareJsonShapes(source, target, ctx);

    expect(result.bodyClassification).toBe('body_value_drift');
    expect(result.volatilitySourcesTouched).toEqual([]);
  });

  test('G1c. non_json / not_probed envelopes are STRICT (no value tolerance)', () => {
    const source = { ts: '2026-06-16T10:00:00Z' };
    const target = { ts: '2026-06-16T11:00:00Z' };

    for (const tag of ['non_json', 'not_probed'] as const) {
      const ctx: VolatilityContext = {
        envelope: { paths: ['/ts'], volatility_source: tag, k: 0 },
      };
      const result = compareJsonShapes(source, target, ctx);
      expect(result.bodyClassification).toBe('body_value_drift');
      expect(result.volatilitySourcesTouched).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // G3 -- no-override guard
  // -------------------------------------------------------------------------
  test('G3. a deliberately-changed NON-volatile leaf still breaks alongside a volatile one', () => {
    const source = {
      updatedAt: '2026-06-16T10:00:00Z', // volatile (tolerated)
      balance: 100, // NOT volatile -- a real regression
    };
    const target = {
      updatedAt: '2026-06-16T11:30:00Z',
      balance: 250,
    };
    const ctx: VolatilityContext = { envelope: probedEnvelope(['/updatedAt']) };

    const result = compareJsonShapes(source, target, ctx);

    // The genuine regression on /balance still produces value drift.
    expect(result.bodyClassification).toBe('body_value_drift');
    const balance = result.bodyDiffJson.find((d) => d.path === '/balance');
    expect(balance?.kind).toBe('value_changed');
    expect(balance?.volatilitySource).toBeUndefined();
    // The volatile leaf is still tolerated + tagged.
    const ts = result.bodyDiffJson.find((d) => d.path === '/updatedAt');
    expect(ts?.volatilitySource).toBe('probed');
  });
});
